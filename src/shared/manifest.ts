import { z } from 'zod'

// Per-host TTS model selector. v2 is the stable, consistent-sounding default.
// v3 is the alpha model that renders audio tags ([pause], [thoughtfully], etc.)
// but sounds different from v2 for the same voice ID — pick v3 only when you
// want tag-driven expressive delivery.
export const TTS_MODELS = ['eleven_multilingual_v2', 'eleven_v3'] as const
export type TtsModel = (typeof TTS_MODELS)[number]

const hostSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  persona: z.string(),
  voiceRef: z.string().min(1),
  ttsModel: z.enum(TTS_MODELS).optional(),
})

const narrationSegmentSchema = z.object({
  type: z.literal('narration'),
  id: z.string().min(1),
  hostId: z.string().min(1),
  text: z.string().min(1),
  factRefs: z.array(z.string()).optional(),
  audio: z.string().url().or(z.string().startsWith('file:')).or(z.string().startsWith('/')).optional(),
})

const trackSchema = z.object({
  title: z.string().min(1),
  artist: z.string().min(1),
  isrc: z.string().optional(),
  spotifyUri: z.string().regex(/^spotify:track:[A-Za-z0-9]+$/),
  appleMusicId: z.string().optional(),
}).passthrough()

const voiceoverSchema = z.object({
  id: z.string().min(1),
  hostId: z.string().min(1),
  text: z.string().min(1),
  atSeconds: z.number().min(0),
  duckTo: z.number().min(0).max(100).default(60),
  // When true, don't fade music back up after this voiceover ends.
  // The next voiceover will pick up the conversation at the already-ducked level.
  // Set on every voiceover in a chain EXCEPT the last one.
  holdDuck: z.boolean().default(false),
  audio: z.string().url().or(z.string().startsWith('file:')).or(z.string().startsWith('/')).optional(),
})

const songSegmentSchema = z.object({
  type: z.literal('song'),
  id: z.string().min(1),
  track: trackSchema,
  startAtSeconds: z.number().min(0).default(0),
  playSeconds: z.number().positive(),
  why: z.string().optional(),
  voiceovers: z.array(voiceoverSchema).optional(),
})

const segmentSchema = z.discriminatedUnion('type', [narrationSegmentSchema, songSegmentSchema])

const chapterSchema = z.object({
  title: z.string().min(1),
  segments: z.array(segmentSchema).min(1),
})

const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  accessedDate: z.string(),
})

const factSchema = z.object({
  id: z.string(),
  claim: z.string(),
  sourceId: z.string(),
  confidence: z.number().min(0).max(1),
})

export const episodeManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1),
  subject: z.string().min(1),
  coverImage: z.string().min(1),
  estimatedMinutes: z.number().positive(),
  hosts: z.array(hostSchema).min(1),
  chapters: z.array(chapterSchema).min(1),
  sources: z.array(sourceSchema),
  facts: z.array(factSchema),
}).strict()

export type EpisodeManifest = z.infer<typeof episodeManifestSchema>
export type Host = z.infer<typeof hostSchema>
export type NarrationSegment = z.infer<typeof narrationSegmentSchema>
export type SongSegment = z.infer<typeof songSegmentSchema>
export type Voiceover = z.infer<typeof voiceoverSchema>
export type Segment = z.infer<typeof segmentSchema>

export type FlatSegment = Segment & { chapterIndex: number; chapterTitle: string; indexInEpisode: number }

export function flattenSegments(manifest: EpisodeManifest): FlatSegment[] {
  const flat: FlatSegment[] = []
  let i = 0
  manifest.chapters.forEach((chapter, chapterIndex) => {
    for (const segment of chapter.segments) {
      flat.push({ ...segment, chapterIndex, chapterTitle: chapter.title, indexInEpisode: i })
      i++
    }
  })
  return flat
}

// Permissive variant of the manifest schema for drafts. Drafts may have empty
// strings while being authored; only Publish/Preview should validate against
// episodeManifestSchema.

const draftHostSchema = hostSchema.extend({
  name: z.string(),
  voiceRef: z.string(),
})

const draftNarrationSegmentSchema = narrationSegmentSchema.extend({
  hostId: z.string(),
  text: z.string(),
})

const draftTrackSchema = trackSchema.extend({
  title: z.string(),
  artist: z.string(),
  spotifyUri: z.string(),
})

const draftVoiceoverSchema = voiceoverSchema.extend({
  hostId: z.string(),
  text: z.string(),
})

const draftSongSegmentSchema = songSegmentSchema.extend({
  track: draftTrackSchema,
  voiceovers: z.array(draftVoiceoverSchema).optional(),
})

const draftSegmentSchema = z.discriminatedUnion('type', [
  draftNarrationSegmentSchema,
  draftSongSegmentSchema,
])

const draftChapterSchema = chapterSchema.extend({
  title: z.string(),
  segments: z.array(draftSegmentSchema),
})

export const draftManifestSchema = episodeManifestSchema.extend({
  title: z.string(),
  subject: z.string(),
  coverImage: z.string(),
  hosts: z.array(draftHostSchema),
  chapters: z.array(draftChapterSchema),
})

export type DraftManifest = z.infer<typeof draftManifestSchema>

export interface DraftSummary {
  draftId: string
  title: string
  subject: string
  hostCount: number
  segmentCount: number
  hasCover: boolean
  updatedAt: number
}

export interface LibrarySummary {
  libraryId: string
  title: string
  subject: string
  hostCount: number
  segmentCount: number
  estimatedMinutes: number
  hasCover: boolean
  publishedAt: number
}

export interface DraftOutlineNarrationBeat {
  type: 'narration'
  hostId: string
  intent: string
}

export interface DraftOutlineVoiceoverBeat {
  hostId: string
  intent: string
  atSeconds: number
}

export interface DraftOutlineSongBeat {
  type: 'song'
  trackRequest: { title: string; artist: string; searchHint?: string }
  why: string
  voiceoverBeats: DraftOutlineVoiceoverBeat[]
}

export interface DraftOutlineChapter {
  title: string
  beats: Array<DraftOutlineNarrationBeat | DraftOutlineSongBeat>
}

export interface DraftOutline {
  proposedHosts: Array<{
    id: string
    name: string
    persona: string
    voiceRefHint: 'narrator-male' | 'narrator-female' | 'character-male' | 'character-female'
  }>
  chapters: DraftOutlineChapter[]
}
