# Spec F — Pre-rendered Narration + Cover Image Generation

**Date:** 2026-06-26
**Scope:** Two features that go together because they both warm a draft into a finished, fast-playing episode.

1. **Cover image generation** — provider abstraction with a Gemini (nano-banana / Imagen) initial implementation; pluggable so MidJourney/DALL·E can slot in later. Triggered from CoverEditor.
2. **Pre-rendered narration** — synthesize every narration + voiceover line via ElevenLabs upfront. Result: playback no longer hits ElevenLabs at runtime. Triggered from DraftEditor toolbar.

## Image generation

### Abstraction: `ImageProvider`

```ts
interface ImageProvider {
  id: 'gemini' | 'openai' | 'midjourney' | string
  generateImage(opts: { prompt: string; aspect?: 'square' | '16:9' | '9:16' }, signal?: AbortSignal): Promise<{
    bytes: Uint8Array
    mimeType: string  // 'image/png' | 'image/jpeg'
  }>
}
```

Lives in `src/main/image/ImageProvider.ts`.

### Initial impl: `GeminiImageProvider`

Uses `gemini-2.5-flash-image-preview` (the "nano-banana" image model) via the Google Generative Language REST API. Direct fetch, not AI SDK — keeps the dependency surface minimal and gives us straightforward Gemini behavior (Vercel AI SDK's image abstraction for Google is still settling between Imagen and Gemini image modalities; direct call avoids that).

Endpoint:

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}
Body: {
  contents: [{ parts: [{ text: prompt }] }],
  generationConfig: { responseModalities: ['IMAGE'] }
}
```

Returns `candidates[0].content.parts[0].inlineData.{ mimeType, data }` (base64). We decode and return bytes.

Aspect ratio: Gemini honors it via prompt language; we append "Square cover art." / "Widescreen 16:9 cover art." to the prompt. (Imagen has explicit aspect, Gemini doesn't — we lean on text.)

### Stub providers

`OpenAIImageProvider` and `MidjourneyImageProvider` exist as files with NotImplementedError throws. They mark the seams without shipping configured.

### IPC

```ts
window.deepcuts.image = {
  generateAndSetCover(args: {
    draftId: string
    prompt: string
    providerId: 'gemini' | 'openai' | 'midjourney'
    modelId?: string
  }): Promise<void>
}
```

Single high-level call: main generates the image and writes `cover.png` (or `.jpg`) into the draft directory directly. The renderer then refreshes via the existing `drafts.coverUrl`.

### Settings

In the "Generation" section, add image-side fields:

- **Image provider** dropdown (Gemini is the only enabled option; OpenAI/MJ disabled with "coming soon")
- **Image model id** input — defaults to `gemini-2.5-flash-image-preview`
- The image API key reuses the existing `gemini` keychain entry (same key powers both text and image generation on Google's API)

### UI: CoverEditor button

Add a "Generate cover" button next to "Choose cover…". Click → small inline prompt textarea + a "Generate" button.

Default prompt is built from the draft's title + subject: `"${title}. ${subject}. Minimal, evocative cover art with confident typography. Square."`

User can edit the prompt before generating.

## Pre-rendered narration

### Architecture

`src/main/prerender.ts` exports:

```ts
async function prerenderDraft(
  draftId: string,
  deps: { tts: ElevenLabsTTS; loadDraft; emit; signal? }
): Promise<{ rendered: number; skipped: number; warnings: string[] }>
```

Algorithm:

1. Load the draft manifest.
2. Collect every text+voiceRef pair: narration segments + voiceovers within each song.
3. For each pair, call `tts.synthesize(text, voiceRef, { segmentId })` — that already writes to `userData/narration-cache/<segId>-<sha1(voiceRef+text)>.mp3` and returns the path. Existing cache means already-rendered pairs are skipped (`cached: true`).
4. Emit progress per pair.

No manifest changes — the cache is the artifact. Subsequent playback's tier-2 path (`NarrationPlayer` → `window.deepcuts.tts.elevenlabs(...)`) returns the cached file instantly.

### Voiceovers pre-render too

The current scheduler `playNarration` callback ignores `audio` on voiceovers — and that's fine, because pre-rendering hits the same `synthesize()` call the runtime would have made. Cache key (`sha1(voiceRef + text)`) is identical, so cache hit at playback.

### IPC

```ts
window.deepcuts.prerender = {
  start(draftId: string): Promise<{ rendered: number; skipped: number; warnings: string[] }>
  cancel(): Promise<void>
  // Progress events go through the existing generation:progress channel with a 'prerender' step kind.
}
```

### UI

In DraftEditor toolbar, between Preview and Save:

- "Pre-render audio" button
- Click → confirmation if there's no ElevenLabs key (asks to set in Settings; nothing to do without)
- Otherwise runs; progress UI inline (X of Y rendered)
- On complete: success toast with "rendered / skipped" counts and any warnings

## Tests

- `prerender.test.ts` — orchestrator with a mocked TTS; verifies it visits every narration + voiceover exactly once and skips duplicates
- `GeminiImageProvider.test.ts` — mocked fetch; happy path + error mapping

## Non-goals

- Bundling audio with library entries on publish (cache stays on the local machine; sharing-with-audio is a later spec)
- Multiple covers / variants
- Image editing (only generate-from-scratch)
- Anthropic Claude or OpenAI image generation (stubs only)

## Definition of done

1. Settings shows image model id + acknowledges Gemini key is reused for image gen
2. CoverEditor has a "Generate cover" button → prompt editor → image appears in the draft
3. DraftEditor has a "Pre-render audio" button → progress UI → cache filled
4. Re-playing a pre-rendered draft makes zero ElevenLabs calls (verified by deleting the key after pre-render — playback still works)
5. `npm run typecheck`, `npm test`, `npm run build` all pass
