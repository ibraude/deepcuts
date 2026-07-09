# Spec — Remote Content Catalog

**Date:** 2026-07-09
**Scope:** A remotely-hosted catalog of episode manifests, cover images, and pre-rendered narration audio. Both the desktop app and (in a future spec) the marketing website read from it. The app transitions to all-remote content — bundled episodes are removed.

## Goal

Move every episode's assets — manifest JSON, cover image, pre-rendered narration and voiceover MP3s — into a `/content/` directory in the main repo, served publicly via jsDelivr's GitHub CDN. The desktop app fetches this catalog at startup and streams audio at playback time, with local caching for offline replay and an explicit "download for offline" action for full-episode retention. Publishing a new episode is a git commit landing new files under `/content/`.

## Non-goals

- The marketing website itself (separate spec, brainstormed next).
- Authentication or private content — everything is public.
- Podcast RSS feed generation.
- Search, filtering, or personalization.
- An in-app "Ship to Web" button — publishing is CLI-driven and git-reviewed for now.
- Migration of user-published drafts to remote (Spec E's local library flow stays local).

## Hosting model

- Storage: `/content/` directory in the main `deepcuts` repo.
- CDN: jsDelivr against the `@main` tag.
- Base URL: `https://cdn.jsdelivr.net/gh/<owner>/deepcuts@main/content/`, where `<owner>` is the GitHub org/user hosting the repo — set once as a single constant `CONTENT_BASE_URL` in `src/shared/config.ts`.
- Propagation: ~10 min from `git push` to global availability. Cache-bust via `?ts=<epoch>` if ever needed.
- Overridable via `DEEPCUTS_CONTENT_BASE_URL` env var for local dev (point at a local static file server or a fork).

**Repo size — flagged risk.** Pre-rendered narration is ~1 MB/min at 128 kbps mono. A 40-min episode is ~40 MB. Twenty episodes ≈ 800 MB inside `/content/`. This is real weight in a code repo. Escape hatches, deferred until we feel the pain:

- Git LFS for `/content/**/*.mp3` (transparent to jsDelivr consumers; costs LFS bandwidth).
- Split `/content` into a sibling repo `deepcuts-content`.
- Move audio to Cloudflare R2 while keeping manifests + covers in git.

We ship "same repo /content" as chosen; document the escape hatches; revisit after the fourth released episode.

## Directory layout

```
/content/
  catalog.json                          # master index, small
  episodes/
    almost-blue/
      manifest.json                     # EpisodeManifest (existing zod schema)
      meta.json                         # marketing overlay
      cover.png                         # 1200×1200
      audio/
        n-01.mp3                        # pre-rendered narration segments
        n-02.mp3
        vo-song-01-01.mp3               # pre-rendered voiceovers
        ...
    waiting-around-to-die/
      ...
    blood-on-the-tracks/                # upcoming — cover + meta only
      cover.png
      meta.json
```

**Files present per status:**

| File            | Released | Upcoming        |
|-----------------|----------|-----------------|
| `cover.png`     | ✓        | ✓               |
| `meta.json`     | ✓        | ✓               |
| `manifest.json` | ✓        | — (not yet)     |
| `audio/*.mp3`   | ✓        | —               |

An upcoming episode is a directory containing just `cover.png` + `meta.json`. When the writing lands, `manifest.json` and `audio/` fill in, `meta.json` flips its `releaseDate` on, and the entry in `catalog.json` moves from `upcoming` → `released` on the next publish.

## `catalog.json` shape

Small, cache-friendly, minimal. Carries only what's needed to decide *what to show and in what order*.

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-07-09T12:00:00Z",
  "episodes": [
    { "id": "almost-blue",           "status": "released", "releaseDate": "2026-06-10", "order": 1 },
    { "id": "waiting-around-to-die", "status": "released", "releaseDate": "2026-07-01", "order": 2 },
    { "id": "bill-withers-carnegie", "status": "released", "releaseDate": "2026-07-05", "order": 3 },
    { "id": "solid-air",             "status": "released", "releaseDate": "2026-07-08", "order": 4 },
    { "id": "blonde-on-blonde",      "status": "upcoming", "expectedRelease": "2026-Q4", "order": 5 },
    { "id": "blood-on-the-tracks",   "status": "upcoming", "expectedRelease": "2027-Q1", "order": 20 }
  ]
}
```

**Two-hop fetch pattern.** Consumers fetch `catalog.json` first, then for each visible card fetch `episodes/<id>/meta.json` on demand. This keeps `catalog.json` tiny (~2 KB at 20 episodes) and pushes per-episode data into per-episode files that load only when the user actually looks at that episode.

**Ordering.** `order` is a manual integer, low-to-high. Gives full control without depending on release dates (which are vague for upcoming: `"2027-Q1"`).

**Status values.** `"released" | "upcoming"`. No `"draft"` / `"hidden"` — anything not ready to show simply doesn't appear in `catalog.json`.

## `meta.json` shape

Kept separate from `manifest.json` so the strict app schema stays untouched and this file can evolve as the site's needs grow.

```json
{
  "schemaVersion": 1,
  "artistName": "Chet Baker",
  "albumName": "Almost Blue",
  "blurb": "A portrait of Chet Baker. The music. The silence. The beauty.",
  "palette": {
    "bg": "#e8e4d6",
    "ink": "#0e2a44",
    "accent": "#2f6ea1"
  },
  "releaseDate": "2026-06-10",
  "expectedRelease": null
}
```

- `releaseDate` present for released episodes (ISO date); `null` otherwise.
- `expectedRelease` present for upcoming (free-form string like `"2027-Q1"` or `"Autumn 2026"`); `null` otherwise.
- `palette` colors are used by the (future) site for per-episode section theming. The publish script proposes values via color-quantization on `cover.png` (see Publish flow); the human confirms or overrides before committing.
- Validated by a new zod schema `episodeMetaSchema` in `src/shared/meta.ts`.

## Manifest changes

The `narrationSegmentSchema` in `src/shared/manifest.ts` already accepts audio URLs (`z.string().url().or(...)`), so published manifests store narration audio as CDN URLs directly with no schema change:

```json
{
  "type": "narration",
  "id": "n-01",
  "hostId": "host-1",
  "text": "...",
  "audio": "https://cdn.jsdelivr.net/gh/<owner>/deepcuts@main/content/episodes/almost-blue/audio/n-01.mp3"
}
```

**One additive schema change:** `voiceoverSchema` today has no `audio` field. Add one optional field to match the narration segment shape:

```ts
audio: z.string().url().or(z.string().startsWith('file:')).or(z.string().startsWith('/')).optional()
```

Voiceovers get the same treatment as narration — the CDN URL is written into the manifest at publish time. Existing drafts without pre-rendered audio remain valid (field is optional).

## App changes

### New module: `src/main/catalog/RemoteCatalog.ts`

```ts
interface RemoteCatalog {
  refresh(): Promise<void>                            // fetches catalog.json, writes to cache
  list(): Promise<CatalogEntry[]>                     // reads from cache
  loadEpisode(id: string): Promise<EpisodeManifest>   // fetches + caches manifest.json
  loadMeta(id: string): Promise<EpisodeMeta>          // fetches + caches meta.json
  coverUrl(id: string): string                        // direct jsDelivr URL, no fetch
}

interface CatalogEntry {
  id: string
  status: 'released' | 'upcoming'
  releaseDate?: string
  expectedRelease?: string
  order: number
}
```

DI-friendly like existing modules: `createRemoteCatalog({ baseUrl, cacheRoot, fetcher, fs })` returns the interface above. `fetcher` defaults to `globalThis.fetch`; tests inject a fake.

### Startup flow

1. Read cached `catalog.json` from `userData/cache/catalog.json`. If present, render Catalog UI immediately.
2. In parallel, `refresh()` fetches the live copy and updates the cache; UI refreshes when it lands.
3. If no cache and offline → empty state: *"Connect to load your library."*

Cache-first + background-refresh keeps startup snappy and offline-tolerant.

### Play flow

1. User clicks a card. App fetches `meta.json` + `manifest.json`, caches both under `userData/cache/episodes/<id>/`.
2. Scheduler runs the manifest exactly as it does today. Only difference: narration/voiceover `audio` field is now an HTTPS URL, not a `file:` path.
3. NarrationPlayer streams the MP3 via `<audio>` (browser handles HTTP caching for you).
4. **Prefetch-3:** at playback start, and after each segment boundary, the next three CDN audio artifacts (narration segments and voiceovers in playback order) are warmed in the background via `fetch(url, {cache: 'force-cache'})` or a hidden `<audio preload="auto">`. Song segments are skipped — those play through the user's Spotify desktop app and don't touch the CDN.

### Download-for-offline

- Per-episode action button ("Download for offline") visible in the Catalog card hover or on the episode detail view.
- Clicking downloads `manifest.json`, `meta.json`, `cover.png`, and every `audio/*.mp3` referenced in the manifest into `userData/cache/episodes/<id>/`.
- Card gains a **"Downloaded"** pill (subtle, uppercase, 0.2 em tracking).
- Downloaded episodes are fully playable offline. The Scheduler resolves audio URLs against the local cache first, then falls back to network.
- Storage estimate shown alongside the button before download (e.g., "~38 MB").
- "Remove downloaded" action reverses it.

Distinct from browser HTTP cache, which can be evicted at any time.

### Bundled episodes go away

`episodes/blonde-on-blonde-60.json` and `episodes/marty-stuck-in-mobile.json` are deleted from the app repo. The proper Blonde on Blonde episode reappears in `/content/episodes/blonde-on-blonde/` when written. First-launch users with no internet see the empty state; the "download for offline" affordance is the answer for road-warriors.

### Live ElevenLabs synthesis stays — for drafts only

The synth code path is not deleted; it moves behind an `isDraft` branch. Everything in the published library plays pre-rendered MP3 from the CDN. Draft/preview mode inside the editor keeps calling ElevenLabs at runtime (no pre-render step for unpublished drafts).

## Publish flow

CLI-driven. `scripts/publish-episode.ts`, invoked from repo root.

```
npm run publish-episode -- --draft <draftId> [--status released|upcoming] [--order N]
```

### Released episode

1. Read draft from `~/Library/Application Support/deepcuts/drafts/<draftId>/`.
2. Validate strictly against `episodeManifestSchema`. Fail loud on any issue with a list of schema problems.
3. Pre-render every narration + voiceover segment via the existing ElevenLabs pipeline (Spec F — pre-render feature). Output: `content/episodes/<id>/audio/<segmentId>.mp3` per segment.
4. Rewrite the manifest: every segment's `audio` field is replaced with its CDN URL (`{baseUrl}/episodes/<id>/audio/<segmentId>.mp3`, with `<owner>` and `deepcuts@main` baked in).
5. Copy `cover.png` from the draft into `content/episodes/<id>/cover.png`.
6. Read or generate `meta.json`:
   - If the draft already contains a `meta.json`, copy it.
   - Otherwise, prompt interactively (`artistName`, `albumName`, `blurb`, `palette` — palette may be extracted from cover via a color-quantization step, editable before commit).
7. Add or update the episode's entry in `content/catalog.json`: `status: "released"`, `releaseDate: <today ISO>`, `order: <next unless --order N>`.
8. Print a git diff summary and a suggested commit message (`content: publish <id>`). The script does **not** run `git add / commit / push` — that stays a review step under the user's control.

### Upcoming episode

Same script, `--status upcoming`. Only cover + meta required; skips manifest / audio steps. Useful for "we've announced this" placeholder cards.

### Idempotent re-publish

If the episode dir already exists, the script overwrites audio + manifest and reports what changed. `catalog.json` `order` is preserved unless `--order N` is passed.

### Unpublish

Manual — `git rm -r content/episodes/<id>/` and delete from `catalog.json`. Rare enough to skip a script.

## Testing

- **`RemoteCatalog` unit tests** (main process): cache-first behavior, refresh-in-background updates cache, offline fallback returns cached copy, `loadEpisode` populates disk cache, dev override env var respected. Uses a fake `fetch` + fake `fs`.
- **Integration test:** spin a local static file server on a random port serving a fixture `content/` tree; point `RemoteCatalog` at it via env var; exercise catalog → meta → manifest → simulated playback (with in-memory MP3 stubs). One end-to-end trace.
- **`publish-episode.ts` snapshot test:** given a fixture draft dir, assert the generated `content/episodes/<id>/` tree and the diff to `catalog.json`. No network in test.
- **Existing tests unchanged:** Scheduler / NarrationPlayer / `manifest.ts` schema tests keep passing as-is.
- `npm run typecheck`, `npm test`, `npm run build` all green.

## Definition of done

1. `/content/` populated for the four released episodes (Chet Baker – Almost Blue, Townes Van Zandt – Waiting Around to Die, Bill Withers – Live at Carnegie Hall, John Martyn – Solid Air) and cover+meta placeholders for the sixteen upcoming ones.
2. `src/main/catalog/RemoteCatalog.ts` implemented with tests.
3. App startup and play flow use `RemoteCatalog` end-to-end. `episodes/blonde-on-blonde-60.json` and `episodes/marty-stuck-in-mobile.json` deleted. Draft/preview keeps live ElevenLabs synthesis.
4. Prefetch-3 during playback active by default.
5. Download-for-offline per-episode action shipping, with pill in Catalog UI and offline replay verified manually in airplane mode.
6. `scripts/publish-episode.ts` produces a valid `content/` entry from a draft (or skeleton for upcoming), rewrites audio URLs, updates `catalog.json`, prints diff + commit message.
7. Tests written; `npm run typecheck`, `npm test`, `npm run build` all green.
8. Manual smoke on a fresh machine: catalog loads over network, playback streams, mid-playback disconnect continues from prefetched buffer, "Download for offline" makes an episode fully replayable offline.

## Roster reference

Released (4):
- almost-blue — Chet Baker, *Almost Blue*
- waiting-around-to-die — Townes Van Zandt
- bill-withers-carnegie — Bill Withers, *Live at Carnegie Hall*
- solid-air — John Martyn, *Solid Air*

Upcoming (16):
- blonde-on-blonde — Bob Dylan
- heart-of-saturday-night — Tom Waits
- dusk — The The
- five-leaves-left — Nick Drake
- small-change — Tom Waits
- strangeways — The Smiths
- prince-of-darkness — Nick Cave
- there-goes-rhymin-simon — Paul Simon
- mad-dogs-and-englishmen — Joe Cocker
- rumours — Fleetwood Mac
- music-from-big-pink — The Band
- blue — Joni Mitchell
- tapestry — Carole King
- i-never-loved-a-man — Aretha Franklin
- nebraska — Bruce Springsteen
- blood-on-the-tracks — Bob Dylan

IDs are the canonical episode slugs used throughout `/content/`, `RemoteCatalog`, and the (future) website.
