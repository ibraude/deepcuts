import { z } from 'zod'

export const paletteSchema = z.object({
  bg: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  ink: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
})

export const episodeMetaSchema = z.object({
  schemaVersion: z.literal(1),
  artistName: z.string().min(1),
  albumName: z.string().min(1),
  blurb: z.string().min(1),
  palette: paletteSchema,
  releaseDate: z.string().nullable(),
  expectedRelease: z.string().nullable(),
}).strict()

export type EpisodeMeta = z.infer<typeof episodeMetaSchema>
export type Palette = z.infer<typeof paletteSchema>
