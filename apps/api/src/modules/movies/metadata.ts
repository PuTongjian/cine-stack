import { XMLBuilder } from 'fast-xml-parser'
export function movieBasename(movie: any) {
  const title = String(movie.title || movie.original_title || 'Movie')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 140)
  const year = String(movie.release_date || '').slice(0, 4)
  return `${title}${/^\d{4}$/.test(year) ? ` (${year})` : ''}`
}
export function movieFolder(movie: any) {
  return `${movieBasename(movie)} [tmdbid-${movie.id}]`
}
export function buildNfo(movie: any) {
  const crew = movie.credits?.crew || []
  const xml = new XMLBuilder({
    ignoreAttributes: false,
    format: true,
    suppressEmptyNode: true,
    suppressBooleanAttributes: false,
  })
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    xml.build({
      movie: {
        title: movie.title,
        originaltitle: movie.original_title,
        year: movie.release_date?.slice(0, 4),
        premiered: movie.release_date,
        plot: movie.overview,
        tagline: movie.tagline,
        runtime: movie.runtime,
        uniqueid: [
          { '@_type': 'tmdb', '@_default': 'true', '#text': String(movie.id) },
          ...(movie.imdb_id
            ? [{ '@_type': 'imdb', '#text': movie.imdb_id }]
            : []),
        ],
        genre: movie.genres?.map((x: any) => x.name),
        studio: movie.production_companies?.map((x: any) => x.name),
        director: crew
          .filter((x: any) => x.job === 'Director')
          .map((x: any) => x.name),
        actor: movie.credits?.cast
          ?.slice(0, 20)
          .map((x: any, index: number) => ({
            name: x.name,
            role: x.character,
            order: index,
          })),
        ...(movie.poster_path
          ? { thumb: `https://image.tmdb.org/t/p/original${movie.poster_path}` }
          : {}),
        ...(movie.backdrop_path
          ? {
              fanart: {
                thumb: `https://image.tmdb.org/t/p/original${movie.backdrop_path}`,
              },
            }
          : {}),
        ratings: {
          rating: {
            '@_name': 'themoviedb',
            '@_max': '10',
            '@_default': 'true',
            value: movie.vote_average,
            votes: movie.vote_count,
          },
        },
      },
    })
  )
}
