import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { Request } from 'express';
const fixture = vi.hoisted(() => ({ storageDir: '' }));
vi.mock('./config.js', () => ({ get dataDir() { return fixture.storageDir; } }));
import { StrmService, downloadHost } from './strm.js';
import { createAuth } from './auth.js';

let root: string;
let service: StrmService;
const quark = { cookie: 'secret-cookie', listFiles: vi.fn(), downloadUrl: vi.fn() };
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(resolve(tmpdir(), 'cine-strm-'));
  fixture.storageDir = resolve(root, 'data');
  vi.stubEnv('ADMIN_PASSWORD', 'fixture-password-123456');
  quark.listFiles.mockResolvedValue([]);
  quark.downloadUrl.mockResolvedValue('https://download.pds.quark.cn/video');
  service = new StrmService(() => quark as any);
  await service.initialize();
  await service.saveSettings({ enabled: true, sourceFolderId: 'library', outputDir: resolve(root, 'output'), baseUrl: 'http://cinestack:80' });
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

test('recursively maps saved videos, preserves sidecars and updates stable links without downloading videos', async () => {
  quark.listFiles.mockImplementation(async (id) => id === 'library' ? [{ fid: 'folder1', file_name: '电影 (2024)', dir: true }] : [
    { fid: 'video1', file_name: '电影 (2024).mkv', size: 10_000_000 },
    { fid: 'nfo1', file_name: 'movie.nfo', size: 8 },
    { fid: 'sub1', file_name: '电影 (2024).srt', size: 8 },
  ]);
  const upstream = vi.fn(async () => new Response('metadata'));
  vi.stubGlobal('fetch', upstream);
  expect(await service.sync()).toMatchObject({ count: 1, metadataCount: 2, warnings: [] });
  const path = resolve(root, 'output', '电影 (2024)', '电影 (2024).strm');
  const content = await readFile(path, 'utf8');
  expect(content).toMatch(/^http:\/\/cinestack\/api\/strm\/stream\/video1\?token=[a-f0-9]{64}\n$/);
  expect(content).not.toContain(quark.cookie);
  expect(quark.downloadUrl.mock.calls.map(([id]) => id)).toEqual(['nfo1', 'sub1']);
  await writeFile(resolve(root, 'output', '电影 (2024)', 'movie.nfo'), 'user metadata');
  expect(await service.sync()).toMatchObject({ count: 1, metadataCount: 0 });
  expect(upstream).toHaveBeenCalledTimes(2);
  expect(await readFile(path, 'utf8')).toBe(content);
  expect(await readFile(resolve(root, 'output', '电影 (2024)', 'movie.nfo'), 'utf8')).toBe('user metadata');
  const restarted = new StrmService(() => quark as any);
  await restarted.initialize();
  const url = new URL(content.trim());
  expect(restarted.authorize({ path: url.pathname, method: 'GET', query: { token: url.searchParams.get('token') } } as any)).toBe(true);
});

test('keeps multiple video formats and rejects output directory symlinks escaping the root', async () => {
  quark.listFiles.mockResolvedValue([{ fid: 'v1', file_name: 'Movie.mkv' }, { fid: 'v2', file_name: 'Movie.mp4' }]);
  expect(await service.sync()).toMatchObject({ count: 2 });
  expect(await readFile(resolve(root, 'output', 'Movie.mkv.strm'), 'utf8')).toContain('/v1?');
  expect(await readFile(resolve(root, 'output', 'Movie.mp4.strm'), 'utf8')).toContain('/v2?');
  await mkdir(resolve(root, 'outside'));
  await symlink(resolve(root, 'outside'), resolve(root, 'output', 'escape'));
  quark.listFiles.mockResolvedValue([{ fid: 'folder', file_name: 'escape', dir: true }]);
  await expect(service.sync()).rejects.toThrow('越界符号链接');
});

test('validates source, output and playback configuration without replacing the last valid settings', async () => {
  const settings = service.getSettings();
  for (const change of [{ outputDir: '../relative' }, { outputDir: root }, { sourceFolderId: '../secret' }, { baseUrl: 'file:///tmp' }, { baseUrl: 'http://user:pass@server' }, { baseUrl: 'http://server/path' }]) {
    await expect(service.saveSettings({ ...settings, ...change })).rejects.toThrow('STRM_');
  }
  expect(service.getSettings()).toEqual(settings);
  expect(service.getSettings()).not.toHaveProperty('secret');
});

test('long Unicode names fit local filesystems and sanitized sidecars retain their extension', async () => {
  quark.listFiles.mockResolvedValue([{ fid: 'v1', file_name: `${'影'.repeat(120)}.mkv` }, { fid: 's1', file_name: '字幕:简体.srt', size: 4 }]);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('text')));
  expect(await service.sync()).toMatchObject({ count: 1, metadataCount: 1 });
  const names = await readdir(resolve(root, 'output'));
  expect(names).toContain('字幕_简体-s1.srt');
  expect(names.every((name) => Buffer.byteLength(name) <= 255)).toBe(true);
});

test('rejects credential-bearing, private and unrelated download hosts', () => {
  expect(downloadHost('https://foo.pds.quark.cn/file').hostname).toBe('foo.pds.quark.cn');
  for (const url of ['http://foo.quark.cn/file', 'https://127.0.0.1/file', 'https://foo.quark.cn.evil.test/file', 'https://user:password@foo.quark.cn/file', 'https://foo.quark.cn:8443/file']) {
    expect(() => downloadHost(url)).toThrow('STRM_DOWNLOAD_HOST_INVALID');
  }
});

test('signed Jellyfin GET and HEAD requests bypass the session and forward byte ranges; tampered tokens cannot play', async () => {
  quark.listFiles.mockResolvedValue([{ fid: 'video1', file_name: 'Movie.mkv' }]);
  await service.sync();
  const url = new URL((await readFile(resolve(root, 'output', 'Movie.strm'), 'utf8')).trim());
  const app = express();
  app.use(await createAuth((req) => service.authorize(req)));
  app.get('/api/strm/stream/:id', (req, res, next) => { service.stream(req.params.id, req, res).catch(next); });
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  const clientFetch = fetch;
  const upstream = vi.fn(async (_url, options) => new Response(options.method === 'HEAD' ? null : '2345', { status: 206, headers: { 'Content-Range': 'bytes 2-5/10', 'Content-Length': '4', 'Accept-Ranges': 'bytes' } }));
  vi.stubGlobal('fetch', upstream);
  const streamUrl = `http://127.0.0.1:${address.port}${url.pathname}${url.search}`;
  try {
    const response = await clientFetch(streamUrl, { headers: { Range: 'bytes=2-5' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await response.text()).toBe('2345');
    expect(upstream.mock.calls[0][1].headers).toMatchObject({ Cookie: quark.cookie, Range: 'bytes=2-5' });
    expect((await clientFetch(streamUrl, { method: 'HEAD' })).status).toBe(206);
    expect(upstream.mock.calls[1][1].method).toBe('HEAD');
    expect((await clientFetch(streamUrl.replace(/token=.*/, 'token=bad'))).status).toBe(401);
    expect((await clientFetch(`http://127.0.0.1:${address.port}/api/strm/settings`)).status).toBe(401);
    const req = { path: url.pathname, query: { token: url.searchParams.get('token') }, method: 'POST' } as unknown as Request;
    expect(service.authorize(req)).toBe(false);
    await service.saveSettings({ ...service.getSettings(), enabled: false });
    expect((await clientFetch(streamUrl)).status).toBe(401);
  } finally { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); }
});
