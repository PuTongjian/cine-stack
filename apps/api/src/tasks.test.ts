import { test, expect, vi, beforeEach } from 'vitest';
const { db } = vi.hoisted(() => ({ db: { task: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), create: vi.fn() }, resource: { findUnique: vi.fn() } } }));
vi.mock('./database.js', () => ({ database: db }));
vi.mock('./config.js', () => ({ dataDir: '/tmp/movie-task-fixture' }));
vi.mock('@movie/crawler-engine', () => ({ SuenenClient: class {}, QuarkClient: class {} }));
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), writeFile: vi.fn() }));
import { TaskService } from './tasks.js';
beforeEach(() => vi.clearAllMocks());
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
