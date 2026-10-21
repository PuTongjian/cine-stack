import { test, expect, vi } from 'vitest';
import { QuarkClient } from './client.mjs';
test('existing library folder is reused without remote writes', async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: 200, code: 0, data: { list: [{ fid: 'existing', dir: true, file_name: 'MovieLibrary' }] } })));
  const client = new QuarkClient({ cookie: 'fixture=value', fetchImpl });
  expect(await client.ensureFolder('parent', 'MovieLibrary')).toEqual({ id: 'existing', name: 'MovieLibrary', created: false });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][1].method).toBe('GET');
});
test('upstream failures never expose their credential-bearing message', async () => {
  const client = new QuarkClient({ cookie: 'secret', fetchImpl: async () => new Response(JSON.stringify({ status: 401, code: 41001, message: 'secret' })) });
  await expect(client.listFiles()).rejects.toThrow('QUARK_API_41001');
});
test('upload reuses an existing metadata file without overwriting it', async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: 200, code: 0, data: { list: [{ fid: 'nfo', file_name: 'movie.nfo' }] } })));
  const client = new QuarkClient({ cookie: 'secret', fetchImpl });
  await expect(client.uploadSmallFile('folder', 'movie.nfo', '<movie/>')).resolves.toEqual({ id: 'nfo', existing: true });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('metadata upload enforces its small-file boundary before network access', async () => {
  const fetchImpl = vi.fn();
  const client = new QuarkClient({ cookie: 'secret', fetchImpl });
  await expect(client.uploadSmallFile('folder', 'movie.nfo', Buffer.alloc(4 * 1024 * 1024 + 1))).rejects.toThrow('QUARK_METADATA_SIZE_LIMIT');
  expect(fetchImpl).not.toHaveBeenCalled();
});
