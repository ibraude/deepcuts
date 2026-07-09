# Deepcuts M1 — Playback of the bundled flagship episode

**Date:** 2026-06-26
**Scope:** Milestone 1 only. M2 (live catalog) and M3 (local generation) are explicitly out of scope.
**Goal:** App launches → flagship episode visible in a minimal catalog grid → click Play → narration (system voice or ElevenLabs) and a real Spotify track alternate seamlessly through to the end, automatically, on a clean macOS install with zero keys required.

## Non-negotiables (from the brief)

- No Spotify Web API, no OAuth, no client secret. Control Spotify only via `osascript` against the local desktop client.
- Songs are pre-resolved in manifests as `spotify:track:` URIs. Playback never searches the catalog.
- Scheduler is a deterministic state machine — no LLM, no network reasoning in the playback loop.
- All `osascript` calls and all key-bearing API calls run in the main process. Renderer talks to main only through a typed `contextBridge` surface.
- Secrets in OS keychain via Electron `safeStorage`. Never logged. Never in the renderer.
- macOS only. Apple Music is stubbed.

## Architecture

Three-process Electron split, security-first:

- **`main/`** — owns `osascript`, `fetch` for ElevenLabs, `safeStorage`, manifest/catalog loading from disk. Exposes typed IPC handlers.
- **`preload/`** — exposes `window.deepcuts.*` via `contextBridge` only. No Node globals leak to the renderer.
- **`renderer/`** — React + Vite + TS strict + Tailwind v4. Contains the Scheduler, NarrationPlayer, UI, and Zustand store. Stateless w.r.t. the OS.

```
┌───────────────────────────────────────────────────────────┐
│ renderer (Chromium)                                       │
│   App                                                     │
│   ├─ catalog/  ── reads bundled flagship manifest         │
│   └─ player/                                              │
│      ├─ Scheduler  (pure state machine, unit tested)      │
│      ├─ NarrationPlayer  (segment.audio | EL | SystemTTS) │
│      └─ playerStore (Zustand)                             │
│                       │                                   │
│             window.deepcuts.* (typed contextBridge)       │
└───────────────────────────────────────────────────────────┘
                        │ IPC
┌───────────────────────────────────────────────────────────┐
│ main                                                      │
│   ├─ music/AppleScriptSpotify.ts  (execFile osascript)    │
│   ├─ tts/ElevenLabsTTS.ts         (fetch + cache)         │
│   ├─ keychain.ts                  (safeStorage)           │
│   └─ ipc.ts                       (typed handlers)        │
└───────────────────────────────────────────────────────────┘
```

## Components

### `main/music/AppleScriptSpotify.ts`

Implements `MusicProvider`. Each method shells out to `osascript -e <script>` via `child_process.execFile` (safer than `exec` — avoids shell interpolation). Maps known stderr patterns to typed errors:

- `errAEEventNotPermitted` / "Not authorized to send Apple events" → `AutomationConsentDeniedError`
- "Application isn't running" → caught and retried after `tell application "Spotify" to activate` (with a 2s settle)
- Any other failure → `AppleScriptError` with raw stderr

Public surface:

```ts
isAvailable(): Promise<boolean>             // app installed (NSWorkspace / mdfind)
ensureReady(): Promise<void>                // launch app; wait for player state to become reachable
play(trackUri: string): Promise<void>
pause(): Promise<void>
getPosition(): Promise<number>              // seconds (float)
getState(): Promise<'playing'|'paused'|'stopped'>
getCurrentTrack(): Promise<{ id: string; uri: string }>
setVolume(pct: number): Promise<void>
```

### `main/tts/ElevenLabsTTS.ts`

`synthesize(text, voiceRef)`: POST `https://api.elevenlabs.io/v1/text-to-speech/<voice_id>/stream` with `xi-api-key` header. Returns mp3 bytes. Cached on disk at `app.getPath('userData')/narration-cache/<segmentId>-<sha1(voiceRef+text)>.mp3`. Cache key includes the text hash so edits to the manifest produce fresh audio.

`SystemTTS` lives in the renderer (uses `window.speechSynthesis`) — not in main — because Chromium owns the synthesizer.

### `renderer/player/NarrationPlayer.ts`

`play(segment): Promise<void>` resolves when narration finishes. Three tiers, in order:

1. `segment.audio` present → play via `HTMLAudioElement`, resolve on `ended`.
2. ElevenLabs key set in keychain AND `segment.hostId` resolves to a voice with `voiceRef` starting `elevenlabs:` → call `window.deepcuts.tts.elevenlabs(text, voiceRef)` → main returns a file path → play that file, resolve on `ended`.
3. SystemTTS fallback. Pick the best available voice (see below). 60s safety timeout in case Chromium drops the `end` event.

**Voice selection** (SystemTTS):

```
priority = voice => {
  if (/\(Premium\)/.test(voice.name))  return 0
  if (/\(Enhanced\)/.test(voice.name)) return 1
  if (voice.name === 'Samantha')       return 2
  if (voice.lang.startsWith('en'))     return 3
  return 4
}
```

Pick `getVoices().sort(by priority)[0]`. If the chosen voice has `priority >= 2`, emit a one-time dismissible banner to download premium voices (`x-apple.systempreferences:com.apple.preference.universalaccess?SpokenContent`). Persisted dismissal in `localStorage`.

### `renderer/player/Scheduler.ts`

Pure state machine. No DOM. No network. Tested in isolation against a mocked `MusicProvider` and `NarrationPlayer`.

**States:** `idle | loading | playing-narration | playing-song | paused | done | error`
**Events:** `start | pause | resume | next | previous | stop | segmentEnded | userInterrupted | musicError`

Loop logic:

```
flatten(manifest.chapters[].segments) → ordered segments[]
for each segment, in order:
  if type === 'narration':
    await narrationPlayer.play(segment)
  else if type === 'song':
    await music.ensureReady()
    await music.play(segment.track.spotifyUri)
    poll every 500ms:
      pos = await music.getPosition()
      state = await music.getState()
      track = await music.getCurrentTrack()
      if pos >= segment.playSeconds: break  // (M1 ignores startAtSeconds, always 0)
      if state !== 'playing':         pause episode, surface 'user interrupted'
      if track.uri !== segment.track.spotifyUri: same
    await music.pause()
```

**Skip-while-playing-narration:** cancel `speechSynthesis` / pause `<audio>`. Advance.
**Skip-while-playing-song:** stop the polling loop, `music.pause()`, advance.

### `main/ipc.ts`

Typed IPC handlers, one per renderer-facing method. Channel names are namespaced (`spotify:play`, `tts:elevenlabs`, `keychain:set`). Errors are serialized as `{ name, message }` and rethrown in the renderer.

### `shared/manifest.ts` and `shared/catalog.ts`

Zod schemas. Strict — unknown keys rejected at the top level, allowed inside `track` (so future fields don't break old apps). `schemaVersion: 1`.

## Flagship episode (proof-of-concept, ~5 min)

`episodes/blonde-on-blonde-60.json`:

- Subject: Bob Dylan — Blonde on Blonde
- 1 chapter: "Nashville, 4 a.m."
- 5 segments: narration (intro, ~30s) → song (Visions of Johanna, 60s) → narration (~20s) → song (Stuck Inside of Mobile, 60s) → narration (outro, ~15s)
- `audio` field absent on all narration segments → demo runs SystemTTS by default. With an ElevenLabs key + voiceRef set, the same manifest renders with premium voice on play.
- Spotify URIs hand-resolved via `curl` against the iTunes Search API + Odesli during authoring (not at playback time). Committed as constants.
- Cover: a simple committed PNG in `episodes/covers/`.

## Error states with real UI panels

1. **Spotify not installed** — full-screen panel: "Deepcuts plays the real Spotify app. [Download Spotify]". Detected via `isAvailable()` returning false.
2. **Automation consent denied** — panel: "Deepcuts needs permission to control Spotify. [Open Settings]". Button opens `x-apple.systempreferences:com.apple.preference.security?Privacy_Automation`. Detected via `AutomationConsentDeniedError`.
3. **Spotify installed but no playback after `play`** — after 2s of `play()` with `position === 0` and `state !== 'playing'`, surface: "Open Spotify and make sure you're signed in."
4. **Generic AppleScript failure** — show error name + stderr in a collapsible `<details>` block.
5. **ElevenLabs failure** — quietly fall back to SystemTTS for the failed segment. Log to the renderer console (not to disk). Surface only if all tiers fail.

## Visual / UX

Per the brief's Linear-grade direction:

- Background `#0E0E11`. Surface `#15151A`. Text `#ECECEE` / `#8A8A8F`. Borders `rgba(255,255,255,0.07)`. Accent muted indigo `#7c7aed`.
- Inter, sizes `12/14/16/20/28`, hierarchy by weight + size.
- Spacing on `4/8/12/16/24/32` scale, radii `6–8px`.
- **Catalog**: cover-led grid, generous air, no card chrome. One row for M1 (one episode).
- **Player**: cover (large, top-left), chapter title, "Now playing" line that swaps between narration host name and `Artist — Track`, transcript of the current narration segment (current line gently emphasized; previous lines dimmed; future lines hidden until reached), sources panel (collapsible), thin progress bar across the whole episode.
- **Settings**: minimal panel reachable by ⌘, — single input for ElevenLabs API key (masked), save/clear buttons.
- Motion: 150–200ms ease on text/now-playing swap. No bouncy easing. No spinners-as-decoration.

## Testing

- `Scheduler.test.ts`:
  - Flatten + ordering of segments across chapters
  - Narration → song → narration transition advances on `segmentEnded`
  - Song completion when `position >= playSeconds`
  - User-interrupted song (state goes to `paused` mid-play)
  - User skipped to a different track mid-play
  - `next` while in narration cancels narration and advances
  - `next` while in song stops polling, pauses Spotify, advances
  - End-of-episode → `done`
- `manifest.test.ts`: zod schema accepts the flagship; rejects missing `spotifyUri`, missing `playSeconds`, unknown top-level keys.
- No integration tests against real Spotify (that's the hybrid verification step below).

## Verification plan (hybrid)

I run, headless:

- `npm run typecheck` (`tsc --noEmit`) — must pass
- `npm test` (`vitest run`) — must pass
- `npm run build` — Vite renderer + main bundle compile cleanly

I won't auto-run the probe-spotify script — it would launch your Spotify and trigger the macOS Automation consent prompt, which is your decision. It's there for you to use:

- `npm run probe-spotify` — small standalone CLI that calls `AppleScriptSpotify` directly: launch Spotify, play `spotify:track:3AhXZa8sUQht0UEdBJgpGc` for 3 seconds, read position, pause. Prints state. Smoke test before opening the app.

You run, on your Mac:

- `npm run dev` → app window opens
- Click the flagship → narration plays → Spotify launches if not running → real Dylan track plays → narration resumes → episode ends
- Try with ElevenLabs key pasted in Settings, also verify
- Try denying Automation consent → confirm the error panel shows and the Settings deeplink works

## Out of scope (M1)

- Live catalog fetch (`CATALOG_URL`) — M2
- Episode generation pipeline (`scripts/render-episode.ts`, `scripts/resolve-tracks.ts`) — M3
- Apple Music adapter (only `AppleScriptAppleMusic.ts` stub that throws "not implemented")
- Code signing / notarization (documented in README, not implemented)
- Windows / Linux
- Pre-rendering flagship narration with ElevenLabs (the manifest supports it; we just don't ship rendered audio in M1)

## File layout

```
deepcuts/
  src/
    main/
      index.ts
      ipc.ts
      keychain.ts
      music/
        MusicProvider.ts
        AppleScriptSpotify.ts
        AppleScriptAppleMusic.ts      # STUB
      tts/
        TTSProvider.ts
        ElevenLabsTTS.ts
    preload/
      index.ts
    renderer/
      main.tsx
      App.tsx
      player/
        Scheduler.ts
        Scheduler.test.ts
        NarrationPlayer.ts
        SystemTTS.ts
        playerStore.ts
      catalog/
        Catalog.tsx
        loadLocal.ts
      settings/
        Settings.tsx
      ui/
        (components)
      styles/
        index.css
    shared/
      manifest.ts
      catalog.ts
      ipcSchema.ts
  episodes/
    blonde-on-blonde-60.json
    covers/blonde-on-blonde-60.png
  scripts/
    probe-spotify.ts
  electron-builder.yml
  vite.config.ts
  vitest.config.ts
  tsconfig.json
  package.json
  README.md
```

## Definition of done for M1

1. Fresh `git clone && npm install && npm run dev` on a Mac with Spotify installed and signed in:
   - App window opens, flagship visible
   - Click Play → SystemTTS narration → real Dylan track in Spotify → SystemTTS narration → next track → outro narration → done
   - No crashes, no console errors
2. `npm run typecheck && npm test` both pass on the maintainer's machine without Spotify available
3. Each of the four error states has a real UI panel that the user can actually recover from
4. README has a clearly-written "5-minute clone-and-run with no keys" path
