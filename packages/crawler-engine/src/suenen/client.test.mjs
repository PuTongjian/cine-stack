import { test, expect, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SuenenClient, parseSearchResults, parseQuarkLinks } from './client.mjs';
test('search results preserve thread identity and remove duplicate links', () => {
  const html = '<div class="style3_subject"><a href="thread-12.htm">Movie</a><a href="thread-12.htm#comments">Comments</a></div>';
  expect(parseSearchResults(html)).toEqual([{ id: '12', title: 'Movie', url: 'https://www.suenen.com/thread-12.htm' }]);
});
test('search returns the first ten titles in site order without fetching posts', async () => {
  const client = new SuenenClient({});
  const getHtml = vi.spyOn(client, 'getHtml').mockResolvedValue(Array.from({ length: 12 }, (_, index) => `<div class="style3_subject"><a href="thread-${index + 1}.htm">标题 ${index + 1}</a></div>`).join(''));
  const posts = await client.search('电影');
  expect(posts.map((post) => post.title)).toEqual(Array.from({ length: 10 }, (_, index) => `标题 ${index + 1}`));
  expect(getHtml).toHaveBeenCalledExactlyOnceWith('/search-%E7%94%B5%E5%BD%B1-1.htm');
});
test('post shares are parsed only for the selected thread and reject invalid IDs', async () => {
  const client = new SuenenClient({});
  const getHtml = vi.spyOn(client, 'getHtml').mockResolvedValue('<div class="message"><a href="https://pan.quark.cn/s/abc123?pwd=a123">资源</a></div>');
  await expect(client.postShares('12')).resolves.toEqual([{ shareId: 'abc123', passcode: 'a123', url: 'https://pan.quark.cn/s/abc123', postUrl: 'https://www.suenen.com/thread-12.htm' }]);
  expect(getHtml).toHaveBeenCalledExactlyOnceWith('/thread-12.htm');
  await expect(client.postShares('../my')).rejects.toThrow('SUENEN_INVALID_POST');
  expect(getHtml).toHaveBeenCalledTimes(1);
});
test('restored www sessions are reused by the actual session-check path', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'suenen-client-'));
  await mkdir(join(folder, 'sessions'));
  await writeFile(join(folder, 'sessions/suenen.json'), JSON.stringify({ cookies: [
    { name: 'bbs_token', value: 'fixture', domain: 'www.suenen.com', path: '/', expires: -1, secure: true, httpOnly: true },
    { name: 'other_token', value: 'private', domain: 'other.test', path: '/', expires: -1 },
  ] }));
  const fetchImpl = vi.fn(async (url, options) => {
    expect(url.href).toBe('https://www.suenen.com/my.htm');
    expect(options.headers.Cookie).toBe('bbs_token=fixture');
    return new Response('<script>var uid = 19209;</script>');
  });
  vi.stubGlobal('fetch', fetchImpl);
  try {
    const client = new SuenenClient({ dataDir: folder });
    await client.ensureSession();
    await client.ensureSession();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(client.request('https://other.test/')).rejects.toThrow('SUENEN_INVALID_URL');
  } finally { vi.unstubAllGlobals(); await rm(folder, { recursive: true, force: true }); }
});
test('resource parsing only accepts direct Quark HTTPS shares and extracts passcodes', () => {
  const html = '<div class="message"><p><a href="https://pan.quark.cn/s/abc123">资源</a> 提取码: a123</p><a href="https://evil.test/s/ab">bad</a><a href="http://pan.quark.cn/s/ab">bad</a></div>';
  expect(parseQuarkLinks(html, 'https://suenen.com/thread-12.htm')).toEqual([{ shareId: 'abc123', passcode: 'a123', url: 'https://pan.quark.cn/s/abc123', postUrl: 'https://suenen.com/thread-12.htm' }]);
});
