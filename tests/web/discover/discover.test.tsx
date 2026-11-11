// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'
import { Discover } from '@/features/discover/pages/discover-page'
import { api } from '@/infrastructure/http/api'

vi.mock('@/infrastructure/http/api', () => ({ api: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const movie = {
  id: 42,
  title: '电影',
  release_date: '2025-01-01',
  poster_path: null,
  vote_average: 7.2,
  overview: '',
}
function renderDiscover(entry: string) {
  vi.mocked(api).mockImplementation(async path =>
    path === '/movies/genres'
      ? { genres: [{ id: 18, name: '剧情' }] }
      : { results: [movie], total_results: 1, total_pages: 3 }
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Discover />
      </MemoryRouter>
    </QueryClientProvider>
  )
}
test('search waits for a nonempty title and submits a trimmed query', async () => {
  renderDiscover('/discover?mode=search')
  await screen.findByText('搜索你想看的电影')
  expect(vi.mocked(api).mock.calls.map(([path]) => path)).toEqual([
    '/movies/genres',
  ])
  fireEvent.change(screen.getByRole('textbox', { name: '搜索电影' }), {
    target: { value: '  星际穿越  ' },
  })
  fireEvent.click(screen.getByRole('button', { name: '搜索', exact: true }))
  await screen.findByText('电影')
  const request = vi
    .mocked(api)
    .mock.calls.find(([path]) => path.startsWith('/movies/search'))?.[0]
  expect(new URLSearchParams(request?.split('?')[1]).get('q')).toBe('星际穿越')
})
test('changing a filter resets pagination and keeps the other filters', async () => {
  renderDiscover('/discover?mode=discover&page=3&with_genres=18')
  await screen.findByText('电影')
  const year = screen.getByRole('spinbutton', { name: '起始年份' })
  fireEvent.change(year, { target: { value: '2' } })
  expect((year as HTMLInputElement).value).toBe('2')
  fireEvent.change(year, { target: { value: '2025' } })
  await waitFor(() =>
    expect(
      vi.mocked(api).mock.calls.some(([path]) => path.includes('2025-01-01'))
    ).toBe(true)
  )
  const request = vi
    .mocked(api)
    .mock.calls.filter(([path]) => path.startsWith('/movies/discover'))
    .at(-1)?.[0]
  const params = new URLSearchParams(request?.split('?')[1])
  expect(params.get('page')).toBe('1')
  expect(params.get('with_genres')).toBe('18')
  expect(params.get('primary_release_date.gte')).toBe('2025-01-01')
})
test('switching shadcn tabs changes the API source and exposes its filters', async () => {
  renderDiscover('/discover')
  await screen.findByText('电影')
  fireEvent.mouseDown(screen.getByRole('tab', { name: '分类筛选' }), {
    button: 0,
  })
  await screen.findByRole('combobox', { name: '类型' })
  await waitFor(() =>
    expect(
      vi
        .mocked(api)
        .mock.calls.some(([path]) => path.startsWith('/movies/discover'))
    ).toBe(true)
  )
  expect(
    screen.getByRole('tab', { name: '分类筛选' }).getAttribute('aria-selected')
  ).toBe('true')
})
