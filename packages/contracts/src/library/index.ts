import { z } from 'zod'
export const libraryUpdateSchema = z.object({
  watched: z.boolean().optional(),
  rating: z.number().min(0).max(10).nullable().optional(),
})
