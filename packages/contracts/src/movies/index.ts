import { z } from 'zod'
export const searchSchema = z.object({
  q: z.string().trim().min(1).max(100),
  page: z.coerce.number().int().min(1).max(100).default(1),
})
export type MovieSummary = {
  id: number
  title: string
  original_title?: string
  release_date: string
  poster_path: string | null
  backdrop_path?: string | null
  vote_average: number
  overview: string
  genre_ids?: number[]
}
