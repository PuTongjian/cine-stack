// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrmSettingsPanel } from './strm-settings';
import { api } from './api';
vi.mock('./api', () => ({ api: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

test('selects a cloud directory, saves the mapping and only syncs saved settings', async () => {
  const initial = { enabled: false, sourceFolderId: 'library', outputDir: '/app/strm', baseUrl: '' };
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === '/integrations/quark-tv') return { authorized: false };
    if (path === '/strm/settings' && options?.method === 'PUT') return JSON.parse(String(options.body));
    if (path === '/strm/settings') return initial;
    if (path === '/strm/folders?folderId=0') return [{ id: 'movies', name: '电影目录' }];
    if (path === '/strm/folders?folderId=movies') return [];
    if (path === '/strm/sync') return { count: 2, metadataCount: 1, warnings: [] };
    throw new Error(`Unexpected API path: ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><StrmSettingsPanel /></QueryClientProvider>);
  await screen.findByLabelText('启用 STRM 映射');
  const sync = screen.getByRole('button', { name: '立即同步已有资源' }) as HTMLButtonElement;
  expect(sync.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '选择目录' }));
  fireEvent.click(await screen.findByRole('button', { name: '电影目录' }));
  await screen.findByText('此目录没有子目录');
  fireEvent.click(screen.getByRole('button', { name: '映射此目录' }));
  fireEvent.click(screen.getByLabelText('启用 STRM 映射'));
  fireEvent.change(screen.getByLabelText('Jellyfin 可访问的影栈地址'), { target: { value: 'http://192.168.1.10:8080' } });
  expect(sync.disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '保存映射配置' }));
  await screen.findByText('映射配置已保存');
  await waitFor(() => expect(sync.disabled).toBe(false));
  expect(vi.mocked(api).mock.calls.find(([path, options]) => path === '/strm/settings' && options?.method === 'PUT')?.[1]?.body).toBe(JSON.stringify({ ...initial, enabled: true, sourceFolderId: 'movies', baseUrl: 'http://192.168.1.10:8080' }));
  fireEvent.click(sync);
  await screen.findByText('同步完成 · 2 个 STRM · 1 个元数据或字幕文件');
});
