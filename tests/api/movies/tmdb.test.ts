import { afterEach, expect, test, vi } from 'vitest'
import { TmdbService } from '../../../apps/api/src/modules/movies/tmdb.js'

afterEach(() => vi.unstubAllEnvs())
test('TMDB API key is server-side and cached responses avoid repeated calls', async () => {
  vi.stubEnv('TMDB_API_KEY', 'fixture')
  vi.stubEnv('TMDB_READ_ACCESS_TOKEN', '')
  const fetchImpl = vi.fn(
    async () =>
      new Response(JSON.stringify({ results: [{ id: 1 }] }), { status: 200 })
  )
  const service = new TmdbService(fetchImpl as typeof fetch)
  await service.trending('week', '1')
  await service.trending('week', '1')
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  const url = fetchImpl.mock.calls[0][0] as URL
  expect(url.pathname).toBe('/3/trending/movie/week')
  expect(url.searchParams.get('api_key')).toBe('fixture')
})
test('invalid pagination and unsupported sort never reach TMDB', () => {
  const service = new TmdbService()
  expect(() => service.trending('week', '-1')).toThrow('INVALID_PAGE')
  expect(() => service.discover({ sort_by: 'unknown' })).toThrow('INVALID_SORT')
})
