// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { formatFileSize } from '@/domain/resources/file-size'
import { ShareFileBrowser } from '@/features/resources/components/share-file-browser'
import { api } from '@/infrastructure/http/api'

vi.mock('@/infrastructure/http/api', () => ({ api: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const resource = {
  id: 'resource',
  title: '电影分享',
  shareId: 'share',
  passcode: 'a123',
}
function renderBrowser() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Routes>
          <Route
            path="/"
            element={<ShareFileBrowser resource={resource} title="电影分享" />}
          />
          <Route path="/tasks" element={<p>任务已提交</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}
function mockFiles() {
  vi.mocked(api).mockImplementation(async path => {
    if (path === '/resources/resource/files?folderId=0')
      return [
        { id: 'small', name: 'small.srt', directory: false, size: 1024 },
        { id: 'folder', name: '电影目录', directory: true, size: null },
        { id: 'large', name: 'large.mkv', directory: false, size: 5368709120 },
        { id: 'empty', name: 'empty.txt', directory: false, size: 0 },
      ]
    if (path === '/resources/resource/files?folderId=folder')
      return [
        { id: 'video', name: 'Film.mkv', directory: false, size: 2147483648 },
      ]
    if (path === '/transfers') return { id: 'task' }
    throw new Error(`Unexpected path: ${path}`)
  })
}
test('formats byte sizes without treating unknown size as an empty file', () => {
  expect(formatFileSize(null)).toBe('—')
  expect(formatFileSize(undefined)).toBe('—')
  expect(formatFileSize(-1)).toBe('—')
  expect(formatFileSize(0)).toBe('0 B')
  expect(formatFileSize(1024)).toBe('1 KiB')
  expect(formatFileSize(5368709120)).toBe('5 GiB')
})
test('keeps folders first and sorts real file sizes numerically', async () => {
  mockFiles()
  renderBrowser()
  await screen.findByText('large.mkv')
  expect(screen.getByText('5 GiB')).toBeTruthy()
  expect(screen.getByText('0 B')).toBeTruthy()
  expect(screen.getByText('—')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '大小', exact: true }))
  let rows = screen.getAllByRole('row').slice(1)
  expect(
    within(rows[0]).getByRole('button', { name: '打开 电影目录' })
  ).toBeTruthy()
  expect(rows[1].textContent).toContain('large.mkv')
  expect(rows[2].textContent).toContain('small.srt')
  fireEvent.click(screen.getByRole('button', { name: '大小', exact: true }))
  rows = screen.getAllByRole('row').slice(1)
  expect(rows[1].textContent).toContain('empty.txt')
})
test('select all shows known size separately from unknown folder sizes and clears selection on navigation', async () => {
  mockFiles()
  renderBrowser()
  await screen.findByText('large.mkv')
  fireEvent.click(screen.getByRole('checkbox', { name: '全选当前目录' }))
  expect(screen.getByText('已选 4 项 · 5 GiB，另有大小未知的项目')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '打开 电影目录' }))
  await screen.findByText('Film.mkv')
  expect(
    (
      screen.getByRole('button', {
        name: '转存选中项 (0)',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  expect(document.activeElement).toBe(
    screen.getByRole('region', { name: '电影目录中的文件' })
  )
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 Film.mkv' }))
  expect(screen.getByText('已选 1 项 · 2 GiB')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '分享根目录' }))
  await screen.findByText('large.mkv')
  expect(
    screen
      .getByRole('checkbox', { name: '全选当前目录' })
      .getAttribute('aria-checked')
  ).toBe('false')
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: '打开 电影目录' })
  )
})
test('folder transfer sends only the user selection with its current parent', async () => {
  mockFiles()
  renderBrowser()
  fireEvent.click(
    await screen.findByRole('checkbox', { name: '选择 电影目录' })
  )
  fireEvent.click(screen.getByRole('button', { name: '转存选中项 (1)' }))
  await screen.findByText('任务已提交')
  expect(
    vi.mocked(api).mock.calls.find(([path]) => path === '/transfers')?.[1]?.body
  ).toBe(
    JSON.stringify({
      resourceId: 'resource',
      folderId: '0',
      fileIds: ['folder'],
    })
  )
})
test('a movie and subtitle are submitted together in one transfer', async () => {
  mockFiles()
  renderBrowser()
  fireEvent.click(
    await screen.findByRole('checkbox', { name: '选择 large.mkv' })
  )
  fireEvent.click(screen.getByRole('checkbox', { name: '选择 small.srt' }))
  fireEvent.click(screen.getByRole('button', { name: '转存选中项 (2)' }))
  await screen.findByText('任务已提交')
  expect(
    JSON.parse(
      vi.mocked(api).mock.calls.find(([path]) => path === '/transfers')![1]!
        .body as string
    )
  ).toEqual({
    resourceId: 'resource',
    folderId: '0',
    fileIds: ['large', 'small'],
  })
})
test('a failed directory can be retried without enabling a transfer', async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error('读取失败'))
    .mockResolvedValue([])
  renderBrowser()
  await screen.findByRole('alert')
  expect(
    (
      screen.getByRole('button', {
        name: '转存选中项 (0)',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '重试' }))
  await screen.findByText('此目录为空')
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})
