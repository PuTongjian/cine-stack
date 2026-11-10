import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { QuarkTvService } from './quark-tv.js';

afterEach(() => vi.unstubAllGlobals());
const json = (data: unknown) => new Response(JSON.stringify(data));

test('TV credentials persist privately and survive service restart, logout removes them', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'cine-tv-'));
  const upstream = vi.fn()
    .mockResolvedValueOnce(json({ qr_data: 'aW1hZ2U=', query_token: 'secret-query' }))
    .mockResolvedValueOnce(json({ code: 'code' }))
    .mockResolvedValueOnce(json({ code: 200, data: { access_token: 'secret-access', refresh_token: 'secret-refresh', expires_in: 3600 } }))
    .mockResolvedValueOnce(json({ data: { download_url: 'https://download.pds.quark.cn/video' } }));
  vi.stubGlobal('fetch', upstream);
  try {
    const service = new QuarkTvService(directory);
    await service.initialize();
    expect(service.status().authorized).toBe(false);
    await service.startLogin();
    await service.pollLogin();
    expect(service.status().authorized).toBe(true);
    expect(JSON.stringify(service.status())).not.toContain('secret');
    const path = resolve(directory, 'quark-tv.json');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path, 'utf8')).refreshToken).toBe('secret-refresh');
    const restarted = new QuarkTvService(directory);
    await restarted.initialize();
    expect(await restarted.downloadUrl('video')).toBe('https://download.pds.quark.cn/video');
    await restarted.logout();
    expect(restarted.status().authorized).toBe(false);
    expect(await readFile(path, 'utf8')).not.toContain('secret');
    await expect(restarted.downloadUrl('video')).rejects.toThrow('QUARK_TV_AUTH_REQUIRED');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
