import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { StrmSettings } from '@movie/contracts'
import type { QuarkClient } from '@movie/crawler-engine'
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import { dataDir } from '../../infrastructure/config.js'
import { stagingPrefix, videoFilePattern as video } from '../movies/metadata.js'
import { downloadHost, playbackRange, streamVideo } from './video-stream.js'

export { downloadHost } from './video-stream.js'

const sidecar = /\.(nfo|jpg|jpeg|png|srt|ass|ssa|sub|vtt)$/i
const fileIdPattern = /^[a-zA-Z0-9]+$/

function safeName(name: string, id: string) {
  const marker = /\s*\[tmdbid-\d+\]$/i.exec(name)?.[0] || ''
  const characters = [
    ...name
      .slice(0, name.length - marker.length)
      .normalize('NFC')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/[. ]+$/g, ''),
  ]
  while (Buffer.byteLength(characters.join('') + marker) > 180) characters.pop()
  const clean = characters.join('') + marker
  if (!clean || clean === '.' || clean === '..') return id
  return clean === name ? clean : `${clean}-${id}`
}

export class StrmService {
  private settings!: StrmSettings
  private secret!: string
  private syncing = false
  private saving = false
  private configFile: string
  constructor(
    private quark: () => QuarkClient,
    private storageDir = dataDir,
    private tv?: { downloadUrl(id: string): Promise<string> }
  ) {
    this.configFile = resolve(storageDir, 'strm.json')
  }
  async initialize() {
    await mkdir(this.storageDir, { recursive: true })
    try {
      const saved = JSON.parse(await readFile(this.configFile, 'utf8'))
      if (!/^[a-f0-9]{64}$/.test(saved.secret))
        throw new Error('STRM_CONFIG_INVALID')
      this.secret = saved.secret
      this.settings = this.validate(saved.settings)
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error
      this.secret = randomBytes(32).toString('hex')
      this.settings = {
        enabled: false,
        sourceFolderId: process.env.QUARK_LIBRARY_FOLDER_ID || '0',
        outputDir: resolve(
          process.env.STRM_OUTPUT_DIR || resolve(this.storageDir, 'strm')
        ),
        baseUrl: '',
      }
      await this.persist(this.settings)
    }
  }
  getSettings() {
    return { ...this.settings }
  }
  private validate(input: any): StrmSettings {
    if (
      !input ||
      typeof input.enabled !== 'boolean' ||
      typeof input.sourceFolderId !== 'string' ||
      !fileIdPattern.test(input.sourceFolderId) ||
      typeof input.outputDir !== 'string' ||
      !isAbsolute(input.outputDir) ||
      /[\x00-\x1f]/.test(input.outputDir) ||
      typeof input.baseUrl !== 'string'
    )
      throw new BadRequestException(
        'STRM_配置无效，请选择云盘目录并填写本地绝对路径。'
      )
    let baseUrl = input.baseUrl.trim().replace(/\/+$/, '')
    if (baseUrl || input.enabled) {
      let url: URL
      try {
        url = new URL(baseUrl)
      } catch {
        throw new BadRequestException(
          'STRM_请填写 Jellyfin 可访问的 HTTP/HTTPS 地址。'
        )
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      )
        throw new BadRequestException(
          'STRM_播放地址需为 HTTP/HTTPS 地址，不能包含路径或凭据。'
        )
      baseUrl = url.origin
    }
    const outputDir = resolve(input.outputDir)
    const fromData = relative(outputDir, resolve(this.storageDir))
    if (
      !fromData ||
      (!fromData.startsWith(`..${sep}`) &&
        fromData !== '..' &&
        !isAbsolute(fromData))
    )
      throw new BadRequestException('STRM_输出目录不能是数据目录或它的父目录。')
    return {
      enabled: input.enabled,
      sourceFolderId: input.sourceFolderId,
      outputDir,
      baseUrl,
    }
  }
  private async persist(settings: StrmSettings) {
    const temp = `${this.configFile}.tmp`
    await writeFile(temp, JSON.stringify({ settings, secret: this.secret }), {
      mode: 0o600,
    })
    await rename(temp, this.configFile)
  }
  async saveSettings(input: unknown) {
    if (this.syncing || this.saving)
      throw new ConflictException('STRM_正在同步或保存，请稍后重试。')
    this.saving = true
    try {
      const settings = this.validate(input)
      if (settings.enabled) {
        await mkdir(settings.outputDir, { recursive: true })
        await this.quark().listFiles(settings.sourceFolderId)
      }
      await this.persist(settings)
      this.settings = settings
      return this.getSettings()
    } finally {
      this.saving = false
    }
  }
  async folders(folderId = '0') {
    if (!fileIdPattern.test(folderId))
      throw new BadRequestException('STRM_INVALID_FOLDER')
    return (await this.quark().listFiles(folderId))
      .filter(file => file.dir || file.file_type === 0)
      .map(file => ({ id: file.fid, name: file.file_name }))
  }
  private signature(fileId: string) {
    return createHmac('sha256', this.secret).update(fileId).digest('hex')
  }
  authorize(req: Request) {
    const match = /^\/api\/strm\/stream\/([a-zA-Z0-9]+)$/.exec(req.path)
    const token = req.query.token
    if (
      !this.settings.enabled ||
      !match ||
      typeof token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !['GET', 'HEAD'].includes(req.method)
    )
      return false
    return timingSafeEqual(
      Buffer.from(token),
      Buffer.from(this.signature(match[1]))
    )
  }
  private async download(
    quark: QuarkClient,
    fileId: string,
    options: { method?: string; range?: string; signal?: AbortSignal } = {}
  ) {
    let url = downloadHost(await quark.downloadUrl(fileId))
    for (let redirects = 0; redirects < 4; redirects++) {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          Cookie: quark.cookie,
          Referer: 'https://pan.quark.cn/',
          'Accept-Encoding': 'identity',
          ...(options.range ? { Range: options.range } : {}),
        },
        redirect: 'manual',
        signal: options.signal,
      })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        url = downloadHost(
          new URL(response.headers.get('location') || '', url).href
        )
        continue
      }
      return response
    }
    throw new Error('STRM_TOO_MANY_REDIRECTS')
  }
  /**
   * Deletes .strm files whose video left the drive, and whole folders whose drive folder is gone.
   * Sidecars in live folders stay, since Jellyfin may have saved its own artwork there.
   */
  private async reconcile(
    root: string,
    expected: Set<string>,
    folders: Set<string>
  ) {
    let removed = 0
    const sweep = async (directory: string): Promise<void> => {
      const actual = await realpath(directory)
      if (actual !== root && !actual.startsWith(`${root}${sep}`))
        throw new Error('STRM_映射目录包含越界符号链接。')
      for (const entry of await readdir(actual, { withFileTypes: true })) {
        const path = resolve(actual, entry.name)
        if (entry.isDirectory()) {
          await sweep(path)
          if (!folders.has(path) && !(await readdir(path)).length) {
            await rm(path, { recursive: true })
            removed++
          }
        } else if (
          !expected.has(path) &&
          (/\.strm$/i.test(entry.name) ||
            (!folders.has(actual) && sidecar.test(entry.name)))
        ) {
          await rm(path)
          removed++
        }
      }
    }
    await sweep(root)
    return removed
  }
  /** Movie IDs whose folder in the output directory still holds a .strm file. */
  async strmMovieIds(folderMovieId: (name: string) => number | undefined) {
    const found = new Set<number>()
    const root = await realpath(this.settings.outputDir).catch((error: any) => {
      if (error.code !== 'ENOENT') throw error
      return null
    })
    if (!root) return found
    const walk = async (
      dir: string,
      movieId: number | undefined,
      depth: number
    ): Promise<void> => {
      if (depth > 32) return
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(stagingPrefix)) continue
        if (entry.isDirectory())
          await walk(
            resolve(dir, entry.name),
            movieId ?? folderMovieId(entry.name),
            depth + 1
          )
        else if (
          entry.isFile() &&
          movieId !== undefined &&
          /\.strm$/i.test(entry.name)
        )
          found.add(movieId)
      }
    }
    await walk(root, undefined, 0)
    return found
  }
  async stream(fileId: string, req: Request, res: Response) {
    if (!this.authorize(req)) throw new ForbiddenException('STRM_INVALID_TOKEN')
    const range = playbackRange(req.headers.range)
    try {
      if (!this.tv) throw new Error('QUARK_TV_AUTH_REQUIRED')
      const url = downloadHost(await this.tv.downloadUrl(fileId))
      res.setHeader('Cache-Control', 'private, no-store')
      // Browser static playback bypasses FFmpeg; open/large requests need bounded CDN reads here.
      if (req.method === 'GET' && range.relay)
        return await streamVideo(url, req, res)
      res.status(302).setHeader('Location', url.href)
      res.end()
    } catch (error: any) {
      if (res.headersSent) {
        res.destroy()
        return
      }
      if (res.destroyed) return
      throw new BadGatewayException(
        error.message === 'QUARK_TV_AUTH_REQUIRED'
          ? 'STRM_请先在连接设置中扫码授权 Quark TV。'
          : 'STRM_Quark TV 播放暂时不可用，请重新授权后重试。'
      )
    }
  }
  async sync() {
    if (!this.settings.enabled)
      throw new BadRequestException('STRM_请先启用并保存映射配置。')
    if (this.syncing || this.saving)
      throw new ConflictException('STRM_正在同步或保存，请稍后重试。')
    this.syncing = true
    const settings = this.getSettings()
    let count = 0
    let metadataCount = 0
    const warnings: string[] = []
    try {
      await mkdir(settings.outputDir, { recursive: true })
      const root = await realpath(settings.outputDir)
      const fromData = relative(root, await realpath(this.storageDir))
      if (
        !fromData ||
        (!fromData.startsWith(`..${sep}`) &&
          fromData !== '..' &&
          !isAbsolute(fromData))
      )
        throw new BadRequestException(
          'STRM_输出目录不能是数据目录或它的父目录。'
        )
      const quark = this.quark()
      const visited = new Set<string>()
      const expected = new Set<string>()
      const folders = new Set<string>()
      const walk = async (
        folderId: string,
        segments: string[],
        depth: number
      ) => {
        if (depth > 32 || visited.size >= 10_000 || visited.has(folderId))
          throw new Error('STRM_目录层级或数量超限。')
        visited.add(folderId)
        const directory = resolve(root, ...segments)
        // Resolve each directory before writing, so existing symlinks cannot escape the output root.
        await mkdir(directory, { recursive: true })
        const actual = await realpath(directory)
        if (actual !== root && !actual.startsWith(`${root}${sep}`))
          throw new Error('STRM_映射目录包含越界符号链接。')
        folders.add(actual)
        const files = await quark.listFiles(folderId)
        for (const file of files) {
          if (
            typeof file.fid !== 'string' ||
            !fileIdPattern.test(file.fid) ||
            typeof file.file_name !== 'string'
          )
            throw new Error('STRM_网盘文件信息无效。')
          if (file.file_name.startsWith(stagingPrefix)) continue
          const isDirectory = file.dir || file.file_type === 0
          const extension = isDirectory ? '' : extname(file.file_name)
          const name = `${safeName(file.file_name.slice(0, file.file_name.length - extension.length), file.fid)}${extension}`
          if (isDirectory) {
            await walk(file.fid, [...segments, name], depth + 1)
            continue
          }
          if (video.test(file.file_name)) {
            const stem = file.file_name.replace(video, '')
            const duplicate = files.some(
              other =>
                other.fid !== file.fid &&
                typeof other.file_name === 'string' &&
                video.test(other.file_name) &&
                other.file_name.replace(video, '') === stem
            )
            const path = resolve(
              actual,
              `${duplicate ? name : safeName(stem, file.fid)}.strm`
            )
            const content = `${settings.baseUrl}/api/strm/stream/${file.fid}?token=${this.signature(file.fid)}\n`
            const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`
            await writeFile(temp, content, { flag: 'wx' })
            await rename(temp, path)
            expected.add(path)
            count++
          } else if (sidecar.test(file.file_name)) {
            expected.add(resolve(actual, name))
            if (file.size > 4 * 1024 * 1024) {
              warnings.push(`${name} 超过 4MB，已跳过。`)
              continue
            }
            try {
              try {
                await lstat(resolve(actual, name))
                continue
              } catch (error: any) {
                if (error.code !== 'ENOENT') throw error
              }
              const response = await this.download(quark, file.fid, {
                signal: AbortSignal.timeout(30_000),
              })
              if (!response.ok || !response.body) {
                await response.body?.cancel()
                throw new Error()
              }
              const chunks: Uint8Array[] = []
              let size = 0
              for await (const chunk of response.body as any) {
                size += chunk.length
                if (size > 4 * 1024 * 1024) throw new Error()
                chunks.push(chunk)
              }
              await writeFile(resolve(actual, name), Buffer.concat(chunks), {
                flag: 'wx',
              })
              metadataCount++
            } catch (error: any) {
              if (error.code !== 'EEXIST')
                warnings.push(`${name} 未能同步，可稍后重试。`)
            }
          }
        }
      }
      await walk(settings.sourceFolderId, [], 0)
      const removed = await this.reconcile(root, expected, folders)
      return {
        count,
        metadataCount,
        removed,
        outputDir: settings.outputDir,
        warnings,
      }
    } catch (error: any) {
      if (error.message?.startsWith('STRM_')) throw error
      throw new BadGatewayException(
        'STRM_同步失败，请检查云盘连接和输出目录的写入权限。'
      )
    } finally {
      this.syncing = false
    }
  }
}
