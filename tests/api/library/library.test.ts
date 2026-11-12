import { expect, test } from 'vitest'
import {
  findDownloadedMovieIds,
  movieIdForFolder,
} from '../../../apps/api/src/modules/library/library.js'

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

test('discovers movies present on the drive even when they have no database record', async () => {
  const files = new Map([
    [
      'library',
      [{ fid: 'hope', file_name: '希望 (2026) [tmdbid-1058424]', dir: true }],
    ],
    ['hope', [{ fid: 'video', file_name: '希望 (2026).mp4' }]],
  ])
  await expect(
    findDownloadedMovieIds(movies, async id => files.get(id) || [], 'library')
  ).resolves.toEqual(new Set([1058424]))
  await expect(
    findDownloadedMovieIds([], async id => files.get(id) || [], 'library')
  ).resolves.toEqual(new Set([1058424]))
})

test('invalid TMDB directory markers never become metadata lookup IDs', () => {
  for (const marker of ['0', '9007199254740992', '-1'])
    expect(
      movieIdForFolder(`Film [tmdbid-${marker}]`, new Map())
    ).toBeUndefined()
})

test('downloaded state follows actual file deletions and ignores incomplete replacement files', async () => {
  const files = new Map<string, any[]>([
    [
      'library',
      [{ fid: 'movie', file_name: '电影 (2025) [tmdbid-42]', dir: true }],
    ],
    [
      'movie',
      [
        { fid: 'video', file_name: '电影.webm' },
        { fid: 'stage', file_name: '_incoming-task', dir: true },
      ],
    ],
    ['stage', [{ fid: 'incoming', file_name: 'new.mkv' }]],
  ])
  const scan = () =>
    findDownloadedMovieIds(movies, async id => files.get(id) || [], 'library')
  expect(await scan()).toEqual(new Set([42]))
  files.get('movie')!.shift()
  files
    .get('movie')!
    .push({ fid: 'partial', file_name: '_incoming-task-partial.mkv' })
  expect(await scan()).toEqual(new Set())
  files.set('library', [])
  expect(await scan()).toEqual(new Set())
})
