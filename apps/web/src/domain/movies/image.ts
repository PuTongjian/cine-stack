export const image = (path: string | null | undefined, size = 'w500') =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : undefined
