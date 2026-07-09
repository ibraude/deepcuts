import { z } from 'zod'

export const generatedHostSchema = z.object({
  id: z.string().describe('Short slug id, e.g. "narrator" or "marty"'),
  name: z.string().describe('Display name'),
  persona: z.string().describe('Detailed persona — voice, manner, biographical sketch if any'),
  voiceRefHint: z
    .enum(['narrator-male', 'narrator-female', 'character-male', 'character-female'])
    .describe('Voice flavor; we map to an ElevenLabs default voice'),
})

export const generatedNarrationSegmentSchema = z.object({
  type: z.literal('narration'),
  id: z.string(),
  hostId: z.string(),
  text: z.string().describe('Narration line — full sentences, no placeholders'),
})

export const generatedTrackRequestSchema = z.object({
  title: z.string(),
  artist: z.string(),
  searchHint: z.string().optional().describe('Album or year to disambiguate covers/remasters'),
  why: z.string().describe('One-sentence reason this song is here'),
})

export const generatedVoiceoverSchema = z.object({
  id: z.string(),
  hostId: z.string(),
  text: z.string().describe('Voiceover line spoken over the music — natural, conversational'),
  atSeconds: z.number().min(0).describe('When in the song this fires (seconds)'),
  duckTo: z
    .number()
    .min(0)
    .max(100)
    .default(55)
    .describe('Music duck level as a PERCENTAGE on a 0–100 scale (e.g. 55 means 55%). Do NOT use a 0–1 fraction.'),
  holdDuck: z.boolean().default(false).describe('True if next voiceover follows shortly — keeps music ducked'),
})

export const generatedSongSegmentSchema = z.object({
  type: z.literal('song'),
  id: z.string(),
  trackRequest: generatedTrackRequestSchema,
  startAtSeconds: z.number().min(0).default(0),
  playSeconds: z.number().positive().describe('Cap at typical song length + buffer, e.g. 500 for a full play-through'),
  voiceovers: z.array(generatedVoiceoverSchema).default([]),
})

export const generatedSegmentSchema = z.discriminatedUnion('type', [
  generatedNarrationSegmentSchema,
  generatedSongSegmentSchema,
])

export const generatedChapterSchema = z.object({
  title: z.string(),
  segments: z.array(generatedSegmentSchema).min(1),
})

export const generatedManifestSchema = z.object({
  title: z.string().describe('Episode title — evocative, short'),
  subject: z.string().describe('Subject in brief, e.g. "Bob Dylan — Blonde on Blonde"'),
  estimatedMinutes: z.number().positive(),
  hosts: z.array(generatedHostSchema).min(1).max(3),
  chapters: z.array(generatedChapterSchema).min(1),
})

export type GeneratedManifest = z.infer<typeof generatedManifestSchema>
export type GeneratedSegment = z.infer<typeof generatedSegmentSchema>
export type GeneratedTrackRequest = z.infer<typeof generatedTrackRequestSchema>

// --- Outline schema (Spec C step 2) ---

export const draftOutlineNarrationBeatSchema = z.object({
  type: z.literal('narration'),
  hostId: z.string(),
  intent: z.string().describe('One sentence summary of what the narration should accomplish'),
})

export const draftOutlineVoiceoverBeatSchema = z.object({
  hostId: z.string(),
  intent: z.string().describe('What this voiceover should accomplish over the song'),
  atSeconds: z.number().min(0),
})

export const draftOutlineSongBeatSchema = z.object({
  type: z.literal('song'),
  trackRequest: generatedTrackRequestSchema,
  why: z.string(),
  voiceoverBeats: z.array(draftOutlineVoiceoverBeatSchema),
})

export const draftOutlineChapterSchema = z.object({
  title: z.string(),
  beats: z
    .array(z.discriminatedUnion('type', [draftOutlineNarrationBeatSchema, draftOutlineSongBeatSchema]))
    .min(1),
})

export const draftOutlineSchema = z.object({
  proposedHosts: z.array(generatedHostSchema).min(1).max(3),
  chapters: z.array(draftOutlineChapterSchema).min(1),
})

export type DraftOutlineParsed = z.infer<typeof draftOutlineSchema>
