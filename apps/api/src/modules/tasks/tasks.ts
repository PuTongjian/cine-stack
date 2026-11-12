import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import type { ShareFile } from '@movie/contracts'
import { QuarkClient, SuenenClient } from '@movie/crawler-engine'
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { dataDir } from '../../infrastructure/config.js'
import { database } from '../../infrastructure/database.js'
import {
  buildNfo,
  movieBasename,
  movieFolder,
  videoFilePattern as organizedVideo,
  stagingPrefix,
} from '../movies/metadata.js'
import { TmdbService } from '../movies/tmdb.js'
import type { StrmService } from '../strm/strm.js'

export class TaskService {
  strm?: StrmService
  private tail = Promise.resolve()
  private suenen = new SuenenClient({
    username: process.env.SUENEN_USERNAME,
    password: process.env.SUENEN_PASSWORD,
    dataDir,
  })
  constructor(private tmdb: TmdbService) {}
  quark() {
    return new QuarkClient({ cookie: process.env.QUARK_COOKIE })
  }
  async initialize() {
    const tasks = await database.task.findMany({
      where: { status: { in: ['queued', 'running'] } },
    })
    for (const task of tasks) {
      if (task.kind === 'search') this.enqueue(() => this.search(task.id))
      else
        await database.task.update({
          where: { id: task.id },
          data: {
            status: 'partial',
            error: '服务已重启，请核对网盘文件后重试整理。',
          },
        })
    }
  }
  enqueue(work: () => Promise<unknown>) {
    this.tail = this.tail
      .then(work)
      .then(() => {})
      .catch(() => {})
  }
  async saveMovie(movieId: number) {
    const movie = await this.tmdb.detail(movieId)
    await database.movie.upsert({
      where: { id: movieId },
      update: { title: movie.title, metadata: JSON.stringify(movie) },
      create: {
        id: movieId,
        title: movie.title,
        year: movie.release_date?.slice(0, 4) || '',
        poster: movie.poster_path,
        metadata: JSON.stringify(movie),
      },
    })
    return movie
  }
  async createSearch(movieId: number) {
    await this.saveMovie(movieId)
    const existing = await database.task.findFirst({
      where: { movieId, kind: 'search', status: { in: ['queued', 'running'] } },
    })
    if (existing) return this.publicTask(existing)
    const task = await database.task.create({
      data: { kind: 'search', movieId, payload: '{}' },
    })
    this.enqueue(() => this.search(task.id))
    return this.publicTask(task)
  }
  async search(id: string) {
    try {
      const task = await database.task.update({
        where: { id },
        data: { status: 'running', stage: 'searching', error: null },
      })
      const movie = await this.tmdb.detail(task.movieId)
      const results = await this.suenen.search(movie.title)
      const candidates =
        results.length ||
        !movie.original_title ||
        movie.original_title === movie.title
          ? results
          : await this.suenen.search(movie.original_title)
      await database.task.update({
        where: { id },
        data: {
          status: 'completed',
          stage: candidates.length ? 'awaiting_selection' : 'empty',
          result: JSON.stringify({
            count: candidates.length,
            posts: candidates,
          }),
        },
      })
    } catch (error) {
      await this.fail(id, error)
    }
  }
  async postResources(searchId: string, postId: string) {
    const task = await database.task.findUnique({ where: { id: searchId } })
    if (!task || task.kind !== 'search' || task.status !== 'completed')
      throw new NotFoundException()
    const post = JSON.parse(task.result).posts?.find(
      (item: { id: string }) => item.id === postId
    )
    if (!post) throw new NotFoundException()
    const shares = await this.suenen
      .postSharesWithOptions(postId, { autoReply: true })
      .catch(error => {
        if (error instanceof Error && error.message === 'SUENEN_REPLY_REQUIRED')
          throw new ConflictException({
            code: 'SUENEN_REPLY_REQUIRED',
            message:
              '该帖子要求回复后才能查看下载链接。请用资源站点账号打开原帖，按站点要求操作后重试。',
          })
        if (error instanceof Error && error.message === 'SUENEN_NO_QUARK_SHARE')
          throw new BadRequestException({
            code: 'SUENEN_NO_QUARK_SHARE',
            message:
              '已自动回复，但原帖没有可用的夸克网盘链接；请打开原帖查看其他网盘链接。',
          })
        throw error
      })
    if (!shares.length)
      throw new BadRequestException(
        '该帖子没有可用的夸克网盘链接，请打开来源帖子查看。'
      )
    const resources = []
    for (const share of shares)
      resources.push(
        await database.resource.upsert({
          where: { searchId_shareId: { searchId, shareId: share.shareId } },
          update: {},
          create: {
            searchId,
            movieId: task.movieId,
            title: post.title,
            postUrl: share.postUrl,
            shareId: share.shareId,
            passcode: share.passcode,
          },
        })
      )
    return resources
  }
  async resourceFiles(id: string, folderId = '0') {
    if (!/^[a-zA-Z0-9-]+$/.test(folderId))
      throw new BadRequestException('INVALID_FOLDER')
    const resource = await database.resource.findUnique({ where: { id } })
    if (!resource) throw new NotFoundException()
    const share = await this.quark().inspectShare(
      resource.shareId,
      resource.passcode,
      folderId
    )
    return share.files.map((file: any): ShareFile => {
      const directory = !!file.dir || file.file_type === 0
      const size =
        file.size == null || file.size === '' ? NaN : Number(file.size)
      return {
        id: file.fid,
        name: file.file_name,
        size:
          Number.isSafeInteger(size) && size >= 0 && (!directory || size > 0)
            ? size
            : null,
        directory,
      }
    })
  }
  async createTransfer(input: {
    resourceId: string
    fileIds: string[]
    folderId: string
  }) {
    if (
      !input.fileIds?.length ||
      input.fileIds.length > 100 ||
      new Set(input.fileIds).size !== input.fileIds.length ||
      input.fileIds.some(
        id => typeof id !== 'string' || !/^[a-zA-Z0-9]+$/.test(id)
      ) ||
      !/^[a-zA-Z0-9]+$/.test(input.folderId)
    )
      throw new BadRequestException('INVALID_FILES')
    const resource = await database.resource.findUnique({
      where: { id: input.resourceId },
    })
    if (!resource) throw new NotFoundException()
    if (!process.env.QUARK_LIBRARY_FOLDER_ID)
      throw new BadRequestException('QUARK_LIBRARY_NOT_CONFIGURED')
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          resource.movieId,
          resource.shareId,
          input.folderId,
          [...input.fileIds].sort(),
          process.env.QUARK_LIBRARY_FOLDER_ID,
        ])
      )
      .digest('hex')
    const existing = await database.task.findUnique({
      where: { idempotencyKey: key },
    })
    if (existing) {
      if (['queued', 'running'].includes(existing.status))
        return this.publicTask(existing)
      if (existing.stage === 'transferring' && !existing.remoteTaskId)
        throw new ConflictException('转存结果待核对，不能自动重试。')
      // A finished task says nothing about the drive now; allow saving the same files again.
      await database.task.update({
        where: { id: existing.id },
        data: { idempotencyKey: null },
      })
    }
    let task
    try {
      task = await database.task.create({
        data: {
          kind: 'transfer',
          movieId: resource.movieId,
          payload: JSON.stringify(input),
          idempotencyKey: key,
        },
      })
    } catch (error: any) {
      if (error.code !== 'P2002') throw error
      return this.publicTask(
        await database.task.findUniqueOrThrow({
          where: { idempotencyKey: key },
        })
      )
    }
    this.enqueue(() => this.transfer(task.id))
    return this.publicTask(task)
  }
  async transfer(id: string) {
    let transferred = false
    try {
      let task = await database.task.findUniqueOrThrow({ where: { id } })
      const input = JSON.parse(task.payload)
      const movie = await this.tmdb.detail(task.movieId)
      const quark = this.quark()
      task = await database.task.update({
        where: { id },
        data: {
          status: 'running',
          stage: task.remoteTaskId ? 'organizing' : 'validating',
          error: null,
        },
      })
      const target =
        task.targetFolderId ||
        (
          await quark.ensureFolder(
            process.env.QUARK_LIBRARY_FOLDER_ID!,
            movieFolder(movie)
          )
        ).id
      await database.task.update({
        where: { id },
        data: { targetFolderId: target },
      })
      if (!task.remoteTaskId) {
        const resource = await database.resource.findUniqueOrThrow({
          where: { id: input.resourceId },
        })
        const share = await quark.inspectShare(
          resource.shareId,
          resource.passcode,
          input.folderId
        )
        const selected = share.files.filter((file: any) =>
          input.fileIds.includes(file.fid)
        )
        if (selected.length !== input.fileIds.length)
          throw new Error('选中文件已失效，请重新搜索。')
        // Save into a per-task folder so new files never collide with the copy being replaced.
        const staging = await quark.ensureFolder(
          target,
          `${stagingPrefix}${id}`
        )
        const previousFileIds = (await quark.listFiles(target))
          .filter((file: any) => !file.file_name.startsWith(stagingPrefix))
          .map((file: any) => file.fid)
          .filter((fid: string) => fid !== staging.id)
        // Persist the uncertain boundary before a remote write. A restart must never repeat this blindly.
        await database.task.update({
          where: { id },
          data: {
            stage: 'transferring',
            result: JSON.stringify({
              stagingFolderId: staging.id,
              previousFileIds,
            }),
          },
        })
        const remoteTaskId = await quark.transfer({
          ...share,
          files: selected,
          targetFolderId: staging.id,
        })
        task = await database.task.update({
          where: { id },
          data: { remoteTaskId },
        })
      }
      await quark.waitTask(task.remoteTaskId!)
      transferred = true
      const saved = JSON.parse(task.result)
      await database.task.update({
        where: { id },
        data: {
          stage: 'organizing',
          result: JSON.stringify({ ...saved, transferred: true }),
        },
      })
      let replaced = 0
      if (saved.stagingFolderId) {
        replaced = await this.replaceWithStaged(quark, target, id, saved)
      }
      const { folderId: mediaFolderId, files } = await this.mediaFolder(
        quark,
        target
      )
      const videos = files.filter((file: any) =>
        organizedVideo.test(file.file_name)
      )
      const warnings: string[] = []
      if (videos.length === 1) {
        const video = videos[0]
        const name = `${movieBasename(movie)}${extname(video.file_name).toLowerCase()}`
        if (name !== video.file_name) {
          if (
            files.some(
              (file: any) => file.fid !== video.fid && file.file_name === name
            )
          )
            throw new Error('规范文件名已存在，未覆盖。')
          await quark.rename(video.fid, name)
        }
        const subtitles = files.filter((file: any) =>
          /\.(srt|ass|ssa|sub|vtt)$/i.test(file.file_name)
        )
        const extensions = subtitles.map((file: any) =>
          extname(file.file_name).toLowerCase()
        )
        for (const subtitle of subtitles) {
          const extension = extname(subtitle.file_name).toLowerCase()
          if (
            extensions.filter((item: string) => item === extension).length !== 1
          ) {
            warnings.push('同格式字幕不止一份，保留字幕原名以避免语言丢失。')
            continue
          }
          const subtitleName = `${movieBasename(movie)}${extension}`
          if (
            subtitleName !== subtitle.file_name &&
            !files.some(
              (file: any) =>
                file.fid !== subtitle.fid && file.file_name === subtitleName
            )
          )
            await quark.rename(subtitle.fid, subtitleName)
        }
      } else
        warnings.push(
          videos.length
            ? '包含多个视频，保留原文件名以避免错误归并。'
            : '转存包含目录，未递归重命名；请在网盘核对影片。'
        )
      await database.task.update({
        where: { id },
        data: { stage: 'generating_metadata' },
      })
      const metadataDir = resolve(dataDir, 'metadata', String(movie.id))
      await mkdir(metadataDir, { recursive: true })
      await writeFile(resolve(metadataDir, 'movie.nfo'), buildNfo(movie))
      await database.task.update({
        where: { id },
        data: { stage: 'uploading_metadata' },
      })
      await quark.uploadSmallFile(mediaFolderId, 'movie.nfo', buildNfo(movie))
      for (const [field, name] of [
        ['poster_path', 'poster.jpg'],
        ['backdrop_path', 'fanart.jpg'],
      ]) {
        if (!movie[field]) continue
        const url = new URL(
          `https://image.tmdb.org/t/p/${field === 'poster_path' ? 'w780' : 'w1280'}${movie[field]}`
        )
        if (url.origin !== 'https://image.tmdb.org')
          throw new Error('INVALID_ARTWORK_URL')
        const response = await fetch(url, {
          signal: AbortSignal.timeout(30_000),
          redirect: 'error',
        })
        if (!response.ok) throw new Error('ARTWORK_UNAVAILABLE')
        const bytes = Buffer.from(await response.arrayBuffer())
        await quark.uploadSmallFile(mediaFolderId, name, bytes, 'image/jpeg')
      }
      await database.task.update({
        where: { id },
        data: {
          status: warnings.length ? 'partial' : 'completed',
          stage: warnings.length ? 'organizing_pending' : 'completed',
          result: JSON.stringify({
            ...saved,
            transferred: true,
            targetFolderId: target,
            mediaFolderId,
            replaced,
            metadataUploaded: true,
            warnings,
            nfoUrl: `/api/movies/${movie.id}/nfo`,
          }),
        },
      })
    } catch (error) {
      await this.fail(id, error)
    } finally {
      if (transferred && this.strm?.getSettings().enabled) {
        try {
          const task = await database.task.findUniqueOrThrow({ where: { id } })
          await database.task.update({
            where: { id },
            data: { status: 'running', stage: 'generating_strm' },
          })
          const mapped = await this.strm.sync()
          const result = JSON.parse(task.result)
          await database.task.update({
            where: { id },
            data: {
              status: mapped.warnings.length ? 'partial' : task.status,
              stage: task.stage,
              result: JSON.stringify({
                ...result,
                strm: mapped,
                warnings: [...(result.warnings || []), ...mapped.warnings],
              }),
            },
          })
        } catch (error) {
          await this.fail(id, error)
        }
      }
    }
  }
  async mediaFolder(quark: QuarkClient, folderId: string) {
    let files = await quark.listFiles(folderId)
    for (
      let depth = 0;
      depth < 6 &&
      !files.some((file: any) => organizedVideo.test(file.file_name));
      depth++
    ) {
      const directories = files.filter(
        (file: any) =>
          (file.dir || file.file_type === 0) &&
          !file.file_name.startsWith(stagingPrefix)
      )
      if (directories.length !== 1) break
      folderId = directories[0].fid
      files = await quark.listFiles(folderId)
    }
    return { folderId, files }
  }
  private async containsVideo(
    quark: QuarkClient,
    files: any[],
    visited = new Set<string>(),
    depth = 0
  ): Promise<boolean> {
    if (depth > 32 || visited.size >= 10_000)
      throw new Error('转存目录层级或数量超限，已保留原资源。')
    for (const file of files) {
      if (file.dir || file.file_type === 0) {
        if (visited.has(file.fid)) continue
        visited.add(file.fid)
        if (
          await this.containsVideo(
            quark,
            await quark.listFiles(file.fid),
            visited,
            depth + 1
          )
        )
          return true
      } else if (organizedVideo.test(file.file_name)) return true
    }
    return false
  }
  /**
   * Moves the newly saved media into the movie folder and sends the previous copy to the
   * Quark recycle bin. Each step re-reads the drive, so a retry after a crash resumes safely.
   */
  async replaceWithStaged(
    quark: QuarkClient,
    target: string,
    taskId: string,
    saved: {
      stagingFolderId: string
      previousFileIds?: string[]
      replacementFiles?: { fid: string; file_name: string }[]
    }
  ) {
    const stagingId = saved.stagingFolderId
    const previousFileIds = saved.previousFileIds || []
    let current = await quark.listFiles(target)
    const stagingExists = current.some((file: any) => file.fid === stagingId)
    const incoming = stagingExists ? await quark.listFiles(stagingId) : []
    if (!saved.replacementFiles) {
      if (!(await this.containsVideo(quark, incoming)))
        throw new Error('转存内容中未识别到视频，已保留原资源，请在网盘核对。')
      saved.replacementFiles = incoming.map((file: any) => ({
        fid: file.fid,
        file_name: file.file_name,
      }))
      // Persist IDs and original names before renaming or moving; retries must identify this copy exactly.
      await database.task.update({
        where: { id: taskId },
        data: { result: JSON.stringify({ ...saved, transferred: true }) },
      })
    }
    const replacements = saved.replacementFiles
    if (
      !replacements.length ||
      replacements.some(
        file => ![...current, ...incoming].some(found => found.fid === file.fid)
      )
    )
      throw new Error('转存的新资源已变动，已停止替换，请在网盘核对。')
    const pending = incoming.filter((file: any) =>
      replacements.some(item => item.fid === file.fid)
    )
    // Temporary names avoid collisions while the old copy remains available in the movie folder.
    for (const file of pending) {
      const name = `${stagingPrefix}${stagingId}-${file.fid}`
      if (file.file_name !== name) await quark.rename(file.fid, name)
    }
    if (pending.length)
      await quark.move(
        pending.map((file: any) => file.fid),
        target
      )
    current = await quark.listFiles(target)
    if (
      replacements.some(
        file => !current.some((found: any) => found.fid === file.fid)
      )
    )
      throw new Error('转存的新资源未全部移入，已保留原资源，请重试整理。')
    if (stagingExists && (await quark.listFiles(stagingId)).length)
      throw new Error('转存临时目录仍有文件，已保留原资源，请在网盘核对。')
    const stale = current
      .filter((file: any) => previousFileIds.includes(file.fid))
      .map((file: any) => file.fid)
    if (stale.length) await quark.delete(stale)
    for (const file of replacements) {
      if (
        current.find((found: any) => found.fid === file.fid)?.file_name !==
        file.file_name
      )
        await quark.rename(file.fid, file.file_name)
    }
    if (stagingExists) await quark.delete([stagingId])
    return previousFileIds.length
  }
  async retry(id: string) {
    const task = await database.task.findUnique({ where: { id } })
    if (!task) throw new NotFoundException()
    if (!['failed', 'partial'].includes(task.status))
      throw new ConflictException('TASK_NOT_RETRYABLE')
    if (
      task.kind === 'transfer' &&
      task.stage === 'transferring' &&
      !task.remoteTaskId
    )
      throw new ConflictException('转存结果待核对，不能自动重试。')
    await database.task.update({
      where: { id },
      data: { status: 'queued', error: null },
    })
    this.enqueue(() =>
      task.kind === 'search' ? this.search(id) : this.transfer(id)
    )
    return { id }
  }
  async fail(id: string, error: unknown) {
    const task = await database.task.findUniqueOrThrow({ where: { id } })
    const message =
      error instanceof Error &&
      /^(SUENEN_|QUARK_|STRM_|选中|规范|转存)/.test(error.message)
        ? error.message
        : '上游服务暂时不可用，请稍后重试。'
    await database.task.update({
      where: { id },
      data: {
        status: task.remoteTaskId ? 'partial' : 'failed',
        error: message,
      },
    })
  }
  publicTask(task: any) {
    const { payload, idempotencyKey, ...rest } = task
    return { ...rest, result: JSON.parse(task.result) }
  }
}
