import { expect, test, vi } from 'vitest'
import { QuarkClient } from '../../../packages/crawler-engine/src/quark/client.mjs'

test('download links are resolved by file ID at playback time', async () => {
  const fetchImpl = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          status: 200,
          code: 0,
          data: [{ download_url: 'https://foo.pds.quark.cn/video' }],
        })
      )
  )
  const client = new QuarkClient({ cookie: 'secret', fetchImpl })
  await expect(client.downloadUrl('abc123')).resolves.toBe(
    'https://foo.pds.quark.cn/video'
  )
  expect(fetchImpl.mock.calls[0][0].pathname).toBe(
    '/1/clouddrive/file/download'
  )
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
    fids: ['abc123'],
  })
  await expect(
    client.downloadUrl('../../../packages/crawler-engine/src/secret')
  ).rejects.toThrow('QUARK_INVALID_FILE_ID')
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})
test('existing library folder is reused without remote writes', async () => {
  const fetchImpl = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          status: 200,
          code: 0,
          data: {
            list: [{ fid: 'existing', dir: true, file_name: 'MovieLibrary' }],
          },
        })
      )
  )
  const client = new QuarkClient({ cookie: 'fixture=value', fetchImpl })
  expect(await client.ensureFolder('parent', 'MovieLibrary')).toEqual({
    id: 'existing',
    name: 'MovieLibrary',
    created: false,
  })
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  expect(fetchImpl.mock.calls[0][1].method).toBe('GET')
})
test('upstream failures never expose their credential-bearing message', async () => {
  const client = new QuarkClient({
    cookie: 'secret',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ status: 401, code: 41001, message: 'secret' })
      ),
  })
  await expect(client.listFiles()).rejects.toThrow('QUARK_API_41001')
})
test('upload reuses an existing metadata file without overwriting it', async () => {
  const fetchImpl = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          status: 200,
          code: 0,
          data: { list: [{ fid: 'nfo', file_name: 'movie.nfo' }] },
        })
      )
  )
  const client = new QuarkClient({ cookie: 'secret', fetchImpl })
  await expect(
    client.uploadSmallFile('folder', 'movie.nfo', '<movie/>')
  ).resolves.toEqual({ id: 'nfo', existing: true })
  expect(fetchImpl).toHaveBeenCalledTimes(1)
})
test('metadata upload enforces its small-file boundary before network access', async () => {
  const fetchImpl = vi.fn()
  const client = new QuarkClient({ cookie: 'secret', fetchImpl })
  await expect(
    client.uploadSmallFile(
      'folder',
      'movie.nfo',
      Buffer.alloc(4 * 1024 * 1024 + 1)
    )
  ).rejects.toThrow('QUARK_METADATA_SIZE_LIMIT')
  expect(fetchImpl).not.toHaveBeenCalled()
})

test('move and recycle-bin deletion wait for remote tasks and skip empty batches', async () => {
  const fetchImpl = vi.fn(
    async url =>
      new Response(
        JSON.stringify({
          status: 200,
          code: 0,
          data: url.pathname.endsWith('/task')
            ? { status: 2 }
            : { task_id: 'operation' },
        })
      )
  )
  const client = new QuarkClient({ cookie: 'fixture=value', fetchImpl })
  await client.move([], 'target')
  await client.delete([])
  expect(fetchImpl).not.toHaveBeenCalled()
  await client.move(['new'], 'target')
  await client.delete(['old'])
  expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual([
    '/1/clouddrive/file/move',
    '/1/clouddrive/task',
    '/1/clouddrive/file/delete',
    '/1/clouddrive/task',
  ])
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
    action_type: 1,
    to_pdir_fid: 'target',
    filelist: ['new'],
    exclude_fids: [],
  })
  expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({
    action_type: 2,
    filelist: ['old'],
    exclude_fids: [],
  })
})
