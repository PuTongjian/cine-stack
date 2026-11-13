import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const db = vi.hoisted(() => ({
  task: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  resource: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
}))
vi.mock('../../../apps/api/src/infrastructure/database.js', () => ({
  database: db,
}))
vi.mock('../../../apps/api/src/infrastructure/config.js', () => ({
  dataDir: '/tmp/movie-task-fixture',
}))
vi.mock('@movie/crawler-engine', () => ({
  SuenenClient: class {},
  QuarkClient: class {},
}))
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), writeFile: vi.fn() }))

import { TaskService } from '../../../apps/api/src/modules/tasks/tasks.js'

beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.unstubAllEnvs())

function stagedTransfer(
  incoming: any[] = [{ fid: 'new', file_name: 'Film (2024).mp4' }]
) {
  const task = {
    id: 'replacement',
    movieId: 42,
    targetFolderId: 'movie',
    remoteTaskId: 'remote',
    payload: '{}',
    status: 'queued',
    stage: 'queued',
    result: JSON.stringify({
      stagingFolderId: 'staging',
      previousFileIds: ['old'],
    }),
  }
  const tree = new Map<string, any[]>([
    [
      'movie',
      [
        { fid: 'old', file_name: 'Film (2024).mkv' },
        { fid: 'staging', file_name: '_incoming-replacement', dir: true },
      ],
    ],
    ['staging', incoming],
  ])
  const locate = (id: string) => {
    for (const [parent, files] of tree) {
      const file = files.find(file => file.fid === id)
      if (file) return { parent, file }
    }
    throw new Error(`Missing fixture file ${id}`)
  }
  const quark = {
    waitTask: vi.fn(async () => {}),
    listFiles: vi.fn(async (id: string) => structuredClone(tree.get(id) || [])),
    rename: vi.fn(async (id: string, name: string) => {
      const { parent, file } = locate(id)
      if (
        tree
          .get(parent)!
          .some(other => other.fid !== id && other.file_name === name)
      )
        throw new Error('QUARK_NAME_CONFLICT')
      file.file_name = name
    }),
    move: vi.fn(async (ids: string[], target: string) => {
      for (const id of ids) {
        const { parent, file } = locate(id)
        if (tree.get(target)!.some(other => other.file_name === file.file_name))
          throw new Error('QUARK_NAME_CONFLICT')
        tree.set(
          parent,
          tree.get(parent)!.filter(other => other.fid !== id)
        )
        tree.get(target)!.push(file)
      }
    }),
    delete: vi.fn(async (ids: string[]) => {
      for (const id of ids) {
        const { parent } = locate(id)
        tree.set(
          parent,
          tree.get(parent)!.filter(file => file.fid !== id)
        )
        tree.delete(id)
      }
    }),
    uploadSmallFile: vi.fn(async () => ({})),
  }
  db.task.findUniqueOrThrow.mockImplementation(async () => ({ ...task }))
  db.task.update.mockImplementation(async ({ data }) =>
    Object.assign(task, data)
  )
  const service = new TaskService({
    detail: async () => ({ id: 42, title: 'Film', release_date: '2024-01-01' }),
  } as any)
  vi.spyOn(service, 'quark').mockReturnValue(quark as any)
  return { service, task, tree, quark }
}

test('replaces a previous download even when the video extension changes', async () => {
  const { service, tree, task } = stagedTransfer()
  await service.transfer('replacement')
  expect(task.status).toBe('completed')
  expect(tree.get('movie')).toEqual([
    { fid: 'new', file_name: 'Film (2024).mp4' },
  ])
  expect(JSON.parse(task.result)).toMatchObject({
    replaced: 1,
    transferred: true,
  })
})

test.each(['folder', 'video and subtitle'])(
  'waits for delayed move listings when saving a %s before removing the old copy',
  async selection => {
    vi.useFakeTimers()
    try {
      const incoming =
        selection === 'folder'
          ? [{ fid: 'disc', file_name: 'Movie folder', dir: true }]
          : [
              { fid: 'new', file_name: 'release.mkv' },
              { fid: 'sub', file_name: 'release.srt' },
            ]
      const { service, task, tree, quark } = stagedTransfer(incoming)
      if (selection === 'folder')
        tree.set('disc', [{ fid: 'video', file_name: 'release.mkv' }])
      const listFiles = quark.listFiles.getMockImplementation()!
      const move = quark.move.getMockImplementation()!
      let staleTarget: any[] | undefined
      let staleSource: any[] | undefined
      quark.move.mockImplementation(async (ids, target) => {
        staleTarget = await listFiles(target)
        staleSource = await listFiles('staging')
        await move(ids, target)
      })
      quark.listFiles.mockImplementation(async folder => {
        if (folder === 'movie' && staleTarget) {
          const stale = staleTarget
          staleTarget = undefined
          return stale
        }
        if (folder === 'staging' && staleSource) {
          const stale = staleSource
          staleSource = undefined
          return stale
        }
        return listFiles(folder)
      })
      const pending = service.transfer('replacement')
      await vi.runAllTimersAsync()
      await pending
      expect(task.status).toBe('completed')
      expect(
        tree
          .get('movie')
          ?.map(file => file.fid)
          .sort()
      ).toEqual(incoming.map(file => file.fid).sort())
      expect(JSON.parse(task.result).metadataUploaded).toBe(true)
      expect(
        tree.get('movie')?.some(file => file.file_name.startsWith('_incoming-'))
      ).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  }
)

test('waits for all selected files before recording the replacement, including delayed subtitles', async () => {
  vi.useFakeTimers()
  try {
    const { service, task, tree, quark } = stagedTransfer([
      { fid: 'new', file_name: 'release.mkv' },
      { fid: 'sub', file_name: 'release.srt' },
    ])
    task.payload = JSON.stringify({ fileIds: ['sourcevideo', 'sourcesub'] })
    const listFiles = quark.listFiles.getMockImplementation()!
    let firstRead = true
    quark.listFiles.mockImplementation(async folder => {
      const files = await listFiles(folder)
      if (folder === 'staging' && firstRead) {
        firstRead = false
        return files.slice(0, 1)
      }
      return files
    })
    const pending = service.transfer('replacement')
    await vi.runAllTimersAsync()
    await pending
    expect(task.status).toBe('completed')
    expect(tree.get('movie')).toEqual([
      { fid: 'new', file_name: 'Film (2024).mkv' },
      { fid: 'sub', file_name: 'Film (2024).srt' },
    ])
    expect(JSON.parse(task.result).replacementFiles).toHaveLength(2)
  } finally {
    vi.useRealTimers()
  }
})

test('a failed promotion preserves the original download and retry finishes the replacement', async () => {
  const { service, tree, quark, task } = stagedTransfer([
    { fid: 'new', file_name: 'Film (2024).mkv' },
  ])
  quark.move.mockRejectedValueOnce(new Error('QUARK_MOVE_FAILED'))
  await service.transfer('replacement')
  expect(task.status).toBe('partial')
  expect(tree.get('movie')).toContainEqual({
    fid: 'old',
    file_name: 'Film (2024).mkv',
  })
  expect(quark.delete).not.toHaveBeenCalled()
  await service.transfer('replacement')
  expect(task.status).toBe('completed')
  expect(tree.get('movie')).toEqual([
    { fid: 'new', file_name: 'Film (2024).mkv' },
  ])
})

test('a partially applied move resumes using the persisted file IDs and original names', async () => {
  const { service, tree, quark, task } = stagedTransfer([
    { fid: 'new', file_name: 'Film (2024).mkv' },
    { fid: 'sub', file_name: 'Film (2024).srt' },
  ])
  const move = quark.move.getMockImplementation()!
  quark.move.mockImplementationOnce(async (ids, target) => {
    await move(ids.slice(0, 1), target)
    throw new Error('QUARK_MOVE_PENDING')
  })
  await service.transfer('replacement')
  expect(task.status).toBe('partial')
  expect(tree.get('movie')).toContainEqual({
    fid: 'old',
    file_name: 'Film (2024).mkv',
  })
  expect(quark.delete).not.toHaveBeenCalled()
  expect(JSON.parse(task.result).replacementFiles).toEqual([
    { fid: 'new', file_name: 'Film (2024).mkv' },
    { fid: 'sub', file_name: 'Film (2024).srt' },
  ])
  await service.transfer('replacement')
  expect(task.status).toBe('completed')
  expect(tree.get('movie')).toEqual([
    { fid: 'new', file_name: 'Film (2024).mkv' },
    { fid: 'sub', file_name: 'Film (2024).srt' },
  ])
})

test('a successful move response is verified before any original resource is deleted', async () => {
  const { service, tree, quark, task } = stagedTransfer()
  quark.move.mockResolvedValueOnce(undefined)
  await service.transfer('replacement')
  expect(task.status).toBe('partial')
  expect(tree.get('movie')).toContainEqual({
    fid: 'old',
    file_name: 'Film (2024).mkv',
  })
  expect(quark.delete).not.toHaveBeenCalled()
  await service.transfer('replacement')
  expect(task.status).toBe('completed')
})

test('retry after an uncertain delete never deletes the promoted copy', async () => {
  const { service, tree, quark, task } = stagedTransfer()
  const remove = quark.delete.getMockImplementation()!
  quark.delete.mockImplementationOnce(async ids => {
    await remove(ids)
    throw new Error('QUARK_HTTP_503')
  })
  await service.transfer('replacement')
  expect(task.status).toBe('partial')
  expect(tree.get('movie')?.some(file => file.fid === 'new')).toBe(true)
  await service.transfer('replacement')
  expect(task.status).toBe('completed')
  expect(tree.get('movie')).toEqual([
    { fid: 'new', file_name: 'Film (2024).mp4' },
  ])
  expect(quark.delete.mock.calls.flatMap(([ids]) => ids)).not.toContain('new')
})

test('retrying an older partial task does not treat a newer download as its own replacement', async () => {
  const { service, tree, quark, task } = stagedTransfer()
  quark.uploadSmallFile.mockRejectedValueOnce(
    new Error('QUARK_METADATA_UNAVAILABLE')
  )
  await service.transfer('replacement')
  expect(task.status).toBe('partial')
  tree.set('movie', [{ fid: 'newer', file_name: 'Film (2024).mkv' }])
  quark.delete.mockClear()
  quark.rename.mockClear()
  await service.transfer('replacement')
  expect(task.status).toBe('partial')
  expect(tree.get('movie')).toEqual([
    { fid: 'newer', file_name: 'Film (2024).mkv' },
  ])
  expect(quark.delete).not.toHaveBeenCalled()
  expect(quark.rename).not.toHaveBeenCalled()
})

test('replacement accepts every video format supported by STRM', async () => {
  const { service, tree, task } = stagedTransfer([
    { fid: 'new', file_name: 'release.webm' },
  ])
  await service.transfer('replacement')
  expect(task.status).toBe('completed')
  expect(tree.get('movie')).toEqual([
    { fid: 'new', file_name: 'Film (2024).webm' },
  ])
})

test('replacement preserves selected directories containing multiple nested videos', async () => {
  const { service, tree, task } = stagedTransfer([
    { fid: 'disc1', file_name: 'Disc 1', dir: true },
    { fid: 'disc2', file_name: 'Disc 2', dir: true },
  ])
  tree.set('disc1', [{ fid: 'v1', file_name: 'Part 1.mkv' }])
  tree.set('disc2', [{ fid: 'v2', file_name: 'Part 2.mp4' }])
  await service.transfer('replacement')
  expect(
    tree
      .get('movie')
      ?.map(file => file.fid)
      .sort()
  ).toEqual(['disc1', 'disc2'])
  expect(JSON.parse(task.result)).toMatchObject({
    transferred: true,
    metadataUploaded: true,
  })
})

test('a replacement without videos leaves the original and staging contents intact', async () => {
  const { service, tree, quark } = stagedTransfer([
    { fid: 'text', file_name: 'readme.txt' },
  ])
  await service.transfer('replacement')
  expect(tree.get('movie')).toContainEqual({
    fid: 'old',
    file_name: 'Film (2024).mkv',
  })
  expect(quark.delete).not.toHaveBeenCalled()
  expect(quark.move).not.toHaveBeenCalled()
})

test('an uncertain transfer cannot bypass the retry guard by submitting the same selection again', async () => {
  vi.stubEnv('QUARK_LIBRARY_FOLDER_ID', 'library')
  db.resource.findUnique.mockResolvedValue({ movieId: 42, shareId: 'share' })
  db.task.findUnique.mockResolvedValue({
    id: 'old',
    kind: 'transfer',
    status: 'failed',
    stage: 'transferring',
    remoteTaskId: null,
    result: '{}',
  })
  db.task.create.mockResolvedValue({ id: 'new', result: '{}' })
  const service = new TaskService({} as any)
  vi.spyOn(service, 'enqueue').mockImplementation(() => {})
  await expect(
    service.createTransfer({
      resourceId: 'resource',
      fileIds: ['video'],
      folderId: '0',
    })
  ).rejects.toThrow('转存结果待核对')
  expect(db.task.create).not.toHaveBeenCalled()
})

test.each(['completed', 'partial', 'failed'])(
  'a %s transfer allows downloading the same selection again',
  async status => {
    vi.stubEnv('QUARK_LIBRARY_FOLDER_ID', 'library')
    db.resource.findUnique.mockResolvedValue({ movieId: 42, shareId: 'share' })
    db.task.findUnique.mockResolvedValue({
      id: 'old',
      kind: 'transfer',
      status,
      stage: 'completed',
      remoteTaskId: 'remote',
      result: '{}',
    })
    db.task.create.mockResolvedValue({
      id: 'new',
      status: 'queued',
      result: '{}',
    })
    const service = new TaskService({} as any)
    const enqueue = vi.spyOn(service, 'enqueue').mockImplementation(() => {})
    expect(
      await service.createTransfer({
        resourceId: 'resource',
        fileIds: ['video'],
        folderId: '0',
      })
    ).toMatchObject({ id: 'new' })
    expect(db.task.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'old' },
      data: { idempotencyKey: null },
    })
    expect(db.task.create).toHaveBeenCalledOnce()
    expect(enqueue).toHaveBeenCalledOnce()
  }
)

test.each(['queued', 'running'])(
  'a %s transfer still deduplicates double clicks',
  async status => {
    vi.stubEnv('QUARK_LIBRARY_FOLDER_ID', 'library')
    db.resource.findUnique.mockResolvedValue({ movieId: 42, shareId: 'share' })
    db.task.findUnique.mockResolvedValue({
      id: 'old',
      kind: 'transfer',
      status,
      result: '{}',
    })
    const service = new TaskService({} as any)
    expect(
      await service.createTransfer({
        resourceId: 'resource',
        fileIds: ['video'],
        folderId: '0',
      })
    ).toMatchObject({ id: 'old' })
    expect(db.task.create).not.toHaveBeenCalled()
    expect(db.task.update).not.toHaveBeenCalled()
  }
)
