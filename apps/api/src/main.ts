import 'reflect-metadata';
import './config.js';
import { Module, Controller, Get, Post, Put, Patch, Param, Query, Body, Req, Res, BadRequestException, ParseIntPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response } from 'express';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { database } from './database.js';
import { dataDir } from './config.js';
import { TmdbService } from './tmdb.js';
import { buildNfo, movieBasename } from './metadata.js';
import { TaskService } from './tasks.js';
import { createAuth } from './auth.js';
import { StrmService } from './strm.js';
import { QuarkTvService } from './quark-tv.js';
import { findDownloadedMovieIds } from './library.js';

const tmdb = new TmdbService();
const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
const tasks = new TaskService(tmdb);
const quarkTv = new QuarkTvService();
const strm = new StrmService(() => tasks.quark(), dataDir, quarkTv);
tasks.strm = strm;
@Controller('api')
class ApiController {
  @Get('health') health() { return { status: 'ok', version }; }
  @Get('movies/trending') trending(@Query() q: any) { return tmdb.trending(q.window, q.page); }
  @Get('movies/search') search(@Query() q: any) { return tmdb.search(q.q, q.page, q.year); }
  @Get('movies/discover') discover(@Query() q: any) { return tmdb.discover(q); }
  @Get('movies/genres') genres() { return tmdb.get('genre/movie/list'); }
  @Get('movies/:id') detail(@Param('id', ParseIntPipe) id: number) { return tmdb.detail(id); }
  @Get('movies/:id/nfo') async nfo(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const movie = await tmdb.detail(id);
    res.type('application/xml').setHeader('Content-Disposition', `attachment; filename="movie.nfo"; filename*=UTF-8''${encodeURIComponent(movieBasename(movie) + '.nfo')}`);
    res.send(buildNfo(movie));
  }
  @Get('library') async library(@Query() q: any) {
    const movies = await database.movie.findMany({ orderBy: { updatedAt: 'desc' } });
    const downloaded = process.env.QUARK_COOKIE && process.env.QUARK_LIBRARY_FOLDER_ID
      ? await findDownloadedMovieIds(movies.map((movie) => JSON.parse(movie.metadata)), (folderId) => tasks.quark().listFiles(folderId), process.env.QUARK_LIBRARY_FOLDER_ID)
      : new Set<number>();
    return { results: movies.filter((m) => (q.watched !== 'true' || m.watchedAt) && (q.downloaded !== 'true' || downloaded.has(m.id))).map((m) => ({ ...JSON.parse(m.metadata), watchedAt: m.watchedAt, rating: m.rating, downloaded: downloaded.has(m.id) })) };
  }
  @Put('library/:id') async add(@Param('id', ParseIntPipe) id: number) { await tasks.saveMovie(id); return { id }; }
  @Patch('library/:id') async update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    if (body.watched !== undefined && typeof body.watched !== 'boolean') throw new BadRequestException('INVALID_WATCHED');
    if (body.rating !== undefined && body.rating !== null && (typeof body.rating !== 'number' || body.rating < 0 || body.rating > 10)) throw new BadRequestException('INVALID_RATING');
    await tasks.saveMovie(id);
    return database.movie.update({ where: { id }, data: { ...(body.watched !== undefined ? { watchedAt: body.watched ? new Date() : null } : {}), ...(body.rating !== undefined ? { rating: body.rating } : {}) } });
  }
  @Post('movies/:id/resource-searches') resourceSearch(@Param('id', ParseIntPipe) id: number) { return tasks.createSearch(id); }
  @Get('resources') async resources(@Query('searchId') searchId: string) {
    if (!searchId) throw new BadRequestException('SEARCH_ID_REQUIRED');
    return database.resource.findMany({ where: { searchId }, orderBy: { createdAt: 'asc' } });
  }
  @Get('resources/:id/files') resourceFiles(@Param('id') id: string, @Query('folderId') folderId?: string) { return tasks.resourceFiles(id, folderId); }
  @Get('tasks/:id/posts/:postId/resources') postResources(@Param('id') id: string, @Param('postId') postId: string) { return tasks.postResources(id, postId); }
  @Post('transfers') transfer(@Body() body: any) {
    if (typeof body.resourceId !== 'string' || !Array.isArray(body.fileIds) || typeof body.folderId !== 'string') throw new BadRequestException('INVALID_TRANSFER');
    return tasks.createTransfer(body);
  }
  @Get('tasks') async taskList() { return (await database.task.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })).map((task) => tasks.publicTask(task)); }
  @Get('tasks/:id') async task(@Param('id') id: string) { return tasks.publicTask(await database.task.findUniqueOrThrow({ where: { id } })); }
  @Post('tasks/:id/retry') retry(@Param('id') id: string) { return tasks.retry(id); }
  @Get('integrations') integrations() { return { tmdb: !!(process.env.TMDB_API_KEY || process.env.TMDB_READ_ACCESS_TOKEN), suenen: !!(process.env.SUENEN_USERNAME && process.env.SUENEN_PASSWORD), quark: !!process.env.QUARK_COOKIE, folderId: process.env.QUARK_LIBRARY_FOLDER_ID || null, folderName: process.env.QUARK_LIBRARY_FOLDER_NAME || 'MovieLibrary', engine: 'CloudSaver MIT adapter', metadataUpload: true }; }
  @Post('integrations/quark/check') async checkQuark() { return { connected: true, count: (await tasks.quark().listFiles(process.env.QUARK_LIBRARY_FOLDER_ID)).length }; }
  @Get('integrations/quark-tv') quarkTvStatus() { return quarkTv.status(); }
  @Post('integrations/quark-tv/login') quarkTvLogin() { return quarkTv.startLogin(); }
  @Post('integrations/quark-tv/poll') quarkTvPoll() { return quarkTv.pollLogin(); }
  @Post('integrations/quark-tv/logout') quarkTvLogout() { return quarkTv.logout(); }
  @Get('strm/settings') strmSettings() { return strm.getSettings(); }
  @Put('strm/settings') saveStrmSettings(@Body() body: unknown) { return strm.saveSettings(body); }
  @Get('strm/folders') strmFolders(@Query('folderId') folderId?: string) { return strm.folders(folderId); }
  @Post('strm/sync') syncStrm() { return strm.sync(); }
  @Get('strm/stream/:id') stream(@Param('id') id: string, @Req() req: Request, @Res() res: Response) { return strm.stream(id, req, res); }
}
@Module({ controllers: [ApiController] })
class AppModule {}
await mkdir(dataDir, { recursive: true });
await database.$connect();
await quarkTv.initialize();
await strm.initialize();
await tasks.initialize();
const app = await NestFactory.create(AppModule);
// Deployment origins must be explicitly configured; local development stays available.
app.use((req: any, res: any, next: any) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && origin !== process.env.APP_ORIGIN && !/^http:\/\/(127\.0\.0\.1|localhost):(3001|5173|8080)$/.test(origin)) return res.status(403).json({ message: 'ORIGIN_DENIED' });
    if (!req.is('application/json')) return res.status(415).json({ message: 'JSON_REQUIRED' });
  }
  next();
});
// Register parsers before authentication middleware, which reads the login body.
app.use((await import('express')).json({ limit: '64kb' }));
app.use(await createAuth((req) => strm.authorize(req)));
app.enableShutdownHooks();
await app.listen(Number(process.env.PORT || 3001), process.env.HOST || '127.0.0.1');
