# Remote Content Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all episode assets (manifests, cover images, pre-rendered narration/voiceover MP3s) into a `/content/` directory served via jsDelivr's GitHub CDN. The desktop app becomes all-remote: fetch a catalog index at startup, stream audio at playback with prefetch, cache locally for offline replay, and expose an explicit "Download for offline" per-episode action.

**Architecture:** A new `RemoteCatalog` module in the main process is the single point of truth for catalog and manifest loading. It reads `catalog.json` and per-episode `meta.json` / `manifest.json` from jsDelivr, caches everything under `userData/cache/`, and exposes IPC to the renderer. A separate `DownloadedEpisodes` module handles full-episode offline retention by writing manifests with rewritten `file://` audio URLs into `userData/downloaded/<id>/`, transparent to the Scheduler. Bundled `episodes/*.json` are removed. A new `scripts/publish-episode.ts` CLI landsdrafts into `/content/` for git commit.

**Tech Stack:** TypeScript, Electron main + preload + renderer, Zod for schema validation, Vitest for tests. Fetch API for CDN reads. Existing `Scheduler` and `NarrationPlayer` are reused unchanged.

## Global Constraints

- Base URL constant lives in `src/shared/config.ts` as `CONTENT_BASE_URL`, defaulting to `https://cdn.jsdelivr.net/gh/<owner>/deepcuts@main/content` — replace `<owner>` with the actual GitHub owner at Task 1. Override with `DEEPCUTS_CONTENT_BASE_URL` env var (read in main process only).
- All new main-process modules follow the existing DI pattern (see `src/main/library.ts`, `src/main/drafts.ts`): a `createXxx({...deps})` factory returns an interface object. Dependencies include `fetcher`, `fs`, `cacheRoot`, `baseUrl` — all injectable for tests.
- Zod schemas live in `src/shared/`. All catalog / meta / manifest JSON parsed at the trust boundary (fetch response, filesystem read) must pass strict validation before use.
- IPC channels use the existing `wrap()` helper in `src/main/ipc.ts`. Preload exposes them via `contextBridge` under `window.deepcuts.*`, typed in `src/preload/api.d.ts`.
- Tests: Vitest. Existing tests must keep passing (`npm test`). New tests use fake `fetch` and in-memory `fs` — no real network, no real disk writes.
- Every task ends with `npm run typecheck && npm test` green and a commit.
- No secrets or auth in this project — everything hits public URLs.
- Songs play through the user's Spotify desktop app. Nothing in this plan touches song playback — only narration and voiceover.

## File Structure

```
src/
  shared/
    config.ts                              # NEW — CONTENT_BASE_URL const
    meta.ts                                # NEW — episodeMetaSchema
    manifest.ts                            # MODIFY — add optional audio to voiceoverSchema
    ipcSchema.ts                           # MODIFY — remote catalog + downloaded channels
    catalog.ts                             # MODIFY — new schemas: remoteCatalogSchema
  main/
    catalog/
      RemoteCatalog.ts                     # NEW — fetch/cache remote content
      RemoteCatalog.test.ts                # NEW — unit tests
    downloaded/
      DownloadedEpisodes.ts                # NEW — full-episode offline retention
      DownloadedEpisodes.test.ts           # NEW — unit tests
    ipc.ts                                 # MODIFY — register handlers, remove old bundled ones
  preload/
    index.ts                               # MODIFY — expose new APIs, drop old ones
    api.d.ts                               # MODIFY — types for new APIs
  renderer/
    catalog/
      loadCatalog.ts                       # NEW (replaces loadLocal.ts) — remote-only loader
      Catalog.tsx                          # MODIFY — released list + upcoming section + downloaded pill
    player/
      PrefetchWarmer.ts                    # NEW — prefetch next-3 audio URLs
      PrefetchWarmer.test.ts               # NEW — unit tests
      playerStore.ts                       # MODIFY — instantiate and drive PrefetchWarmer
scripts/
  publish-episode.ts                       # NEW — CLI
  publish-episode.test.ts                  # NEW — fixture test
content/                                   # NEW — catalog seed (mostly authored, not code)
  catalog.json
  episodes/<id>/{cover.png,meta.json,manifest.json,audio/*.mp3}
episodes/                                  # DELETED — bundled JSONs and covers removed
```

## Tasks

1. Shared types, schemas, and config
2. `RemoteCatalog` module + tests
3. IPC handlers + preload bridge for `RemoteCatalog`
4. Renderer switches to remote catalog
5. `PrefetchWarmer` during playback
6. `DownloadedEpisodes` module + UI action
7. Remove bundled episode plumbing
8. `publish-episode.ts` CLI + tests
9. Seed `content/` and end-to-end smoke

---

### Task 1: Shared types, schemas, and config

**Files:**
- Create: `src/shared/config.ts`
- Create: `src/shared/meta.ts`
- Modify: `src/shared/manifest.ts` (voiceoverSchema gets optional `audio` field)
- Modify: `src/shared/catalog.ts` (add `remoteCatalogSchema`)
- Modify: `src/shared/ipcSchema.ts` (add channel constants)
- Test: `src/shared/meta.test.ts`

**Interfaces:**
- Produces:
  - `CONTENT_BASE_URL: string` — the default jsDelivr base URL (no trailing slash).
  - `episodeMetaSchema: ZodType<EpisodeMeta>`.
  - `EpisodeMeta = { schemaVersion: 1; artistName: string; albumName: string; blurb: string; palette: {bg: string; ink: string; accent: string}; releaseDate: string | null; expectedRelease: string | null }`.
  - `remoteCatalogSchema: ZodType<RemoteCatalogIndex>`.
  - `RemoteCatalogIndex = { schemaVersion: 1; updatedAt: string; episodes: RemoteCatalogEntry[] }`.
  - `RemoteCatalogEntry = { id: string; status: 'released' | 'upcoming'; releaseDate?: string; expectedRelease?: string; order: number }`.
  - New IPC channels: `RemoteCatalogList`, `RemoteCatalogRefresh`, `RemoteCatalogLoadEpisode`, `RemoteCatalogLoadMeta`, `RemoteCatalogCoverUrl`, `DownloadedList`, `DownloadedStart`, `DownloadedRemove`, `DownloadedIsDownloaded`.
- Consumes: nothing (foundational task).

- [ ] **Step 1: Create `src/shared/config.ts`**

```ts
// The GitHub owner hosting the /content directory. Replace with the actual owner.
const CONTENT_OWNER = 'REPLACE_ME_OWNER'
const CONTENT_REPO = 'deepcuts'
const CONTENT_REF = 'main'

// Default CDN base URL. Do not include a trailing slash.
// jsDelivr propagates ~10 min from git push; cache-bust with ?ts=<epoch> if needed.
export const CONTENT_BASE_URL_DEFAULT =
  `https://cdn.jsdelivr.net/gh/${CONTENT_OWNER}/${CONTENT_REPO}@${CONTENT_REF}/content`

// Runtime resolver — checks DEEPCUTS_CONTENT_BASE_URL env var for dev overrides.
// Main process only; renderer receives resolved URLs through IPC.
export function resolveContentBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.DEEPCUTS_CONTENT_BASE_URL?.trim()
  const url = override && override.length > 0 ? override : CONTENT_BASE_URL_DEFAULT
  return url.replace(/\/+$/, '')
}
```

Replace `REPLACE_ME_OWNER` before Task 9 (the seed task). Leave a `TODO(catalog):` comment on the constant if the owner isn't known yet — the plan can proceed with a placeholder.

- [ ] **Step 2: Write tests for `resolveContentBaseUrl` in `src/shared/config.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { resolveContentBaseUrl, CONTENT_BASE_URL_DEFAULT } from './config'

describe('resolveContentBaseUrl', () => {
  it('returns the default when env var is unset', () => {
    expect(resolveContentBaseUrl({})).toBe(CONTENT_BASE_URL_DEFAULT)
  })

  it('returns the env override when set', () => {
    expect(resolveContentBaseUrl({ DEEPCUTS_CONTENT_BASE_URL: 'http://localhost:8080/content' }))
      .toBe('http://localhost:8080/content')
  })

  it('strips trailing slashes', () => {
    expect(resolveContentBaseUrl({ DEEPCUTS_CONTENT_BASE_URL: 'http://x/y///' }))
      .toBe('http://x/y')
  })

  it('ignores empty env override', () => {
    expect(resolveContentBaseUrl({ DEEPCUTS_CONTENT_BASE_URL: '  ' }))
      .toBe(CONTENT_BASE_URL_DEFAULT)
  })
})
```

- [ ] **Step 3: Create `src/shared/meta.ts`**

```ts
import { z } from 'zod'

export const paletteSchema = z.object({
  bg: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  ink: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
})

export const episodeMetaSchema = z.object({
  schemaVersion: z.literal(1),
  artistName: z.string().min(1),
  albumName: z.string().min(1),
  blurb: z.string().min(1),
  palette: paletteSchema,
  releaseDate: z.string().nullable(),
  expectedRelease: z.string().nullable(),
}).strict()

export type EpisodeMeta = z.infer<typeof episodeMetaSchema>
export type Palette = z.infer<typeof paletteSchema>
```

- [ ] **Step 4: Write tests in `src/shared/meta.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { episodeMetaSchema } from './meta'

const valid = {
  schemaVersion: 1,
  artistName: 'Chet Baker',
  albumName: 'Almost Blue',
  blurb: 'A portrait of Chet Baker.',
  palette: { bg: '#e8e4d6', ink: '#0e2a44', accent: '#2f6ea1' },
  releaseDate: '2026-06-10',
  expectedRelease: null,
}

describe('episodeMetaSchema', () => {
  it('accepts a valid released meta', () => {
    expect(() => episodeMetaSchema.parse(valid)).not.toThrow()
  })

  it('accepts a valid upcoming meta', () => {
    expect(() => episodeMetaSchema.parse({
      ...valid, releaseDate: null, expectedRelease: '2027-Q1',
    })).not.toThrow()
  })

  it('rejects bad hex color', () => {
    expect(() => episodeMetaSchema.parse({
      ...valid, palette: { ...valid.palette, bg: 'not-a-color' },
    })).toThrow()
  })

  it('rejects empty strings', () => {
    expect(() => episodeMetaSchema.parse({ ...valid, artistName: '' })).toThrow()
  })

  it('rejects unknown fields (strict)', () => {
    expect(() => episodeMetaSchema.parse({ ...valid, extraField: 'x' })).toThrow()
  })
})
```

- [ ] **Step 5: Add optional `audio` to `voiceoverSchema` in `src/shared/manifest.ts`**

Locate the `voiceoverSchema` definition (currently lines 35-45) and add an `audio` field mirroring `narrationSegmentSchema.audio`:

```ts
const voiceoverSchema = z.object({
  id: z.string().min(1),
  hostId: z.string().min(1),
  text: z.string().min(1),
  atSeconds: z.number().min(0),
  duckTo: z.number().min(0).max(100).default(55),
  holdDuck: z.boolean().default(false),
  audio: z.string().url().or(z.string().startsWith('file:')).or(z.string().startsWith('/')).optional(),
})
```

- [ ] **Step 6: Add `remoteCatalogSchema` to `src/shared/catalog.ts`**

Append at the bottom of the file:

```ts
export const remoteCatalogEntrySchema = z.object({
  id: z.string().min(1),
  status: z.enum(['released', 'upcoming']),
  releaseDate: z.string().optional(),
  expectedRelease: z.string().optional(),
  order: z.number().int().nonnegative(),
})

export const remoteCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string(),
  episodes: z.array(remoteCatalogEntrySchema),
}).strict()

export type RemoteCatalogEntry = z.infer<typeof remoteCatalogEntrySchema>
export type RemoteCatalogIndex = z.infer<typeof remoteCatalogSchema>
```

- [ ] **Step 7: Add new IPC channel constants in `src/shared/ipcSchema.ts`**

Append inside the `IpcChannels` object:

```ts
  RemoteCatalogList: 'remoteCatalog:list',
  RemoteCatalogRefresh: 'remoteCatalog:refresh',
  RemoteCatalogLoadEpisode: 'remoteCatalog:loadEpisode',
  RemoteCatalogLoadMeta: 'remoteCatalog:loadMeta',
  RemoteCatalogCoverUrl: 'remoteCatalog:coverUrl',

  DownloadedList: 'downloaded:list',
  DownloadedStart: 'downloaded:start',
  DownloadedRemove: 'downloaded:remove',
  DownloadedIsDownloaded: 'downloaded:isDownloaded',
  DownloadedProgress: 'downloaded:progress',
```

- [ ] **Step 8: Run typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: all pre-existing tests pass; new schema tests pass. No implementation changes needed elsewhere yet.

- [ ] **Step 9: Commit**

```bash
git add src/shared/config.ts src/shared/config.test.ts src/shared/meta.ts src/shared/meta.test.ts \
        src/shared/manifest.ts src/shared/catalog.ts src/shared/ipcSchema.ts
git commit -m "catalog: shared config, meta schema, voiceover audio, remote catalog schema, IPC channels"
```

---

### Task 2: `RemoteCatalog` module

**Files:**
- Create: `src/main/catalog/RemoteCatalog.ts`
- Test: `src/main/catalog/RemoteCatalog.test.ts`

**Interfaces:**
- Consumes: `CONTENT_BASE_URL_DEFAULT`, `resolveContentBaseUrl` (Task 1), `remoteCatalogSchema` (Task 1), `episodeMetaSchema` (Task 1), `episodeManifestSchema` (existing).
- Produces:
  ```ts
  export interface RemoteCatalog {
    refresh(): Promise<RemoteCatalogIndex>              // fetch + write cache
    list(): Promise<RemoteCatalogIndex>                 // cache-first read
    loadMeta(id: string): Promise<EpisodeMeta>          // fetch + cache
    loadEpisode(id: string): Promise<EpisodeManifest>   // fetch + cache
    coverUrl(id: string): string                        // sync — direct CDN URL
    baseUrl(): string
  }
  export interface RemoteCatalogDeps {
    baseUrl: string
    cacheRoot: () => string                             // path to userData/cache
    fetcher?: typeof fetch                              // defaults to globalThis.fetch
    fs?: typeof import('node:fs/promises')              // defaults to node fs
  }
  export function createRemoteCatalog(deps: RemoteCatalogDeps): RemoteCatalog
  ```

- [ ] **Step 1: Write the tests first at `src/main/catalog/RemoteCatalog.test.ts`**

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createRemoteCatalog, type RemoteCatalogDeps } from './RemoteCatalog'
import type { RemoteCatalogIndex } from '../../shared/catalog'

function makeFakeFs() {
  const files = new Map<string, string>()
  return {
    files,
    fs: {
      readFile: vi.fn(async (p: string) => {
        const v = files.get(p)
        if (v === undefined) { const e: any = new Error('ENOENT'); e.code = 'ENOENT'; throw e }
        return v
      }),
      writeFile: vi.fn(async (p: string, data: string) => { files.set(p, data) }),
      mkdir: vi.fn(async () => undefined),
    } as any,
  }
}

function makeFetcher(responses: Record<string, unknown | Error>) {
  return vi.fn(async (url: string) => {
    const r = responses[url]
    if (r === undefined) throw new Error(`No fake response for ${url}`)
    if (r instanceof Error) throw r
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(r),
      json: async () => r,
    } as any
  })
}

const VALID_CATALOG: RemoteCatalogIndex = {
  schemaVersion: 1,
  updatedAt: '2026-07-09T00:00:00Z',
  episodes: [
    { id: 'almost-blue', status: 'released', releaseDate: '2026-06-10', order: 1 },
    { id: 'blood-on-the-tracks', status: 'upcoming', expectedRelease: '2027-Q1', order: 20 },
  ],
}

function defaults(overrides: Partial<RemoteCatalogDeps> = {}): RemoteCatalogDeps {
  const { fs } = makeFakeFs()
  return {
    baseUrl: 'https://cdn.example.com/content',
    cacheRoot: () => '/tmp/cache',
    fetcher: makeFetcher({ 'https://cdn.example.com/content/catalog.json': VALID_CATALOG }) as any,
    fs,
    ...overrides,
  }
}

describe('RemoteCatalog', () => {
  it('refresh() fetches catalog.json and writes it to cache', async () => {
    const { fs, files } = makeFakeFs()
    const fetcher = makeFetcher({ 'https://cdn.example.com/content/catalog.json': VALID_CATALOG })
    const rc = createRemoteCatalog({
      baseUrl: 'https://cdn.example.com/content',
      cacheRoot: () => '/tmp/cache',
      fetcher: fetcher as any,
      fs,
    })
    const result = await rc.refresh()
    expect(result.episodes).toHaveLength(2)
    expect(files.get('/tmp/cache/catalog.json')).toContain('almost-blue')
  })

  it('list() returns cached catalog when present without a fetch', async () => {
    const { fs, files } = makeFakeFs()
    files.set('/tmp/cache/catalog.json', JSON.stringify(VALID_CATALOG))
    const fetcher = vi.fn()
    const rc = createRemoteCatalog({
      baseUrl: 'https://cdn.example.com/content',
      cacheRoot: () => '/tmp/cache',
      fetcher: fetcher as any,
      fs,
    })
    const result = await rc.list()
    expect(result.episodes).toHaveLength(2)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('list() falls back to fetching when no cache exists', async () => {
    const rc = createRemoteCatalog(defaults())
    const result = await rc.list()
    expect(result.episodes).toHaveLength(2)
  })

  it('list() throws when both cache and network are unavailable', async () => {
    const { fs } = makeFakeFs()
    const fetcher = makeFetcher({
      'https://cdn.example.com/content/catalog.json': new Error('offline'),
    })
    const rc = createRemoteCatalog({
      baseUrl: 'https://cdn.example.com/content',
      cacheRoot: () => '/tmp/cache',
      fetcher: fetcher as any,
      fs,
    })
    await expect(rc.list()).rejects.toThrow(/no cached catalog/i)
  })

  it('loadMeta() fetches, validates strict, and caches', async () => {
    const meta = {
      schemaVersion: 1,
      artistName: 'Chet Baker',
      albumName: 'Almost Blue',
      blurb: 'A portrait.',
      palette: { bg: '#e8e4d6', ink: '#0e2a44', accent: '#2f6ea1' },
      releaseDate: '2026-06-10',
      expectedRelease: null,
    }
    const { fs, files } = makeFakeFs()
    const fetcher = makeFetcher({
      'https://cdn.example.com/content/episodes/almost-blue/meta.json': meta,
    })
    const rc = createRemoteCatalog({
      baseUrl: 'https://cdn.example.com/content',
      cacheRoot: () => '/tmp/cache',
      fetcher: fetcher as any,
      fs,
    })
    const result = await rc.loadMeta('almost-blue')
    expect(result.artistName).toBe('Chet Baker')
    expect(files.get('/tmp/cache/episodes/almost-blue/meta.json')).toContain('Chet Baker')
  })

  it('loadMeta() returns cached copy on subsequent calls', async () => {
    const { fs } = makeFakeFs()
    const meta = {
      schemaVersion: 1, artistName: 'X', albumName: 'Y', blurb: 'Z',
      palette: { bg: '#000000', ink: '#000000', accent: '#000000' },
      releaseDate: null, expectedRelease: 'Q3',
    }
    const fetcher = makeFetcher({ 'https://cdn.example.com/content/episodes/x/meta.json': meta })
    const rc = createRemoteCatalog({
      baseUrl: 'https://cdn.example.com/content',
      cacheRoot: () => '/tmp/cache',
      fetcher: fetcher as any,
      fs,
    })
    await rc.loadMeta('x')
    await rc.loadMeta('x')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('coverUrl() returns a direct CDN URL without fetching', () => {
    const rc = createRemoteCatalog(defaults())
    expect(rc.coverUrl('almost-blue'))
      .toBe('https://cdn.example.com/content/episodes/almost-blue/cover.png')
  })

  it('loadEpisode() fetches and caches manifest.json', async () => {
    const manifest = {
      schemaVersion: 1,
      id: 'almost-blue',
      title: 'Chet Baker',
      subject: 'Almost Blue',
      coverImage: 'cover.png',
      estimatedMinutes: 42,
      hosts: [{ id: 'h1', name: 'Host', persona: '', voiceRef: 'elevenlabs:x' }],
      chapters: [{ title: 'C1', segments: [
        { type: 'narration', id: 'n-01', hostId: 'h1', text: 'Hello.',
          audio: 'https://cdn.example.com/content/episodes/almost-blue/audio/n-01.mp3' },
      ]}],
      sources: [], facts: [],
    }
    const { fs, files } = makeFakeFs()
    const fetcher = makeFetcher({
      'https://cdn.example.com/content/episodes/almost-blue/manifest.json': manifest,
    })
    const rc = createRemoteCatalog({
      baseUrl: 'https://cdn.example.com/content',
      cacheRoot: () => '/tmp/cache',
      fetcher: fetcher as any,
      fs,
    })
    const result = await rc.loadEpisode('almost-blue')
    expect(result.id).toBe('almost-blue')
    expect(files.get('/tmp/cache/episodes/almost-blue/manifest.json')).toContain('almost-blue')
  })
})
```

- [ ] **Step 2: Run tests and verify they fail (module doesn't exist)**

Run: `npm test -- src/main/catalog/RemoteCatalog.test.ts`
Expected: fails with "cannot find module ./RemoteCatalog".

- [ ] **Step 3: Implement `src/main/catalog/RemoteCatalog.ts`**

```ts
import { promises as nodefs } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  remoteCatalogSchema,
  type RemoteCatalogIndex,
} from '../../shared/catalog'
import { episodeMetaSchema, type EpisodeMeta } from '../../shared/meta'
import { episodeManifestSchema, type EpisodeManifest } from '../../shared/manifest'

export interface RemoteCatalog {
  refresh(): Promise<RemoteCatalogIndex>
  list(): Promise<RemoteCatalogIndex>
  loadMeta(id: string): Promise<EpisodeMeta>
  loadEpisode(id: string): Promise<EpisodeManifest>
  coverUrl(id: string): string
  baseUrl(): string
}

export interface RemoteCatalogDeps {
  baseUrl: string
  cacheRoot: () => string
  fetcher?: typeof fetch
  fs?: Pick<typeof nodefs, 'readFile' | 'writeFile' | 'mkdir'>
}

export function createRemoteCatalog(deps: RemoteCatalogDeps): RemoteCatalog {
  const fetcher = deps.fetcher ?? (globalThis.fetch as typeof fetch)
  const fs = deps.fs ?? nodefs

  async function readCache(path: string): Promise<string | null> {
    try {
      return await fs.readFile(path, 'utf-8') as unknown as string
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async function writeCache(path: string, data: string): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, data, 'utf-8')
  }

  async function fetchJson(url: string): Promise<unknown> {
    const resp = await fetcher(url)
    if (!resp.ok) throw new Error(`Fetch ${url} failed: ${resp.status}`)
    return await resp.json()
  }

  function catalogCachePath() { return join(deps.cacheRoot(), 'catalog.json') }
  function metaCachePath(id: string) { return join(deps.cacheRoot(), 'episodes', id, 'meta.json') }
  function manifestCachePath(id: string) { return join(deps.cacheRoot(), 'episodes', id, 'manifest.json') }

  async function refresh(): Promise<RemoteCatalogIndex> {
    const raw = await fetchJson(`${deps.baseUrl}/catalog.json`)
    const parsed = remoteCatalogSchema.parse(raw)
    await writeCache(catalogCachePath(), JSON.stringify(parsed))
    return parsed
  }

  async function list(): Promise<RemoteCatalogIndex> {
    const cached = await readCache(catalogCachePath())
    if (cached !== null) {
      try { return remoteCatalogSchema.parse(JSON.parse(cached)) } catch { /* fall through to refresh */ }
    }
    try {
      return await refresh()
    } catch (err) {
      throw new Error('no cached catalog and network unavailable', { cause: err })
    }
  }

  async function loadMeta(id: string): Promise<EpisodeMeta> {
    const cachePath = metaCachePath(id)
    const cached = await readCache(cachePath)
    if (cached !== null) {
      try { return episodeMetaSchema.parse(JSON.parse(cached)) } catch { /* refetch */ }
    }
    const raw = await fetchJson(`${deps.baseUrl}/episodes/${id}/meta.json`)
    const parsed = episodeMetaSchema.parse(raw)
    await writeCache(cachePath, JSON.stringify(parsed))
    return parsed
  }

  async function loadEpisode(id: string): Promise<EpisodeManifest> {
    const cachePath = manifestCachePath(id)
    const cached = await readCache(cachePath)
    if (cached !== null) {
      try { return episodeManifestSchema.parse(JSON.parse(cached)) } catch { /* refetch */ }
    }
    const raw = await fetchJson(`${deps.baseUrl}/episodes/${id}/manifest.json`)
    const parsed = episodeManifestSchema.parse(raw)
    await writeCache(cachePath, JSON.stringify(parsed))
    return parsed
  }

  function coverUrl(id: string): string {
    return `${deps.baseUrl}/episodes/${id}/cover.png`
  }

  return { refresh, list, loadMeta, loadEpisode, coverUrl, baseUrl: () => deps.baseUrl }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/main/catalog/RemoteCatalog.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Run full test suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: all pre-existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/catalog/RemoteCatalog.ts src/main/catalog/RemoteCatalog.test.ts
git commit -m "catalog: RemoteCatalog module with fetch/cache and strict validation"
```

---

### Task 3: IPC handlers + preload bridge

**Files:**
- Modify: `src/main/ipc.ts` (register handlers; add `RemoteCatalog` + placeholder `DownloadedEpisodes` — the latter is stubbed here and filled in Task 6)
- Modify: `src/preload/index.ts` (expose APIs)
- Modify: `src/preload/api.d.ts` (types)

**Interfaces:**
- Consumes: `createRemoteCatalog` (Task 2), IPC channel constants (Task 1), `resolveContentBaseUrl` (Task 1).
- Produces:
  ```ts
  window.deepcuts.remoteCatalog = {
    list(): Promise<RemoteCatalogIndex>
    refresh(): Promise<RemoteCatalogIndex>
    loadEpisode(id: string): Promise<EpisodeManifest>
    loadMeta(id: string): Promise<EpisodeMeta>
    coverUrl(id: string): Promise<string>
  }
  ```

- [ ] **Step 1: Wire `RemoteCatalog` inside `registerIpc()` in `src/main/ipc.ts`**

Add near the top of `registerIpc()`, after the `spotify` instantiation:

```ts
import { createRemoteCatalog } from './catalog/RemoteCatalog'
import { resolveContentBaseUrl } from '../shared/config'
// ...
const remoteCatalog = createRemoteCatalog({
  baseUrl: resolveContentBaseUrl(),
  cacheRoot: () => join(app.getPath('userData'), 'cache'),
})
```

Register handlers below the existing `LibraryIsPublished` handler:

```ts
ipcMain.handle(IpcChannels.RemoteCatalogList, wrap(() => remoteCatalog.list()))
ipcMain.handle(IpcChannels.RemoteCatalogRefresh, wrap(() => remoteCatalog.refresh()))
ipcMain.handle(IpcChannels.RemoteCatalogLoadEpisode, wrap((id: string) => remoteCatalog.loadEpisode(id)))
ipcMain.handle(IpcChannels.RemoteCatalogLoadMeta, wrap((id: string) => remoteCatalog.loadMeta(id)))
ipcMain.handle(IpcChannels.RemoteCatalogCoverUrl, wrap(async (id: string) => remoteCatalog.coverUrl(id)))
```

- [ ] **Step 2: Expose the API in `src/preload/index.ts`**

Inside the `api = { ... }` object, add:

```ts
remoteCatalog: {
  list: () => invoke<import('../shared/catalog').RemoteCatalogIndex>(IpcChannels.RemoteCatalogList),
  refresh: () => invoke<import('../shared/catalog').RemoteCatalogIndex>(IpcChannels.RemoteCatalogRefresh),
  loadEpisode: (id: string) =>
    invoke<import('../shared/manifest').EpisodeManifest>(IpcChannels.RemoteCatalogLoadEpisode, id),
  loadMeta: (id: string) =>
    invoke<import('../shared/meta').EpisodeMeta>(IpcChannels.RemoteCatalogLoadMeta, id),
  coverUrl: (id: string) => invoke<string>(IpcChannels.RemoteCatalogCoverUrl, id),
},
```

- [ ] **Step 3: Add types in `src/preload/api.d.ts`**

Read the existing file first, then add the `remoteCatalog` property to the exposed interface:

```ts
remoteCatalog: {
  list: () => Promise<import('../shared/catalog').RemoteCatalogIndex>
  refresh: () => Promise<import('../shared/catalog').RemoteCatalogIndex>
  loadEpisode: (id: string) => Promise<import('../shared/manifest').EpisodeManifest>
  loadMeta: (id: string) => Promise<import('../shared/meta').EpisodeMeta>
  coverUrl: (id: string) => Promise<string>
}
```

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: passes. `npm test` still green.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/preload/index.ts src/preload/api.d.ts
git commit -m "catalog: IPC handlers and preload bridge for RemoteCatalog"
```

---

### Task 4: Renderer switches to remote catalog

**Files:**
- Create: `src/renderer/catalog/loadCatalog.ts` (replaces `loadLocal.ts`)
- Delete: `src/renderer/catalog/loadLocal.ts` (in the same commit)
- Modify: `src/renderer/catalog/Catalog.tsx`
- Modify: any file importing `loadUnifiedCatalog` (e.g., anywhere in renderer)

**Interfaces:**
- Consumes: `window.deepcuts.remoteCatalog.*` (Task 3), `window.deepcuts.library.*` (existing).
- Produces:
  ```ts
  export interface CatalogView {
    released: ReleasedEntry[]      // playable, ordered
    upcoming: UpcomingEntry[]      // showcase-only
    library: LibraryEntry[]        // user-published local
  }
  export interface ReleasedEntry {
    id: string; source: 'remote'
    coverUrl: string
    meta: EpisodeMeta
    releaseDate: string            // ISO date
  }
  export interface UpcomingEntry {
    id: string
    coverUrl: string
    meta: EpisodeMeta
    expectedRelease: string
  }
  // LibraryEntry stays as-is from the current UnifiedCatalogEntry with source: 'library'.
  export async function loadCatalog(): Promise<CatalogView>
  export async function loadEpisodeManifest(id: string, source: 'remote' | 'library'): Promise<EpisodeManifest>
  ```

- [ ] **Step 1: Create `src/renderer/catalog/loadCatalog.ts`**

```ts
import type { EpisodeManifest, LibrarySummary } from '../../shared/manifest'
import type { EpisodeMeta } from '../../shared/meta'
import { episodeManifestSchema } from '../../shared/manifest'

export interface ReleasedEntry {
  source: 'remote'
  id: string
  coverUrl: string
  meta: EpisodeMeta
  releaseDate: string
}

export interface UpcomingEntry {
  source: 'remote'
  id: string
  coverUrl: string
  meta: EpisodeMeta
  expectedRelease: string
}

export interface LibraryEntry {
  source: 'library'
  id: string
  title: string
  subject: string
  coverImage: string
  estimatedMinutes: number
}

export interface CatalogView {
  released: ReleasedEntry[]
  upcoming: UpcomingEntry[]
  library: LibraryEntry[]
}

export async function loadCatalog(): Promise<CatalogView> {
  const [index, libraryRaw] = await Promise.all([
    window.deepcuts.remoteCatalog.list(),
    window.deepcuts.library.list(),
  ])
  const sorted = [...index.episodes].sort((a, b) => a.order - b.order)

  const metaPairs = await Promise.all(sorted.map(async (e) => {
    const meta = await window.deepcuts.remoteCatalog.loadMeta(e.id)
    const coverUrl = await window.deepcuts.remoteCatalog.coverUrl(e.id)
    return { entry: e, meta, coverUrl }
  }))

  const released: ReleasedEntry[] = []
  const upcoming: UpcomingEntry[] = []
  for (const { entry, meta, coverUrl } of metaPairs) {
    if (entry.status === 'released' && entry.releaseDate) {
      released.push({ source: 'remote', id: entry.id, coverUrl, meta, releaseDate: entry.releaseDate })
    } else if (entry.status === 'upcoming') {
      upcoming.push({
        source: 'remote', id: entry.id, coverUrl, meta,
        expectedRelease: entry.expectedRelease ?? 'TBA',
      })
    }
  }

  const library: LibraryEntry[] = await Promise.all(
    (libraryRaw as LibrarySummary[]).map(async (l) => ({
      source: 'library' as const,
      id: l.libraryId,
      title: l.title,
      subject: l.subject,
      coverImage: (await window.deepcuts.library.coverUrl(l.libraryId)) ?? '',
      estimatedMinutes: l.estimatedMinutes,
    })),
  )

  return { released, upcoming, library }
}

export async function loadEpisodeManifestById(
  id: string,
  source: 'remote' | 'library',
): Promise<EpisodeManifest> {
  if (source === 'library') {
    const raw = await window.deepcuts.library.loadManifest(id)
    const manifest = episodeManifestSchema.parse(raw)
    const libraryCoverUrl = await window.deepcuts.library.coverUrl(id).catch(() => null)
    return libraryCoverUrl ? { ...manifest, coverImage: libraryCoverUrl } : manifest
  }
  return window.deepcuts.remoteCatalog.loadEpisode(id)
}
```

- [ ] **Step 2: Update `src/renderer/catalog/Catalog.tsx`**

Read the current `Catalog.tsx`, then:
- Replace the `loadUnifiedCatalog()` call with `loadCatalog()`.
- Render `released` and `library` entries in one section (as today), and `upcoming` in a separate section with distinct visual treatment (non-playable, e.g., mouse cursor doesn't change on hover; no click handler; a subtle "Coming soon" caption using `meta.expectedRelease`).
- Card content uses `meta.artistName`, `meta.albumName`, `meta.blurb` for remote entries; library entries keep the existing shape.
- Click on a released entry calls `loadEpisodeManifestById(id, 'remote')` and `playerStore.startWithManifest(...)`.

Concrete changes (the exact JSX depends on the existing markup — read `Catalog.tsx` and preserve the styling patterns). Structure:

```tsx
const [view, setView] = useState<CatalogView | null>(null)
useEffect(() => { loadCatalog().then(setView).catch(console.error) }, [])
if (!view) return <div>Loading…</div>

return (
  <div>
    <section aria-label="Library">
      {[...view.released, ...view.library].map((e) => (
        <EpisodeCard key={`${e.source}:${e.id}`} entry={e} onPlay={playEntry} />
      ))}
    </section>
    {view.upcoming.length > 0 && (
      <section aria-label="Upcoming">
        <h2>Upcoming</h2>
        {view.upcoming.map((e) => <UpcomingCard key={e.id} entry={e} />)}
      </section>
    )}
  </div>
)
```

Where `playEntry(entry)`:
```tsx
async function playEntry(entry: ReleasedEntry | LibraryEntry) {
  const manifest = await loadEpisodeManifestById(entry.id, entry.source)
  await playerStore.startWithManifest(manifest)
}
```

- [ ] **Step 3: Delete `src/renderer/catalog/loadLocal.ts` and grep for orphaned imports**

Run: `grep -r "loadUnifiedCatalog\|loadLocal" src/`
Expected: no matches after the change. Delete `src/renderer/catalog/loadLocal.ts`.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 5: Manual smoke test**

Set up a local static server for a fixture catalog:
```bash
mkdir -p /tmp/deepcuts-fixture/episodes/almost-blue
echo '{"schemaVersion":1,"updatedAt":"2026-07-09T00:00:00Z","episodes":[{"id":"almost-blue","status":"released","releaseDate":"2026-06-10","order":1}]}' > /tmp/deepcuts-fixture/catalog.json
echo '{"schemaVersion":1,"artistName":"Chet Baker","albumName":"Almost Blue","blurb":"...","palette":{"bg":"#e8e4d6","ink":"#0e2a44","accent":"#2f6ea1"},"releaseDate":"2026-06-10","expectedRelease":null}' > /tmp/deepcuts-fixture/episodes/almost-blue/meta.json
cp /path/to/any/cover.png /tmp/deepcuts-fixture/episodes/almost-blue/cover.png
cd /tmp/deepcuts-fixture && python3 -m http.server 8080 &
DEEPCUTS_CONTENT_BASE_URL=http://localhost:8080 npm run dev
```

Expected: Catalog view loads and shows a single "Chet Baker — Almost Blue" card with the cover.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/catalog/loadCatalog.ts src/renderer/catalog/Catalog.tsx
git rm src/renderer/catalog/loadLocal.ts
git commit -m "catalog: renderer switches to remote catalog, released + upcoming sections"
```

---

### Task 5: `PrefetchWarmer` during playback

**Files:**
- Create: `src/renderer/player/PrefetchWarmer.ts`
- Test: `src/renderer/player/PrefetchWarmer.test.ts`
- Modify: `src/renderer/player/playerStore.ts` (instantiate and drive the warmer at segment boundaries)

**Interfaces:**
- Consumes: `EpisodeManifest`, `flattenSegments` (existing), `FlatSegment`.
- Produces:
  ```ts
  export interface PrefetchWarmer {
    warm(flatSegments: FlatSegment[], currentIndex: number): void
    reset(): void
  }
  export function createPrefetchWarmer(deps: { fetcher?: typeof fetch }): PrefetchWarmer
  ```

- [ ] **Step 1: Write the test at `src/renderer/player/PrefetchWarmer.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { createPrefetchWarmer } from './PrefetchWarmer'
import type { FlatSegment } from '../../shared/manifest'

function narration(id: string, audio: string): FlatSegment {
  return {
    type: 'narration', id, hostId: 'h1', text: 'x', audio,
    chapterIndex: 0, chapterTitle: 'C', indexInEpisode: 0,
  }
}
function song(id: string): FlatSegment {
  return {
    type: 'song', id,
    track: { title: 't', artist: 'a', spotifyUri: 'spotify:track:x' },
    startAtSeconds: 0, playSeconds: 10,
    chapterIndex: 0, chapterTitle: 'C', indexInEpisode: 0,
  }
}

describe('PrefetchWarmer', () => {
  it('warms next 3 CDN audio URLs after currentIndex', () => {
    const fetcher = vi.fn(async () => new Response('', { status: 200 }))
    const w = createPrefetchWarmer({ fetcher: fetcher as any })
    const segs: FlatSegment[] = [
      narration('n-01', 'https://cdn/x/n-01.mp3'),
      narration('n-02', 'https://cdn/x/n-02.mp3'),
      narration('n-03', 'https://cdn/x/n-03.mp3'),
      narration('n-04', 'https://cdn/x/n-04.mp3'),
      narration('n-05', 'https://cdn/x/n-05.mp3'),
    ]
    w.warm(segs, 0)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher).toHaveBeenCalledWith('https://cdn/x/n-02.mp3', { cache: 'force-cache' })
    expect(fetcher).toHaveBeenCalledWith('https://cdn/x/n-03.mp3', { cache: 'force-cache' })
    expect(fetcher).toHaveBeenCalledWith('https://cdn/x/n-04.mp3', { cache: 'force-cache' })
  })

  it('skips song segments (Spotify handles them)', () => {
    const fetcher = vi.fn(async () => new Response('', { status: 200 }))
    const w = createPrefetchWarmer({ fetcher: fetcher as any })
    const segs: FlatSegment[] = [
      narration('n-01', 'https://cdn/x/n-01.mp3'),
      song('s-01'),
      narration('n-02', 'https://cdn/x/n-02.mp3'),
      song('s-02'),
      narration('n-03', 'https://cdn/x/n-03.mp3'),
    ]
    w.warm(segs, 0)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenCalledWith('https://cdn/x/n-02.mp3', { cache: 'force-cache' })
    expect(fetcher).toHaveBeenCalledWith('https://cdn/x/n-03.mp3', { cache: 'force-cache' })
  })

  it('skips segments without an audio URL (drafts, live-synth)', () => {
    const fetcher = vi.fn(async () => new Response('', { status: 200 }))
    const w = createPrefetchWarmer({ fetcher: fetcher as any })
    const segs: FlatSegment[] = [
      narration('n-01', ''),
      { ...narration('n-02', 'ignored'), audio: undefined } as unknown as FlatSegment,
      narration('n-03', 'https://cdn/x/n-03.mp3'),
    ]
    w.warm(segs, 0)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('https://cdn/x/n-03.mp3', { cache: 'force-cache' })
  })

  it('does not fetch a URL twice across warm() calls', () => {
    const fetcher = vi.fn(async () => new Response('', { status: 200 }))
    const w = createPrefetchWarmer({ fetcher: fetcher as any })
    const segs: FlatSegment[] = [
      narration('n-01', 'https://cdn/x/n-01.mp3'),
      narration('n-02', 'https://cdn/x/n-02.mp3'),
    ]
    w.warm(segs, 0)
    w.warm(segs, 0)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('reset() clears the seen set', () => {
    const fetcher = vi.fn(async () => new Response('', { status: 200 }))
    const w = createPrefetchWarmer({ fetcher: fetcher as any })
    const segs: FlatSegment[] = [narration('n-01', 'https://cdn/x/n-01.mp3')]
    w.warm(segs, -1)   // -1: warms starting from index 0
    w.reset()
    w.warm(segs, -1)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `npm test -- src/renderer/player/PrefetchWarmer.test.ts`
Expected: fails with "cannot find module".

- [ ] **Step 3: Implement `src/renderer/player/PrefetchWarmer.ts`**

```ts
import type { FlatSegment } from '../../shared/manifest'

const PREFETCH_AHEAD = 3

export interface PrefetchWarmer {
  warm(flatSegments: FlatSegment[], currentIndex: number): void
  reset(): void
}

export interface PrefetchWarmerDeps {
  fetcher?: typeof fetch
}

export function createPrefetchWarmer(deps: PrefetchWarmerDeps = {}): PrefetchWarmer {
  const fetcher = deps.fetcher ?? (globalThis.fetch as typeof fetch)
  const seen = new Set<string>()

  function collectNext(flatSegments: FlatSegment[], currentIndex: number): string[] {
    const urls: string[] = []
    for (let i = currentIndex + 1; i < flatSegments.length && urls.length < PREFETCH_AHEAD; i++) {
      const seg = flatSegments[i]
      if (!seg || seg.type !== 'narration') continue
      const audio = seg.audio
      if (!audio || audio.length === 0) continue
      urls.push(audio)
    }
    return urls
  }

  return {
    warm(flatSegments, currentIndex) {
      for (const url of collectNext(flatSegments, currentIndex)) {
        if (seen.has(url)) continue
        seen.add(url)
        void fetcher(url, { cache: 'force-cache' }).catch(() => {
          // best-effort; ignore failures — the actual play will surface real errors
        })
      }
    },
    reset() { seen.clear() },
  }
}
```

- [ ] **Step 4: Wire the warmer into `playerStore.ts`**

Read `src/renderer/player/playerStore.ts`, then:
- Import: `import { createPrefetchWarmer } from './PrefetchWarmer'`.
- Add a store-scoped instance: `const prefetch = createPrefetchWarmer({})`.
- On `startWithManifest`: `prefetch.reset(); prefetch.warm(flatSegments, -1)`.
- On advancing to segment index `i`: `prefetch.warm(flatSegments, i)`.

The exact hook points depend on the existing store structure — insert the calls at the two places where "playback started" and "advanced to next segment" are handled. If those calls are in `Scheduler.ts` rather than the store, move the wiring accordingly.

- [ ] **Step 5: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/player/PrefetchWarmer.ts src/renderer/player/PrefetchWarmer.test.ts \
        src/renderer/player/playerStore.ts
git commit -m "player: PrefetchWarmer warms next 3 CDN audio URLs during playback"
```

---

### Task 6: `DownloadedEpisodes` module + UI action

**Files:**
- Create: `src/main/downloaded/DownloadedEpisodes.ts`
- Test: `src/main/downloaded/DownloadedEpisodes.test.ts`
- Modify: `src/main/ipc.ts` (register handlers)
- Modify: `src/preload/index.ts` (expose API)
- Modify: `src/preload/api.d.ts` (types)
- Modify: `src/renderer/catalog/loadCatalog.ts` (surface `isDownloaded` on each released entry)
- Modify: `src/renderer/catalog/Catalog.tsx` (Download button + "Downloaded" pill)

**Interfaces:**
- Consumes: `RemoteCatalog` (Task 2), Node `fs/promises`, Node `path`.
- Produces:
  ```ts
  export interface DownloadedEpisodes {
    list(): Promise<string[]>                                     // downloaded episode IDs
    isDownloaded(id: string): Promise<boolean>
    start(id: string, onProgress?: (p: DownloadProgress) => void): Promise<void>
    remove(id: string): Promise<void>
    // When the id is downloaded, loadManifestLocal returns the local manifest
    // (audio URLs rewritten to file://). Otherwise resolves to null.
    loadManifestLocal(id: string): Promise<EpisodeManifest | null>
  }
  export interface DownloadProgress { total: number; done: number; currentUrl: string }
  export function createDownloadedEpisodes(deps: DownloadedEpisodesDeps): DownloadedEpisodes
  export interface DownloadedEpisodesDeps {
    downloadedRoot: () => string                                  // userData/downloaded
    catalog: Pick<RemoteCatalog, 'loadEpisode' | 'coverUrl' | 'loadMeta'>
    fetcher?: typeof fetch
    fs?: Pick<typeof import('node:fs/promises'), 'readFile'|'writeFile'|'mkdir'|'rm'|'stat'>
  }
  ```

- [ ] **Step 1: Write tests at `src/main/downloaded/DownloadedEpisodes.test.ts`**

Model the same fake-fs / fake-fetch harness as `RemoteCatalog.test.ts`. Cover: `isDownloaded` false initially; after `start()`, all audio URLs from the manifest are fetched (as ArrayBuffer / bytes) and written to disk; `loadManifestLocal` returns the manifest with `file://` audio URLs; `remove()` clears the dir and `isDownloaded()` returns false again; progress callbacks fire once per audio file.

```ts
import { describe, expect, it, vi } from 'vitest'
import { createDownloadedEpisodes } from './DownloadedEpisodes'
import type { EpisodeManifest } from '../../shared/manifest'

const FIXTURE_MANIFEST: EpisodeManifest = {
  schemaVersion: 1,
  id: 'almost-blue',
  title: 'Chet Baker',
  subject: 'Almost Blue',
  coverImage: 'cover.png',
  estimatedMinutes: 42,
  hosts: [{ id: 'h1', name: 'H', persona: '', voiceRef: 'elevenlabs:x' }],
  chapters: [{
    title: 'C1',
    segments: [
      { type: 'narration', id: 'n-01', hostId: 'h1', text: 'Hi',
        audio: 'https://cdn.example.com/content/episodes/almost-blue/audio/n-01.mp3' },
      { type: 'narration', id: 'n-02', hostId: 'h1', text: 'Hi2',
        audio: 'https://cdn.example.com/content/episodes/almost-blue/audio/n-02.mp3' },
    ],
  }],
  sources: [], facts: [],
}

function makeFakeFs() {
  const files = new Map<string, Uint8Array | string>()
  const dirs = new Set<string>()
  return {
    files, dirs,
    fs: {
      readFile: vi.fn(async (p: string) => {
        const v = files.get(p)
        if (v === undefined) { const e: any = new Error('ENOENT'); e.code = 'ENOENT'; throw e }
        return v as any
      }),
      writeFile: vi.fn(async (p: string, data: any) => { files.set(p, data) }),
      mkdir: vi.fn(async (p: string) => { dirs.add(p) }),
      rm: vi.fn(async (p: string) => {
        for (const key of [...files.keys()]) if (key.startsWith(p)) files.delete(key)
      }),
      stat: vi.fn(async (p: string) => {
        if (files.has(p) || dirs.has(p)) return { isDirectory: () => dirs.has(p) } as any
        const e: any = new Error('ENOENT'); e.code = 'ENOENT'; throw e
      }),
    } as any,
  }
}

describe('DownloadedEpisodes', () => {
  it('start() fetches all audio + cover + meta and writes to downloadedRoot', async () => {
    const { fs, files } = makeFakeFs()
    const fetcher = vi.fn(async (url: string) => ({
      ok: true, status: 200,
      arrayBuffer: async () => new Uint8Array([1,2,3]).buffer,
      text: async () => JSON.stringify({}),
      json: async () => ({}),
    } as any))
    const dl = createDownloadedEpisodes({
      downloadedRoot: () => '/dl',
      catalog: {
        loadEpisode: async () => FIXTURE_MANIFEST,
        coverUrl: () => 'https://cdn.example.com/content/episodes/almost-blue/cover.png',
        loadMeta: async () => ({
          schemaVersion: 1, artistName: 'X', albumName: 'Y', blurb: 'Z',
          palette: { bg: '#000000', ink: '#000000', accent: '#000000' },
          releaseDate: '2026-06-10', expectedRelease: null,
        }),
      },
      fetcher: fetcher as any,
      fs,
    })
    await dl.start('almost-blue')
    expect(files.has('/dl/almost-blue/audio/n-01.mp3')).toBe(true)
    expect(files.has('/dl/almost-blue/audio/n-02.mp3')).toBe(true)
    expect(files.has('/dl/almost-blue/cover.png')).toBe(true)
    expect(files.has('/dl/almost-blue/manifest.json')).toBe(true)
  })

  it('loadManifestLocal() returns null when not downloaded', async () => {
    const { fs } = makeFakeFs()
    const dl = createDownloadedEpisodes({
      downloadedRoot: () => '/dl',
      catalog: { loadEpisode: async () => FIXTURE_MANIFEST } as any,
      fetcher: (async () => ({} as any)) as any, fs,
    })
    expect(await dl.loadManifestLocal('almost-blue')).toBeNull()
  })

  it('loadManifestLocal() returns manifest with file:// audio URLs after download', async () => {
    const { fs, files } = makeFakeFs()
    const fetcher = vi.fn(async () => ({
      ok: true, status: 200,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    } as any))
    const dl = createDownloadedEpisodes({
      downloadedRoot: () => '/dl',
      catalog: {
        loadEpisode: async () => FIXTURE_MANIFEST,
        coverUrl: () => 'https://cdn.example.com/content/episodes/almost-blue/cover.png',
        loadMeta: async () => ({} as any),
      },
      fetcher: fetcher as any, fs,
    })
    await dl.start('almost-blue')
    const local = await dl.loadManifestLocal('almost-blue')
    expect(local).not.toBeNull()
    const audioUrls = local!.chapters.flatMap(c => c.segments)
      .filter(s => s.type === 'narration')
      .map(s => (s as any).audio)
    expect(audioUrls.every((u: string) => u.startsWith('file:///dl/almost-blue/audio/'))).toBe(true)
  })

  it('remove() clears the dir and isDownloaded returns false', async () => {
    const { fs } = makeFakeFs()
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array().buffer } as any))
    const dl = createDownloadedEpisodes({
      downloadedRoot: () => '/dl',
      catalog: { loadEpisode: async () => FIXTURE_MANIFEST, coverUrl: () => 'https://c', loadMeta: async () => ({} as any) } as any,
      fetcher: fetcher as any, fs,
    })
    await dl.start('almost-blue')
    expect(await dl.isDownloaded('almost-blue')).toBe(true)
    await dl.remove('almost-blue')
    expect(await dl.isDownloaded('almost-blue')).toBe(false)
  })

  it('start() reports progress once per audio file', async () => {
    const { fs } = makeFakeFs()
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array().buffer } as any))
    const dl = createDownloadedEpisodes({
      downloadedRoot: () => '/dl',
      catalog: { loadEpisode: async () => FIXTURE_MANIFEST, coverUrl: () => 'https://c', loadMeta: async () => ({} as any) } as any,
      fetcher: fetcher as any, fs,
    })
    const events: any[] = []
    await dl.start('almost-blue', (p) => events.push(p))
    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(events[events.length - 1].done).toBe(events[events.length - 1].total)
  })
})
```

- [ ] **Step 2: Run tests to see them fail**

Run: `npm test -- src/main/downloaded/DownloadedEpisodes.test.ts`
Expected: fails with "cannot find module".

- [ ] **Step 3: Implement `src/main/downloaded/DownloadedEpisodes.ts`**

```ts
import { promises as nodefs } from 'node:fs'
import { dirname, join } from 'node:path'
import { flattenSegments, type EpisodeManifest } from '../../shared/manifest'
import type { RemoteCatalog } from '../catalog/RemoteCatalog'

export interface DownloadProgress {
  total: number
  done: number
  currentUrl: string
}

export interface DownloadedEpisodes {
  list(): Promise<string[]>
  isDownloaded(id: string): Promise<boolean>
  start(id: string, onProgress?: (p: DownloadProgress) => void): Promise<void>
  remove(id: string): Promise<void>
  loadManifestLocal(id: string): Promise<EpisodeManifest | null>
}

export interface DownloadedEpisodesDeps {
  downloadedRoot: () => string
  catalog: Pick<RemoteCatalog, 'loadEpisode' | 'coverUrl' | 'loadMeta'>
  fetcher?: typeof fetch
  fs?: Pick<typeof nodefs, 'readFile' | 'writeFile' | 'mkdir' | 'rm' | 'stat'>
}

export function createDownloadedEpisodes(deps: DownloadedEpisodesDeps): DownloadedEpisodes {
  const fetcher = deps.fetcher ?? (globalThis.fetch as typeof fetch)
  const fs = deps.fs ?? nodefs

  function episodeDir(id: string) { return join(deps.downloadedRoot(), id) }
  function localManifestPath(id: string) { return join(episodeDir(id), 'manifest.json') }
  function localAudioPath(id: string, segmentId: string) { return join(episodeDir(id), 'audio', `${segmentId}.mp3`) }

  async function writeBytes(path: string, url: string): Promise<void> {
    const resp = await fetcher(url)
    if (!resp.ok) throw new Error(`Download ${url} failed: ${resp.status}`)
    const buf = new Uint8Array(await resp.arrayBuffer())
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, buf)
  }

  async function isDownloaded(id: string): Promise<boolean> {
    try { await fs.stat(localManifestPath(id)); return true } catch { return false }
  }

  async function list(): Promise<string[]> {
    // Presence of userData/downloaded/<id>/manifest.json defines "downloaded".
    // We don't scan the dir here (keeps this DI-friendly); the renderer asks per-id.
    // If a batch list is needed later, we can add fs.readdir here.
    return []
  }

  async function loadManifestLocal(id: string): Promise<EpisodeManifest | null> {
    try {
      const raw = await fs.readFile(localManifestPath(id), 'utf-8')
      return JSON.parse(raw as unknown as string) as EpisodeManifest
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async function start(id: string, onProgress?: (p: DownloadProgress) => void): Promise<void> {
    const manifest = await deps.catalog.loadEpisode(id)
    const flat = flattenSegments(manifest)
    const audioUrls: Array<{ segmentId: string; url: string }> = []
    for (const seg of flat) {
      if (seg.type === 'narration' && seg.audio) audioUrls.push({ segmentId: seg.id, url: seg.audio })
      if (seg.type === 'song' && seg.voiceovers) {
        for (const vo of seg.voiceovers) {
          if (vo.audio) audioUrls.push({ segmentId: vo.id, url: vo.audio })
        }
      }
    }
    const total = audioUrls.length + 1 // + cover
    let done = 0

    // Cover
    await writeBytes(join(episodeDir(id), 'cover.png'), deps.catalog.coverUrl(id))
    done++; onProgress?.({ total, done, currentUrl: 'cover.png' })

    // Audio
    for (const { segmentId, url } of audioUrls) {
      await writeBytes(localAudioPath(id, segmentId), url)
      done++; onProgress?.({ total, done, currentUrl: url })
    }

    // Rewrite manifest audio URLs to file:// pointing at the local paths, then write it.
    const localManifest: EpisodeManifest = {
      ...manifest,
      chapters: manifest.chapters.map((ch) => ({
        ...ch,
        segments: ch.segments.map((s) => {
          if (s.type === 'narration') {
            return { ...s, audio: `file://${localAudioPath(id, s.id)}` }
          }
          if (s.type === 'song' && s.voiceovers) {
            return {
              ...s,
              voiceovers: s.voiceovers.map((vo) =>
                vo.audio ? { ...vo, audio: `file://${localAudioPath(id, vo.id)}` } : vo,
              ),
            }
          }
          return s
        }),
      })),
    }
    await fs.mkdir(dirname(localManifestPath(id)), { recursive: true })
    await fs.writeFile(localManifestPath(id), JSON.stringify(localManifest), 'utf-8')
  }

  async function remove(id: string): Promise<void> {
    await fs.rm(episodeDir(id), { recursive: true, force: true } as any)
  }

  return { list, isDownloaded, start, remove, loadManifestLocal }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/main/downloaded/DownloadedEpisodes.test.ts`
Expected: all pass.

- [ ] **Step 5: Wire into `src/main/ipc.ts`**

Below the `remoteCatalog` instantiation:

```ts
import { createDownloadedEpisodes } from './downloaded/DownloadedEpisodes'

const downloaded = createDownloadedEpisodes({
  downloadedRoot: () => join(app.getPath('userData'), 'downloaded'),
  catalog: remoteCatalog,
})
```

Register handlers:

```ts
ipcMain.handle(IpcChannels.DownloadedIsDownloaded, wrap((id: string) => downloaded.isDownloaded(id)))
ipcMain.handle(IpcChannels.DownloadedRemove, wrap((id: string) => downloaded.remove(id)))
ipcMain.handle(IpcChannels.DownloadedStart, wrap(async (id: string) => {
  await downloaded.start(id, (p) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.DownloadedProgress, { id, ...p })
    }
  })
}))
```

Change `RemoteCatalogLoadEpisode` handler to prefer local:
```ts
ipcMain.handle(
  IpcChannels.RemoteCatalogLoadEpisode,
  wrap(async (id: string) => {
    const local = await downloaded.loadManifestLocal(id)
    if (local) return local
    return remoteCatalog.loadEpisode(id)
  }),
)
```

- [ ] **Step 6: Expose in preload (`src/preload/index.ts`)**

```ts
downloaded: {
  isDownloaded: (id: string) => invoke<boolean>(IpcChannels.DownloadedIsDownloaded, id),
  start: (id: string) => invoke<void>(IpcChannels.DownloadedStart, id),
  remove: (id: string) => invoke<void>(IpcChannels.DownloadedRemove, id),
  onProgress: (cb: (p: { id: string; total: number; done: number; currentUrl: string }) => void) => {
    const listener = (_e: unknown, payload: any) => cb(payload)
    ipcRenderer.on(IpcChannels.DownloadedProgress, listener)
    return () => ipcRenderer.off(IpcChannels.DownloadedProgress, listener)
  },
},
```

And add types in `src/preload/api.d.ts` matching the above.

- [ ] **Step 7: Add "Download for offline" affordance in `Catalog.tsx`**

In each released card's hover overlay (mirror the existing "Unpublish" pattern from library cards):
- Show a "Download for offline" button when `!isDownloaded`.
- Show a "Downloaded" pill + "Remove download" affordance when `isDownloaded`.
- Poll `isDownloaded(id)` for each released entry on catalog load; reflect in local component state.
- On click "Download for offline": call `window.deepcuts.downloaded.start(id)`, subscribe to `onProgress` to render a subtle progress bar in the card until done, then set the pill.

The pill styling matches the existing "YOURS" pill (`0.2em` tracking, uppercase, accent color).

- [ ] **Step 8: Run typecheck + all tests**

Run: `npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 9: Manual smoke — download an episode from the fixture server, then disconnect the network and replay**

With the fixture from Task 4 Step 5 still running:
1. Launch app, click "Download for offline" on Chet Baker.
2. Verify progress bar completes and the pill shows.
3. Kill the fixture server (`kill %1`).
4. Restart app. Click play — episode should play through end-to-end from the local cache with no network.

- [ ] **Step 10: Commit**

```bash
git add src/main/downloaded/DownloadedEpisodes.ts src/main/downloaded/DownloadedEpisodes.test.ts \
        src/main/ipc.ts src/preload/index.ts src/preload/api.d.ts \
        src/renderer/catalog/Catalog.tsx src/renderer/catalog/loadCatalog.ts
git commit -m "catalog: Download-for-offline retains full episode locally with rewritten manifest"
```

---

### Task 7: Remove bundled episode plumbing

**Files:**
- Delete: `episodes/blonde-on-blonde-60.json`, `episodes/marty-stuck-in-mobile.json`, `episodes/covers/blonde-on-blonde-60.png`, `episodes/covers/marty-stuck-in-mobile.png` (and any additional siblings).
- Modify: `src/main/ipc.ts` — remove `CatalogLoadLocal`, `ManifestLoad`, `CoverUrl` handlers; remove `episodesRoot()`.
- Modify: `src/preload/index.ts` — remove `catalog.loadLocal`, `manifest.load`, `assets.coverUrl` from the exposed API.
- Modify: `src/preload/api.d.ts` — remove matching types.
- Modify: `src/shared/ipcSchema.ts` — remove `CatalogLoadLocal`, `ManifestLoad`, `CoverUrl` constants.
- Modify: `src/shared/catalog.ts` — remove `catalogEntrySchema` / `catalogIndexSchema` if now unused (grep first).
- Modify: `electron.vite.config.ts` — if it copies `episodes/` into the packaged app, drop that step.

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new (this is a cleanup task).

- [ ] **Step 1: Confirm nothing outside `ipc.ts` reads bundled episode paths**

Run: `grep -rn "CatalogLoadLocal\|ManifestLoad\|episodesRoot\|catalogIndexSchema\|catalog.loadLocal\|manifest.load\|assets.coverUrl" src/`
Expected: matches only inside the files listed above, plus test files that need to be updated.

- [ ] **Step 2: Delete the bundled files**

```bash
git rm episodes/blonde-on-blonde-60.json episodes/marty-stuck-in-mobile.json
git rm episodes/covers/blonde-on-blonde-60.png episodes/covers/marty-stuck-in-mobile.png
```

If `episodes/covers/` is now empty:
```bash
rmdir episodes/covers episodes 2>/dev/null || true
```

- [ ] **Step 3: Remove the IPC handlers from `src/main/ipc.ts`**

Delete the handler blocks for `CatalogLoadLocal`, `ManifestLoad`, and `CoverUrl`, along with the `episodesRoot()` function at the top of the file.

- [ ] **Step 4: Remove matching preload entries**

In `src/preload/index.ts`, delete these blocks:
```ts
catalog: { loadLocal: ... },
manifest: { load: ... },
assets: { coverUrl: ... },
```
Do the same in `src/preload/api.d.ts`.

- [ ] **Step 5: Remove the channel constants and unused schemas**

In `src/shared/ipcSchema.ts`, delete `CatalogLoadLocal`, `ManifestLoad`, `CoverUrl` entries.

In `src/shared/catalog.ts`, delete `catalogEntrySchema`, `catalogIndexSchema`, and their types if grep confirms nothing else uses them. If `prerender` or `drafts` still reference them, keep them and note in a comment.

- [ ] **Step 6: Update `electron.vite.config.ts` if needed**

Read the file. If it declares a `copy` or `resource` for the `episodes/` directory (for `process.resourcesPath` at runtime), remove that block. Otherwise no change needed.

- [ ] **Step 7: Run typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: all pass. If tests fail because they reference removed IPC channels or bundled paths, update those tests to point at the fixture-based `RemoteCatalog` flow.

- [ ] **Step 8: Manual smoke — the app boots against the fixture and shows only remote content**

```bash
DEEPCUTS_CONTENT_BASE_URL=http://localhost:8080 npm run dev
```
Expected: Catalog view loads. No bundled episodes shown. No console errors about missing files under `episodes/`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "catalog: remove bundled episode plumbing; app is now all-remote"
```

---

### Task 8: `publish-episode.ts` CLI + tests

**Files:**
- Create: `scripts/publish-episode.ts`
- Create: `scripts/publish-episode.test.ts`
- Modify: `package.json` (add `publish-episode` script)

**Interfaces:**
- Consumes: existing `prerenderDraft` (in `src/main/prerender.ts`), `draftManifestSchema` / `episodeManifestSchema` (existing), `episodeMetaSchema` (Task 1), `resolveContentBaseUrl` (Task 1), Node `fs`, `path`.
- Produces: a CLI. `publishEpisode(args)` is exported for testing.

- [ ] **Step 1: Write the fixture test at `scripts/publish-episode.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { publishEpisode } from './publish-episode'
import type { DraftManifest } from '../src/shared/manifest'

const DRAFT: DraftManifest = {
  schemaVersion: 1,
  id: 'almost-blue',
  title: 'Chet Baker',
  subject: 'Almost Blue',
  coverImage: 'cover.png',
  estimatedMinutes: 42,
  hosts: [{ id: 'h1', name: 'H', persona: '', voiceRef: 'elevenlabs:vX' }],
  chapters: [{
    title: 'C1',
    segments: [
      { type: 'narration', id: 'n-01', hostId: 'h1', text: 'Hello.' },
      { type: 'narration', id: 'n-02', hostId: 'h1', text: 'World.' },
    ],
  }],
  sources: [], facts: [],
}

function makeFakeFs() {
  const files = new Map<string, string | Uint8Array>()
  return {
    files,
    fs: {
      readFile: vi.fn(async (p: string) => {
        const v = files.get(p)
        if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        return v as any
      }),
      writeFile: vi.fn(async (p: string, data: any) => { files.set(p, data) }),
      mkdir: vi.fn(async () => undefined),
      copyFile: vi.fn(async (src: string, dst: string) => { files.set(dst, files.get(src) ?? '') }),
    } as any,
  }
}

describe('publishEpisode', () => {
  it('for an upcoming episode: writes only cover + meta, updates catalog', async () => {
    const { fs, files } = makeFakeFs()
    files.set('/drafts/almost-blue/manifest.json', JSON.stringify(DRAFT))
    files.set('/drafts/almost-blue/cover.png', new Uint8Array([1,2,3]))
    files.set('/drafts/almost-blue/meta.json', JSON.stringify({
      schemaVersion: 1, artistName: 'Chet Baker', albumName: 'Almost Blue', blurb: 'A portrait.',
      palette: { bg: '#e8e4d6', ink: '#0e2a44', accent: '#2f6ea1' },
      releaseDate: null, expectedRelease: '2027-Q1',
    }))
    files.set('/content/catalog.json', JSON.stringify({
      schemaVersion: 1, updatedAt: '2026-07-09T00:00:00Z', episodes: [],
    }))

    await publishEpisode({
      draftDir: '/drafts/almost-blue',
      contentDir: '/content',
      status: 'upcoming',
      order: 5,
      today: () => '2026-07-09',
      synthesize: vi.fn(),
      fs,
      baseUrl: 'https://cdn.example.com/content',
    })

    expect(files.has('/content/episodes/almost-blue/cover.png')).toBe(true)
    expect(files.has('/content/episodes/almost-blue/meta.json')).toBe(true)
    expect(files.has('/content/episodes/almost-blue/manifest.json')).toBe(false)
    const catalog = JSON.parse(files.get('/content/catalog.json') as string)
    expect(catalog.episodes).toContainEqual(expect.objectContaining({
      id: 'almost-blue', status: 'upcoming', order: 5, expectedRelease: '2027-Q1',
    }))
  })

  it('for a released episode: pre-renders audio, rewrites URLs, writes manifest', async () => {
    const { fs, files } = makeFakeFs()
    files.set('/drafts/almost-blue/manifest.json', JSON.stringify(DRAFT))
    files.set('/drafts/almost-blue/cover.png', new Uint8Array([1,2,3]))
    files.set('/drafts/almost-blue/meta.json', JSON.stringify({
      schemaVersion: 1, artistName: 'Chet Baker', albumName: 'Almost Blue', blurb: 'A portrait.',
      palette: { bg: '#e8e4d6', ink: '#0e2a44', accent: '#2f6ea1' },
      releaseDate: '2026-06-10', expectedRelease: null,
    }))
    files.set('/content/catalog.json', JSON.stringify({
      schemaVersion: 1, updatedAt: '2026-07-09T00:00:00Z', episodes: [],
    }))
    const synthesize = vi.fn(async (_text: string, _voiceRef: string, opts: { segmentId: string }) => ({
      filePath: `/synth-cache/${opts.segmentId}.mp3`, cached: false,
    }))
    // Fake the synth output bytes so copyFile can move them.
    files.set('/synth-cache/n-01.mp3', new Uint8Array([9]))
    files.set('/synth-cache/n-02.mp3', new Uint8Array([9]))

    await publishEpisode({
      draftDir: '/drafts/almost-blue',
      contentDir: '/content',
      status: 'released',
      order: 1,
      today: () => '2026-07-09',
      synthesize,
      fs,
      baseUrl: 'https://cdn.example.com/content',
    })

    expect(files.has('/content/episodes/almost-blue/audio/n-01.mp3')).toBe(true)
    expect(files.has('/content/episodes/almost-blue/audio/n-02.mp3')).toBe(true)
    const manifestOut = JSON.parse(files.get('/content/episodes/almost-blue/manifest.json') as string)
    const audio0 = manifestOut.chapters[0].segments[0].audio
    expect(audio0).toBe('https://cdn.example.com/content/episodes/almost-blue/audio/n-01.mp3')
    const catalog = JSON.parse(files.get('/content/catalog.json') as string)
    expect(catalog.episodes[0]).toMatchObject({
      id: 'almost-blue', status: 'released', releaseDate: '2026-07-09', order: 1,
    })
  })

  it('re-publish overwrites in place and preserves order unless overridden', async () => {
    const { fs, files } = makeFakeFs()
    files.set('/drafts/almost-blue/manifest.json', JSON.stringify(DRAFT))
    files.set('/drafts/almost-blue/cover.png', new Uint8Array([1]))
    files.set('/drafts/almost-blue/meta.json', JSON.stringify({
      schemaVersion: 1, artistName: 'X', albumName: 'Y', blurb: 'Z',
      palette: { bg: '#000000', ink: '#000000', accent: '#000000' },
      releaseDate: '2026-06-10', expectedRelease: null,
    }))
    files.set('/content/catalog.json', JSON.stringify({
      schemaVersion: 1, updatedAt: '2026-07-09T00:00:00Z',
      episodes: [{ id: 'almost-blue', status: 'released', releaseDate: '2026-06-01', order: 7 }],
    }))
    const synthesize = vi.fn(async (_t: string, _v: string, opts: any) => ({
      filePath: `/synth-cache/${opts.segmentId}.mp3`, cached: true,
    }))
    files.set('/synth-cache/n-01.mp3', new Uint8Array())
    files.set('/synth-cache/n-02.mp3', new Uint8Array())

    await publishEpisode({
      draftDir: '/drafts/almost-blue',
      contentDir: '/content',
      status: 'released',
      today: () => '2026-07-09',
      synthesize, fs, baseUrl: 'https://cdn.example.com/content',
    })

    const catalog = JSON.parse(files.get('/content/catalog.json') as string)
    expect(catalog.episodes[0].order).toBe(7)
  })
})
```

- [ ] **Step 2: Run the test to see it fail**

Run: `npm test -- scripts/publish-episode.test.ts`
Expected: fails with "cannot find module ./publish-episode".

- [ ] **Step 3: Implement `scripts/publish-episode.ts`**

```ts
import { promises as nodefs } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  episodeManifestSchema,
  flattenSegments,
  type DraftManifest,
  type EpisodeManifest,
} from '../src/shared/manifest'
import { episodeMetaSchema, type EpisodeMeta } from '../src/shared/meta'
import { remoteCatalogSchema, type RemoteCatalogIndex } from '../src/shared/catalog'
import { resolveContentBaseUrl } from '../src/shared/config'
import type { SynthFn } from '../src/main/prerender'

export interface PublishEpisodeArgs {
  draftDir: string             // e.g., "~/Library/Application Support/deepcuts/drafts/<id>"
  contentDir: string           // e.g., "<repo>/content"
  status: 'released' | 'upcoming'
  order?: number
  today?: () => string         // yyyy-mm-dd; overridable for tests
  synthesize?: SynthFn         // required if status === "released"
  fs?: Pick<typeof nodefs, 'readFile'|'writeFile'|'mkdir'|'copyFile'>
  baseUrl?: string             // override CONTENT_BASE_URL for URL rewriting
}

export async function publishEpisode(args: PublishEpisodeArgs): Promise<void> {
  const fs = args.fs ?? nodefs
  const baseUrl = args.baseUrl ?? resolveContentBaseUrl()
  const today = (args.today ?? (() => new Date().toISOString().slice(0, 10)))()

  const draftRaw = await fs.readFile(join(args.draftDir, 'manifest.json'), 'utf-8')
  const draft = JSON.parse(draftRaw as unknown as string) as DraftManifest
  const id = draft.id
  const episodeDir = join(args.contentDir, 'episodes', id)

  // Copy cover + meta unconditionally (both released and upcoming need them).
  await fs.mkdir(episodeDir, { recursive: true })
  await fs.copyFile(join(args.draftDir, 'cover.png'), join(episodeDir, 'cover.png'))

  const metaRaw = await fs.readFile(join(args.draftDir, 'meta.json'), 'utf-8')
  const meta: EpisodeMeta = episodeMetaSchema.parse(JSON.parse(metaRaw as unknown as string))
  await fs.writeFile(join(episodeDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')

  if (args.status === 'released') {
    if (!args.synthesize) throw new Error('synthesize is required for released episodes')
    // Strict-validate before we spend time on TTS.
    episodeManifestSchema.parse(draft)

    const flat = flattenSegments(draft as unknown as EpisodeManifest)
    for (const seg of flat) {
      if (seg.type === 'narration' && seg.text) {
        const host = draft.hosts.find((h) => h.id === seg.hostId)!
        const { filePath } = await args.synthesize(seg.text, host.voiceRef, {
          segmentId: seg.id, modelId: host.ttsModel,
        })
        await fs.mkdir(join(episodeDir, 'audio'), { recursive: true })
        await fs.copyFile(filePath, join(episodeDir, 'audio', `${seg.id}.mp3`))
      }
      if (seg.type === 'song' && seg.voiceovers) {
        for (const vo of seg.voiceovers) {
          const host = draft.hosts.find((h) => h.id === vo.hostId)!
          const { filePath } = await args.synthesize(vo.text, host.voiceRef, {
            segmentId: vo.id, modelId: host.ttsModel,
          })
          await fs.copyFile(filePath, join(episodeDir, 'audio', `${vo.id}.mp3`))
        }
      }
    }

    // Rewrite audio URLs to CDN.
    const rewrittenManifest: EpisodeManifest = {
      ...(draft as unknown as EpisodeManifest),
      chapters: draft.chapters.map((ch) => ({
        ...ch,
        segments: ch.segments.map((s) => {
          if (s.type === 'narration') {
            return { ...s, audio: `${baseUrl}/episodes/${id}/audio/${s.id}.mp3` }
          }
          if (s.type === 'song' && s.voiceovers) {
            return {
              ...s,
              voiceovers: s.voiceovers.map((vo) => ({
                ...vo, audio: `${baseUrl}/episodes/${id}/audio/${vo.id}.mp3`,
              })),
            }
          }
          return s
        }),
      })),
    } as EpisodeManifest
    episodeManifestSchema.parse(rewrittenManifest)
    await fs.writeFile(
      join(episodeDir, 'manifest.json'),
      JSON.stringify(rewrittenManifest, null, 2), 'utf-8',
    )
  }

  // Update catalog.json.
  const catalogPath = join(args.contentDir, 'catalog.json')
  const catalogRaw = await fs.readFile(catalogPath, 'utf-8')
  const catalog: RemoteCatalogIndex = remoteCatalogSchema.parse(JSON.parse(catalogRaw as unknown as string))
  const existing = catalog.episodes.find((e) => e.id === id)
  const orderValue = args.order ?? existing?.order ?? (catalog.episodes.reduce((m, e) => Math.max(m, e.order), 0) + 1)

  const entry = args.status === 'released'
    ? { id, status: 'released' as const, releaseDate: today, order: orderValue }
    : {
        id, status: 'upcoming' as const,
        expectedRelease: meta.expectedRelease ?? 'TBA',
        order: orderValue,
      }

  const others = catalog.episodes.filter((e) => e.id !== id)
  const next: RemoteCatalogIndex = {
    schemaVersion: 1,
    updatedAt: `${today}T00:00:00Z`,
    episodes: [...others, entry].sort((a, b) => a.order - b.order),
  }
  await fs.writeFile(catalogPath, JSON.stringify(next, null, 2), 'utf-8')

  console.log(`Published ${id} (${args.status}, order ${orderValue}).`)
  console.log(`Suggested commit: git add content/ && git commit -m "content: publish ${id}"`)
}

// CLI entry point.
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k: string) => {
    const i = process.argv.indexOf(`--${k}`)
    return i >= 0 ? process.argv[i + 1] : undefined
  }
  const draftId = arg('draft')
  const status = (arg('status') ?? 'released') as 'released' | 'upcoming'
  const order = arg('order') ? Number(arg('order')) : undefined
  if (!draftId) { console.error('Usage: publish-episode --draft <id> [--status released|upcoming] [--order N]'); process.exit(1) }
  const home = process.env.HOME ?? ''
  const draftDir = join(home, 'Library/Application Support/deepcuts/drafts', draftId)
  const contentDir = join(process.cwd(), 'content')
  // For CLI usage, the synth pipeline needs to be wired to the real ElevenLabs client;
  // route through the same pipeline the app uses. Left as a follow-up if this CLI needs
  // to run headlessly; for the initial version, invoke pre-render from within the app
  // via the existing PrerenderStart IPC and then run this script with --skip-prerender.
  // For released without --skip-prerender: fail with a clear message.
  publishEpisode({
    draftDir, contentDir, status, order,
    synthesize: async () => { throw new Error(
      'Live synthesis from CLI is not wired yet. Pre-render from the app first via the ' +
      'Prerender action, then re-run this script — it will pick up the cached MP3s from ' +
      "userData/narration-cache. TODO(catalog): add --from-narration-cache flag.",
    )},
  }).catch((err) => { console.error(err); process.exit(1) })
}
```

Note: the CLI wiring for the released case is intentionally shallow — the plan proves the mechanism with the test, and the CLI's synth integration can be tightened in a follow-up. `--status upcoming` works end-to-end from the CLI today.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- scripts/publish-episode.test.ts`
Expected: all pass.

- [ ] **Step 5: Add npm script to `package.json`**

Under `"scripts"`:
```json
"publish-episode": "tsx scripts/publish-episode.ts"
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add scripts/publish-episode.ts scripts/publish-episode.test.ts package.json
git commit -m "catalog: publish-episode CLI writes to /content and updates catalog.json"
```

---

### Task 9: Seed `content/` and end-to-end smoke

**Files:**
- Create: `content/catalog.json`
- Create: `content/episodes/<id>/cover.png` + `content/episodes/<id>/meta.json` for each of the 20 episodes in the roster (see spec § Roster reference).

**Interfaces:** none. This task exists to produce a working end state that the plan's DoD can verify.

**Note:** The four "released" episodes (Chet Baker, Townes, Bill Withers, John Martyn) do not have written manifests + audio yet at plan-execution time. The catalog can only mark an episode "released" once its manifest + audio exist under `content/episodes/<id>/`. So the achievable seed for this plan is:

- All 20 episodes get `cover.png` + `meta.json` in `content/episodes/<id>/`.
- All 20 start as `status: "upcoming"` in `catalog.json`.
- As each released episode is later drafted + pre-rendered + published via `publish-episode.ts --status released`, its entry flips.

- [ ] **Step 1: Author `content/catalog.json` with all 20 episodes as `upcoming`**

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-07-09T00:00:00Z",
  "episodes": [
    { "id": "almost-blue", "status": "upcoming", "expectedRelease": "Summer 2026", "order": 1 },
    { "id": "waiting-around-to-die", "status": "upcoming", "expectedRelease": "Summer 2026", "order": 2 },
    { "id": "bill-withers-carnegie", "status": "upcoming", "expectedRelease": "Summer 2026", "order": 3 },
    { "id": "solid-air", "status": "upcoming", "expectedRelease": "Summer 2026", "order": 4 },
    { "id": "blonde-on-blonde", "status": "upcoming", "expectedRelease": "Autumn 2026", "order": 5 },
    { "id": "heart-of-saturday-night", "status": "upcoming", "expectedRelease": "Autumn 2026", "order": 6 },
    { "id": "dusk", "status": "upcoming", "expectedRelease": "Autumn 2026", "order": 7 },
    { "id": "five-leaves-left", "status": "upcoming", "expectedRelease": "Winter 2026", "order": 8 },
    { "id": "small-change", "status": "upcoming", "expectedRelease": "Winter 2026", "order": 9 },
    { "id": "strangeways", "status": "upcoming", "expectedRelease": "Winter 2026", "order": 10 },
    { "id": "prince-of-darkness", "status": "upcoming", "expectedRelease": "2027-Q1", "order": 11 },
    { "id": "there-goes-rhymin-simon", "status": "upcoming", "expectedRelease": "2027-Q1", "order": 12 },
    { "id": "mad-dogs-and-englishmen", "status": "upcoming", "expectedRelease": "2027-Q1", "order": 13 },
    { "id": "rumours", "status": "upcoming", "expectedRelease": "2027-Q2", "order": 14 },
    { "id": "music-from-big-pink", "status": "upcoming", "expectedRelease": "2027-Q2", "order": 15 },
    { "id": "blue", "status": "upcoming", "expectedRelease": "2027-Q2", "order": 16 },
    { "id": "tapestry", "status": "upcoming", "expectedRelease": "2027-Q3", "order": 17 },
    { "id": "i-never-loved-a-man", "status": "upcoming", "expectedRelease": "2027-Q3", "order": 18 },
    { "id": "nebraska", "status": "upcoming", "expectedRelease": "2027-Q3", "order": 19 },
    { "id": "blood-on-the-tracks", "status": "upcoming", "expectedRelease": "2027-Q4", "order": 20 }
  ]
}
```

- [ ] **Step 2: For each episode ID, create `content/episodes/<id>/cover.png` and `content/episodes/<id>/meta.json`**

Place the 1200×1200 cover art PNG at `content/episodes/<id>/cover.png` (the user supplies covers as they're produced — Task 9 is the mechanical part; you'll need at least the 4 released episodes' covers to make the smoke meaningful).

Template `meta.json` (fill per episode):

```json
{
  "schemaVersion": 1,
  "artistName": "Chet Baker",
  "albumName": "Almost Blue",
  "blurb": "A portrait of Chet Baker. The music. The silence. The beauty. And the blues that never left.",
  "palette": { "bg": "#e8e4d6", "ink": "#0e2a44", "accent": "#2f6ea1" },
  "releaseDate": null,
  "expectedRelease": "Summer 2026"
}
```

Repeat for the other 19 episodes with correct `artistName`, `albumName`, `blurb`, and palette (approximate the dominant tones of each cover).

- [ ] **Step 3: Verify each meta parses against the schema**

Write a small node script or use a REPL:
```bash
node --input-type=module -e "
import { readFile, readdir } from 'node:fs/promises'
import { episodeMetaSchema } from './src/shared/meta.js'
const dirs = await readdir('content/episodes')
for (const d of dirs) {
  const raw = await readFile(\`content/episodes/\${d}/meta.json\`, 'utf-8')
  episodeMetaSchema.parse(JSON.parse(raw))
  console.log('OK', d)
}
"
```
Expected: prints "OK <id>" for each of the 20.

- [ ] **Step 4: Point the app at the local `content/` and smoke-test**

Run a local static server from the repo root:
```bash
npx http-server -p 8080 .
# in another terminal:
DEEPCUTS_CONTENT_BASE_URL=http://localhost:8080/content npm run dev
```
Expected: Catalog view shows the "Library" section empty (no released episodes yet) and the "Upcoming" section with 20 cards, each showing its cover art and artist/album lines.

- [ ] **Step 5: Verify full DoD checklist**

Run all three:
```bash
npm run typecheck
npm test
npm run build
```
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add content/
git commit -m "content: seed catalog with 20 upcoming episodes and per-episode covers/meta"
```

---

## Self-Review

**Spec coverage:**
- Hosting model (§ Hosting model) — Task 1 sets `CONTENT_BASE_URL` + env override; Task 2's `RemoteCatalog` uses it.
- Directory layout (§ Directory layout) — Tasks 8 (writes it) + 9 (seeds it) enforce it.
- `catalog.json` shape (§ `catalog.json` shape) — Task 1's `remoteCatalogSchema` locks the structure; Task 9 populates it.
- `meta.json` shape (§ `meta.json` shape) — Task 1's `episodeMetaSchema`; Task 9 populates it.
- Manifest voiceover.audio addition (§ Manifest changes) — Task 1 Step 5.
- `RemoteCatalog` module (§ App changes) — Task 2.
- IPC + preload (§ App changes) — Task 3.
- Renderer switches (§ App changes) — Task 4.
- Prefetch-3 (§ App changes → Play flow) — Task 5.
- Download-for-offline (§ App changes → Download-for-offline) — Task 6.
- Bundled removal (§ App changes → Bundled episodes go away) — Task 7.
- Live synthesis stays for drafts (§ App changes → Live ElevenLabs synthesis stays) — Preserved by keeping the existing `NarrationPlayer.play()` path; nothing in this plan touches the draft/preview path.
- Publish flow (§ Publish flow) — Task 8; the released-from-CLI path has a documented limitation (synth pipeline not headless — flagged inline in Task 8 Step 3 as a `TODO(catalog):`); upcoming-status flow is complete.
- Testing (§ Testing) — Tasks 1, 2, 5, 6, 8 all include Vitest coverage; integration smoke steps in Tasks 4, 6, 9 exercise the end-to-end path.
- Definition of done items 1–8 — All eight DoD bullets have at least one task step that produces the artifact.

**Placeholder scan:** One documented placeholder remains — `REPLACE_ME_OWNER` in `src/shared/config.ts` (Task 1 Step 1). This is deliberate and called out inline: the GitHub owner is set at deploy time by the operator, not at plan-execution time.

**Type consistency:** All names line up — `RemoteCatalog` / `createRemoteCatalog` / `RemoteCatalogDeps` in Tasks 2, 3, 6; `EpisodeMeta` / `episodeMetaSchema` / `paletteSchema` in Tasks 1, 4, 6, 8; `RemoteCatalogIndex` / `RemoteCatalogEntry` in Tasks 1, 2, 4, 8. Prefetch skips song segments (Task 5) matching the spec's "Songs skip — Spotify" clause.

**Scope check:** Nine tasks; each ends with a testable, commit-worthy deliverable; each is small enough to hold in one head. Task 6 is the largest but genuinely single-responsibility (one module + its IPC + one UI affordance). No task straddles multiple subsystems needing coordination.

---

Plan complete and saved to `docs/superpowers/plans/2026-07-09-content-catalog.md`.
