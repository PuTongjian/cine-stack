import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SuenenClient, QuarkClient } from '@movie/crawler-engine';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { database } from './database.js';
import { dataDir } from './config.js';
import { TmdbService } from './tmdb.js';
import { buildNfo, movieBasename, movieFolder } from './metadata.js';
import type { StrmService } from './strm.js';

export class TaskService {
  strm?: StrmService;
  private tail = Promise.resolve();
  private suenen = new SuenenClient({ username: process.env.SUENEN_USERNAME, password: process.env.SUENEN_PASSWORD, dataDir });
  constructor(private tmdb: TmdbService) {}
  quark() { return new QuarkClient({ cookie: process.env.QUARK_COOKIE }); }
  async initialize() {
    const tasks = await database.task.findMany({ where: { status: { in: ['queued', 'running'] } } });
    for (const task of tasks) {
      if (task.kind === 'search') this.enqueue(() => this.search(task.id));
      else await database.task.update({ where: { id: task.id }, data: { status: 'partial', error: '服务已重启，请核对网盘文件后重试整理。' } });
    }
  }
  enqueue(work: () => Promise<unknown>) { this.tail = this.tail.then(work).then(() => {}).catch(() => {}); }
  async saveMovie(movieId: number) {
    const movie = await this.tmdb.detail(movieId);
    await database.movie.upsert({ where: { id: movieId }, update: { title: movie.title, metadata: JSON.stringify(movie) }, create: {
      id: movieId, title: movie.title, year: movie.release_date?.slice(0, 4) || '', poster: movie.poster_path, metadata: JSON.stringify(movie),
    } });
    return movie;
  }
  async createSearch(movieId: number) {
    await this.saveMovie(movieId);
    const existing = await database.task.findFirst({ where: { movieId, kind: 'search', status: { in: ['queued', 'running'] } } });
    if (existing) return this.publicTask(existing);
    const task = await database.task.create({ data: { kind: 'search', movieId, payload: '{}' } });
    this.enqueue(() => this.search(task.id));
    return this.publicTask(task);
  }
  async search(id: string) {
    try {
      const task = await database.task.update({ where: { id }, data: { status: 'running', stage: 'searching', error: null } });
      const movie = await this.tmdb.detail(task.movieId);
      const results = await this.suenen.search(movie.title);
      const candidates = results.length || !movie.original_title || movie.original_title === movie.title ? results : await this.suenen.search(movie.original_title);
      for (const item of candidates) await database.resource.upsert({ where: { searchId_shareId: { searchId: id, shareId: item.shareId } }, update: {}, create: {
        searchId: id, movieId: task.movieId, title: item.title, postUrl: item.postUrl, shareId: item.shareId, passcode: item.passcode,
      } });
      await database.task.update({ where: { id }, data: { status: 'completed', stage: candidates.length ? 'awaiting_selection' : 'empty', result: JSON.stringify({ count: candidates.length }) } });
    } catch (error) { await this.fail(id, error); }
  }
  async resourceFiles(id: string, folderId = '0') {
    if (!/^[a-zA-Z0-9-]+$/.test(folderId)) throw new BadRequestException('INVALID_FOLDER');
    const resource = await database.resource.findUnique({ where: { id } });
    if (!resource) throw new NotFoundException();
    const share = await this.quark().inspectShare(resource.shareId, resource.passcode, folderId);
    return share.files.map((file: any) => ({ id: file.fid, name: file.file_name, size: file.size, directory: file.dir || file.file_type === 0 }));
  }
  async createTransfer(input: { resourceId: string; fileIds: string[]; folderId: string }) {
    if (!input.fileIds?.length || input.fileIds.length > 100 || new Set(input.fileIds).size !== input.fileIds.length || input.fileIds.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9]+$/.test(id)) || !/^[a-zA-Z0-9]+$/.test(input.folderId)) throw new BadRequestException('INVALID_FILES');
    const resource = await database.resource.findUnique({ where: { id: input.resourceId } });
    if (!resource) throw new NotFoundException();
    if (!process.env.QUARK_LIBRARY_FOLDER_ID) throw new BadRequestException('QUARK_LIBRARY_NOT_CONFIGURED');
    const key = createHash('sha256').update(JSON.stringify([resource.movieId, resource.shareId, input.folderId, [...input.fileIds].sort(), process.env.QUARK_LIBRARY_FOLDER_ID])).digest('hex');
    const existing = await database.task.findUnique({ where: { idempotencyKey: key } });
    if (existing) return this.publicTask(existing);
    let task;
    try { task = await database.task.create({ data: { kind: 'transfer', movieId: resource.movieId, payload: JSON.stringify(input), idempotencyKey: key } }); }
    catch (error: any) {
      if (error.code !== 'P2002') throw error;
      return this.publicTask(await database.task.findUniqueOrThrow({ where: { idempotencyKey: key } }));
    }
    this.enqueue(() => this.transfer(task.id));
    return this.publicTask(task);
  }
  async transfer(id: string) {
    let transferred = false;
    try {
      let task = await database.task.findUniqueOrThrow({ where: { id } });
      const input = JSON.parse(task.payload);
      const movie = await this.tmdb.detail(task.movieId);
      const quark = this.quark();
      task = await database.task.update({ where: { id }, data: { status: 'running', stage: task.remoteTaskId ? 'organizing' : 'validating', error: null } });
      const target = task.targetFolderId || (await quark.ensureFolder(process.env.QUARK_LIBRARY_FOLDER_ID!, movieFolder(movie))).id;
      await database.task.update({ where: { id }, data: { targetFolderId: target } });
      if (!task.remoteTaskId) {
        const resource = await database.resource.findUniqueOrThrow({ where: { id: input.resourceId } });
        const share = await quark.inspectShare(resource.shareId, resource.passcode, input.folderId);
        const selected = share.files.filter((file: any) => input.fileIds.includes(file.fid));
        if (selected.length !== input.fileIds.length) throw new Error('选中文件已失效，请重新搜索。');
        // Persist the uncertain boundary before a remote write. A restart must never repeat this blindly.
        await database.task.update({ where: { id }, data: { stage: 'transferring' } });
        const remoteTaskId = await quark.transfer({ ...share, files: selected, targetFolderId: target });
        task = await database.task.update({ where: { id }, data: { remoteTaskId } });
      }
      await quark.waitTask(task.remoteTaskId!);
      transferred = true;
      await database.task.update({ where: { id }, data: { stage: 'organizing', result: JSON.stringify({ transferred: true }) } });
      let mediaFolderId = target;
      let files = await quark.listFiles(mediaFolderId);
      for (let depth = 0; depth < 6 && !files.some((file: any) => /\.(mkv|mp4|avi|mov|m4v|ts)$/i.test(file.file_name)); depth++) {
        const directories = files.filter((file: any) => file.dir || file.file_type === 0);
        if (directories.length !== 1) break;
        mediaFolderId = directories[0].fid;
        files = await quark.listFiles(mediaFolderId);
      }
      const videos = files.filter((file: any) => /\.(mkv|mp4|avi|mov|m4v|ts)$/i.test(file.file_name));
      const warnings: string[] = [];
      if (videos.length === 1) {
        const video = videos[0];
        const name = `${movieBasename(movie)}${extname(video.file_name).toLowerCase()}`;
        if (name !== video.file_name) {
          if (files.some((file: any) => file.fid !== video.fid && file.file_name === name)) throw new Error('规范文件名已存在，未覆盖。');
          await quark.rename(video.fid, name);
        }
        const subtitles = files.filter((file: any) => /\.(srt|ass|ssa|sub|vtt)$/i.test(file.file_name));
        const extensions = subtitles.map((file: any) => extname(file.file_name).toLowerCase());
        for (const subtitle of subtitles) {
          const extension = extname(subtitle.file_name).toLowerCase();
          if (extensions.filter((item: string) => item === extension).length !== 1) {
            warnings.push('同格式字幕不止一份，保留字幕原名以避免语言丢失。'); continue;
          }
          const subtitleName = `${movieBasename(movie)}${extension}`;
          if (subtitleName !== subtitle.file_name && !files.some((file: any) => file.fid !== subtitle.fid && file.file_name === subtitleName)) await quark.rename(subtitle.fid, subtitleName);
        }
      } else warnings.push(videos.length ? '包含多个视频，保留原文件名以避免错误归并。' : '转存包含目录，未递归重命名；请在网盘核对影片。');
      await database.task.update({ where: { id }, data: { stage: 'generating_metadata' } });
      const metadataDir = resolve(dataDir, 'metadata', String(movie.id));
      await mkdir(metadataDir, { recursive: true });
      await writeFile(resolve(metadataDir, 'movie.nfo'), buildNfo(movie));
      await database.task.update({ where: { id }, data: { stage: 'uploading_metadata' } });
      await quark.uploadSmallFile(mediaFolderId, 'movie.nfo', buildNfo(movie));
      for (const [field, name] of [['poster_path', 'poster.jpg'], ['backdrop_path', 'fanart.jpg']]) {
        if (!movie[field]) continue;
        const url = new URL(`https://image.tmdb.org/t/p/${field === 'poster_path' ? 'w780' : 'w1280'}${movie[field]}`);
        if (url.origin !== 'https://image.tmdb.org') throw new Error('INVALID_ARTWORK_URL');
        const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error' });
        if (!response.ok) throw new Error('ARTWORK_UNAVAILABLE');
        const bytes = Buffer.from(await response.arrayBuffer());
        await quark.uploadSmallFile(mediaFolderId, name, bytes, 'image/jpeg');
      }
      await database.task.update({ where: { id }, data: { status: warnings.length ? 'partial' : 'completed', stage: warnings.length ? 'organizing_pending' : 'completed', result: JSON.stringify({ transferred: true, targetFolderId: target, mediaFolderId, metadataUploaded: true, warnings, nfoUrl: `/api/movies/${movie.id}/nfo` }) } });
    } catch (error) { await this.fail(id, error); }
    finally {
      if (transferred && this.strm?.getSettings().enabled) {
        try {
          const task = await database.task.findUniqueOrThrow({ where: { id } });
          await database.task.update({ where: { id }, data: { status: 'running', stage: 'generating_strm' } });
          const mapped = await this.strm.sync();
          const result = JSON.parse(task.result);
          await database.task.update({ where: { id }, data: { status: mapped.warnings.length ? 'partial' : task.status, stage: task.stage, result: JSON.stringify({ ...result, strm: mapped, warnings: [...(result.warnings || []), ...mapped.warnings] }) } });
        } catch (error) { await this.fail(id, error); }
      }
    }
  }
  async retry(id: string) {
    const task = await database.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException();
    if (!['failed', 'partial'].includes(task.status)) throw new ConflictException('TASK_NOT_RETRYABLE');
    if (task.kind === 'transfer' && task.stage === 'transferring' && !task.remoteTaskId) throw new ConflictException('转存结果待核对，不能自动重试。');
    await database.task.update({ where: { id }, data: { status: 'queued', error: null } });
    this.enqueue(() => task.kind === 'search' ? this.search(id) : this.transfer(id));
    return { id };
  }
  async fail(id: string, error: unknown) {
    const task = await database.task.findUniqueOrThrow({ where: { id } });
    const message = error instanceof Error && /^(SUENEN_|QUARK_|STRM_|选中|规范|转存)/.test(error.message) ? error.message : '上游服务暂时不可用，请稍后重试。';
    await database.task.update({ where: { id }, data: { status: task.remoteTaskId ? 'partial' : 'failed', error: message } });
  }
  publicTask(task: any) { const { payload, idempotencyKey, ...rest } = task; return { ...rest, result: JSON.parse(task.result) }; }
}
