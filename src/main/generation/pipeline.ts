import { randomBytes } from 'node:crypto'
import { resolveTrack } from './songResolver'
import type { ScriptProvider, GenerationInput } from './ScriptProvider'
import type { GeneratedManifest, DraftOutlineParsed } from './generationSchema'
import type { DraftManifest } from '../../shared/manifest'

export type PipelineStep = 'research' | 'outline' | 'script' | 'resolving' | 'finalizing'

export type ProgressEvent =
  | { step: PipelineStep; detail?: string; index?: number; total?: number }
  | { step: 'done'; draftId: string; warnings: string[] }
  | { step: 'error'; message: string }

const VOICE_REF_MAP: Record<string, string> = {
  'narrator-male': 'elevenlabs:iP95p4xoKVk53GoZ742B',
  'narrator-female': 'elevenlabs:SAz9YHcvj6GT2YYXdXww',
  'character-male': 'elevenlabs:bIHbv24MWmeRgasZH58o',
  'character-female': 'elevenlabs:SAz9YHcvj6GT2YYXdXww',
}

export interface PipelineDeps {
  provider: ScriptProvider
  createDraft: (manifest: DraftManifest, explicitId?: string) => Promise<string>
  saveDraft: (draftId: string, manifest: DraftManifest) => Promise<void>
  saveResearch: (draftId: string, markdown: string) => Promise<void>
  saveOutline: (draftId: string, outline: unknown) => Promise<void>
  loadResearch: (draftId: string) => Promise<string>
  loadOutline: (draftId: string) => Promise<unknown | null>
  loadDraft: (draftId: string) => Promise<DraftManifest>
  emit: (event: ProgressEvent) => void
  signal?: AbortSignal
}

async function resolveAllSongs(
  manifest: GeneratedManifest,
  provider: PipelineDeps['provider'],
  emit: PipelineDeps['emit'],
  signal?: AbortSignal,
): Promise<{
  resolutions: Map<string, { spotifyUri: string; title: string; artist: string }>
  warnings: string[]
}> {
  const songRequests: Array<{ key: string; title: string; artist: string; searchHint?: string }> = []
  manifest.chapters.forEach((c, ci) => {
    c.segments.forEach((s, si) => {
      if (s.type === 'song') {
        songRequests.push({
          key: `${ci}:${si}`,
          title: s.trackRequest.title,
          artist: s.trackRequest.artist,
          searchHint: s.trackRequest.searchHint,
        })
      }
    })
  })
  const warnings: string[] = []
  const resolutions = new Map<string, { spotifyUri: string; title: string; artist: string }>()
  emit({ step: 'resolving', total: songRequests.length, index: 0 })
  // Bind the provider's findSpotifyUri so we pass a plain callback to the resolver.
  const spotifyUriFinder = (title: string, artist: string, searchHint: string | undefined) =>
    provider.findSpotifyUri(title, artist, searchHint, signal)
  const CONCURRENCY = 4
  let nextIdx = 0
  let completed = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, songRequests.length) }, async () => {
    while (true) {
      const i = nextIdx++
      if (i >= songRequests.length) return
      const r = songRequests[i]!
      try {
        const resolved = await resolveTrack(
          { title: r.title, artist: r.artist, searchHint: r.searchHint },
          { spotifyUriFinder },
        )
        resolutions.set(r.key, {
          spotifyUri: resolved.spotifyUri,
          title: resolved.resolved.title,
          artist: resolved.resolved.artist,
        })
      } catch (err) {
        warnings.push(
          `Could not resolve "${r.title}" by ${r.artist}: ${err instanceof Error ? err.message : err}`,
        )
      }
      completed++
      emit({ step: 'resolving', total: songRequests.length, index: completed })
      if (signal?.aborted) throw new Error('Generation aborted')
    }
  })
  await Promise.all(workers)
  return { resolutions, warnings }
}

function buildDraftFromGenerated(
  draftId: string,
  g: GeneratedManifest,
  resolutions: Map<string, { spotifyUri: string; title: string; artist: string }>,
): DraftManifest {
  return {
    schemaVersion: 1,
    id: draftId,
    title: g.title,
    subject: g.subject,
    coverImage: '',
    estimatedMinutes: g.estimatedMinutes,
    hosts: g.hosts.map((h) => ({
      id: h.id,
      name: h.name,
      persona: h.persona,
      voiceRef: VOICE_REF_MAP[h.voiceRefHint] ?? VOICE_REF_MAP['narrator-male']!,
    })),
    chapters: g.chapters.map((c, ci) => ({
      title: c.title,
      segments: c.segments.map((s, si) => {
        if (s.type === 'narration') {
          return { type: 'narration', id: s.id, hostId: s.hostId, text: s.text }
        }
        const res = resolutions.get(`${ci}:${si}`)
        return {
          type: 'song',
          id: s.id,
          track: {
            title: res?.title ?? s.trackRequest.title,
            artist: res?.artist ?? s.trackRequest.artist,
            spotifyUri: res?.spotifyUri ?? `spotify:track:UNRESOLVED${si}`,
          },
          startAtSeconds: s.startAtSeconds,
          playSeconds: s.playSeconds,
          why: s.trackRequest.why,
          voiceovers: s.voiceovers.map((v) => ({
            id: v.id,
            hostId: v.hostId,
            text: v.text,
            atSeconds: v.atSeconds,
            // Normalize duckTo: if the model emitted a fraction (≤1), interpret as percent.
            duckTo: v.duckTo <= 1 ? Math.round(v.duckTo * 100) : Math.round(v.duckTo),
            holdDuck: v.holdDuck,
          })),
        }
      }),
    })),
    sources: [],
    facts: [],
  }
}

/** Full pipeline: research → outline → script → resolve. Creates and lands a new draft. */
export async function runFullPipeline(
  input: GenerationInput,
  deps: PipelineDeps,
): Promise<{ draftId: string; warnings: string[] }> {
  const { provider, createDraft, saveResearch, saveOutline, emit, signal } = deps

  const draftId = randomBytes(8).toString('hex')

  emit({ step: 'research' })
  const { markdown } = await provider.runResearch(input, signal)
  await saveResearch(draftId, markdown)

  emit({ step: 'outline' })
  const { outline } = await provider.runOutline(input.subject, markdown, input.lengthMinutes, signal)
  await saveOutline(draftId, outline)

  emit({ step: 'script' })
  const { manifest: g } = await provider.runScript(input.subject, markdown, outline, input.lengthMinutes, input.useAudioTags, signal)
  const { resolutions, warnings } = await resolveAllSongs(g, provider, emit, signal)

  emit({ step: 'finalizing' })
  const draft = buildDraftFromGenerated(draftId, g, resolutions)
  await createDraft(draft, draftId)

  emit({ step: 'done', draftId, warnings })
  return { draftId, warnings }
}

/** Per-step runners used by editor "Re-run from here" buttons. */

export async function runResearchOnly(
  draftId: string,
  input: GenerationInput,
  deps: PipelineDeps,
): Promise<void> {
  const { markdown } = await deps.provider.runResearch(input, deps.signal)
  await deps.saveResearch(draftId, markdown)
  deps.emit({ step: 'done', draftId, warnings: [] })
}

/** Resolve the effective target length for re-run paths: explicit input wins,
 * otherwise fall back to the draft's saved estimatedMinutes so re-runs respect
 * the draft's intent. */
async function resolveLengthMinutes(
  draftId: string,
  explicit: number | undefined,
  deps: PipelineDeps,
): Promise<number | undefined> {
  if (typeof explicit === 'number' && explicit > 0) return explicit
  try {
    const draft = await deps.loadDraft(draftId)
    return draft.estimatedMinutes
  } catch {
    return undefined
  }
}

export async function runOutlineOnly(
  draftId: string,
  subject: string,
  deps: PipelineDeps,
  lengthMinutes?: number,
): Promise<void> {
  const markdown = await deps.loadResearch(draftId)
  if (!markdown) throw new Error('No research saved yet — run research first.')
  const effectiveLength = await resolveLengthMinutes(draftId, lengthMinutes, deps)
  const { outline } = await deps.provider.runOutline(subject, markdown, effectiveLength, deps.signal)
  await deps.saveOutline(draftId, outline)
  deps.emit({ step: 'done', draftId, warnings: [] })
}

/** Re-resolve every song segment in an existing draft's manifest without
 * touching narration text, voiceovers, or any other field. Useful when the
 * initial resolution missed tracks and the user wants to retry — or after
 * resolver improvements ship and the user wants to refresh URIs. */
export async function resolveSongsOnly(
  draftId: string,
  deps: PipelineDeps,
): Promise<{ warnings: string[] }> {
  const draft = await deps.loadDraft(draftId)

  // Collect (chapterIdx, segmentIdx, request) for every song segment so we
  // can write resolutions back to the exact positions afterward.
  const requests: Array<{ ci: number; si: number; title: string; artist: string }> = []
  draft.chapters.forEach((c, ci) => {
    c.segments.forEach((s, si) => {
      if (s.type === 'song') {
        requests.push({ ci, si, title: s.track.title, artist: s.track.artist })
      }
    })
  })

  if (requests.length === 0) {
    deps.emit({ step: 'done', draftId, warnings: [] })
    return { warnings: [] }
  }

  const spotifyUriFinder = (title: string, artist: string, searchHint: string | undefined) =>
    deps.provider.findSpotifyUri(title, artist, searchHint, deps.signal)

  const warnings: string[] = []
  type Resolved = { spotifyUri: string; title: string; artist: string }
  const resolutions = new Map<string, Resolved>()
  deps.emit({ step: 'resolving', total: requests.length, index: 0 })

  const CONCURRENCY = 4
  let nextIdx = 0
  let completed = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, requests.length) }, async () => {
    while (true) {
      const i = nextIdx++
      if (i >= requests.length) return
      const r = requests[i]!
      try {
        const resolved = await resolveTrack(
          { title: r.title, artist: r.artist },
          { spotifyUriFinder },
        )
        resolutions.set(`${r.ci}:${r.si}`, {
          spotifyUri: resolved.spotifyUri,
          title: resolved.resolved.title,
          artist: resolved.resolved.artist,
        })
      } catch (err) {
        warnings.push(
          `Could not resolve "${r.title}" by ${r.artist}: ${err instanceof Error ? err.message : err}`,
        )
      }
      completed++
      deps.emit({ step: 'resolving', total: requests.length, index: completed })
      if (deps.signal?.aborted) throw new Error('Resolve aborted')
    }
  })
  await Promise.all(workers)

  // Apply resolutions in place, preserving every other field on each segment.
  const updated: DraftManifest = {
    ...draft,
    chapters: draft.chapters.map((c, ci) => ({
      ...c,
      segments: c.segments.map((s, si) => {
        if (s.type !== 'song') return s
        const res = resolutions.get(`${ci}:${si}`)
        if (!res) return s
        return {
          ...s,
          track: {
            title: res.title,
            artist: res.artist,
            spotifyUri: res.spotifyUri,
          },
        }
      }),
    })),
  }

  deps.emit({ step: 'finalizing' })
  await deps.saveDraft(draftId, updated)
  deps.emit({ step: 'done', draftId, warnings })
  return { warnings }
}

export async function runScriptOnly(
  draftId: string,
  subject: string,
  deps: PipelineDeps,
  lengthMinutes?: number,
  useAudioTags?: boolean,
): Promise<{ warnings: string[] }> {
  const markdown = await deps.loadResearch(draftId)
  const outline = (await deps.loadOutline(draftId)) as DraftOutlineParsed | null
  if (!markdown || !outline) {
    throw new Error('Missing research or outline — run earlier steps first.')
  }
  const effectiveLength = await resolveLengthMinutes(draftId, lengthMinutes, deps)
  deps.emit({ step: 'script' })
  const { manifest: g } = await deps.provider.runScript(subject, markdown, outline, effectiveLength, useAudioTags, deps.signal)
  const { resolutions, warnings } = await resolveAllSongs(g, deps.provider, deps.emit, deps.signal)
  deps.emit({ step: 'finalizing' })
  const draft = buildDraftFromGenerated(draftId, g, resolutions)
  await deps.saveDraft(draftId, draft)
  deps.emit({ step: 'done', draftId, warnings })
  return { warnings }
}
