import { test, expect, vi, beforeEach } from 'vitest';
const { db, suenen } = vi.hoisted(() => ({ db: { task: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), create: vi.fn() }, resource: { findUnique: vi.fn(), upsert: vi.fn() } }, suenen: { search: vi.fn(), postShares: vi.fn() } }));
vi.mock('./database.js', () => ({ database: db }));
vi.mock('./config.js', () => ({ dataDir: '/tmp/movie-task-fixture' }));
vi.mock('@movie/crawler-engine', () => ({ SuenenClient: class { search = suenen.search; postShares = suenen.postShares; }, QuarkClient: class {} }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), writeFile: vi.fn() }));
import { TaskService } from './tasks.js';
beforeEach(() => vi.clearAllMocks());
test('search persists ordered titles and falls back to the original movie title', async () => {
  const posts = [{ id: '12', title: 'Film 1080p', url: 'https://www.suenen.com/thread-12.htm' }];
  db.task.update.mockResolvedValue({ id: 'search', movieId: 42 });
  suenen.search.mockResolvedValueOnce([]).mockResolvedValueOnce(posts);
  await new TaskService({ detail: async () => ({ title: '电影', original_title: 'Film' }) } as any).search('search');
  expect(suenen.search.mock.calls).toEqual([['电影'], ['Film']]);
  expect(db.task.update).toHaveBeenLastCalledWith({ where: { id: 'search' }, data: { status: 'completed', stage: 'awaiting_selection', result: JSON.stringify({ count: 1, posts }) } });
  expect(suenen.postShares).not.toHaveBeenCalled();
  expect(db.resource.upsert).not.toHaveBeenCalled();
});
test('selecting a search title creates all its shares and keeps their passcodes', async () => {
  db.task.findUnique.mockResolvedValue({ id: 'search', kind: 'search', status: 'completed', movieId: 42, result: JSON.stringify({ posts: [{ id: '12', title: 'Film' }] }) });
  suenen.postShares.mockResolvedValue([
    { shareId: 'share1', passcode: 'a123', postUrl: 'https://www.suenen.com/thread-12.htm' },
    { shareId: 'share2', passcode: '', postUrl: 'https://www.suenen.com/thread-12.htm' },
  ]);
  db.resource.upsert.mockImplementation(async ({ create }) => ({ id: create.shareId, ...create }));
  const resources = await new TaskService({} as any).postResources('search', '12');
  expect(suenen.postShares).toHaveBeenCalledExactlyOnceWith('12');
  expect(resources).toMatchObject([{ title: 'Film', movieId: 42, searchId: 'search', shareId: 'share1', passcode: 'a123' }, { shareId: 'share2', passcode: '' }]);
});
test('posts outside the search cannot be resolved and empty posts give an actionable error', async () => {
  db.task.findUnique.mockResolvedValue({ kind: 'search', status: 'completed', result: JSON.stringify({ posts: [{ id: '12', title: 'Film' }] }) });
  const service = new TaskService({} as any);
  await expect(service.postResources('search', '99')).rejects.toThrow('Not Found');
  expect(suenen.postShares).not.toHaveBeenCalled();
  suenen.postShares.mockResolvedValue([]);
  await expect(service.postResources('search', '12')).rejects.toThrow('该帖子没有可用的夸克网盘链接');
  expect(db.resource.upsert).not.toHaveBeenCalled();
});
test('an uncertain remote write cannot be retried as a new transfer', async () => {
  db.task.findUnique.mockResolvedValue({ id: 'task', kind: 'transfer', status: 'failed', stage: 'transferring', remoteTaskId: null });
  const service = new TaskService({} as any);
  await expect(service.retry('task')).rejects.toThrow('转存结果待核对');
  expect(db.task.update).not.toHaveBeenCalled();
});
test('task serialization does not expose share or session payload', () => {
  const service = new TaskService({} as any);
  const result = service.publicTask({ id: '1', payload: 'secret', idempotencyKey: 'private', result: '{"transferred":true}' });
  expect(result.payload).toBeUndefined();
  expect(result.idempotencyKey).toBeUndefined();
  expect(result.result.transferred).toBe(true);
});
test('a failed metadata step preserves transferred movie state', async () => {
  db.task.findUniqueOrThrow.mockResolvedValue({ id: 'task', remoteTaskId: 'remote', result: '{"transferred":true}' });
  db.task.update.mockResolvedValue({});
  await new TaskService({} as any).fail('task', new Error('QUARK_OBJECT_HTTP_503'));
  expect(db.task.update).toHaveBeenCalledWith({ where: { id: 'task' }, data: { status: 'partial', error: 'QUARK_OBJECT_HTTP_503' } });
});
test('successful transfers still map STRM when cloud metadata upload fails', async () => {
  const task = { id: 'task', movieId: 42, targetFolderId: 'folder', remoteTaskId: 'remote', payload: '{}', result: '{}', status: 'queued', stage: 'queued' };
  db.task.findUniqueOrThrow.mockImplementation(async () => ({ ...task }));
  db.task.update.mockImplementation(async ({ data }) => Object.assign(task, data));
  const service = new TaskService({ detail: async () => ({ id: 42, title: 'Film', release_date: '2024-01-01' }) } as any);
  vi.spyOn(service, 'quark').mockReturnValue({
    waitTask: async () => {}, listFiles: async () => [{ fid: 'video', file_name: 'Film (2024).mkv' }],
    uploadSmallFile: async () => { throw new Error('QUARK_METADATA_UNAVAILABLE'); },
  } as any);
  const sync = vi.fn(async () => ({ count: 1, metadataCount: 0, warnings: [], outputDir: '/strm' }));
  service.strm = { getSettings: () => ({ enabled: true }), sync } as any;
  await service.transfer('task');
  expect(sync).toHaveBeenCalledOnce();
  expect(task.status).toBe('partial');
  expect(JSON.parse(task.result)).toMatchObject({ transferred: true, strm: { count: 1 } });
});
