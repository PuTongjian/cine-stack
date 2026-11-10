// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ResourcesPage } from './main';
import { api } from './api';
vi.mock('./api', () => ({ api: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const posts = Array.from({ length: 10 }, (_, index) => ({ id: String(index + 1), title: `资源标题 ${index + 1}`, url: `https://www.suenen.com/thread-${index + 1}.htm` }));
const share = { id: 'resource1', title: posts[0].title, shareId: 'share1', passcode: 'a123' };
function renderResources() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/movies/42/resources?searchId=search']}><Routes><Route path="/movies/:id/resources" element={<ResourcesPage />} /><Route path="/tasks" element={<p>任务已提交</p>} /></Routes></MemoryRouter></QueryClientProvider>);
}
function mockSearch() {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/tasks/search') return { status: 'completed', result: { posts } };
    if (path === '/tasks/search/posts/1/resources') return [share];
    if (path === '/resources/resource1/files?folderId=0') return [{ id: 'folder', name: '电影目录', directory: true }];
    if (path === '/resources/resource1/files?folderId=folder') return [{ id: 'video', name: 'Film.mkv', directory: false }];
    if (path === '/transfers') return { id: 'transfer' };
    throw new Error(`Unexpected API path: ${path}`);
  });
}
test('lists ten clickable titles and waits for manual file selection before transferring', async () => {
  mockSearch(); renderResources();
  await screen.findByRole('button', { name: '资源标题 10' });
  expect(screen.getAllByRole('button').filter((button) => button.className === 'resource-title')).toHaveLength(10);
  expect(vi.mocked(api).mock.calls.map(([path]) => path)).toEqual(['/tasks/search']);
  fireEvent.click(screen.getByRole('button', { name: '资源标题 1' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开 电影目录' }));
  const checkbox = await screen.findByRole('checkbox', { name: '选择 Film.mkv' });
  expect((screen.getByRole('button', { name: '转存选中项 (0)' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('link', { name: '打开网盘' }).getAttribute('href')).toBe('https://pan.quark.cn/s/share1?pwd=a123');
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: '转存选中项 (1)' }));
  await screen.findByText('任务已提交');
  expect(vi.mocked(api).mock.calls.find(([path]) => path === '/transfers')?.[1]?.body).toBe(JSON.stringify({ resourceId: 'resource1', folderId: 'folder', fileIds: ['video'] }));
});
test('switching titles clears the selected files and resets the folder', async () => {
  mockSearch();
  const implementation = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === '/tasks/search/posts/2/resources') return [{ ...share, id: 'resource2', shareId: 'share2' }];
    if (path === '/resources/resource2/files?folderId=0') return [{ id: 'other', name: 'Other.mkv', directory: false }];
    return implementation(path, options);
  });
  renderResources();
  fireEvent.click(await screen.findByRole('button', { name: '资源标题 1' }));
  fireEvent.click(await screen.findByRole('button', { name: '打开 电影目录' }));
  fireEvent.click(await screen.findByRole('checkbox', { name: '选择 Film.mkv' }));
  fireEvent.click(screen.getByRole('button', { name: '资源标题 2' }));
  await screen.findByRole('checkbox', { name: '选择 Other.mkv' });
  expect((screen.getByRole('button', { name: '转存选中项 (0)' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('checkbox', { name: '选择 Film.mkv' })).toBeNull();
});
test('multiple shares require a choice and a failed post keeps its source link available', async () => {
  mockSearch();
  const implementation = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === '/tasks/search/posts/1/resources') return [share, { ...share, id: 'resource2', shareId: 'share2' }];
    if (path === '/tasks/search/posts/2/resources') throw new Error('该帖子没有可用的夸克网盘链接，请打开来源帖子查看。');
    return implementation(path, options);
  });
  renderResources();
  fireEvent.click(await screen.findByRole('button', { name: '资源标题 1' }));
  await screen.findByRole('button', { name: '分享 2' });
  expect(vi.mocked(api).mock.calls.some(([path]) => path.includes('/files?'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '分享 1' }));
  await screen.findByRole('checkbox', { name: '选择 电影目录' });
  fireEvent.click(screen.getByRole('button', { name: '资源标题 2' }));
  await screen.findByRole('alert');
  expect(screen.getAllByRole('link', { name: '来源帖子' })[1].getAttribute('href')).toBe(posts[1].url);
  expect(screen.queryByRole('checkbox')).toBeNull();
});
test('existing searches can still browse their saved shares', async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/tasks/search') return { status: 'completed', result: { count: 1 } };
    if (path === '/resources?searchId=search') return [share];
    if (path === '/resources/resource1/files?folderId=0') return [];
    throw new Error(`Unexpected API path: ${path}`);
  });
  renderResources();
  fireEvent.click(await screen.findByRole('button', { name: '资源标题 1' }));
  await screen.findByText('此目录为空');
  await waitFor(() => expect(vi.mocked(api).mock.calls.some(([path]) => path.includes('/posts/'))).toBe(false));
});
