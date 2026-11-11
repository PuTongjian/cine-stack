import { expect, test } from 'vitest'
import { findDownloadedMovieIds } from '../../../apps/api/src/modules/library/library.js'

const movies = [
  { id: 42, title: '电影', release_date: '2025-01-01' },
  { id: 7, title: '空目录', release_date: '2024-01-01' },
]

test('matches downloaded movies from actual drive folders and video files', async () => {
  const files = new Map([
    [
      'library',
      [
        { fid: 'movie', file_name: '电影 (2025) [tmdbid-42]', dir: true },
        { fid: 'empty', file_name: '空目录 (2024) [tmdbid-7]', dir: true },
      ],
    ],
    ['movie', [{ fid: 'video', file_name: '电影.mkv' }]],
    ['empty', [{ fid: 'poster', file_name: 'poster.jpg' }]],
  ])
  await expect(
    findDownloadedMovieIds(movies, async id => files.get(id) || [], 'library')
  ).resolves.toEqual(new Set([42]))
})

test('recognizes a renamed movie folder when its tmdb marker remains', async () => {
  const files = new Map([
    [
      'library',
      [{ fid: 'movie', file_name: '自定义目录 [tmdbid-42]', dir: true }],
    ],
    ['movie', [{ fid: 'video', file_name: 'movie.mp4' }]],
  ])
  await expect(
    findDownloadedMovieIds(movies, async id => files.get(id) || [], 'library')
  ).resolves.toEqual(new Set([42]))
})
