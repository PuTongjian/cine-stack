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
const tv = { downloadUrl: vi.fn() };
const quark = { cookie: 'secret-cookie', listFiles: vi.fn(), downloadUrl: vi.fn() };
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(resolve(tmpdir(), 'cine-strm-'));
  fixture.storageDir = resolve(root, 'data');
  vi.stubEnv('ADMIN_PASSWORD', 'fixture-password-123456');
  quark.listFiles.mockResolvedValue([]);
  quark.downloadUrl.mockResolvedValue('https://download.pds.quark.cn/video');
  tv.downloadUrl.mockResolvedValue('https://download.pds.quark.cn/video');
  service = new StrmService(() => quark as any, fixture.storageDir, tv);
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

test('signed Jellyfin GET and HEAD requests redirect to TV without fetching video; tampered tokens cannot play', async () => {
  quark.listFiles.mockResolvedValue([{ fid: 'video1', file_name: 'Movie.mkv' }]);
  await service.sync();
  const url = new URL((await readFile(resolve(root, 'output', 'Movie.strm'), 'utf8')).trim());
  const app = express();
  app.use(await createAuth((req) => service.authorize(req)));
  app.get('/api/strm/stream/:id', (req, res, next) => { service.stream(req.params.id, req, res).catch(next); });
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.getStatus?.() || 500).json({ message: error.message }));
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  const clientFetch = fetch;
  const upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
  const streamUrl = `http://127.0.0.1:${address.port}${url.pathname}${url.search}`;
  try {
    const response = await clientFetch(streamUrl, { headers: { Range: 'bytes=2-5' }, redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://download.pds.quark.cn/video');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect((await clientFetch(streamUrl, { method: 'HEAD', redirect: 'manual' })).status).toBe(302);
    expect(tv.downloadUrl).toHaveBeenCalledWith('video1');
    expect(upstream).not.toHaveBeenCalled();
    tv.downloadUrl.mockResolvedValueOnce('https://evil.example/video');
    expect((await clientFetch(streamUrl, { redirect: 'manual' })).status).toBe(502);
    expect((await clientFetch(streamUrl.replace(/token=.*/, 'token=bad'))).status).toBe(401);
    expect((await clientFetch(`http://127.0.0.1:${address.port}/api/strm/settings`)).status).toBe(401);
    const req = { path: url.pathname, query: { token: url.searchParams.get('token') }, method: 'POST' } as unknown as Request;
    expect(service.authorize(req)).toBe(false);
    await service.saveSettings({ ...service.getSettings(), enabled: false });
    expect((await clientFetch(streamUrl)).status).toBe(401);
  } finally { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); }
});

test('browser open ranges are assembled from bounded CDN requests with correct seeking and response lengths', async () => {
  quark.listFiles.mockResolvedValue([{ fid: 'video1', file_name: 'Movie.mkv' }]);
  await service.sync();
  const signed = new URL((await readFile(resolve(root, 'output', 'Movie.strm'), 'utf8')).trim());
  const app = express();
  app.get('/api/strm/stream/:id', (req, res, next) => { service.stream(req.params.id, req, res).catch(next); });
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.getStatus?.() || 500).json({ message: error.message }));
  const server = createServer(app).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const clientFetch = fetch;
  const size = 8 * 1024 * 1024 + 256;
  const upstream = vi.fn(async (_url: unknown, options: any) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);
    if (!match) throw new Error('Unbounded CDN request reproduces slow startup');
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), size - 1);
    if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    return new Response(Buffer.alloc(end - start + 1, start ? 2 : 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Type': 'video/mp4' } });
  });
  vi.stubGlobal('fetch', upstream);
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}${signed.pathname}${signed.search}`;
  try {
    const response = await clientFetch(url, { headers: { Range: 'bytes=0-' }, redirect: 'manual' });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes 0-${size - 1}/${size}`);
    expect(response.headers.get('content-length')).toBe(String(size));
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBe(size);
    expect(bytes[0]).toBe(1);
    expect(bytes[size - 1]).toBe(2);
    expect(upstream.mock.calls.map(([, options]) => options.headers.Range)).toEqual(['bytes=0-8388607', 'bytes=8388608-8388863']);
    upstream.mockClear();
    const seek = await clientFetch(url, { headers: { Range: 'bytes=8388608-' }, redirect: 'manual' });
    expect(seek.status).toBe(206);
    expect(seek.headers.get('content-range')).toBe(`bytes 8388608-${size - 1}/${size}`);
    expect((await seek.arrayBuffer()).byteLength).toBe(256);
    const whole = await clientFetch(url, { redirect: 'manual' });
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-range')).toBeNull();
    expect((await whole.arrayBuffer()).byteLength).toBe(size);
    const invalid = await clientFetch(url, { headers: { Range: 'bytes=9000000-' }, redirect: 'manual' });
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get('content-range')).toBe(`bytes */${size}`);
    expect((await invalid.arrayBuffer()).byteLength).toBe(0);
    const malformed = await clientFetch(url, { headers: { Range: 'bytes=0-1,3-4' }, redirect: 'manual' });
    expect(malformed.status).toBe(400);
  } finally { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); }
});
