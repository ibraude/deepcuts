# Multi-step Pipeline Implementation Plan (Spec C)

**Goal:** Research → Outline → Script & Songs pipeline with editable per-step artifacts saved to each draft directory.

## Tasks

1. Outline & research types + research/outline storage in drafts module
2. Step prompts + outline schema
3. `ScriptProvider` extension: `research()` + `outline()` methods; Gemini wires Google Search grounding for research
4. Pipeline orchestrator: `runFullPipeline` + per-step runners
5. IPC: new draft load/save endpoints + `generation:runStep`
6. DraftEditor tabs (Manifest / Research / Outline) + per-tab UIs
7. Final verify

---

### Task 1: Drafts module — research/outline persistence

**Files:** Modify `src/main/drafts.ts`, `src/shared/manifest.ts`

- [ ] **Step 1: Add `DraftOutline` type to `src/shared/manifest.ts`** (after `DraftSummary`)

```ts
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
```

- [ ] **Step 2: Extend `src/main/drafts.ts`** — add research/outline CRUD

Add new methods inside `createDrafts(...)` returning object:

```ts
async function loadResearch(draftId: string): Promise<string> {
  assertSafeId(draftId)
  return fs
    .readFile(join(root(), draftId, 'research.md'), 'utf-8')
    .catch(() => '')
}

async function saveResearch(draftId: string, markdown: string): Promise<void> {
  assertSafeId(draftId)
  const dir = join(root(), draftId)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'research.md'), markdown)
}

async function loadOutline(draftId: string): Promise<unknown | null> {
  assertSafeId(draftId)
  try {
    const raw = await fs.readFile(join(root(), draftId, 'outline.json'), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function saveOutline(draftId: string, outline: unknown): Promise<void> {
  assertSafeId(draftId)
  const dir = join(root(), draftId)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'outline.json'), JSON.stringify(outline, null, 2))
}
```

Add these to the returned object at the bottom of `createDrafts`:

```ts
  return {
    listDrafts,
    loadDraft,
    saveDraft,
    createDraft,
    deleteDraft,
    duplicateFromEpisode,
    draftCoverUrl,
    setDraftCover,
    loadResearch,
    saveResearch,
    loadOutline,
    saveOutline,
  }
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test`
Expected: passes.

---

### Task 2: Prompts + outline schema

**Files:** Modify `src/main/generation/prompts.ts`, modify `src/main/generation/generationSchema.ts`

- [ ] **Step 1: Add outline schema in `generationSchema.ts`**

Append:

```ts
export const draftOutlineNarrationBeatSchema = z.object({
  type: z.literal('narration'),
  hostId: z.string(),
  intent: z.string().describe('One sentence summary of what the narration should accomplish'),
})

export const draftOutlineVoiceoverBeatSchema = z.object({
  hostId: z.string(),
  intent: z.string().describe('What this voiceover line should accomplish over the song'),
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
  beats: z.array(z.discriminatedUnion('type', [draftOutlineNarrationBeatSchema, draftOutlineSongBeatSchema])).min(1),
})

export const draftOutlineSchema = z.object({
  proposedHosts: z.array(generatedHostSchema).min(1).max(3),
  chapters: z.array(draftOutlineChapterSchema).min(1),
})

export type DraftOutlineParsed = z.infer<typeof draftOutlineSchema>
```

- [ ] **Step 2: Add step prompts in `prompts.ts`**

Append the file (keeping the existing exports):

```ts
export function buildResearchPrompt(subject: string, hints?: string): { system: string; prompt: string } {
  return {
    system: `You are a music documentary researcher. When given a subject (an album, a song, a moment in music history), produce a thorough, citation-rich research document in markdown.

Cover:
- Historical context (year, place, what was happening)
- Personnel (artists, producers, session musicians, engineers)
- Recording details (studio, takes, technical notes, anecdotes)
- Lyrical or musical analysis where notable
- Critical reception then and now
- Cultural impact and lasting influence

Use web search to ground every claim. Cite sources inline as markdown links. Be specific. Avoid hagiography.`,
    prompt: `Subject: ${subject}${hints ? `\n\nUser focus hints:\n${hints}` : ''}\n\nWrite the research document now.`,
  }
}

export function buildOutlinePrompt(subject: string, researchMarkdown: string): { system: string; prompt: string } {
  return {
    system: `You are a music documentary planner. Given a subject and a research document, produce a structured outline for a multi-segment listening documentary.

The output structure:
- proposedHosts: 1–3 hosts. Each with a clear, distinctive persona. For multi-host episodes, characters feel like real people in conversation.
- chapters: each chapter has an array of beats. A beat is either:
  - narration: the host says something between songs. "intent" is one sentence describing what to convey.
  - song: a real track. trackRequest has title, artist, optional searchHint. voiceoverBeats are short lines spoken OVER the song; pick atSeconds carefully (typically mid-song or later).

Prefer 1–3 chapters. 4–8 songs total. Mix narration between songs with voiceovers over the music. Set later atSeconds when the song's notable moments occur. Real songs only.`,
    prompt: `Subject: ${subject}

Research:
${researchMarkdown}

Now produce the outline JSON.`,
  }
}

export function buildScriptPromptFromOutline(
  subject: string,
  researchMarkdown: string,
  outline: unknown,
): { system: string; prompt: string } {
  return {
    system: `You are a music documentary scriptwriter. Given a subject, research notes, and an outline, write a complete episode manifest.

Take the outline's beats and turn each one into actual narration / voiceover text. Use the research to ground specific claims. Use the persona of each host (give each a distinct voice). Conversational, confident, not academic.

Rules:
- For narration beats, write 2–6 sentences of finished narration text.
- For voiceover beats, write 1–3 sentences spoken OVER the song. Keep them short.
- Set holdDuck=true on voiceovers that are part of a conversation chain (every voiceover in the chain except the last).
- songs: keep the trackRequest from the outline. playSeconds: 500 for full-song play-through, or a shorter value when cutting.
- Real songs only — never invent.`,
    prompt: `Subject: ${subject}

Research notes:
${researchMarkdown}

Outline:
${JSON.stringify(outline, null, 2)}

Now produce the full manifest.`,
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: passes.

---

### Task 3: ScriptProvider extension + Gemini step methods

**Files:** Modify `src/main/generation/ScriptProvider.ts`, `src/main/generation/GeminiProvider.ts`

- [ ] **Step 1: Extend `ScriptProvider` interface**

Replace the file contents:

```ts
import type { GeneratedManifest } from './generationSchema'
import type { DraftOutlineParsed } from './generationSchema'

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

  /** Single-shot full generation (Spec A flow — kept for backwards compatibility). */
  generateManifest(input: GenerationInput, signal?: AbortSignal): Promise<GenerationResult>

  /** Spec C — Step 1: research with web search. Returns markdown. */
  runResearch(input: GenerationInput, signal?: AbortSignal): Promise<{ markdown: string }>

  /** Spec C — Step 2: outline from research. */
  runOutline(
    subject: string,
    researchMarkdown: string,
    signal?: AbortSignal,
  ): Promise<{ outline: DraftOutlineParsed }>

  /** Spec C — Step 3: full script from outline + research. */
  runScript(
    subject: string,
    researchMarkdown: string,
    outline: DraftOutlineParsed,
    signal?: AbortSignal,
  ): Promise<GenerationResult>
}
```

- [ ] **Step 2: Update `GeminiProvider.ts`** to implement the new methods

Replace the file:

```ts
import { generateObject, generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildResearchPrompt,
  buildOutlinePrompt,
  buildScriptPromptFromOutline,
} from './prompts'
import { generatedManifestSchema, draftOutlineSchema, type DraftOutlineParsed } from './generationSchema'
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

  private google() {
    return createGoogleGenerativeAI({ apiKey: this.apiKey })
  }

  async generateManifest(input: GenerationInput, signal?: AbortSignal): Promise<GenerationResult> {
    const model = this.google()(this.modelId)
    void input.useSearch
    const result = await generateObject({
      model,
      schema: generatedManifestSchema,
      system: buildSystemPrompt(),
      prompt: buildUserPrompt(input),
      abortSignal: signal,
    })
    return { manifest: result.object }
  }

  async runResearch(input: GenerationInput, signal?: AbortSignal): Promise<{ markdown: string }> {
    const model = this.google()(this.modelId)
    const { system, prompt } = buildResearchPrompt(input.subject, input.hints)
    const result = await generateText({
      model,
      system,
      prompt,
      abortSignal: signal,
      providerOptions: input.useSearch ? { google: { useSearchGrounding: true } as any } : undefined,
    })
    return { markdown: result.text }
  }

  async runOutline(
    subject: string,
    researchMarkdown: string,
    signal?: AbortSignal,
  ): Promise<{ outline: DraftOutlineParsed }> {
    const model = this.google()(this.modelId)
    const { system, prompt } = buildOutlinePrompt(subject, researchMarkdown)
    const result = await generateObject({
      model,
      schema: draftOutlineSchema,
      system,
      prompt,
      abortSignal: signal,
    })
    return { outline: result.object }
  }

  async runScript(
    subject: string,
    researchMarkdown: string,
    outline: DraftOutlineParsed,
    signal?: AbortSignal,
  ): Promise<GenerationResult> {
    const model = this.google()(this.modelId)
    const { system, prompt } = buildScriptPromptFromOutline(subject, researchMarkdown, outline)
    const result = await generateObject({
      model,
      schema: generatedManifestSchema,
      system,
      prompt,
      abortSignal: signal,
    })
    return { manifest: result.object }
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: passes.

---

### Task 4: Pipeline orchestrator — full + per-step runners

**Files:** Modify `src/main/generation/pipeline.ts`

- [ ] **Step 1: Replace the file** with the new orchestrator

```ts
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
  createDraft: (manifest: DraftManifest) => Promise<string>
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
  const CONCURRENCY = 4
  let nextIdx = 0
  let completed = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, songRequests.length) }, async () => {
    while (true) {
      const i = nextIdx++
      if (i >= songRequests.length) return
      const r = songRequests[i]!
      try {
        const resolved = await resolveTrack({ title: r.title, artist: r.artist, searchHint: r.searchHint })
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
            duckTo: v.duckTo,
            holdDuck: v.holdDuck,
          })),
        }
      }),
    })),
    sources: [],
    facts: [],
  }
}

/** Full pipeline: research → outline → script → resolve. Lands a new draft. */
export async function runFullPipeline(
  input: GenerationInput,
  deps: PipelineDeps,
): Promise<{ draftId: string; warnings: string[] }> {
  const { provider, createDraft, saveDraft, saveResearch, saveOutline, emit, signal } = deps

  const draftId = randomBytes(8).toString('hex')

  emit({ step: 'research' })
  const { markdown } = await provider.runResearch(input, signal)
  await saveResearch(draftId, markdown)

  emit({ step: 'outline' })
  const { outline } = await provider.runOutline(input.subject, markdown, signal)
  await saveOutline(draftId, outline)

  emit({ step: 'script' })
  const { manifest: g } = await provider.runScript(input.subject, markdown, outline, signal)

  const { resolutions, warnings } = await resolveAllSongs(g, emit, signal)
  emit({ step: 'finalizing' })
  const draft = buildDraftFromGenerated(draftId, g, resolutions)
  // Create the draft (this writes manifest.json under draftId).
  await createDraft({ ...draft, id: draftId })
  // Overwrite with the actual draftId (createDraft generates a new id internally — we need to keep our pre-generated one to match the research/outline files).
  // To handle this, we instead use saveDraft after createDraft created the directory:
  await saveDraft(draftId, draft)
  emit({ step: 'done', draftId, warnings })
  return { draftId, warnings }
}

/** Per-step runners used by the editor's "Re-run from here" buttons. */

export async function runResearchOnly(
  draftId: string,
  input: GenerationInput,
  deps: PipelineDeps,
): Promise<void> {
  const { markdown } = await deps.provider.runResearch(input, deps.signal)
  await deps.saveResearch(draftId, markdown)
  deps.emit({ step: 'done', draftId, warnings: [] })
}

export async function runOutlineOnly(
  draftId: string,
  subject: string,
  deps: PipelineDeps,
): Promise<void> {
  const markdown = await deps.loadResearch(draftId)
  if (!markdown) throw new Error('No research saved yet — run research first.')
  const { outline } = await deps.provider.runOutline(subject, markdown, deps.signal)
  await deps.saveOutline(draftId, outline)
  deps.emit({ step: 'done', draftId, warnings: [] })
}

export async function runScriptOnly(
  draftId: string,
  subject: string,
  deps: PipelineDeps,
): Promise<{ warnings: string[] }> {
  const markdown = await deps.loadResearch(draftId)
  const outline = (await deps.loadOutline(draftId)) as DraftOutlineParsed | null
  if (!markdown || !outline) throw new Error('Missing research or outline — run earlier steps first.')
  deps.emit({ step: 'script' })
  const { manifest: g } = await deps.provider.runScript(subject, markdown, outline, deps.signal)
  const { resolutions, warnings } = await resolveAllSongs(g, deps.emit, deps.signal)
  deps.emit({ step: 'finalizing' })
  const draft = buildDraftFromGenerated(draftId, g, resolutions)
  await deps.saveDraft(draftId, draft)
  deps.emit({ step: 'done', draftId, warnings })
  return { warnings }
}
```

Note: there's a quirk above — `createDraft` generates its own draftId, but we pre-generate one to put research/outline alongside. The fix is to refactor: write research/outline FIRST under a temp id and then move, OR provide `createDraft` an explicit id. Simplest: have `createDraft` accept an optional explicit id. We modify `drafts.ts.createDraft`.

- [ ] **Step 2: Modify `drafts.ts.createDraft` to accept optional id**

In `src/main/drafts.ts`, change:

```ts
async function createDraft(initial: DraftManifest): Promise<string> {
  await ensureRoot()
  const id = randomBytes(8).toString('hex')
  ...
}
```

To:

```ts
async function createDraft(initial: DraftManifest, explicitId?: string): Promise<string> {
  await ensureRoot()
  const id = explicitId && /^[a-f0-9]{16}$/.test(explicitId) ? explicitId : randomBytes(8).toString('hex')
  ...
}
```

Then in `pipeline.ts.runFullPipeline`, replace the `createDraft` + `saveDraft` two-step with one call:

```ts
await createDraft(draft, draftId)
```

(Remove `saveDraft` from the path — and remove `saveDraft` from PipelineDeps if it becomes unused. Keep it though; per-step runners need it.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: passes.

---

### Task 5: IPC channels + handlers

**Files:** Modify `src/shared/ipcSchema.ts`, `src/main/ipc.ts`, `src/preload/index.ts`

- [ ] **Step 1: Add channels in `ipcSchema.ts`** (inside IpcChannels)

```ts
  DraftsLoadResearch: 'drafts:loadResearch',
  DraftsSaveResearch: 'drafts:saveResearch',
  DraftsLoadOutline: 'drafts:loadOutline',
  DraftsSaveOutline: 'drafts:saveOutline',
  GenerationRunStep: 'generation:runStep',
```

- [ ] **Step 2: Register handlers in `ipc.ts`**

After the existing drafts handlers:

```ts
  ipcMain.handle(IpcChannels.DraftsLoadResearch, wrap((id: string) => drafts.loadResearch(id)))
  ipcMain.handle(
    IpcChannels.DraftsSaveResearch,
    wrap((id: string, md: string) => drafts.saveResearch(id, md)),
  )
  ipcMain.handle(IpcChannels.DraftsLoadOutline, wrap((id: string) => drafts.loadOutline(id)))
  ipcMain.handle(
    IpcChannels.DraftsSaveOutline,
    wrap((id: string, outline: unknown) => drafts.saveOutline(id, outline)),
  )
```

Update the existing GenerationStart handler to use `runFullPipeline` instead of `runGenerationPipeline`:

```ts
import { runFullPipeline, runResearchOnly, runOutlineOnly, runScriptOnly, type ProgressEvent } from './generation/pipeline'
```

Replace the body of `GenerationStart`'s wrap:

```ts
wrap(async (args: { providerId: ProviderId; modelId?: string; input: GenerationInput }) => {
  const { providerId, modelId, input } = args
  const apiKey = await getSecret(providerId)
  if (!apiKey) throw new Error(`No ${providerId} API key set. Add one in Settings → Generation.`)
  abortController = new AbortController()
  try {
    if (providerId !== 'gemini') throw new Error(`Provider ${providerId} not yet implemented.`)
    const provider = new GeminiProvider({ apiKey, modelId })
    const result = await runFullPipeline(input, {
      provider,
      createDraft: (m, explicitId) => drafts.createDraft(m, explicitId),
      saveDraft: (id, m) => drafts.saveDraft(id, m),
      saveResearch: (id, md) => drafts.saveResearch(id, md),
      saveOutline: (id, o) => drafts.saveOutline(id, o),
      loadResearch: (id) => drafts.loadResearch(id),
      loadOutline: (id) => drafts.loadOutline(id),
      loadDraft: (id) => drafts.loadDraft(id),
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
})
```

Note: `createDraft` signature changed to accept optional explicitId. Update the existing `DraftsCreate` handler accordingly (it just passes one arg, but the signature is compatible).

Add a new `GenerationRunStep` handler that runs a single step on an existing draft:

```ts
ipcMain.handle(
  IpcChannels.GenerationRunStep,
  wrap(
    async (args: {
      draftId: string
      step: 'research' | 'outline' | 'script'
      providerId: ProviderId
      modelId?: string
      input: GenerationInput
    }) => {
      const { draftId, step, providerId, modelId, input } = args
      const apiKey = await getSecret(providerId)
      if (!apiKey) throw new Error(`No ${providerId} API key set.`)
      abortController = new AbortController()
      try {
        if (providerId !== 'gemini') throw new Error(`Provider ${providerId} not yet implemented.`)
        const provider = new GeminiProvider({ apiKey, modelId })
        const sharedDeps = {
          provider,
          createDraft: (m: DraftManifest, explicitId?: string) => drafts.createDraft(m, explicitId),
          saveDraft: (id: string, m: DraftManifest) => drafts.saveDraft(id, m),
          saveResearch: (id: string, md: string) => drafts.saveResearch(id, md),
          saveOutline: (id: string, o: unknown) => drafts.saveOutline(id, o),
          loadResearch: (id: string) => drafts.loadResearch(id),
          loadOutline: (id: string) => drafts.loadOutline(id),
          loadDraft: (id: string) => drafts.loadDraft(id),
          emit: emitProgress,
          signal: abortController.signal,
        }
        if (step === 'research') {
          await runResearchOnly(draftId, input, sharedDeps)
          return { warnings: [] }
        }
        if (step === 'outline') {
          await runOutlineOnly(draftId, input.subject, sharedDeps)
          return { warnings: [] }
        }
        if (step === 'script') {
          const r = await runScriptOnly(draftId, input.subject, sharedDeps)
          return r
        }
        throw new Error(`Unknown step: ${step}`)
      } catch (err) {
        emitProgress({ step: 'error', message: err instanceof Error ? err.message : String(err) })
        throw err
      } finally {
        abortController = null
      }
    },
  ),
)
```

Add the type import at the top: `import type { DraftManifest } from '../shared/manifest'`.

- [ ] **Step 3: Update `preload/index.ts`** to surface the new drafts.* methods and generation.runStep

Add to the drafts object:

```ts
    loadResearch: (draftId: string) => invoke<string>(IpcChannels.DraftsLoadResearch, draftId),
    saveResearch: (draftId: string, markdown: string) =>
      invoke<void>(IpcChannels.DraftsSaveResearch, draftId, markdown),
    loadOutline: (draftId: string) => invoke<unknown>(IpcChannels.DraftsLoadOutline, draftId),
    saveOutline: (draftId: string, outline: unknown) =>
      invoke<void>(IpcChannels.DraftsSaveOutline, draftId, outline),
```

Add to the generation object:

```ts
    runStep: (args: {
      draftId: string
      step: 'research' | 'outline' | 'script'
      providerId: 'gemini' | 'claude' | 'openai'
      modelId?: string
      input: {
        subject: string
        hints?: string
        lengthMinutes?: number
        useSearch: boolean
      }
    }) => invoke<{ warnings: string[] }>(IpcChannels.GenerationRunStep, args),
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: passes.

---

### Task 6: DraftEditor tabs (Manifest / Research / Outline)

**Files:** Modify `src/renderer/editor/DraftEditor.tsx`, create `src/renderer/editor/ResearchPanel.tsx`, `src/renderer/editor/OutlinePanel.tsx`, `src/renderer/editor/ManifestPanel.tsx`

- [ ] **Step 1: Extract the current draft editor body into `ManifestPanel.tsx`**

```tsx
import { MetadataEditor } from './forms/MetadataEditor'
import { CoverEditor } from './forms/CoverEditor'
import { HostsEditor } from './forms/HostsEditor'
import { ChaptersEditor } from './forms/ChaptersEditor'

export function ManifestPanel() {
  return (
    <div className="space-y-10">
      <MetadataEditor />
      <CoverEditor />
      <HostsEditor />
      <ChaptersEditor />
    </div>
  )
}
```

- [ ] **Step 2: Create `ResearchPanel.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useEditorStore } from './editorStore'
import { loadGenerationConfig } from '../settings/generationConfig'

export function ResearchPanel() {
  const draftId = useEditorStore((s) => s.currentDraftId)
  const draft = useEditorStore((s) => s.currentDraft)
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!draftId) return
    setLoaded(false)
    window.deepcuts.drafts.loadResearch(draftId).then((md) => {
      setText(md)
      setLoaded(true)
      setDirty(false)
    })
  }, [draftId])

  async function save() {
    if (!draftId) return
    await window.deepcuts.drafts.saveResearch(draftId, text)
    setDirty(false)
  }

  async function regenerate() {
    if (!draftId || !draft) return
    if (text.trim() && !window.confirm('Replace the current research with a fresh generation?')) return
    setRunning(true)
    setError(null)
    try {
      const cfg = loadGenerationConfig()
      await window.deepcuts.generation.runStep({
        draftId,
        step: 'research',
        providerId: cfg.providerId,
        modelId: cfg.modelId,
        input: { subject: draft.subject || draft.title, useSearch: true },
      })
      const md = await window.deepcuts.drafts.loadResearch(draftId)
      setText(md)
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Research failed')
    } finally {
      setRunning(false)
    }
  }

  if (!loaded) return <div className="text-[var(--color-muted)]">Loading research…</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] tracking-[0.2em] uppercase text-[var(--color-muted)]">
          {text.trim() ? (dirty ? 'Edited' : 'Saved') : 'Empty'}
        </div>
        <div className="flex gap-2">
          {dirty && (
            <button
              onClick={save}
              className="text-xs px-2 py-1 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30"
            >
              Save
            </button>
          )}
          <button
            onClick={regenerate}
            disabled={running}
            className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5 disabled:opacity-40"
          >
            {running ? 'Researching…' : text.trim() ? 'Re-generate' : 'Generate research'}
          </button>
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
        placeholder="Click 'Generate research' to fill this in via Gemini with web search…"
        className="w-full min-h-[400px] bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:border-[var(--color-accent)]"
      />
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  )
}
```

- [ ] **Step 3: Create `OutlinePanel.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useEditorStore } from './editorStore'
import { loadGenerationConfig } from '../settings/generationConfig'

export function OutlinePanel() {
  const draftId = useEditorStore((s) => s.currentDraftId)
  const draft = useEditorStore((s) => s.currentDraft)
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!draftId) return
    setLoaded(false)
    window.deepcuts.drafts.loadOutline(draftId).then((o) => {
      setText(o ? JSON.stringify(o, null, 2) : '')
      setLoaded(true)
      setDirty(false)
    })
  }, [draftId])

  async function save() {
    if (!draftId) return
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      setError('Outline JSON is invalid: ' + (e instanceof Error ? e.message : 'parse error'))
      return
    }
    await window.deepcuts.drafts.saveOutline(draftId, parsed)
    setDirty(false)
    setError(null)
  }

  async function regenerate() {
    if (!draftId || !draft) return
    if (text.trim() && !window.confirm('Replace the current outline with a fresh generation?')) return
    setRunning(true)
    setError(null)
    try {
      const cfg = loadGenerationConfig()
      await window.deepcuts.generation.runStep({
        draftId,
        step: 'outline',
        providerId: cfg.providerId,
        modelId: cfg.modelId,
        input: { subject: draft.subject || draft.title, useSearch: false },
      })
      const o = await window.deepcuts.drafts.loadOutline(draftId)
      setText(o ? JSON.stringify(o, null, 2) : '')
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Outline generation failed')
    } finally {
      setRunning(false)
    }
  }

  async function runScript() {
    if (!draftId || !draft) return
    if (!window.confirm('Regenerate the manifest (narration + voiceovers + song resolution) from the current outline? This will overwrite the current manifest.')) return
    setRunning(true)
    setError(null)
    try {
      const cfg = loadGenerationConfig()
      const r = await window.deepcuts.generation.runStep({
        draftId,
        step: 'script',
        providerId: cfg.providerId,
        modelId: cfg.modelId,
        input: { subject: draft.subject || draft.title, useSearch: false },
      })
      // Reload draft from disk to pick up the new manifest.
      await useEditorStore.getState().openDraft(draftId)
      if (r.warnings.length) {
        setError('Script generated with warnings:\n\n' + r.warnings.join('\n'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Script generation failed')
    } finally {
      setRunning(false)
    }
  }

  if (!loaded) return <div className="text-[var(--color-muted)]">Loading outline…</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] tracking-[0.2em] uppercase text-[var(--color-muted)]">
          {text.trim() ? (dirty ? 'Edited' : 'Saved') : 'Empty'}
        </div>
        <div className="flex gap-2">
          {dirty && (
            <button
              onClick={save}
              className="text-xs px-2 py-1 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30"
            >
              Save
            </button>
          )}
          <button
            onClick={regenerate}
            disabled={running}
            className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5 disabled:opacity-40"
          >
            {running ? 'Working…' : text.trim() ? 'Re-generate' : 'Generate outline'}
          </button>
          <button
            onClick={runScript}
            disabled={running || !text.trim()}
            className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5 disabled:opacity-40"
          >
            Regenerate manifest from outline
          </button>
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
        placeholder="Click 'Generate outline' to build a chapter plan from the research…"
        className="w-full min-h-[400px] bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:border-[var(--color-accent)]"
      />
      {error && <div className="text-xs text-red-400 whitespace-pre-wrap">{error}</div>}
    </div>
  )
}
```

- [ ] **Step 4: Update `DraftEditor.tsx`** — add tabs + render appropriate panel

```tsx
import { useEffect, useState } from 'react'
import { useEditorStore } from './editorStore'
import { ManifestPanel } from './ManifestPanel'
import { ResearchPanel } from './ResearchPanel'
import { OutlinePanel } from './OutlinePanel'

type EditorTab = 'manifest' | 'research' | 'outline'

export function DraftEditor() {
  const draft = useEditorStore((s) => s.currentDraft)
  const dirty = useEditorStore((s) => s.dirty)
  const loading = useEditorStore((s) => s.loadingDraft)
  const close = useEditorStore((s) => s.closeDraft)
  const save = useEditorStore((s) => s.saveDraft)
  const error = useEditorStore((s) => s.error)
  const currentDraftId = useEditorStore((s) => s.currentDraftId)

  const [tab, setTab] = useState<EditorTab>('manifest')
  const [isPublished, setIsPublished] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  useEffect(() => {
    if (!currentDraftId) return
    window.deepcuts.library.isPublished(currentDraftId).then(setIsPublished).catch(() => {})
  }, [currentDraftId])

  async function publish() {
    if (!currentDraftId) return
    if (dirty) {
      if (!window.confirm('Save changes before publishing?')) return
      await save()
    }
    setPublishing(true)
    setPublishError(null)
    try {
      await window.deepcuts.library.publish(currentDraftId)
      setIsPublished(true)
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  async function unpublish() {
    if (!currentDraftId) return
    if (!window.confirm('Unpublish this draft? It will disappear from the catalog.')) return
    setPublishing(true)
    setPublishError(null)
    try {
      await window.deepcuts.library.unpublish(currentDraftId)
      setIsPublished(false)
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Unpublish failed')
    } finally {
      setPublishing(false)
    }
  }

  if (loading && !draft) {
    return <div className="p-12 text-[var(--color-muted)]">Loading…</div>
  }
  if (!draft) {
    return <div className="p-12 text-[var(--color-muted)]">No draft open.</div>
  }

  return (
    <div className="p-12 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button
          onClick={close}
          className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          ← Drafts
        </button>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-xs text-[var(--color-muted)]">unsaved</span>}
          {isPublished && (
            <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--color-accent)]">Published</span>
          )}
          <button
            onClick={async () => {
              const id = useEditorStore.getState().currentDraftId
              if (!id) return
              if (useEditorStore.getState().dirty) {
                if (!window.confirm('Save changes before previewing?')) return
                await useEditorStore.getState().saveDraft()
              }
              const result = await useEditorStore.getState().startPreview(id)
              if (!result.ok) {
                alert('Cannot preview — manifest is incomplete:\n\n' + result.errors.join('\n'))
              }
            }}
            className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-hairline)] hover:bg-white/5"
          >
            Preview
          </button>
          <button
            onClick={save}
            disabled={!dirty}
            className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-hairline)] hover:bg-white/5 disabled:opacity-40"
          >
            Save
          </button>
          {isPublished && (
            <button
              onClick={unpublish}
              disabled={publishing}
              className="text-sm px-3 py-1.5 rounded-md text-[var(--color-muted)] hover:bg-white/5 disabled:opacity-40"
            >
              Unpublish
            </button>
          )}
          <button
            onClick={publish}
            disabled={publishing}
            className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-40"
          >
            {publishing ? 'Publishing…' : isPublished ? 'Re-publish' : 'Publish'}
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-[var(--color-hairline)]">
        {(['manifest', 'research', 'outline'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              'text-xs tracking-[0.15em] uppercase px-3 py-2 border-b-2 transition-colors ' +
              (tab === t
                ? 'text-[var(--color-text)] border-[var(--color-accent)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-text)] border-transparent')
            }
          >
            {t}
          </button>
        ))}
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}
      {publishError && (
        <div className="text-xs text-red-400 whitespace-pre-wrap">{publishError}</div>
      )}

      <div className="pt-2">
        {tab === 'manifest' && <ManifestPanel />}
        {tab === 'research' && <ResearchPanel />}
        {tab === 'outline' && <OutlinePanel />}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run build`
Expected: passes.

---

### Task 7: Final verify

- [ ] **Step 1: Gates**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass.

- [ ] **Step 2: Smoke test (on your Mac)**

1. ⌘, → Generation → Gemini key set
2. Editor → + New project → Generate → enter subject → Generate
3. Progress should now cycle: Research → Outline → Script → Resolving → Finalizing
4. Open the resulting draft → switch to Research tab → see the markdown research doc
5. Switch to Outline tab → see the structured outline
6. Edit Research → Save → click "Generate outline" on Outline tab → outline regenerates
7. Click "Regenerate manifest from outline" on Outline tab → manifest regenerates
