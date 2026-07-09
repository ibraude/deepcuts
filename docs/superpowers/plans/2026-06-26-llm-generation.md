# LLM Generation Implementation Plan (Spec A)

> Steps use checkbox (`- [ ]`) syntax.

**Goal:** Single-shot LLM-driven manifest generation. Subject → manifest → resolved Spotify URIs → draft in the editor.

**Architecture:** Vercel AI SDK is the provider abstraction. `ScriptProvider` interface in main process. `GeminiProvider` is the initial implementation (Google Search grounding). Song resolution via iTunes Search + Odesli (no auth). Orchestrator wires LLM → resolver → drafts.createDraft.

**Tech Stack additions:** `ai`, `@ai-sdk/google`, `@ai-sdk/anthropic` (stub config), `@ai-sdk/openai` (stub config). All TypeScript.

## Global Constraints

- All LLM API calls run in the **main process** (keys never reach the renderer).
- Keys stored in keychain via existing `setSecret`/`getSecret`.
- New providers register via the `ScriptProvider` interface; Spec A ships Gemini only.
- Generation never blocks the renderer UI thread; progress streamed via `webContents.send`.
- Song resolution failures don't abort the run — warnings surface in UI.
- TypeScript strict everywhere.

---

## File Structure

```
src/
  main/
    generation/
      ScriptProvider.ts            # NEW — interface + types
      generationSchema.ts          # NEW — Zod schemas for LLM output
      prompts.ts                   # NEW — system + user prompt builders
      GeminiProvider.ts            # NEW — Gemini impl
      songResolver.ts              # NEW — iTunes + Odesli pipeline
      songResolver.test.ts         # NEW
      pipeline.ts                  # NEW — orchestrator
    ipc.ts                         # MODIFY — generation:start + emits progress
  preload/
    index.ts                       # MODIFY — surface generation API
  shared/
    ipcSchema.ts                   # MODIFY — generation channel constants
  renderer/
    editor/
      NewDraftModal.tsx            # MODIFY — third "Generate" tab
      GenerationProgress.tsx       # NEW — progress UI
    settings/
      Settings.tsx                 # MODIFY — Generation section
      generationConfig.ts          # NEW — localStorage helpers
```

## Task list

1. Add dependencies (`ai`, `@ai-sdk/google`, `@ai-sdk/anthropic`, `@ai-sdk/openai`)
2. `ScriptProvider` interface + Zod schemas for LLM output
3. `songResolver.ts` + tests
4. Prompts module
5. `GeminiProvider` implementation
6. `pipeline.ts` orchestrator
7. IPC channels + handlers + progress events + preload bridge
8. Settings: Generation section + `generationConfig.ts` localStorage
9. NewDraftModal: Generate tab + progress UI
10. Final verify

---

## Task 1: Add dependencies

- [ ] **Step 1: Install AI SDK packages**

```bash
npm install ai @ai-sdk/google @ai-sdk/anthropic @ai-sdk/openai
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: passes (no usages yet).

Run: `npm test`
Expected: 51/51 pass.

---

## Task 2: ScriptProvider interface + LLM output schema

**Files:**
- Create: `src/main/generation/ScriptProvider.ts`
- Create: `src/main/generation/generationSchema.ts`

**Interfaces:**
- `ScriptProvider.generateManifest(input, signal?): Promise<{ manifest: GeneratedManifest }>`
- `GeneratedManifest` mirrors `DraftManifest` but song segments carry a `trackRequest` instead of resolved `track`.

- [ ] **Step 1: Create `src/main/generation/generationSchema.ts`**

```ts
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
  text: z.string().min(20).describe('Narration line — full sentences, no placeholders'),
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
  text: z.string().min(10).describe('Voiceover line spoken over the music — natural, conversational'),
  atSeconds: z.number().min(0).describe('When in the song this fires'),
  duckTo: z.number().min(10).max(80).default(55),
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
```

- [ ] **Step 2: Create `src/main/generation/ScriptProvider.ts`**

```ts
import type { GeneratedManifest } from './generationSchema'

export type ProviderId = 'gemini' | 'claude' | 'openai'

export interface GenerationInput {
  subject: string
  hints?: string
  lengthMinutes?: number
  useSearch: boolean
}

export interface GenerationResult {
  manifest: GeneratedManifest
}

export interface ScriptProvider {
  id: ProviderId
  generateManifest(input: GenerationInput, signal?: AbortSignal): Promise<GenerationResult>
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: passes.

---

## Task 3: songResolver + tests

**Files:**
- Create: `src/main/generation/songResolver.ts`
- Create: `src/main/generation/songResolver.test.ts`

**Produces:**
- `resolveTrack(req, fetchFn?)` — returns `{ spotifyUri, resolved: { title, artist } }` or throws

- [ ] **Step 1: Write tests at `src/main/generation/songResolver.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { resolveTrack } from './songResolver'

describe('resolveTrack', () => {
  it('resolves via iTunes Search then Odesli', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('itunes.apple.com')) {
        return new Response(
          JSON.stringify({
            resultCount: 1,
            results: [
              {
                trackId: 178050256,
                trackName: 'Visions of Johanna',
                artistName: 'Bob Dylan',
                trackViewUrl: 'https://music.apple.com/us/album/visions-of-johanna/178049863?i=178050256',
              },
            ],
          }),
          { status: 200 },
        )
      }
      if (url.includes('song.link')) {
        return new Response(
          JSON.stringify({
            linksByPlatform: {
              spotify: { url: 'https://open.spotify.com/track/2rslQV48gNv3r9pPrQFPW1' },
            },
          }),
          { status: 200 },
        )
      }
      throw new Error('Unexpected fetch: ' + url)
    })
    const r = await resolveTrack(
      { title: 'Visions of Johanna', artist: 'Bob Dylan' },
      { fetchFn: fetchFn as any },
    )
    expect(r.spotifyUri).toBe('spotify:track:2rslQV48gNv3r9pPrQFPW1')
    expect(r.resolved.title).toBe('Visions of Johanna')
    expect(r.resolved.artist).toBe('Bob Dylan')
  })

  it('throws when iTunes returns no results', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 }))
    await expect(
      resolveTrack({ title: 'X', artist: 'Y' }, { fetchFn: fetchFn as any }),
    ).rejects.toThrow(/no iTunes result/i)
  })

  it('throws when Odesli has no Spotify link', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('itunes.apple.com')) {
        return new Response(
          JSON.stringify({
            resultCount: 1,
            results: [{ trackViewUrl: 'https://music.apple.com/x', trackName: 'X', artistName: 'Y' }],
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ linksByPlatform: {} }), { status: 200 })
    })
    await expect(
      resolveTrack({ title: 'X', artist: 'Y' }, { fetchFn: fetchFn as any }),
    ).rejects.toThrow(/no Spotify link/i)
  })
})
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/generation/songResolver.ts`**

```ts
export interface SongRequest {
  title: string
  artist: string
  searchHint?: string
}

export interface ResolvedSong {
  spotifyUri: string
  resolved: { title: string; artist: string }
}

export interface ResolverDeps {
  fetchFn?: typeof fetch
}

const SPOTIFY_TRACK_URL_RE = /open\.spotify\.com\/track\/([A-Za-z0-9]+)/

export async function resolveTrack(
  req: SongRequest,
  deps: ResolverDeps = {},
): Promise<ResolvedSong> {
  const fetchFn = deps.fetchFn ?? fetch

  // 1. iTunes Search
  const terms = [req.artist, req.title, req.searchHint].filter(Boolean).join(' ')
  const itunesUrl =
    'https://itunes.apple.com/search?' +
    new URLSearchParams({
      term: terms,
      entity: 'song',
      limit: '1',
    }).toString()
  const itunesRes = await fetchFn(itunesUrl)
  if (!itunesRes.ok) throw new Error(`iTunes search HTTP ${itunesRes.status}`)
  const itunesData = (await itunesRes.json()) as {
    resultCount: number
    results: Array<{ trackViewUrl: string; trackName: string; artistName: string }>
  }
  if (!itunesData.results?.length) {
    throw new Error(`no iTunes result for "${terms}"`)
  }
  const top = itunesData.results[0]!

  // 2. Odesli (song.link)
  const odesliUrl =
    'https://api.song.link/v1-alpha.1/links?' +
    new URLSearchParams({ url: top.trackViewUrl }).toString()
  const odesliRes = await fetchFn(odesliUrl)
  if (!odesliRes.ok) throw new Error(`Odesli HTTP ${odesliRes.status}`)
  const odesliData = (await odesliRes.json()) as {
    linksByPlatform?: { spotify?: { url?: string } }
  }
  const spotifyUrl = odesliData.linksByPlatform?.spotify?.url
  if (!spotifyUrl) throw new Error(`no Spotify link from Odesli for "${top.trackName}"`)
  const match = spotifyUrl.match(SPOTIFY_TRACK_URL_RE)
  if (!match) throw new Error(`unrecognized Spotify URL: ${spotifyUrl}`)
  return {
    spotifyUri: `spotify:track:${match[1]}`,
    resolved: { title: top.trackName, artist: top.artistName },
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 3 new tests + 51 existing = 54 pass.

---

## Task 4: Prompts module

**Files:**
- Create: `src/main/generation/prompts.ts`

**Produces:**
- `buildSystemPrompt()` and `buildUserPrompt(input)` — pure functions

- [ ] **Step 1: Create `src/main/generation/prompts.ts`**

```ts
import type { GenerationInput } from './ScriptProvider'

export function buildSystemPrompt(): string {
  return `You are an audio documentary scriptwriter for a Spotify-driven app called Deepcuts.

A Deepcuts episode alternates between AI-narrated commentary and real Spotify tracks. Narrations play between songs, and voiceovers play OVER the music with the song ducked underneath.

Rules:
- Episodes are conversational and confident, not academic. Think a thoughtful music documentary, not a lecture.
- Multi-host episodes feel like real conversations between specific characters. Give each host a clear voice (one might be authoritative and dry; another might be tangential and chatty).
- Narration goes between songs. Voiceovers go over the music; keep voiceovers shorter and timed sensibly (later in songs is often better).
- For voiceovers in conversation: chain them by setting holdDuck=true on all but the last in the chain. This keeps the music ducked between speakers.
- Songs should be REAL tracks by REAL artists. Provide title, artist, optional searchHint (album or year) so the resolver can find them.
- Set playSeconds high (e.g., 500) when you want the song to play through naturally; use a shorter value when you want it cut.
- Voiceover atSeconds must be within the song's expected length. Space voiceovers naturally — leave at least 10s of music between them when not in a holdDuck chain.
- Quote facts that are well-established. Avoid hallucination. If web search is available, use it to verify dates, session musicians, etc.

Voice flavors available (we map these to ElevenLabs defaults):
- "narrator-male": warm documentary male
- "narrator-female": clear conversational female
- "character-male": friendly conversational male
- "character-female": calm conversational female`
}

export function buildUserPrompt(input: GenerationInput): string {
  const lengthMin = input.lengthMinutes ?? 12
  const hints = input.hints ? `\n\nStyle hints from the user:\n${input.hints}` : ''
  return `Subject: ${input.subject}

Target length: approximately ${lengthMin} minutes total.

Produce a complete episode manifest with:
- A short evocative title
- 1-3 hosts (single-host narrator OK; multi-host if a conversation would land better)
- 1-3 chapters
- For each chapter: a mix of narration segments and song segments; use voiceovers within songs to drive longer, more textured passages
- 4-8 songs total across the episode
${hints}`
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck`
Expected: passes.

---

## Task 5: GeminiProvider

**Files:**
- Create: `src/main/generation/GeminiProvider.ts`

- [ ] **Step 1: Create `src/main/generation/GeminiProvider.ts`**

```ts
import { generateObject } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { buildSystemPrompt, buildUserPrompt } from './prompts'
import { generatedManifestSchema } from './generationSchema'
import type { GenerationInput, GenerationResult, ScriptProvider } from './ScriptProvider'

export interface GeminiProviderConfig {
  apiKey: string
  modelId?: string
}

export class GeminiProvider implements ScriptProvider {
  readonly id = 'gemini' as const
  private apiKey: string
  private modelId: string

  constructor(config: GeminiProviderConfig) {
    this.apiKey = config.apiKey
    this.modelId = config.modelId || 'gemini-2.5-pro'
  }

  async generateManifest(input: GenerationInput, signal?: AbortSignal): Promise<GenerationResult> {
    const google = createGoogleGenerativeAI({ apiKey: this.apiKey })
    const model = google(this.modelId, input.useSearch ? { useSearchGrounding: true } : {})
    const result = await generateObject({
      model,
      schema: generatedManifestSchema,
      system: buildSystemPrompt(),
      prompt: buildUserPrompt(input),
      abortSignal: signal,
    })
    return { manifest: result.object }
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes. (No tests for this — it's a thin wrapper over a third-party SDK; the orchestrator and song resolver carry the test surface.)

---

## Task 6: pipeline.ts orchestrator

**Files:**
- Create: `src/main/generation/pipeline.ts`

**Produces:**
- `runGenerationPipeline(input, providerFactory, deps): Promise<{ draftId, warnings }>`
- `Progress` event emitter pattern

- [ ] **Step 1: Create `src/main/generation/pipeline.ts`**

```ts
import { randomBytes } from 'node:crypto'
import { resolveTrack } from './songResolver'
import type { ScriptProvider, GenerationInput } from './ScriptProvider'
import type { GeneratedManifest } from './generationSchema'
import type { DraftManifest } from '../../shared/manifest'

export type ProgressEvent =
  | { step: 'researching'; detail?: string }
  | { step: 'resolving'; detail?: string; index?: number; total?: number }
  | { step: 'finalizing' }
  | { step: 'done'; draftId: string; warnings: string[] }
  | { step: 'error'; message: string }

export interface PipelineDeps {
  provider: ScriptProvider
  createDraft: (manifest: DraftManifest) => Promise<string>
  emit: (event: ProgressEvent) => void
  signal?: AbortSignal
}

const VOICE_REF_MAP: Record<string, string> = {
  'narrator-male': 'elevenlabs:iP95p4xoKVk53GoZ742B', // Chris
  'narrator-female': 'elevenlabs:SAz9YHcvj6GT2YYXdXww', // River
  'character-male': 'elevenlabs:bIHbv24MWmeRgasZH58o', // Will
  'character-female': 'elevenlabs:SAz9YHcvj6GT2YYXdXww', // River fallback
}

export async function runGenerationPipeline(
  input: GenerationInput,
  deps: PipelineDeps,
): Promise<{ draftId: string; warnings: string[] }> {
  const { provider, createDraft, emit, signal } = deps

  emit({ step: 'researching' })
  const { manifest: g } = await provider.generateManifest(input, signal)

  // Collect all song requests.
  const songRequests: Array<{
    chapterIdx: number
    segIdx: number
    title: string
    artist: string
    searchHint?: string
  }> = []
  g.chapters.forEach((c, chapterIdx) => {
    c.segments.forEach((s, segIdx) => {
      if (s.type === 'song') {
        songRequests.push({
          chapterIdx,
          segIdx,
          title: s.trackRequest.title,
          artist: s.trackRequest.artist,
          searchHint: s.trackRequest.searchHint,
        })
      }
    })
  })

  // Resolve each in parallel (cap 4 concurrent to avoid hammering iTunes/Odesli).
  const warnings: string[] = []
  const resolutions = new Map<string, { spotifyUri: string; title: string; artist: string }>()
  emit({ step: 'resolving', total: songRequests.length, index: 0 })

  const CONCURRENCY = 4
  let nextIdx = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, songRequests.length) }, async () => {
    while (true) {
      const i = nextIdx++
      if (i >= songRequests.length) return
      const r = songRequests[i]!
      try {
        const resolved = await resolveTrack({
          title: r.title,
          artist: r.artist,
          searchHint: r.searchHint,
        })
        resolutions.set(`${r.chapterIdx}:${r.segIdx}`, {
          spotifyUri: resolved.spotifyUri,
          title: resolved.resolved.title,
          artist: resolved.resolved.artist,
        })
      } catch (err) {
        warnings.push(`Could not resolve "${r.title}" by ${r.artist}: ${err instanceof Error ? err.message : err}`)
      }
      emit({ step: 'resolving', total: songRequests.length, index: i + 1 })
      if (signal?.aborted) throw new Error('Generation aborted')
    }
  })
  await Promise.all(workers)

  emit({ step: 'finalizing' })

  // Build final DraftManifest.
  const draftId = randomBytes(8).toString('hex')
  const draft: DraftManifest = {
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
            duckTo: v.duckTo,
            holdDuck: v.holdDuck,
          })),
        }
      }),
    })),
    sources: [],
    facts: [],
  }

  const savedId = await createDraft(draft)
  emit({ step: 'done', draftId: savedId, warnings })
  return { draftId: savedId, warnings }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

---

## Task 7: IPC + preload bridge + progress events

**Files:**
- Modify: `src/shared/ipcSchema.ts`, `src/main/ipc.ts`, `src/preload/index.ts`

- [ ] **Step 1: Add channel constants in `src/shared/ipcSchema.ts`**

Append inside `IpcChannels`:

```ts
  GenerationStart: 'generation:start',
  GenerationCancel: 'generation:cancel',
  GenerationProgress: 'generation:progress',
```

- [ ] **Step 2: Modify `src/main/ipc.ts`** — add handlers + progress emitter

At the top, add imports:

```ts
import { GeminiProvider } from './generation/GeminiProvider'
import { runGenerationPipeline, type ProgressEvent } from './generation/pipeline'
import type { GenerationInput, ProviderId } from './generation/ScriptProvider'
import { BrowserWindow } from 'electron'
```

Add new handlers at the end of `registerIpc()`. Note: `app` and `BrowserWindow` are already imported.

```ts
  // Generation
  let abortController: AbortController | null = null

  function emitProgress(e: ProgressEvent) {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.GenerationProgress, e)
    }
  }

  ipcMain.handle(
    IpcChannels.GenerationStart,
    wrap(async (args: { providerId: ProviderId; modelId?: string; input: GenerationInput }) => {
      const { providerId, modelId, input } = args
      const apiKey = await getSecret(providerId)
      if (!apiKey) throw new Error(`No ${providerId} API key set. Add one in Settings → Generation.`)
      abortController = new AbortController()
      try {
        if (providerId !== 'gemini') throw new Error(`Provider ${providerId} not yet implemented.`)
        const provider = new GeminiProvider({ apiKey, modelId })
        const result = await runGenerationPipeline(input, {
          provider,
          createDraft: (manifest) => drafts.createDraft(manifest),
          emit: emitProgress,
          signal: abortController.signal,
        })
        return result
      } catch (err) {
        emitProgress({ step: 'error', message: err instanceof Error ? err.message : String(err) })
        throw err
      } finally {
        abortController = null
      }
    }),
  )

  ipcMain.handle(
    IpcChannels.GenerationCancel,
    wrap(async () => {
      abortController?.abort()
    }),
  )
```

- [ ] **Step 3: Modify `src/preload/index.ts`** — surface generation API + progress subscription

Add to `api`:

```ts
  generation: {
    start: (args: {
      providerId: 'gemini' | 'claude' | 'openai'
      modelId?: string
      input: {
        subject: string
        hints?: string
        lengthMinutes?: number
        useSearch: boolean
      }
    }) => invoke<{ draftId: string; warnings: string[] }>(IpcChannels.GenerationStart, args),
    cancel: () => invoke<void>(IpcChannels.GenerationCancel),
    onProgress: (handler: (event: unknown) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, event: unknown) => handler(event)
      ipcRenderer.on(IpcChannels.GenerationProgress, listener)
      return () => ipcRenderer.removeListener(IpcChannels.GenerationProgress, listener)
    },
  },
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: passes.

---

## Task 8: Settings — Generation section + generationConfig.ts

**Files:**
- Create: `src/renderer/settings/generationConfig.ts`
- Modify: `src/renderer/settings/Settings.tsx`

- [ ] **Step 1: Create `src/renderer/settings/generationConfig.ts`**

```ts
export type GenerationProviderId = 'gemini' | 'claude' | 'openai'

export interface GenerationConfig {
  providerId: GenerationProviderId
  modelId: string
}

const KEY = 'deepcuts.generation.v1'
const DEFAULT: GenerationConfig = { providerId: 'gemini', modelId: 'gemini-2.5-pro' }

export function loadGenerationConfig(): GenerationConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT
    const v = JSON.parse(raw) as Partial<GenerationConfig>
    return {
      providerId: (v.providerId as GenerationProviderId) ?? DEFAULT.providerId,
      modelId: typeof v.modelId === 'string' && v.modelId.length > 0 ? v.modelId : DEFAULT.modelId,
    }
  } catch {
    return DEFAULT
  }
}

export function saveGenerationConfig(config: GenerationConfig): void {
  localStorage.setItem(KEY, JSON.stringify(config))
}

export const PROVIDER_OPTIONS: Array<{
  id: GenerationProviderId
  label: string
  defaultModelId: string
  helpText: string
}> = [
  {
    id: 'gemini',
    label: 'Gemini (Google)',
    defaultModelId: 'gemini-2.5-pro',
    helpText: 'Get a key at https://aistudio.google.com/app/apikey. Defaults to Gemini 2.5 Pro.',
  },
  {
    id: 'claude',
    label: 'Claude (Anthropic) — coming soon',
    defaultModelId: 'claude-sonnet-4-6',
    helpText: 'Stub for future support.',
  },
  {
    id: 'openai',
    label: 'OpenAI — coming soon',
    defaultModelId: 'gpt-4o',
    helpText: 'Stub for future support.',
  },
]
```

- [ ] **Step 2: Modify `src/renderer/settings/Settings.tsx`** — add a Generation section

Add imports:

```tsx
import { loadGenerationConfig, saveGenerationConfig, PROVIDER_OPTIONS, type GenerationProviderId } from './generationConfig'
```

Inside the Settings component, add state for the generation config:

```tsx
const [genConfig, setGenConfig] = useState(loadGenerationConfig())
const [providerKeys, setProviderKeys] = useState<Record<GenerationProviderId, string>>({
  gemini: '',
  claude: '',
  openai: '',
})
const [hasProviderKey, setHasProviderKey] = useState<Record<GenerationProviderId, boolean>>({
  gemini: false,
  claude: false,
  openai: false,
})

useEffect(() => {
  ;(async () => {
    const next: Record<GenerationProviderId, boolean> = { gemini: false, claude: false, openai: false }
    for (const p of ['gemini', 'claude', 'openai'] as const) {
      next[p] = !!(await window.deepcuts.keychain.get(p))
    }
    setHasProviderKey(next)
  })()
}, [])

function setProviderId(id: GenerationProviderId) {
  const cfg = { ...genConfig, providerId: id }
  setGenConfig(cfg)
  saveGenerationConfig(cfg)
}

function setModelId(modelId: string) {
  const cfg = { ...genConfig, modelId }
  setGenConfig(cfg)
  saveGenerationConfig(cfg)
}

async function saveProviderKey(p: GenerationProviderId) {
  const k = providerKeys[p].trim()
  if (!k) return
  await window.deepcuts.keychain.set(p, k)
  setProviderKeys((s) => ({ ...s, [p]: '' }))
  setHasProviderKey((s) => ({ ...s, [p]: true }))
}

async function clearProviderKey(p: GenerationProviderId) {
  await window.deepcuts.keychain.delete(p)
  setHasProviderKey((s) => ({ ...s, [p]: false }))
}
```

Inside the modal body, add a new section after the existing "ElevenLabs voice" section:

```tsx
<section className="space-y-2">
  <div className="text-sm">Generation</div>
  <div className="text-xs text-[var(--color-muted)]">
    Which LLM to use when generating new episodes in the Editor.
  </div>
  <select
    value={genConfig.providerId}
    onChange={(e) => setProviderId(e.target.value as GenerationProviderId)}
    className="w-full bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
  >
    {PROVIDER_OPTIONS.map((p) => (
      <option key={p.id} value={p.id} disabled={p.id !== 'gemini'}>
        {p.label}
      </option>
    ))}
  </select>
  <input
    value={genConfig.modelId}
    onChange={(e) => setModelId(e.target.value)}
    placeholder="Model id, e.g. gemini-2.5-pro"
    className="w-full bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-[var(--color-accent)]"
  />
  {PROVIDER_OPTIONS.map((p) => (
    <div key={p.id} className="space-y-1 pt-2 border-t border-[var(--color-hairline)]">
      <div className="text-xs">{p.label}</div>
      <div className="text-xs text-[var(--color-muted)]">{p.helpText}</div>
      <div className="flex gap-2">
        <input
          type="password"
          value={providerKeys[p.id]}
          onChange={(e) => setProviderKeys((s) => ({ ...s, [p.id]: e.target.value }))}
          placeholder={hasProviderKey[p.id] ? '••••••••• (key on file)' : 'paste API key'}
          className="flex-1 bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-[var(--color-accent)]"
        />
        <button
          onClick={() => saveProviderKey(p.id)}
          disabled={!providerKeys[p.id].trim()}
          className="text-xs px-2 py-1 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50"
        >
          Save
        </button>
        {hasProviderKey[p.id] && (
          <button onClick={() => clearProviderKey(p.id)} className="text-xs px-2 py-1 rounded-md text-[var(--color-muted)] hover:bg-white/5">
            Clear
          </button>
        )}
      </div>
    </div>
  ))}
</section>
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: passes.

Run: `npm run dev`, ⌘, → see the Generation section, enter a Gemini key (Save), close and reopen, confirm key on file.

---

## Task 9: NewDraftModal Generate tab + progress UI

**Files:**
- Create: `src/renderer/editor/GenerationProgress.tsx`
- Modify: `src/renderer/editor/NewDraftModal.tsx`

- [ ] **Step 1: Create `src/renderer/editor/GenerationProgress.tsx`**

```tsx
interface Props {
  step: 'idle' | 'researching' | 'resolving' | 'finalizing' | 'done' | 'error'
  detail?: string
  index?: number
  total?: number
  error?: string
  warnings?: string[]
}

export function GenerationProgress({ step, detail, index, total, error, warnings }: Props) {
  if (step === 'idle') return null
  const stepText: Record<typeof step, string> = {
    idle: '',
    researching: 'Researching and writing draft…',
    resolving:
      total && total > 0
        ? `Resolving songs… (${Math.min(index ?? 0, total)}/${total})`
        : 'Resolving songs…',
    finalizing: 'Finalizing draft…',
    done: 'Done',
    error: `Error: ${error ?? 'Unknown error'}`,
  }
  return (
    <div className="space-y-2 pt-2 border-t border-[var(--color-hairline)]">
      <div className="flex items-center gap-2">
        {step !== 'done' && step !== 'error' && (
          <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
        )}
        <span className={'text-sm ' + (step === 'error' ? 'text-red-400' : 'text-[var(--color-text)]')}>
          {stepText[step]}
        </span>
      </div>
      {detail && <div className="text-xs text-[var(--color-muted)]">{detail}</div>}
      {warnings && warnings.length > 0 && (
        <details className="text-xs text-amber-300/80">
          <summary className="cursor-pointer">{warnings.length} warning{warnings.length === 1 ? '' : 's'}</summary>
          <ul className="mt-1 list-disc pl-4 space-y-1">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Modify `src/renderer/editor/NewDraftModal.tsx`** — add Generate tab

Replace the entire file:

```tsx
import { useEffect, useState } from 'react'
import { useEditorStore } from './editorStore'
import { GenerationProgress } from './GenerationProgress'
import { loadGenerationConfig } from '../settings/generationConfig'

interface BundledEpisodeOption {
  manifestPath: string
  title: string
  subject: string
}

type Tab = 'empty' | 'duplicate' | 'generate'

interface ProgressState {
  step: 'idle' | 'researching' | 'resolving' | 'finalizing' | 'done' | 'error'
  detail?: string
  index?: number
  total?: number
  error?: string
  warnings?: string[]
}

export function NewDraftModal({ onClose }: { onClose: () => void }) {
  const createEmpty = useEditorStore((s) => s.createEmpty)
  const duplicate = useEditorStore((s) => s.duplicate)
  const openDraft = useEditorStore((s) => s.openDraft)
  const refreshList = useEditorStore((s) => s.refreshList)

  const [tab, setTab] = useState<Tab>('empty')
  const [title, setTitle] = useState('')
  const [episodes, setEpisodes] = useState<BundledEpisodeOption[] | null>(null)
  const [selectedEp, setSelectedEp] = useState<string>('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Generate tab state
  const [subject, setSubject] = useState('')
  const [hints, setHints] = useState('')
  const [lengthMinutes, setLengthMinutes] = useState(12)
  const [useSearch, setUseSearch] = useState(true)
  const [progress, setProgress] = useState<ProgressState>({ step: 'idle' })

  useEffect(() => {
    window.deepcuts.catalog
      .loadLocal()
      .then((c) =>
        setEpisodes(
          c.episodes.map((e) => ({
            manifestPath: e.manifestPath,
            title: e.title,
            subject: e.subject,
          })),
        ),
      )
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    const off = window.deepcuts.generation.onProgress((event: unknown) => {
      const e = event as ProgressState
      setProgress((prev) => ({ ...prev, ...e }))
    })
    return off
  }, [])

  async function submitEmpty() {
    if (!title.trim()) return
    setWorking(true)
    setError(null)
    try {
      const id = await createEmpty(title.trim())
      await openDraft(id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setWorking(false)
    }
  }

  async function submitDuplicate() {
    if (!selectedEp) return
    setWorking(true)
    setError(null)
    try {
      const id = await duplicate(selectedEp)
      await openDraft(id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Duplicate failed')
    } finally {
      setWorking(false)
    }
  }

  async function submitGenerate() {
    if (!subject.trim()) return
    setWorking(true)
    setError(null)
    setProgress({ step: 'researching' })
    try {
      const cfg = loadGenerationConfig()
      const result = await window.deepcuts.generation.start({
        providerId: cfg.providerId,
        modelId: cfg.modelId,
        input: {
          subject: subject.trim(),
          hints: hints.trim() || undefined,
          lengthMinutes,
          useSearch,
        },
      })
      setProgress({ step: 'done', warnings: result.warnings })
      await refreshList()
      await openDraft(result.draftId)
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Generate failed'
      setError(msg)
      setProgress({ step: 'error', error: msg })
    } finally {
      setWorking(false)
    }
  }

  function cancelGenerate() {
    window.deepcuts.generation.cancel().catch(() => {})
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-8" onClick={working ? undefined : onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-hairline)] rounded-lg w-[520px] max-w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">New project</h2>
          <button
            onClick={onClose}
            disabled={working}
            className="text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex gap-2 text-xs tracking-[0.2em] uppercase">
          {(['empty', 'duplicate', 'generate'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              disabled={working}
              className={
                'px-2.5 py-1 rounded-md transition-colors duration-150 ' +
                (tab === t
                  ? 'bg-[var(--color-accent)]/15 text-[var(--color-text)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]')
              }
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'empty' && (
          <div className="space-y-2">
            <label className="text-sm">Title</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My new episode"
              className="w-full bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
            />
            <div className="text-xs text-[var(--color-muted)]">
              A blank manifest with one narrator and one empty narration segment.
            </div>
            <div className="flex justify-end pt-2 gap-2">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-md text-[var(--color-muted)] hover:bg-white/5">Cancel</button>
              <button
                disabled={!title.trim() || working}
                onClick={submitEmpty}
                className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        )}

        {tab === 'duplicate' && (
          <div className="space-y-2">
            <label className="text-sm">Source episode</label>
            {episodes === null ? (
              <div className="text-xs text-[var(--color-muted)]">Loading episodes…</div>
            ) : episodes.length === 0 ? (
              <div className="text-xs text-[var(--color-muted)]">No bundled episodes to duplicate.</div>
            ) : (
              <select
                value={selectedEp}
                onChange={(e) => setSelectedEp(e.target.value)}
                className="w-full bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
              >
                <option value="">Select an episode…</option>
                {episodes.map((e) => (
                  <option key={e.manifestPath} value={e.manifestPath}>
                    {e.title} — {e.subject}
                  </option>
                ))}
              </select>
            )}
            <div className="text-xs text-[var(--color-muted)]">Creates an editable copy.</div>
            <div className="flex justify-end pt-2 gap-2">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-md text-[var(--color-muted)] hover:bg-white/5">Cancel</button>
              <button
                disabled={!selectedEp || working}
                onClick={submitDuplicate}
                className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50"
              >
                Duplicate
              </button>
            </div>
          </div>
        )}

        {tab === 'generate' && (
          <div className="space-y-3">
            <label className="text-sm">Subject</label>
            <input
              autoFocus
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={working}
              placeholder='e.g. "Bob Dylan — Blonde on Blonde"'
              className="w-full bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
            />
            <label className="text-sm">Style hints (optional)</label>
            <textarea
              value={hints}
              onChange={(e) => setHints(e.target.value)}
              disabled={working}
              placeholder='e.g. "Use two hosts — a calm narrator and a chatty guest who plays bass on session work."'
              className="w-full bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)] min-h-[60px]"
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                <span className="block">Target length (min)</span>
                <input
                  type="number"
                  min={3}
                  max={120}
                  value={lengthMinutes}
                  onChange={(e) => setLengthMinutes(Math.max(3, Math.min(120, Number(e.target.value) || 12)))}
                  disabled={working}
                  className="w-full bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm mt-1 focus:outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="flex items-center gap-2 text-sm pt-6">
                <input
                  type="checkbox"
                  checked={useSearch}
                  onChange={(e) => setUseSearch(e.target.checked)}
                  disabled={working}
                />
                <span>Use web search</span>
              </label>
            </div>

            <GenerationProgress {...progress} />

            <div className="flex justify-end pt-2 gap-2">
              {working ? (
                <button onClick={cancelGenerate} className="text-sm px-3 py-1.5 rounded-md text-[var(--color-muted)] hover:bg-white/5">
                  Cancel
                </button>
              ) : (
                <>
                  <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-md text-[var(--color-muted)] hover:bg-white/5">
                    Close
                  </button>
                  <button
                    disabled={!subject.trim()}
                    onClick={submitGenerate}
                    className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50"
                  >
                    Generate
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: passes.

---

## Task 10: Final verify

- [ ] **Step 1: Full gates**

Run: `npm run typecheck`
Run: `npm test`
Run: `npm run build`

All should pass.

- [ ] **Step 2: Smoke test (manual, on the Mac)**

Restart `npm run dev`. Open Settings (⌘,) → Generation section → paste Gemini API key, Save.

Switch to Editor → + New project → Generate tab → enter subject "Bob Dylan — Blonde on Blonde", click Generate.

Expected: progress text cycles through Researching → Resolving songs (with counts) → Finalizing → modal closes → draft opens in the editor with multi-chapter structure, real Spotify URIs (or warnings if some couldn't resolve).
