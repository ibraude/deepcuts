# Spec A — LLM Generation Pipeline

**Date:** 2026-06-26
**Scope:** Provider abstraction + single-shot draft generation. User gives a subject, the LLM produces a manifest with narration, voiceovers, and song picks. Songs are resolved to real Spotify URIs via iTunes Search + Odesli. Result lands as a draft in the editor.

**Position:** Builds on Spec B (drafts library + editor). Future Spec C will add multi-step artifact pipeline (research → outline → script tabs).

## Goal

In the Editor's "+ New project" modal, a new **Generate** tab. Enter a subject ("Bob Dylan — Blonde on Blonde"), optional style hints, optional length target. Click Generate. ~30-60 seconds later a complete, playable draft appears in the drafts list, opened ready for editing.

## Non-goals

- Multi-step artifact tabs (research / outline / script as separate editable artifacts) — Spec C
- Pre-rendering ElevenLabs narration as part of generation — Spec E
- Live regeneration of a single segment while editing — later

## Provider abstraction

### Library choice: Vercel AI SDK

- `ai` (core)
- `@ai-sdk/google` (Gemini 3.1 Pro — initial provider)
- `@ai-sdk/anthropic` (Claude — sketched, not shipped configured)
- `@ai-sdk/openai` (sketched, not shipped configured)

Vercel AI SDK gives us:
- `generateObject({ schema, prompt, ... })` — structured output validated against Zod
- Provider switching via one-line config
- Native tools surface (Gemini's Google Search grounding, Anthropic's web_search)
- Streaming where desired (not used in v1)

### `ScriptProvider` interface

```ts
interface ScriptProvider {
  id: 'gemini' | 'claude' | 'openai'
  generateManifest(input: GenerationInput, signal?: AbortSignal): Promise<GenerationOutput>
}

interface GenerationInput {
  subject: string
  hints?: string          // user-supplied style/persona hints (optional)
  lengthMinutes?: number  // target episode length (optional, defaults to 12)
  useSearch: boolean      // enable provider's web/search tool
}

interface GenerationOutput {
  manifest: GeneratedManifest  // pre-resolution: songs are requests, not URIs
}
```

`GeneratedManifest` differs from `DraftManifest` only in that song segments contain a `trackRequest: { title, artist, searchHint? }` instead of a fully-resolved `track`.

### Initial impl: `GeminiProvider`

- Uses `google('gemini-2.5-pro')` (the model name follows AI SDK's published id; Gemini 3.1 Pro becomes 'gemini-3-pro' or similar — pinned in one constant). At runtime we read the configured model id from settings, defaulting to a known-good Gemini model.
- Web search via `useSearchGrounding: true` toggled by `input.useSearch`.
- System prompt + structured `generateObject` call with the `generatedManifestSchema` Zod schema.

## Song resolution

`src/main/generation/songResolver.ts`:

```ts
async function resolveTrack(req: { title: string; artist: string; searchHint?: string }): Promise<{
  spotifyUri: string
  resolved: { title: string; artist: string }
}>
```

Pipeline:
1. Build iTunes Search query: `"<artist> <title> <searchHint>"`, `entity=song`, `limit=1`.
2. Take the top result; extract `trackViewUrl`.
3. Call Odesli `https://api.song.link/v1-alpha.1/links?url=<trackViewUrl>` with proper encoding.
4. From the response, read `linksByPlatform.spotify.url` (an open.spotify.com URL).
5. Extract the track ID and form `spotify:track:<id>`.
6. Return resolved metadata + URI.

If any step fails for a track, the pipeline doesn't crash — it leaves an unresolved placeholder URI (`spotify:track:UNRESOLVED-<hash>`) and adds the failure to a `warnings` array surfaced to the user. The draft still saves so they can fix it manually.

## Key management

- `keychain.ts` already wraps `safeStorage`. Extend keys: `gemini`, `claude`, `openai` (each a separate secret).
- Settings panel gets a new section: "Generation" — provider dropdown (Gemini default), model id input, API key input per provider.
- Stored separately from ElevenLabs.

## Generation pipeline

`src/main/generation/pipeline.ts` orchestrates:

```
generate(input) ->
  step 'researching' — provider.generateManifest(input)
  step 'resolving songs' — for each song: resolveTrack(...) (parallel, capped)
  step 'finalizing' — build DraftManifest, save via drafts.createDraft
  return { draftId, warnings }
```

Each step emits a progress event to the renderer over IPC (using `webContents.send` to the focused window). Events: `{ step: 'researching' | 'resolving' | 'finalizing' | 'done' | 'error', detail?: string }`.

## UI

### NewDraftModal: third tab

`Empty | Duplicate | Generate`

Generate tab:
- Provider dropdown (Gemini / Claude / OpenAI — Claude/OpenAI disabled with "Coming soon" until their keys are set)
- Subject text input (required)
- Style hints textarea (optional)
- Target length: number input, default 12
- Web search checkbox (default on)
- "Generate" button → disabled while running, shows current step + spinner
- Warnings list after completion (unresolved songs etc.)
- On completion → modal closes, draft opens in editor

### Settings: "Generation" section

- Provider dropdown — saves to localStorage
- Per-provider rows: model id input + API key input (masked) + Save/Clear
- Inline note: "Gemini 2.5 Pro is the current default; substitute the latest Gemini Pro model id if you have access to a newer one."

## Storage

- LLM keys: keychain (existing pattern, new key names `gemini`/`claude`/`openai`)
- Provider/model preference: `localStorage` (key `deepcuts.generation.v1` — `{ providerId, modelId }`)
- Generated draft: same `userData/drafts/<id>/manifest.json` as everything else

## Error handling

- Missing API key → modal shows "Set an API key in Settings → Generation" inline
- LLM call fails → modal shows the error message; nothing saved
- All songs unresolvable → save the draft anyway with placeholders, but mark warnings prominently
- User cancels mid-generation → AbortSignal propagates; partial work discarded

## Tests

- `songResolver.test.ts` — mocked fetch, iTunes + Odesli happy path + failure modes
- `GeminiProvider.test.ts` — mocked AI SDK `generateObject`; verifies schema-conformance check
- `pipeline.test.ts` — wires the above end-to-end with mocks

## Out of scope (Spec C+)

- Editable intermediate artifacts (research doc, outline doc)
- Regeneration of specific segments
- Voiceover timing post-pass with real durations
- Streaming generation visible to user
- Cost/usage tracking

## Definition of done

1. Settings → Generation section accepts a Gemini API key, stored in keychain
2. Editor → + New project → Generate tab → enter "Bob Dylan — Blonde on Blonde", click Generate
3. ~30-60s later a draft appears in the editor with 1+ chapters, multi-host structure (if subject warrants), narration text written, song segments with real Spotify URIs, sensible voiceovers
4. Preview works in the player using the existing pipeline
5. Failed song resolutions are surfaced as warnings; the user can fix them by editing
6. `npm run typecheck`, `npm test`, `npm run build` all pass
