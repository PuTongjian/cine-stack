import {
  movieFolder,
  stagingPrefix,
  videoFilePattern as videoFile,
} from '../movies/metadata.js'

const movieMarker = /\[tmdbid-(\d+)\](?:-[a-zA-Z0-9]+)?$/i

type Movie = {
  id: number
  title?: string
  original_title?: string
  release_date?: string
}
type DriveFile = {
  fid?: string
  file_name?: string
  dir?: boolean
  file_type?: number
}

function isDirectory(file: DriveFile) {
  return file.dir === true || file.file_type === 0
}

export function movieIdForFolder(
  name: string,
  moviesByFolder: Map<string, number>
) {
  const exact = moviesByFolder.get(name)
  if (exact !== undefined) return exact
  const match = movieMarker.exec(name)
  const id = match ? Number(match[1]) : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

/** Finds movies that have a real video file in their configured cloud-drive folder. */
export async function findDownloadedMovieIds(
  movies: Movie[],
  listFiles: (folderId: string) => Promise<DriveFile[]>,
  rootFolderId: string
) {
  const moviesByFolder = new Map(
    movies.map(movie => [movieFolder(movie), movie.id])
  )
  const downloaded = new Set<number>()
  const visited = new Set<string>()

  const walk = async (
    folderId: string,
    matchedMovieId?: number,
    depth = 0
  ): Promise<void> => {
    if (depth > 32 || visited.has(folderId)) return
    visited.add(folderId)
    for (const file of await listFiles(folderId)) {
      if (typeof file.fid !== 'string' || typeof file.file_name !== 'string')
        continue
      if (file.file_name.startsWith(stagingPrefix)) continue
      if (isDirectory(file)) {
        const movieId =
          matchedMovieId ?? movieIdForFolder(file.file_name, moviesByFolder)
        await walk(file.fid, movieId, depth + 1)
      } else if (
        matchedMovieId !== undefined &&
        videoFile.test(file.file_name)
      ) {
        downloaded.add(matchedMovieId)
      }
    }
  }

  await walk(rootFolderId)
  return downloaded
}
