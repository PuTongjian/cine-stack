// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { MovieDetail } from '@/features/movies/pages/movie-detail-page'
import { api } from '@/infrastructure/http/api'

vi.mock('@/infrastructure/http/api', () => ({ api: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

function renderDetail(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  })
) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/movies/42']}>
        <Routes>
          <Route path="/movies/:id" element={<MovieDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return client
}
const movie = {
  id: 42,
  title: 'Film',
  release_date: '2024-01-01',
  vote_average: 8,
}

test('detail refreshes cached presence and lets the user recheck deleted files without changing viewing history', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  })
  client.setQueryData(['library'], {
    results: [{ ...movie, downloaded: false, strm: false }],
  })
  let state = {
    ...movie,
    downloaded: true,
    strm: true,
    watchedAt: '2026-11-01',
  }
  vi.mocked(api).mockImplementation(async path =>
    path === '/library' ? { results: [state] } : movie
  )
  renderDetail(client)
  await screen.findByText(/网盘已存/)
  expect(
    screen.getByRole('button', { name: '再次下载 / 更换资源' })
  ).toBeTruthy()
  state = { ...state, downloaded: false, strm: false }
  fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
  await screen.findByText(/网盘未存/)
  expect(screen.getByText('· STRM 未映射', { exact: false })).toBeTruthy()
  expect(
    screen.getByRole('button', { name: '已看过' }).getAttribute('aria-pressed')
  ).toBe('true')
  expect(
    screen.queryByRole('button', { name: '再次下载 / 更换资源' })
  ).toBeNull()
})

test('failed presence reads are displayed as unknown rather than missing videos', async () => {
  vi.mocked(api).mockImplementation(async path => {
    if (path === '/library') throw new Error('QUARK_HTTP_503')
    return movie
  })
  renderDetail()
  await screen.findByText('文件状态读取失败')
  expect(screen.queryByText(/网盘未存/)).toBeNull()
  vi.mocked(api).mockImplementation(async path =>
    path === '/library'
      ? { results: [{ ...movie, downloaded: true, strm: false }] }
      : movie
  )
  fireEvent.click(screen.getByRole('button', { name: '刷新状态' }))
  await screen.findByText(/网盘已存/)
})
