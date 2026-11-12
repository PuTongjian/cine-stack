// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'
import { MovieCard } from '@/features/movies/components/movie-card'

afterEach(cleanup)
test('movie card links to details with a real poster and stable movie identity', () => {
  render(
    <MemoryRouter>
      <MovieCard
        movie={{
          id: 42,
          title: '电影',
          release_date: '2025-01-01',
          poster_path: '/fixture.jpg',
          vote_average: 7.2,
          overview: '',
        }}
      />
    </MemoryRouter>
  )
  expect(screen.getByRole('link').getAttribute('href')).toBe('/movies/42')
  expect(screen.getByRole('img').getAttribute('src')).toBe(
    'https://image.tmdb.org/t/p/w342/fixture.jpg'
  )
  expect(screen.getByText('7.2')).toBeTruthy()
})

test('movie cards show independent drive and STRM states and remove badges when files disappear', () => {
  const movie = {
    id: 42,
    title: '电影',
    release_date: '2025-01-01',
    poster_path: null,
    vote_average: 7.2,
    overview: '',
  }
  const card = (downloaded: boolean, strm: boolean) => (
    <MemoryRouter>
      <MovieCard movie={{ ...movie, downloaded, strm }} />
    </MemoryRouter>
  )
  const view = render(card(true, true))
  expect(screen.getByLabelText('网盘已存 · STRM 已映射')).toBeTruthy()
  view.rerender(card(false, true))
  expect(screen.getByLabelText('STRM 已映射')).toBeTruthy()
  expect(screen.queryByLabelText('网盘已存 · STRM 已映射')).toBeNull()
  view.rerender(card(false, false))
  expect(screen.queryByLabelText('STRM 已映射')).toBeNull()
})
