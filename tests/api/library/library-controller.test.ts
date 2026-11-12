import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const { db, listFiles, strmMovieIds, saveMovie } = vi.hoisted(() => ({
  db: { movie: { findMany: vi.fn() } },
  listFiles: vi.fn(),
  strmMovieIds: vi.fn(),
  saveMovie: vi.fn(),
}))
vi.mock('../../../apps/api/src/infrastructure/database.js', () => ({
  database: db,
}))
vi.mock('../../../apps/api/src/app/services.js', () => ({
  tasks: { quark: () => ({ listFiles }), saveMovie },
  strm: { strmMovieIds },
}))

import { LibraryController } from '../../../apps/api/src/modules/library/library.controller.js'

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('QUARK_COOKIE', 'fixture=value')
  vi.stubEnv('QUARK_LIBRARY_FOLDER_ID', 'library')
  db.movie.findMany.mockResolvedValue([
    {
      id: 42,
      watchedAt: '2026-11-01T00:00:00.000Z',
      rating: 8,
      metadata: JSON.stringify({
        id: 42,
        title: 'Film',
        release_date: '2024-01-01',
      }),
    },
  ])
})
afterEach(() => vi.unstubAllEnvs())

test('library reports cloud and STRM presence independently and preserves viewing history after deletions', async () => {
  const files = new Map<string, any[]>([
    [
      'library',
      [{ fid: 'movie', file_name: 'Film (2024) [tmdbid-42]', dir: true }],
    ],
    ['movie', [{ fid: 'video', file_name: 'Film.mkv' }]],
  ])
  listFiles.mockImplementation(async id => files.get(id) || [])
  strmMovieIds.mockResolvedValue(new Set([42]))
  const controller = new LibraryController()
  expect((await controller.library({})).results[0]).toMatchObject({
    id: 42,
    downloaded: true,
    strm: true,
  })
  files.set('movie', [])
  expect((await controller.library({})).results[0]).toMatchObject({
    downloaded: false,
    strm: true,
    rating: 8,
    watchedAt: '2026-11-01T00:00:00.000Z',
  })
  expect((await controller.library({ downloaded: 'true' })).results).toEqual([])
  strmMovieIds.mockResolvedValue(new Set())
  expect(
    (await controller.library({ watched: 'true' })).results[0]
  ).toMatchObject({ downloaded: false, strm: false, rating: 8 })
})

test('a failed cloud read does not return a fabricated missing-file state', async () => {
  listFiles.mockRejectedValue(new Error('QUARK_HTTP_503'))
  strmMovieIds.mockResolvedValue(new Set([42]))
  await expect(new LibraryController().library({})).rejects.toThrow(
    'QUARK_HTTP_503'
  )
})

test('downloaded movies missing from the database are discovered and their metadata is saved', async () => {
  const movie = {
    id: 1058424,
    title: '希望',
    release_date: '2026-01-01',
    poster_path: null,
    vote_average: 7,
    overview: '',
  }
  listFiles.mockImplementation(async id =>
    id === 'library'
      ? [{ fid: 'hope', file_name: '希望 (2026) [tmdbid-1058424]', dir: true }]
      : [{ fid: 'video', file_name: '希望 (2026).mp4' }]
  )
  strmMovieIds.mockResolvedValue(new Set([1058424]))
  saveMovie.mockResolvedValue(movie)
  const result = await new LibraryController().library({ downloaded: 'true' })
  expect(result.results).toEqual([
    expect.objectContaining({
      id: 1058424,
      title: '希望',
      downloaded: true,
      strm: true,
    }),
  ])
  expect(saveMovie).toHaveBeenCalledExactlyOnceWith(1058424)
})

test('a movie present only in STRM is listed without claiming its cloud video exists', async () => {
  listFiles.mockResolvedValue([])
  strmMovieIds.mockResolvedValue(new Set([1058424]))
  saveMovie.mockResolvedValue({
    id: 1058424,
    title: '希望',
    release_date: '2026-01-01',
  })
  const controller = new LibraryController()
  const result = await controller.library({})
  expect(result.results).toContainEqual(
    expect.objectContaining({ id: 1058424, downloaded: false, strm: true })
  )
  expect((await controller.library({ downloaded: 'true' })).results).toEqual([])
})

test('a TMDB outage does not hide newly discovered files or discard existing viewing history', async () => {
  listFiles.mockResolvedValue([])
  strmMovieIds.mockResolvedValue(new Set([1058424]))
  saveMovie.mockRejectedValue(new Error('TMDB_UNAVAILABLE'))
  const result = await new LibraryController().library({})
  expect(result.results).toContainEqual(
    expect.objectContaining({
      id: 1058424,
      title: 'TMDB 1058424',
      downloaded: false,
      strm: true,
    })
  )
  expect(result.results).toContainEqual(
    expect.objectContaining({
      id: 42,
      rating: 8,
      watchedAt: '2026-11-01T00:00:00.000Z',
    })
  )
})

test('discovered metadata is reused on subsequent reads and deleted videos leave the downloaded filter', async () => {
  const movie = { id: 1058424, title: '希望', release_date: '2026-01-01' }
  const files = new Map<string, any[]>([
    [
      'library',
      [{ fid: 'hope', file_name: '希望 (2026) [tmdbid-1058424]', dir: true }],
    ],
    ['hope', [{ fid: 'video', file_name: '希望 (2026).mp4' }]],
  ])
  listFiles.mockImplementation(async id => files.get(id) || [])
  strmMovieIds.mockResolvedValue(new Set([1058424]))
  saveMovie.mockImplementation(async () => {
    db.movie.findMany.mockResolvedValue([
      {
        id: movie.id,
        watchedAt: null,
        rating: null,
        metadata: JSON.stringify(movie),
      },
    ])
    return movie
  })
  const controller = new LibraryController()
  expect(
    (await controller.library({ downloaded: 'true' })).results
  ).toHaveLength(1)
  expect(
    (await controller.library({ downloaded: 'true' })).results
  ).toHaveLength(1)
  expect(saveMovie).toHaveBeenCalledOnce()
  files.set('hope', [])
  expect((await controller.library({ downloaded: 'true' })).results).toEqual([])
  expect((await controller.library({})).results).toContainEqual(
    expect.objectContaining({ id: 1058424, downloaded: false, strm: true })
  )
})

test('unknown empty movie folders are not imported as downloaded movies', async () => {
  listFiles.mockImplementation(async id =>
    id === 'library'
      ? [{ fid: 'hope', file_name: '希望 (2026) [tmdbid-1058424]', dir: true }]
      : [{ fid: 'metadata', file_name: 'movie.nfo' }]
  )
  strmMovieIds.mockResolvedValue(new Set())
  expect(
    (await new LibraryController().library({ downloaded: 'true' })).results
  ).toEqual([])
  expect(saveMovie).not.toHaveBeenCalled()
})
