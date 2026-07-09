# Deepcuts

A macOS desktop app that plays AI-generated listening documentaries about music. Narration alternates with the actual songs, which play through your own Spotify desktop client. No accounts, no Spotify Web API, no server — everything runs locally.

## Run it (5 minutes, no keys)

Requirements: macOS, Node 20+, the Spotify desktop app installed and signed in.

```bash
git clone <repo>
cd deepcuts
npm install
npm run dev
```

First time you click Play, macOS will ask whether Deepcuts can control Spotify. Allow it. If you miss the prompt: System Settings → Privacy & Security → Automation → Deepcuts → toggle Spotify on.

With no API keys configured, narration uses your Mac's built-in system voice. For higher quality:

- Open System Settings → Accessibility → Spoken Content → System Voice and download a Premium voice (Ava, Zoe, Joelle, Evan, Nathan, or Noelle).
- Or open Deepcuts → ⌘, → paste an ElevenLabs API key. Synthesized narration is cached locally.

## Verify your Spotify setup

```bash
npm run probe-spotify
```

This launches Spotify, plays one Dylan track for three seconds, reads back position and state, then pauses. If you see `AutomationConsentDenied`, grant access in Privacy & Security → Automation.

## Add an episode

Episodes live in `episodes/*.json` and follow the schema in `src/shared/manifest.ts`. To add one:

1. Author a manifest — narration text plus chapter structure.
2. Resolve each song to a `spotify:track:` URI. The easiest way is to right-click the track in your Spotify desktop app → Share → Copy Spotify URI.
3. Add a cover image at `episodes/covers/<id>.<ext>`.
4. Open a PR.

## Editor

Open the app, click the **Editor** pill at the top right.

- **+ New project** — start from a blank manifest or duplicate one of the bundled episodes for editing.
- Edit any field — title, subject, hosts, chapter structure, narration text, song picks, voiceover timing.
- **Preview** plays the draft using the same player as the bundled episodes, with a banner indicating preview mode. Exit preview returns to the editor.
- Drafts are stored locally under `~/Library/Application Support/deepcuts/drafts/<id>/`.

Publishing drafts to the library catalog comes in a later spec.

## Architecture

- `src/main/` — Electron main process. All `osascript` calls and all key-bearing API calls run here. Talks to the renderer through a typed `contextBridge` only.
- `src/preload/` — exposes `window.deepcuts.*` via `contextBridge`. `nodeIntegration: false`, `contextIsolation: true`.
- `src/renderer/` — React UI. The Scheduler state machine in `player/Scheduler.ts` is pure logic and fully unit-tested.
- `src/shared/` — Zod schemas, IPC types, and error taxonomy shared between processes.

## What it's not

- It does **not** use the Spotify Web API, OAuth, or any server.
- It does **not** stream or decode Spotify audio. It just tells your already-running Spotify app what to play.
- It is **macOS only**. Apple Music is stubbed.

## Tests

```bash
npm test          # 30 unit tests covering schemas, AppleScript, ElevenLabs, NarrationPlayer, Scheduler
npm run typecheck # strict TS on every file
npm run build     # production build of main, preload, and renderer
```

## Distribution

Signed/notarized distribution requires an Apple Developer ID ($99/year). Configure the identity via `CSC_LINK` / `CSC_KEY_PASSWORD` env vars for electron-builder. Until that's set up, distribute via `npm run dev` against the source.
