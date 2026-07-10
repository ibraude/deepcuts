import { z } from 'zod'

export const remoteCatalogEntrySchema = z.object({
  id: z.string().min(1),
  status: z.enum(['released', 'upcoming']),
  releaseDate: z.string().optional(),
  expectedRelease: z.string().optional(),
  order: z.number().int().nonnegative(),
})

export const remoteCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string(),
  episodes: z.array(remoteCatalogEntrySchema),
}).strict()

export type RemoteCatalogEntry = z.infer<typeof remoteCatalogEntrySchema>
export type RemoteCatalogIndex = z.infer<typeof remoteCatalogSchema>
