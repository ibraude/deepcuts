import { z } from 'zod'

export const catalogEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subject: z.string().min(1),
  coverImage: z.string().min(1),
  estimatedMinutes: z.number().positive(),
  manifestPath: z.string().min(1),
  prerendered: z.boolean().default(false),
})

export const catalogIndexSchema = z.object({
  episodes: z.array(catalogEntrySchema),
})

export type CatalogEntry = z.infer<typeof catalogEntrySchema>
export type CatalogIndex = z.infer<typeof catalogIndexSchema>

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
