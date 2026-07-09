# Editor Shell + Drafts Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app Editor mode that manages draft episodes — create empty, duplicate from a bundled episode, edit any manifest field via a form-based UI, preview in the existing player, delete. Lands the substrate for later specs (generation, artifacts, timeline, publish).

**Architecture:** A new `editor/` directory in the renderer with its own Zustand store and form components. A new `drafts.ts` module in the main process owns CRUD over `userData/drafts/<id>/`. A small `appStore` toggles between `library` and `editor` modes at the top level of `App.tsx`. The existing Player and Scheduler are reused for preview — no changes to scheduler logic.

**Tech Stack:** Existing — React 18, TypeScript strict, Tailwind v4, Zustand, Zod, Vitest, Electron IPC via `contextBridge`. No new dependencies.

## Global Constraints

- **macOS only.** No Windows/Linux paths.
- **All filesystem access in main process.** Renderer never touches `node:fs`, `node:path`, or `app.getPath`.
- **TypeScript strict everywhere.**
- **No new dependencies** for this spec. Pure addition over the existing stack.
- **Draft IDs:** 16-char hex strings from `crypto.randomBytes(8).toString('hex')` — generated in main process, never accepted from renderer input.
- **Bundled `episodes/` directory is read-only.** Duplicating reads from it but never writes back to it.
- **Drafts may be incomplete.** Use `draftManifestSchema` (permissive) for editor I/O. Strict `episodeManifestSchema` only on Preview.
- **No git commits inside steps.** This project doesn't use git; only file changes.

---

## File Structure

```
src/
  main/
    drafts.ts                                # NEW — CRUD over <userData>/drafts/<id>/
    drafts.test.ts                           # NEW — unit tests for drafts module
    ipc.ts                                   # MODIFY — register drafts:* handlers
  preload/
    index.ts                                 # MODIFY — surface drafts API + assets.draftCoverUrl
  renderer/
    App.tsx                                  # MODIFY — render Library or Editor by appMode
    appStore.ts                              # NEW — appMode toggle, persisted
    ui/
      ModeToggle.tsx                         # NEW — LIBRARY | EDITOR pill
    editor/
      EditorView.tsx                         # NEW — top-level: list or editor
      DraftList.tsx                          # NEW — grid of draft cards
      DraftCard.tsx                          # NEW — single draft card
      NewDraftModal.tsx                      # NEW — Empty | Duplicate tabs
      DraftEditor.tsx                        # NEW — form editor shell
      DraftPreviewBanner.tsx                 # NEW — shown over player during preview
      editorStore.ts                         # NEW — drafts state + actions
      forms/
        MetadataEditor.tsx                   # NEW — title, subject, estimatedMinutes
        HostsEditor.tsx                      # NEW — hosts list
        ChaptersEditor.tsx                   # NEW — chapter sections + reorder
        SegmentList.tsx                      # NEW — segments within a chapter
        NarrationSegmentEditor.tsx           # NEW — text + hostId
        SongSegmentEditor.tsx                # NEW — track + voiceovers list
        VoiceoverEditor.tsx                  # NEW — voiceover fields
        CoverEditor.tsx                      # NEW — cover image upload
    player/
      playerStore.ts                         # MODIFY — add startWithManifest()
  shared/
    manifest.ts                              # MODIFY — export draftManifestSchema + DraftSummary
    ipcSchema.ts                             # MODIFY — add drafts:* channel constants
```

## Task list

1. Shared schema + types: `draftManifestSchema`, `DraftSummary`
2. Main process: `drafts.ts` module + tests
3. IPC channels + handlers + preload bridge
4. `appStore` (mode toggle)
5. `ModeToggle` component + wire into `App.tsx`
6. `editorStore` (Zustand) + tests
7. `EditorView` + `DraftList` + `DraftCard` (read-only listing)
8. `NewDraftModal` — Empty + Duplicate flows
9. `DraftEditor` shell + `MetadataEditor` + `HostsEditor`
10. `ChaptersEditor` + `SegmentList` + segment editors (narration, song, voiceover)
11. `CoverEditor` — cover replacement
12. Preview integration — `playerStore.startWithManifest()` + `DraftPreviewBanner`
13. Final wiring, polish, full typecheck/test/build

---

## Task 1: Shared schema + types

**Files:**
- Modify: `src/shared/manifest.ts`
- Test: `src/shared/manifest.test.ts` (add cases to existing file)

**Interfaces produced:**
- `draftManifestSchema` — same shape as `episodeManifestSchema` but with `.min(1)` string constraints loosened to `.min(0)` so drafts can have empty fields mid-edit.
- `DraftSummary` type used by IPC `drafts:list` results.

- [ ] **Step 1: Add the draft schema and summary type to `src/shared/manifest.ts`**

Append to the file (just before the closing of file — keep existing exports intact):

```ts
// Permissive variant of the manifest schema for drafts. Drafts may have empty
// strings while being authored; only Publish/Preview should validate against
// episodeManifestSchema.
const draftHostSchema = hostSchema.extend({
  name: z.string(),
  persona: z.string(),
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
  playSeconds: z.number().min(0),
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
  updatedAt: number  // ms since epoch
}
```

Note: this works because `hostSchema`, `narrationSegmentSchema`, etc. are object schemas, and `.extend(...)` overrides only the listed keys. The script above relaxes every required string to allow empty values.

But — currently those schemas are local consts (not exported). Make them `const` exports at minimum within this module so `.extend` works on them. Search the file: lines like `const hostSchema = z.object({...})` should stay as they are (the `.extend` calls reference them by closure within the same file). Confirm by reading the existing file.

- [ ] **Step 2: Verify the file still compiles**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Add schema tests at the bottom of `src/shared/manifest.test.ts`**

```ts
import { draftManifestSchema } from './manifest'

describe('draftManifestSchema', () => {
  it('accepts a draft with empty narration text', () => {
    const draft = {
      schemaVersion: 1,
      id: 'd',
      title: '',
      subject: '',
      coverImage: '',
      estimatedMinutes: 5,
      hosts: [{ id: 'h', name: '', persona: '', voiceRef: '' }],
      chapters: [
        {
          title: '',
          segments: [{ type: 'narration', id: 'n0', hostId: 'h', text: '' }],
        },
      ],
      sources: [],
      facts: [],
    }
    expect(() => draftManifestSchema.parse(draft)).not.toThrow()
  })

  it('still rejects a song segment with missing playSeconds', () => {
    const draft = {
      schemaVersion: 1,
      id: 'd',
      title: '',
      subject: '',
      coverImage: '',
      estimatedMinutes: 5,
      hosts: [{ id: 'h', name: '', persona: '', voiceRef: '' }],
      chapters: [
        {
          title: '',
          segments: [
            {
              type: 'song',
              id: 's0',
              track: { title: '', artist: '', spotifyUri: '' },
              startAtSeconds: 0,
              // playSeconds missing
            },
          ],
        },
      ],
      sources: [],
      facts: [],
    }
    expect(() => draftManifestSchema.parse(draft)).toThrow()
  })
})
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: all existing tests pass + 2 new tests pass.

---

## Task 2: Main process `drafts.ts` module

**Files:**
- Create: `src/main/drafts.ts`
- Create: `src/main/drafts.test.ts`

**Interfaces produced (consumed by IPC handlers in Task 3):**

```ts
function listDrafts(): Promise<DraftSummary[]>
function loadDraft(draftId: string): Promise<DraftManifest>
function saveDraft(draftId: string, manifest: unknown): Promise<void>
function createDraft(initial: DraftManifest): Promise<string>  // returns draftId
function deleteDraft(draftId: string): Promise<void>
function duplicateFromEpisode(episodePath: string): Promise<string>
function draftCoverUrl(draftId: string): Promise<string | null>
function setDraftCover(draftId: string, sourcePath: string): Promise<void>
function draftsRoot(): string  // for testing override
```

`draftsRoot()` is internally `app.getPath('userData') + '/drafts'` but the module exposes a way to override for tests via dependency injection.

- [ ] **Step 1: Write the failing tests** at `src/main/drafts.test.ts`

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDrafts } from './drafts'
import type { DraftManifest } from '../shared/manifest'

const mkTmp = async () => {
  const d = join(tmpdir(), 'deepcuts-drafts-' + Math.random().toString(36).slice(2))
  await fs.mkdir(d, { recursive: true })
  return d
}

function freshManifest(over: Partial<DraftManifest> = {}): DraftManifest {
  return {
    schemaVersion: 1,
    id: 'x',
    title: 'X',
    subject: '',
    coverImage: '',
    estimatedMinutes: 5,
    hosts: [{ id: 'h', name: 'H', persona: '', voiceRef: '' }],
    chapters: [
      { title: 'C', segments: [{ type: 'narration', id: 'n0', hostId: 'h', text: '' }] },
    ],
    sources: [],
    facts: [],
    ...over,
  }
}

describe('drafts module', () => {
  it('creates a draft and returns a 16-char id', async () => {
    const root = await mkTmp()
    const episodesRoot = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root, episodesRoot: () => episodesRoot })
    const id = await m.createDraft(freshManifest())
    expect(id).toMatch(/^[a-f0-9]{16}$/)
    const onDisk = await fs.readFile(join(root, id, 'manifest.json'), 'utf-8')
    expect(JSON.parse(onDisk).title).toBe('X')
  })

  it('lists drafts with summary data', async () => {
    const root = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root, episodesRoot: () => '' })
    await m.createDraft(freshManifest({ title: 'First', subject: 'sub' }))
    await m.createDraft(freshManifest({ title: 'Second' }))
    const list = await m.listDrafts()
    expect(list).toHaveLength(2)
    const titles = list.map((d) => d.title).sort()
    expect(titles).toEqual(['First', 'Second'])
    expect(list[0]!.hostCount).toBe(1)
    expect(list[0]!.segmentCount).toBe(1)
  })

  it('loads a saved draft', async () => {
    const root = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root, episodesRoot: () => '' })
    const id = await m.createDraft(freshManifest({ title: 'Loadable' }))
    const loaded = await m.loadDraft(id)
    expect(loaded.title).toBe('Loadable')
  })

  it('saves overwriting an existing draft', async () => {
    const root = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root, episodesRoot: () => '' })
    const id = await m.createDraft(freshManifest({ title: 'Old' }))
    await m.saveDraft(id, freshManifest({ title: 'New' }))
    const loaded = await m.loadDraft(id)
    expect(loaded.title).toBe('New')
  })

  it('deletes a draft', async () => {
    const root = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root, episodesRoot: () => '' })
    const id = await m.createDraft(freshManifest())
    await m.deleteDraft(id)
    await expect(m.loadDraft(id)).rejects.toThrow()
    const list = await m.listDrafts()
    expect(list).toHaveLength(0)
  })

  it('duplicates from an episode, copies manifest, returns new draftId', async () => {
    const root = await mkTmp()
    const eps = await mkTmp()
    const episode = freshManifest({ title: 'Episode', subject: 'sub' })
    await fs.writeFile(join(eps, 'ep.json'), JSON.stringify(episode))
    const m = createDrafts({ draftsRoot: () => root, episodesRoot: () => eps })
    const id = await m.duplicateFromEpisode('ep.json')
    expect(id).toMatch(/^[a-f0-9]{16}$/)
    const loaded = await m.loadDraft(id)
    expect(loaded.title).toBe('Episode')
  })

  it('rejects unsafe draftIds', async () => {
    const root = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root, episodesRoot: () => '' })
    await expect(m.loadDraft('../etc/passwd')).rejects.toThrow()
    await expect(m.deleteDraft('../etc/passwd')).rejects.toThrow()
  })

  it('rejects unsafe episode paths in duplicate', async () => {
    const root = await mkTmp()
    const eps = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root, episodesRoot: () => eps })
    await expect(m.duplicateFromEpisode('../etc/passwd')).rejects.toThrow()
    await expect(m.duplicateFromEpisode('/abs/path')).rejects.toThrow()
  })

  it('reports hasCover=false when no cover file, true when one exists', async () => {
    const root = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root, episodesRoot: () => '' })
    const id = await m.createDraft(freshManifest())
    let list = await m.listDrafts()
    expect(list[0]!.hasCover).toBe(false)
    await fs.writeFile(join(root, id, 'cover.png'), 'fake')
    list = await m.listDrafts()
    expect(list[0]!.hasCover).toBe(true)
  })

  it('returns a file:// URL for the cover when present', async () => {
    const root = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root, episodesRoot: () => '' })
    const id = await m.createDraft(freshManifest())
    expect(await m.draftCoverUrl(id)).toBeNull()
    await fs.writeFile(join(root, id, 'cover.png'), 'fake')
    expect(await m.draftCoverUrl(id)).toBe('file://' + join(root, id, 'cover.png'))
  })
})
```

- [ ] **Step 2: Run the tests to confirm failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/drafts.ts`**

```ts
import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import { draftManifestSchema, type DraftManifest, type DraftSummary } from '../shared/manifest'

const ID_RE = /^[a-f0-9]{16}$/

export interface DraftsDeps {
  draftsRoot: () => string
  episodesRoot: () => string
}

function assertSafeId(id: string): void {
  if (!ID_RE.test(id)) throw new Error(`Unsafe draftId: ${id}`)
}

function assertSafeEpisodePath(p: string): void {
  if (p.includes('..') || p.startsWith('/') || extname(p) !== '.json') {
    throw new Error(`Unsafe episode path: ${p}`)
  }
}

export function createDrafts(deps: DraftsDeps) {
  const root = deps.draftsRoot
  const eps = deps.episodesRoot

  async function ensureRoot(): Promise<void> {
    await fs.mkdir(root(), { recursive: true })
  }

  async function listDrafts(): Promise<DraftSummary[]> {
    await ensureRoot()
    const dirs = await fs.readdir(root(), { withFileTypes: true }).catch(() => [])
    const out: DraftSummary[] = []
    for (const entry of dirs) {
      if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue
      const id = entry.name
      const manifestPath = join(root(), id, 'manifest.json')
      try {
        const raw = await fs.readFile(manifestPath, 'utf-8')
        const m = JSON.parse(raw) as DraftManifest
        const stat = await fs.stat(manifestPath)
        const hasCover = await fs.access(join(root(), id, 'cover.png')).then(() => true).catch(() => false)
        const segmentCount = (m.chapters ?? []).reduce((sum, c) => sum + ((c.segments ?? []).length), 0)
        out.push({
          draftId: id,
          title: m.title ?? '',
          subject: m.subject ?? '',
          hostCount: (m.hosts ?? []).length,
          segmentCount,
          hasCover,
          updatedAt: stat.mtimeMs,
        })
      } catch {
        // Skip corrupt drafts in the summary list; loadDraft will surface errors.
      }
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt)
    return out
  }

  async function loadDraft(draftId: string): Promise<DraftManifest> {
    assertSafeId(draftId)
    const manifestPath = join(root(), draftId, 'manifest.json')
    const raw = await fs.readFile(manifestPath, 'utf-8')
    return draftManifestSchema.parse(JSON.parse(raw))
  }

  async function saveDraft(draftId: string, manifest: unknown): Promise<void> {
    assertSafeId(draftId)
    const parsed = draftManifestSchema.parse(manifest)
    const dir = join(root(), draftId)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'manifest.json'), JSON.stringify(parsed, null, 2))
  }

  async function createDraft(initial: DraftManifest): Promise<string> {
    await ensureRoot()
    const id = randomBytes(8).toString('hex')
    const dir = join(root(), id)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'manifest.json'), JSON.stringify(initial, null, 2))
    return id
  }

  async function deleteDraft(draftId: string): Promise<void> {
    assertSafeId(draftId)
    await fs.rm(join(root(), draftId), { recursive: true, force: true })
  }

  async function duplicateFromEpisode(episodePath: string): Promise<string> {
    assertSafeEpisodePath(episodePath)
    const sourceManifestPath = join(eps(), episodePath)
    const raw = await fs.readFile(sourceManifestPath, 'utf-8')
    const manifest = draftManifestSchema.parse(JSON.parse(raw))
    const newId = await createDraft(manifest)
    // Try to copy a co-located cover (best-effort; e.g. covers/<id>.png alongside manifest).
    if (manifest.coverImage) {
      const sourceCover = join(eps(), manifest.coverImage)
      const destCover = join(root(), newId, 'cover.png')
      await fs.copyFile(sourceCover, destCover).catch(() => {
        // Cover missing or unreadable — leave draft without cover.
      })
    }
    return newId
  }

  async function draftCoverUrl(draftId: string): Promise<string | null> {
    assertSafeId(draftId)
    const coverPath = join(root(), draftId, 'cover.png')
    const exists = await fs.access(coverPath).then(() => true).catch(() => false)
    return exists ? 'file://' + coverPath : null
  }

  async function setDraftCover(draftId: string, sourcePath: string): Promise<void> {
    assertSafeId(draftId)
    if (!sourcePath) throw new Error('Empty source path')
    const dir = join(root(), draftId)
    await fs.mkdir(dir, { recursive: true })
    await fs.copyFile(sourcePath, join(dir, 'cover.png'))
  }

  return {
    listDrafts,
    loadDraft,
    saveDraft,
    createDraft,
    deleteDraft,
    duplicateFromEpisode,
    draftCoverUrl,
    setDraftCover,
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all drafts module tests pass.

---

## Task 3: IPC channels + handlers + preload bridge

**Files:**
- Modify: `src/shared/ipcSchema.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`

**Interfaces produced (used by renderer in later tasks):**

```ts
window.deepcuts.drafts = {
  list(): Promise<DraftSummary[]>
  load(draftId): Promise<unknown>  // renderer parses
  save(draftId, manifest): Promise<void>
  create(initial): Promise<string>
  delete(draftId): Promise<void>
  duplicateFromEpisode(episodePath): Promise<string>
  coverUrl(draftId): Promise<string | null>
  setCover(draftId, sourcePath): Promise<void>
}
```

- [ ] **Step 1: Add channel constants in `src/shared/ipcSchema.ts`**

Append inside the `IpcChannels` object, before the closing `} as const`:

```ts
  DraftsList: 'drafts:list',
  DraftsLoad: 'drafts:load',
  DraftsSave: 'drafts:save',
  DraftsCreate: 'drafts:create',
  DraftsDelete: 'drafts:delete',
  DraftsDuplicate: 'drafts:duplicateFromEpisode',
  DraftsCoverUrl: 'drafts:coverUrl',
  DraftsSetCover: 'drafts:setCover',
```

- [ ] **Step 2: Register handlers in `src/main/ipc.ts`**

Add the imports at the top:

```ts
import { createDrafts } from './drafts'
```

Inside `registerIpc()`, after the existing handler block, add:

```ts
  const drafts = createDrafts({
    draftsRoot: () => join(app.getPath('userData'), 'drafts'),
    episodesRoot,
  })

  ipcMain.handle(IpcChannels.DraftsList, wrap(() => drafts.listDrafts()))
  ipcMain.handle(IpcChannels.DraftsLoad, wrap((id: string) => drafts.loadDraft(id)))
  ipcMain.handle(
    IpcChannels.DraftsSave,
    wrap((id: string, manifest: unknown) => drafts.saveDraft(id, manifest)),
  )
  ipcMain.handle(
    IpcChannels.DraftsCreate,
    wrap((initial: unknown) => drafts.createDraft(initial as any)),
  )
  ipcMain.handle(IpcChannels.DraftsDelete, wrap((id: string) => drafts.deleteDraft(id)))
  ipcMain.handle(
    IpcChannels.DraftsDuplicate,
    wrap((episodePath: string) => drafts.duplicateFromEpisode(episodePath)),
  )
  ipcMain.handle(IpcChannels.DraftsCoverUrl, wrap((id: string) => drafts.draftCoverUrl(id)))
  ipcMain.handle(
    IpcChannels.DraftsSetCover,
    wrap((id: string, sourcePath: string) => drafts.setDraftCover(id, sourcePath)),
  )
```

- [ ] **Step 3: Expose in `src/preload/index.ts`**

Inside the `api` object, before the closing brace, add:

```ts
  drafts: {
    list: () => invoke<import('../shared/manifest').DraftSummary[]>(IpcChannels.DraftsList),
    load: (draftId: string) => invoke<unknown>(IpcChannels.DraftsLoad, draftId),
    save: (draftId: string, manifest: unknown) =>
      invoke<void>(IpcChannels.DraftsSave, draftId, manifest),
    create: (initial: unknown) => invoke<string>(IpcChannels.DraftsCreate, initial),
    delete: (draftId: string) => invoke<void>(IpcChannels.DraftsDelete, draftId),
    duplicateFromEpisode: (episodePath: string) =>
      invoke<string>(IpcChannels.DraftsDuplicate, episodePath),
    coverUrl: (draftId: string) => invoke<string | null>(IpcChannels.DraftsCoverUrl, draftId),
    setCover: (draftId: string, sourcePath: string) =>
      invoke<void>(IpcChannels.DraftsSetCover, draftId, sourcePath),
  },
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test`
Expected: passes.

Run: `npm run build`
Expected: clean build.

---

## Task 4: `appStore` (mode toggle)

**Files:**
- Create: `src/renderer/appStore.ts`

**Interfaces produced (used by `App.tsx` in Task 5):**

```ts
useAppStore() returns { appMode: 'library' | 'editor', setAppMode(mode), toggleAppMode() }
```

- [ ] **Step 1: Create `src/renderer/appStore.ts`**

```ts
import { create } from 'zustand'

export type AppMode = 'library' | 'editor'

const KEY = 'deepcuts.appMode.v1'

function loadInitial(): AppMode {
  const v = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
  return v === 'editor' ? 'editor' : 'library'
}

interface AppStore {
  appMode: AppMode
  setAppMode(mode: AppMode): void
  toggleAppMode(): void
}

export const useAppStore = create<AppStore>((set, get) => ({
  appMode: loadInitial(),
  setAppMode(mode) {
    localStorage.setItem(KEY, mode)
    set({ appMode: mode })
  },
  toggleAppMode() {
    get().setAppMode(get().appMode === 'editor' ? 'library' : 'editor')
  },
}))
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

---

## Task 5: `ModeToggle` component + wire into `App.tsx`

**Files:**
- Create: `src/renderer/ui/ModeToggle.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Create `src/renderer/ui/ModeToggle.tsx`**

```tsx
import { useAppStore } from '../appStore'

export function ModeToggle() {
  const mode = useAppStore((s) => s.appMode)
  const set = useAppStore((s) => s.setAppMode)
  return (
    <div className="no-drag inline-flex items-center text-[10px] tracking-[0.2em] uppercase select-none">
      <button
        onClick={() => set('library')}
        className={
          'px-2.5 py-1 rounded-l-md border transition-colors duration-150 ' +
          (mode === 'library'
            ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)]/40 text-[var(--color-text)]'
            : 'border-[var(--color-hairline)] text-[var(--color-muted)] hover:text-[var(--color-text)]')
        }
      >
        Library
      </button>
      <button
        onClick={() => set('editor')}
        className={
          'px-2.5 py-1 rounded-r-md border-y border-r transition-colors duration-150 ' +
          (mode === 'editor'
            ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)]/40 text-[var(--color-text)]'
            : 'border-[var(--color-hairline)] text-[var(--color-muted)] hover:text-[var(--color-text)]')
        }
      >
        Editor
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Update `src/renderer/App.tsx`** to use the mode toggle and render either Library or Editor

Replace the whole file content with:

```tsx
import { useEffect, useState } from 'react'
import { Catalog } from './catalog/Catalog'
import { Player } from './player/Player'
import { Settings } from './settings/Settings'
import { usePlayerStore } from './player/playerStore'
import { useAppStore } from './appStore'
import { ModeToggle } from './ui/ModeToggle'
import { EditorView } from './editor/EditorView'

export function App() {
  const init = usePlayerStore((s) => s.init)
  const status = usePlayerStore((s) => s.schedulerState.status.kind)
  const appMode = useAppStore((s) => s.appMode)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    init()
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ',') {
        e.preventDefault()
        setShowSettings(true)
      }
      if (e.key === 'Escape') setShowSettings(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [init])

  const playerActive = status !== 'idle' && status !== 'done'

  return (
    <main className="min-h-screen">
      <div className="drag fixed top-0 left-0 right-0 h-9 z-50" aria-hidden />
      <div className="fixed top-1.5 right-3 z-[60]">
        <ModeToggle />
      </div>
      {appMode === 'editor' ? (
        <EditorView />
      ) : playerActive ? (
        <Player />
      ) : (
        <Catalog />
      )}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </main>
  )
}
```

- [ ] **Step 3: Stub `src/renderer/editor/EditorView.tsx`** so the app compiles before Tasks 7+

```tsx
export function EditorView() {
  return (
    <div className="p-12 max-w-5xl mx-auto">
      <div className="text-xs tracking-[0.2em] uppercase text-[var(--color-muted)] mb-2">Deepcuts</div>
      <h1 className="text-2xl font-medium mb-12">Editor</h1>
      <div className="text-[var(--color-muted)]">Editor scaffolding — drafts list coming next.</div>
    </div>
  )
}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Expected: passes.

Run: `npm run build`
Expected: clean.

Run: `npm run dev` (briefly)
Expected: the app opens, you can toggle between Library (catalog) and Editor (placeholder) at the top right. Then close.

---

## Task 6: `editorStore` (Zustand) + tests

**Files:**
- Create: `src/renderer/editor/editorStore.ts`
- Create: `src/renderer/editor/editorStore.test.ts`

**Interfaces produced (used by editor components in Tasks 7-12):**

```ts
useEditorStore() returns {
  drafts: DraftSummary[]
  currentDraftId: string | null
  currentDraft: DraftManifest | null
  dirty: boolean
  loadingList: boolean
  loadingDraft: boolean
  error: string | null

  refreshList(): Promise<void>
  openDraft(draftId): Promise<void>
  closeDraft(): void
  updateDraft(updater: (m: DraftManifest) => DraftManifest): void
  saveDraft(): Promise<void>
  createEmpty(title: string): Promise<string>
  duplicate(episodePath): Promise<string>
  remove(draftId): Promise<void>
}
```

- [ ] **Step 1: Write the failing tests** at `src/renderer/editor/editorStore.test.ts`

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { DraftManifest, DraftSummary } from '../../shared/manifest'

// We replace window.deepcuts.drafts with a controllable mock per test.
function setupMock() {
  const drafts: Record<string, DraftManifest> = {}
  const summaries: DraftSummary[] = []
  ;(globalThis as any).window = {
    deepcuts: {
      drafts: {
        list: vi.fn(async () => summaries.slice()),
        load: vi.fn(async (id: string) => structuredClone(drafts[id])),
        save: vi.fn(async (id: string, m: DraftManifest) => { drafts[id] = m }),
        create: vi.fn(async (m: DraftManifest) => {
          const id = Math.random().toString(36).slice(2, 18).padEnd(16, '0')
          drafts[id] = m
          summaries.push({ draftId: id, title: m.title, subject: m.subject, hostCount: m.hosts.length, segmentCount: 1, hasCover: false, updatedAt: Date.now() })
          return id
        }),
        delete: vi.fn(async (id: string) => {
          delete drafts[id]
          const i = summaries.findIndex((s) => s.draftId === id)
          if (i >= 0) summaries.splice(i, 1)
        }),
        duplicateFromEpisode: vi.fn(async () => 'dup' + '0'.repeat(13)),
        coverUrl: vi.fn(async () => null),
        setCover: vi.fn(async () => {}),
      },
    },
  }
  return { drafts, summaries }
}

beforeEach(() => {
  setupMock()
  vi.resetModules()
})

describe('editorStore', () => {
  it('refreshList populates drafts', async () => {
    const { useEditorStore } = await import('./editorStore')
    await useEditorStore.getState().createEmpty('Foo')
    await useEditorStore.getState().refreshList()
    expect(useEditorStore.getState().drafts.length).toBe(1)
    expect(useEditorStore.getState().drafts[0]!.title).toBe('Foo')
  })

  it('openDraft loads manifest and clears dirty', async () => {
    const { useEditorStore } = await import('./editorStore')
    const id = await useEditorStore.getState().createEmpty('Bar')
    await useEditorStore.getState().openDraft(id)
    expect(useEditorStore.getState().currentDraftId).toBe(id)
    expect(useEditorStore.getState().currentDraft?.title).toBe('Bar')
    expect(useEditorStore.getState().dirty).toBe(false)
  })

  it('updateDraft marks dirty without writing to disk', async () => {
    const { useEditorStore } = await import('./editorStore')
    const id = await useEditorStore.getState().createEmpty('Baz')
    await useEditorStore.getState().openDraft(id)
    useEditorStore.getState().updateDraft((m) => ({ ...m, title: 'Edited' }))
    expect(useEditorStore.getState().currentDraft?.title).toBe('Edited')
    expect(useEditorStore.getState().dirty).toBe(true)
  })

  it('saveDraft persists and clears dirty', async () => {
    const { useEditorStore } = await import('./editorStore')
    const id = await useEditorStore.getState().createEmpty('Qux')
    await useEditorStore.getState().openDraft(id)
    useEditorStore.getState().updateDraft((m) => ({ ...m, title: 'Saved' }))
    await useEditorStore.getState().saveDraft()
    expect(useEditorStore.getState().dirty).toBe(false)
    // Reopen and confirm persisted.
    useEditorStore.getState().closeDraft()
    await useEditorStore.getState().openDraft(id)
    expect(useEditorStore.getState().currentDraft?.title).toBe('Saved')
  })

  it('remove deletes the draft and refreshes the list', async () => {
    const { useEditorStore } = await import('./editorStore')
    const id = await useEditorStore.getState().createEmpty('Goner')
    await useEditorStore.getState().refreshList()
    expect(useEditorStore.getState().drafts.length).toBe(1)
    await useEditorStore.getState().remove(id)
    expect(useEditorStore.getState().drafts.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npm test`
Expected: FAIL — `editorStore` module not found.

- [ ] **Step 3: Implement `src/renderer/editor/editorStore.ts`**

```ts
import { create } from 'zustand'
import { draftManifestSchema, type DraftManifest, type DraftSummary } from '../../shared/manifest'

interface EditorStore {
  drafts: DraftSummary[]
  currentDraftId: string | null
  currentDraft: DraftManifest | null
  dirty: boolean
  loadingList: boolean
  loadingDraft: boolean
  error: string | null

  refreshList(): Promise<void>
  openDraft(draftId: string): Promise<void>
  closeDraft(): void
  updateDraft(updater: (m: DraftManifest) => DraftManifest): void
  saveDraft(): Promise<void>
  createEmpty(title: string): Promise<string>
  duplicate(episodePath: string): Promise<string>
  remove(draftId: string): Promise<void>
}

function makeEmptyManifest(title: string): DraftManifest {
  return {
    schemaVersion: 1,
    id: 'draft',
    title,
    subject: '',
    coverImage: '',
    estimatedMinutes: 5,
    hosts: [
      {
        id: 'host_a',
        name: 'Narrator',
        persona: '',
        voiceRef: 'elevenlabs:iP95p4xoKVk53GoZ742B',
      },
    ],
    chapters: [
      {
        title: 'Untitled chapter',
        segments: [
          { type: 'narration', id: 'n0', hostId: 'host_a', text: '' },
        ],
      },
    ],
    sources: [],
    facts: [],
  }
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  drafts: [],
  currentDraftId: null,
  currentDraft: null,
  dirty: false,
  loadingList: false,
  loadingDraft: false,
  error: null,

  async refreshList() {
    set({ loadingList: true, error: null })
    try {
      const list = await window.deepcuts.drafts.list()
      set({ drafts: list })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to list drafts' })
    } finally {
      set({ loadingList: false })
    }
  },

  async openDraft(draftId) {
    set({ loadingDraft: true, error: null, currentDraftId: draftId })
    try {
      const raw = await window.deepcuts.drafts.load(draftId)
      const parsed = draftManifestSchema.parse(raw)
      set({ currentDraft: parsed, dirty: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to open draft' })
    } finally {
      set({ loadingDraft: false })
    }
  },

  closeDraft() {
    set({ currentDraftId: null, currentDraft: null, dirty: false })
  },

  updateDraft(updater) {
    const cur = get().currentDraft
    if (!cur) return
    set({ currentDraft: updater(cur), dirty: true })
  },

  async saveDraft() {
    const { currentDraftId, currentDraft } = get()
    if (!currentDraftId || !currentDraft) return
    await window.deepcuts.drafts.save(currentDraftId, currentDraft)
    set({ dirty: false })
  },

  async createEmpty(title) {
    const id = await window.deepcuts.drafts.create(makeEmptyManifest(title))
    await get().refreshList()
    return id
  },

  async duplicate(episodePath) {
    const id = await window.deepcuts.drafts.duplicateFromEpisode(episodePath)
    await get().refreshList()
    return id
  },

  async remove(draftId) {
    await window.deepcuts.drafts.delete(draftId)
    if (get().currentDraftId === draftId) {
      set({ currentDraftId: null, currentDraft: null, dirty: false })
    }
    await get().refreshList()
  },
}))
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 5 editorStore tests pass.

---

## Task 7: `EditorView` + `DraftList` + `DraftCard`

**Files:**
- Modify: `src/renderer/editor/EditorView.tsx`
- Create: `src/renderer/editor/DraftList.tsx`
- Create: `src/renderer/editor/DraftCard.tsx`

- [ ] **Step 1: Create `src/renderer/editor/DraftCard.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { DraftSummary } from '../../shared/manifest'

interface DraftCardProps {
  draft: DraftSummary
  onOpen: () => void
  onPreview: () => void
  onDelete: () => void
}

export function DraftCard({ draft, onOpen, onPreview, onDelete }: DraftCardProps) {
  const [coverSrc, setCoverSrc] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!draft.hasCover) { setCoverSrc(null); return }
    window.deepcuts.drafts.coverUrl(draft.draftId)
      .then((u) => { if (!cancelled) setCoverSrc(u) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [draft.draftId, draft.hasCover])

  return (
    <div className="group flex flex-col gap-3 relative">
      <button
        onClick={onOpen}
        className="aspect-square w-full rounded-md bg-[var(--color-surface)] border border-[var(--color-hairline)] flex items-center justify-center overflow-hidden focus:outline-none focus:border-[var(--color-accent)]"
      >
        {coverSrc ? (
          <img src={coverSrc} alt={draft.title} className="w-full h-full object-cover" draggable={false} />
        ) : (
          <span className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
            {(draft.title || 'Untitled').slice(0, 2)}
          </span>
        )}
        <span className="absolute top-2 left-2 text-[10px] tracking-[0.2em] uppercase px-1.5 py-0.5 rounded-sm bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
          Draft
        </span>
      </button>
      <div>
        <button
          onClick={onOpen}
          className="text-base font-medium text-left group-hover:text-[var(--color-accent)] transition-colors"
        >
          {draft.title || 'Untitled draft'}
        </button>
        <div className="text-sm text-[var(--color-muted)] mt-0.5">
          {draft.subject || '—'}
        </div>
        <div className="text-xs text-[var(--color-muted)] mt-1">
          {draft.hostCount} host{draft.hostCount === 1 ? '' : 's'} · {draft.segmentCount} segment{draft.segmentCount === 1 ? '' : 's'}
        </div>
      </div>
      <div className="flex gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onPreview}
          className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5"
        >
          Preview
        </button>
        <button
          onClick={onOpen}
          className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5"
        >
          Edit
        </button>
        <button
          onClick={onDelete}
          className="text-xs px-2 py-1 rounded-md text-[var(--color-muted)] hover:text-red-400 hover:bg-white/5"
        >
          Delete
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/renderer/editor/DraftList.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useEditorStore } from './editorStore'
import { DraftCard } from './DraftCard'
import { NewDraftModal } from './NewDraftModal'

export function DraftList() {
  const drafts = useEditorStore((s) => s.drafts)
  const loading = useEditorStore((s) => s.loadingList)
  const refresh = useEditorStore((s) => s.refreshList)
  const openDraft = useEditorStore((s) => s.openDraft)
  const remove = useEditorStore((s) => s.remove)
  const [showNewModal, setShowNewModal] = useState(false)

  useEffect(() => { refresh() }, [refresh])

  async function confirmDelete(id: string, title: string) {
    if (window.confirm(`Delete "${title || 'Untitled draft'}"? This can't be undone.`)) {
      await remove(id)
    }
  }

  return (
    <div className="p-12 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-12">
        <div>
          <div className="text-xs tracking-[0.2em] uppercase text-[var(--color-muted)] mb-2">Deepcuts</div>
          <h1 className="text-2xl font-medium">Editor</h1>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30"
        >
          + New project
        </button>
      </div>

      {loading && drafts.length === 0 ? (
        <div className="text-[var(--color-muted)]">Loading drafts…</div>
      ) : drafts.length === 0 ? (
        <div className="text-[var(--color-muted)] py-12">
          No drafts yet. Click <strong className="text-[var(--color-text)]">+ New project</strong> to start one.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-10">
          {drafts.map((d) => (
            <DraftCard
              key={d.draftId}
              draft={d}
              onOpen={() => openDraft(d.draftId)}
              onPreview={() => { /* wired in Task 12 */ }}
              onDelete={() => confirmDelete(d.draftId, d.title)}
            />
          ))}
        </div>
      )}

      {showNewModal && <NewDraftModal onClose={() => setShowNewModal(false)} />}
    </div>
  )
}
```

- [ ] **Step 3: Replace `src/renderer/editor/EditorView.tsx`** with the dispatcher

```tsx
import { useEditorStore } from './editorStore'
import { DraftList } from './DraftList'
import { DraftEditor } from './DraftEditor'

export function EditorView() {
  const currentDraftId = useEditorStore((s) => s.currentDraftId)
  return currentDraftId ? <DraftEditor /> : <DraftList />
}
```

- [ ] **Step 4: Stub `src/renderer/editor/DraftEditor.tsx`** and `NewDraftModal.tsx` so this compiles

`DraftEditor.tsx`:
```tsx
import { useEditorStore } from './editorStore'

export function DraftEditor() {
  const close = useEditorStore((s) => s.closeDraft)
  return (
    <div className="p-12 max-w-5xl mx-auto">
      <button onClick={close} className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)] hover:text-[var(--color-text)]">
        ← Drafts
      </button>
      <div className="mt-12 text-[var(--color-muted)]">Draft editor — form coming in next task.</div>
    </div>
  )
}
```

`NewDraftModal.tsx`:
```tsx
export function NewDraftModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-8" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[var(--color-surface)] border border-[var(--color-hairline)] rounded-lg w-[420px] p-6">
        New draft modal (next task)
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm run build`
Expected: passes.

---

## Task 8: `NewDraftModal` — Empty + Duplicate

**Files:**
- Modify: `src/renderer/editor/NewDraftModal.tsx`

- [ ] **Step 1: Replace `src/renderer/editor/NewDraftModal.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useEditorStore } from './editorStore'

interface BundledEpisodeOption {
  manifestPath: string
  title: string
  subject: string
}

export function NewDraftModal({ onClose }: { onClose: () => void }) {
  const createEmpty = useEditorStore((s) => s.createEmpty)
  const duplicate = useEditorStore((s) => s.duplicate)
  const openDraft = useEditorStore((s) => s.openDraft)

  const [tab, setTab] = useState<'empty' | 'duplicate'>('empty')
  const [title, setTitle] = useState('')
  const [episodes, setEpisodes] = useState<BundledEpisodeOption[] | null>(null)
  const [selectedEp, setSelectedEp] = useState<string>('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.deepcuts.catalog.loadLocal()
      .then((c) => setEpisodes(c.episodes.map((e) => ({ manifestPath: e.manifestPath, title: e.title, subject: e.subject }))))
      .catch((e: Error) => setError(e.message))
  }, [])

  async function submitEmpty() {
    if (!title.trim()) return
    setWorking(true); setError(null)
    try {
      const id = await createEmpty(title.trim())
      await openDraft(id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally { setWorking(false) }
  }

  async function submitDuplicate() {
    if (!selectedEp) return
    setWorking(true); setError(null)
    try {
      const id = await duplicate(selectedEp)
      await openDraft(id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Duplicate failed')
    } finally { setWorking(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-8" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[var(--color-surface)] border border-[var(--color-hairline)] rounded-lg w-[480px] max-w-full p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">New project</h2>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-text)]" aria-label="Close">×</button>
        </div>

        <div className="flex gap-2 text-xs tracking-[0.2em] uppercase">
          <button
            onClick={() => setTab('empty')}
            className={
              'px-2.5 py-1 rounded-md transition-colors duration-150 ' +
              (tab === 'empty'
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-text)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-text)]')
            }
          >Empty</button>
          <button
            onClick={() => setTab('duplicate')}
            className={
              'px-2.5 py-1 rounded-md transition-colors duration-150 ' +
              (tab === 'duplicate'
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-text)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-text)]')
            }
          >Duplicate</button>
        </div>

        {tab === 'empty' ? (
          <div className="space-y-2">
            <label className="text-sm">Title</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My new episode"
              className="w-full bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
            />
            <div className="text-xs text-[var(--color-muted)]">A blank manifest with one narrator and one empty narration segment. You'll fill in the rest.</div>
            <div className="flex justify-end pt-2 gap-2">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-md text-[var(--color-muted)] hover:bg-white/5">Cancel</button>
              <button
                disabled={!title.trim() || working}
                onClick={submitEmpty}
                className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50"
              >Create</button>
            </div>
          </div>
        ) : (
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
                  <option key={e.manifestPath} value={e.manifestPath}>{e.title} — {e.subject}</option>
                ))}
              </select>
            )}
            <div className="text-xs text-[var(--color-muted)]">Creates an editable copy. Bundled episodes stay untouched.</div>
            <div className="flex justify-end pt-2 gap-2">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-md text-[var(--color-muted)] hover:bg-white/5">Cancel</button>
              <button
                disabled={!selectedEp || working}
                onClick={submitDuplicate}
                className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50"
              >Duplicate</button>
            </div>
          </div>
        )}

        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm run build`
Expected: passes.

---

## Task 9: `DraftEditor` shell + `MetadataEditor` + `HostsEditor`

**Files:**
- Modify: `src/renderer/editor/DraftEditor.tsx`
- Create: `src/renderer/editor/forms/MetadataEditor.tsx`
- Create: `src/renderer/editor/forms/HostsEditor.tsx`
- Create: `src/renderer/editor/forms/FormField.tsx`

- [ ] **Step 1: Create `src/renderer/editor/forms/FormField.tsx`** — shared field primitives

```tsx
import type { ReactNode } from 'react'

export function FormField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-[0.15em] text-[var(--color-muted)]">{label}</span>
      {children}
      {hint && <span className="block text-xs text-[var(--color-muted)]">{hint}</span>}
    </label>
  )
}

export function inputClass(invalid = false) {
  return (
    'w-full bg-[var(--color-background)] border rounded-md px-2 py-1.5 text-sm focus:outline-none ' +
    (invalid
      ? 'border-red-500/60 focus:border-red-500'
      : 'border-[var(--color-hairline)] focus:border-[var(--color-accent)]')
  )
}

export function textareaClass(invalid = false) {
  return inputClass(invalid) + ' min-h-[80px] leading-relaxed font-sans'
}
```

- [ ] **Step 2: Create `src/renderer/editor/forms/MetadataEditor.tsx`**

```tsx
import { useEditorStore } from '../editorStore'
import { FormField, inputClass } from './FormField'

export function MetadataEditor() {
  const draft = useEditorStore((s) => s.currentDraft)
  const update = useEditorStore((s) => s.updateDraft)
  if (!draft) return null
  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">Metadata</h2>
      <FormField label="Title">
        <input
          value={draft.title}
          onChange={(e) => update((m) => ({ ...m, title: e.target.value }))}
          className={inputClass()}
        />
      </FormField>
      <FormField label="Subject">
        <input
          value={draft.subject}
          onChange={(e) => update((m) => ({ ...m, subject: e.target.value }))}
          className={inputClass()}
        />
      </FormField>
      <FormField label="Estimated minutes" hint="Used as a rough length indicator in the catalog.">
        <input
          type="number"
          min={1}
          step={1}
          value={draft.estimatedMinutes}
          onChange={(e) => update((m) => ({ ...m, estimatedMinutes: Number(e.target.value) || 1 }))}
          className={inputClass()}
        />
      </FormField>
    </section>
  )
}
```

- [ ] **Step 3: Create `src/renderer/editor/forms/HostsEditor.tsx`**

```tsx
import { useEditorStore } from '../editorStore'
import { FormField, inputClass, textareaClass } from './FormField'

export function HostsEditor() {
  const draft = useEditorStore((s) => s.currentDraft)
  const update = useEditorStore((s) => s.updateDraft)
  if (!draft) return null

  function setHost(idx: number, patch: Partial<typeof draft.hosts[number]>) {
    update((m) => ({
      ...m,
      hosts: m.hosts.map((h, i) => (i === idx ? { ...h, ...patch } : h)),
    }))
  }

  function addHost() {
    update((m) => ({
      ...m,
      hosts: [
        ...m.hosts,
        {
          id: `host_${m.hosts.length}`,
          name: '',
          persona: '',
          voiceRef: 'elevenlabs:iP95p4xoKVk53GoZ742B',
        },
      ],
    }))
  }

  function removeHost(idx: number) {
    update((m) => ({ ...m, hosts: m.hosts.filter((_, i) => i !== idx) }))
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">Hosts</h2>
        <button onClick={addHost} className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5">+ Host</button>
      </div>
      {draft.hosts.map((host, idx) => (
        <div key={idx} className="bg-[var(--color-surface)] border border-[var(--color-hairline)] rounded-md p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <FormField label="ID">
              <input value={host.id} onChange={(e) => setHost(idx, { id: e.target.value })} className={inputClass()} />
            </FormField>
            <FormField label="Name">
              <input value={host.name} onChange={(e) => setHost(idx, { name: e.target.value })} className={inputClass()} />
            </FormField>
          </div>
          <FormField label="Voice ref" hint="elevenlabs:<voiceId> or system:default">
            <input value={host.voiceRef} onChange={(e) => setHost(idx, { voiceRef: e.target.value })} className={inputClass() + ' font-mono'} />
          </FormField>
          <FormField label="Persona">
            <textarea value={host.persona} onChange={(e) => setHost(idx, { persona: e.target.value })} className={textareaClass()} />
          </FormField>
          {draft.hosts.length > 1 && (
            <div className="flex justify-end">
              <button onClick={() => removeHost(idx)} className="text-xs text-[var(--color-muted)] hover:text-red-400">Remove host</button>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
```

- [ ] **Step 4: Replace `src/renderer/editor/DraftEditor.tsx`**

```tsx
import { useEditorStore } from './editorStore'
import { MetadataEditor } from './forms/MetadataEditor'
import { HostsEditor } from './forms/HostsEditor'
import { ChaptersEditor } from './forms/ChaptersEditor'

export function DraftEditor() {
  const draft = useEditorStore((s) => s.currentDraft)
  const dirty = useEditorStore((s) => s.dirty)
  const loading = useEditorStore((s) => s.loadingDraft)
  const close = useEditorStore((s) => s.closeDraft)
  const save = useEditorStore((s) => s.saveDraft)
  const error = useEditorStore((s) => s.error)

  if (loading && !draft) {
    return <div className="p-12 text-[var(--color-muted)]">Loading…</div>
  }
  if (!draft) {
    return <div className="p-12 text-[var(--color-muted)]">No draft open.</div>
  }

  return (
    <div className="p-12 max-w-3xl mx-auto space-y-10">
      <div className="flex items-center justify-between">
        <button onClick={close} className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)] hover:text-[var(--color-text)]">
          ← Drafts
        </button>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-xs text-[var(--color-muted)]">unsaved</span>}
          <button
            onClick={save}
            disabled={!dirty}
            className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}

      <MetadataEditor />
      <HostsEditor />
      <ChaptersEditor />
    </div>
  )
}
```

- [ ] **Step 5: Stub `src/renderer/editor/forms/ChaptersEditor.tsx`** so the build works before Task 10

```tsx
export function ChaptersEditor() {
  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">Chapters</h2>
      <div className="text-[var(--color-muted)] text-sm">Chapter / segment editor coming in next task.</div>
    </section>
  )
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run build`
Expected: passes.

Run: `npm run dev` briefly and confirm:
- Switch to Editor mode
- "+ New project" creates an empty draft and opens it
- Title, subject, and host editing works
- Save persists; closing and re-opening shows persisted state

---

## Task 10: `ChaptersEditor` + `SegmentList` + segment editors + voiceover editor

**Files:**
- Modify: `src/renderer/editor/forms/ChaptersEditor.tsx`
- Create: `src/renderer/editor/forms/SegmentList.tsx`
- Create: `src/renderer/editor/forms/NarrationSegmentEditor.tsx`
- Create: `src/renderer/editor/forms/SongSegmentEditor.tsx`
- Create: `src/renderer/editor/forms/VoiceoverEditor.tsx`

- [ ] **Step 1: Replace `src/renderer/editor/forms/ChaptersEditor.tsx`**

```tsx
import { useEditorStore } from '../editorStore'
import { FormField, inputClass } from './FormField'
import { SegmentList } from './SegmentList'

export function ChaptersEditor() {
  const draft = useEditorStore((s) => s.currentDraft)
  const update = useEditorStore((s) => s.updateDraft)
  if (!draft) return null

  function setChapter(idx: number, title: string) {
    update((m) => ({ ...m, chapters: m.chapters.map((c, i) => i === idx ? { ...c, title } : c) }))
  }
  function addChapter() {
    update((m) => ({
      ...m,
      chapters: [...m.chapters, { title: 'New chapter', segments: [{ type: 'narration', id: `n${Date.now()}`, hostId: m.hosts[0]?.id ?? 'host_a', text: '' }] }],
    }))
  }
  function removeChapter(idx: number) {
    update((m) => ({ ...m, chapters: m.chapters.filter((_, i) => i !== idx) }))
  }
  function moveChapter(idx: number, dir: -1 | 1) {
    update((m) => {
      const next = m.chapters.slice()
      const tgt = idx + dir
      if (tgt < 0 || tgt >= next.length) return m
      ;[next[idx], next[tgt]] = [next[tgt]!, next[idx]!]
      return { ...m, chapters: next }
    })
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">Chapters</h2>
        <button onClick={addChapter} className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5">+ Chapter</button>
      </div>
      {draft.chapters.map((chapter, idx) => (
        <div key={idx} className="bg-[var(--color-surface)] border border-[var(--color-hairline)] rounded-md p-3 space-y-3">
          <div className="flex items-start gap-2">
            <FormField label={`Chapter ${idx + 1} title`}>
              <input value={chapter.title} onChange={(e) => setChapter(idx, e.target.value)} className={inputClass()} />
            </FormField>
            <div className="flex flex-col gap-1 pt-5">
              <button onClick={() => moveChapter(idx, -1)} className="text-xs px-1.5 py-0.5 rounded-sm hover:bg-white/5" aria-label="Move up">↑</button>
              <button onClick={() => moveChapter(idx, 1)} className="text-xs px-1.5 py-0.5 rounded-sm hover:bg-white/5" aria-label="Move down">↓</button>
            </div>
            {draft.chapters.length > 1 && (
              <button onClick={() => removeChapter(idx)} className="text-xs pt-5 px-2 text-[var(--color-muted)] hover:text-red-400">Remove</button>
            )}
          </div>
          <SegmentList chapterIndex={idx} />
        </div>
      ))}
    </section>
  )
}
```

- [ ] **Step 2: Create `src/renderer/editor/forms/SegmentList.tsx`**

```tsx
import { useEditorStore } from '../editorStore'
import { NarrationSegmentEditor } from './NarrationSegmentEditor'
import { SongSegmentEditor } from './SongSegmentEditor'

export function SegmentList({ chapterIndex }: { chapterIndex: number }) {
  const draft = useEditorStore((s) => s.currentDraft)
  const update = useEditorStore((s) => s.updateDraft)
  if (!draft) return null
  const chapter = draft.chapters[chapterIndex]
  if (!chapter) return null

  function addNarration() {
    update((m) => {
      const ch = m.chapters[chapterIndex]!
      const segments = [...ch.segments, { type: 'narration' as const, id: `n${Date.now()}`, hostId: m.hosts[0]?.id ?? 'host_a', text: '' }]
      return { ...m, chapters: m.chapters.map((c, i) => i === chapterIndex ? { ...c, segments } : c) }
    })
  }
  function addSong() {
    update((m) => {
      const ch = m.chapters[chapterIndex]!
      const segments = [
        ...ch.segments,
        {
          type: 'song' as const,
          id: `s${Date.now()}`,
          track: { title: '', artist: '', spotifyUri: '' },
          startAtSeconds: 0,
          playSeconds: 90,
        },
      ]
      return { ...m, chapters: m.chapters.map((c, i) => i === chapterIndex ? { ...c, segments } : c) }
    })
  }
  function removeSegment(segIdx: number) {
    update((m) => ({
      ...m,
      chapters: m.chapters.map((c, i) =>
        i === chapterIndex ? { ...c, segments: c.segments.filter((_, j) => j !== segIdx) } : c
      ),
    }))
  }
  function moveSegment(segIdx: number, dir: -1 | 1) {
    update((m) => {
      const ch = m.chapters[chapterIndex]!
      const segs = ch.segments.slice()
      const tgt = segIdx + dir
      if (tgt < 0 || tgt >= segs.length) return m
      ;[segs[segIdx], segs[tgt]] = [segs[tgt]!, segs[segIdx]!]
      return { ...m, chapters: m.chapters.map((c, i) => i === chapterIndex ? { ...c, segments: segs } : c) }
    })
  }

  return (
    <div className="space-y-3 pl-3 border-l border-[var(--color-hairline)]">
      {chapter.segments.map((segment, segIdx) => (
        <div key={segIdx} className="bg-[var(--color-background)]/60 border border-[var(--color-hairline)] rounded-md p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs tracking-[0.15em] uppercase text-[var(--color-muted)]">
              {segment.type === 'narration' ? 'Narration' : 'Song'} — segment {segIdx + 1}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => moveSegment(segIdx, -1)} className="text-xs px-1.5 py-0.5 rounded-sm hover:bg-white/5" aria-label="Move up">↑</button>
              <button onClick={() => moveSegment(segIdx, 1)} className="text-xs px-1.5 py-0.5 rounded-sm hover:bg-white/5" aria-label="Move down">↓</button>
              <button onClick={() => removeSegment(segIdx)} className="text-xs px-2 py-0.5 text-[var(--color-muted)] hover:text-red-400">Remove</button>
            </div>
          </div>
          {segment.type === 'narration' ? (
            <NarrationSegmentEditor chapterIndex={chapterIndex} segmentIndex={segIdx} />
          ) : (
            <SongSegmentEditor chapterIndex={chapterIndex} segmentIndex={segIdx} />
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <button onClick={addNarration} className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5">+ Narration</button>
        <button onClick={addSong} className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5">+ Song</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `src/renderer/editor/forms/NarrationSegmentEditor.tsx`**

```tsx
import { useEditorStore } from '../editorStore'
import { FormField, inputClass, textareaClass } from './FormField'

export function NarrationSegmentEditor({ chapterIndex, segmentIndex }: { chapterIndex: number; segmentIndex: number }) {
  const draft = useEditorStore((s) => s.currentDraft)
  const update = useEditorStore((s) => s.updateDraft)
  if (!draft) return null
  const seg = draft.chapters[chapterIndex]?.segments[segmentIndex]
  if (!seg || seg.type !== 'narration') return null

  function setField<K extends keyof typeof seg>(key: K, value: (typeof seg)[K]) {
    update((m) => ({
      ...m,
      chapters: m.chapters.map((c, ci) => ci !== chapterIndex ? c : {
        ...c,
        segments: c.segments.map((s, si) => si !== segmentIndex ? s : { ...(s as any), [key]: value }),
      }),
    }))
  }

  const hostExists = draft.hosts.some((h) => h.id === seg.hostId)
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <FormField label="Segment ID">
          <input value={seg.id} onChange={(e) => setField('id', e.target.value)} className={inputClass()} />
        </FormField>
        <FormField label="Host">
          <select
            value={seg.hostId}
            onChange={(e) => setField('hostId', e.target.value)}
            className={inputClass(!hostExists)}
          >
            {draft.hosts.map((h) => <option key={h.id} value={h.id}>{h.name || h.id}</option>)}
            {!hostExists && <option value={seg.hostId}>⚠ {seg.hostId} (unknown)</option>}
          </select>
        </FormField>
      </div>
      <FormField label="Narration text">
        <textarea value={seg.text} onChange={(e) => setField('text', e.target.value)} className={textareaClass()} />
      </FormField>
    </div>
  )
}
```

- [ ] **Step 4: Create `src/renderer/editor/forms/SongSegmentEditor.tsx`**

```tsx
import { useEditorStore } from '../editorStore'
import { FormField, inputClass, textareaClass } from './FormField'
import { VoiceoverEditor } from './VoiceoverEditor'

const SPOTIFY_URI_RE = /^spotify:track:[A-Za-z0-9]+$/

export function SongSegmentEditor({ chapterIndex, segmentIndex }: { chapterIndex: number; segmentIndex: number }) {
  const draft = useEditorStore((s) => s.currentDraft)
  const update = useEditorStore((s) => s.updateDraft)
  if (!draft) return null
  const seg = draft.chapters[chapterIndex]?.segments[segmentIndex]
  if (!seg || seg.type !== 'song') return null

  function setSegField(patch: Partial<typeof seg>) {
    update((m) => ({
      ...m,
      chapters: m.chapters.map((c, ci) => ci !== chapterIndex ? c : {
        ...c,
        segments: c.segments.map((s, si) => si !== segmentIndex ? s : { ...(s as any), ...patch }),
      }),
    }))
  }

  function setTrack(patch: Partial<typeof seg.track>) {
    setSegField({ track: { ...seg.track, ...patch } })
  }

  function addVoiceover() {
    setSegField({
      voiceovers: [
        ...(seg.voiceovers ?? []),
        {
          id: `vo${Date.now()}`,
          hostId: draft.hosts[0]?.id ?? 'host_a',
          text: '',
          atSeconds: 0,
          duckTo: 55,
          holdDuck: false,
        },
      ],
    })
  }
  function removeVoiceover(idx: number) {
    setSegField({ voiceovers: (seg.voiceovers ?? []).filter((_, i) => i !== idx) })
  }

  const uriInvalid = seg.track.spotifyUri.length > 0 && !SPOTIFY_URI_RE.test(seg.track.spotifyUri)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <FormField label="Track title">
          <input value={seg.track.title} onChange={(e) => setTrack({ title: e.target.value })} className={inputClass()} />
        </FormField>
        <FormField label="Artist">
          <input value={seg.track.artist} onChange={(e) => setTrack({ artist: e.target.value })} className={inputClass()} />
        </FormField>
      </div>
      <FormField label="Spotify URI" hint="spotify:track:<id> — right-click track in Spotify → Share → Copy Spotify URI">
        <input
          value={seg.track.spotifyUri}
          onChange={(e) => setTrack({ spotifyUri: e.target.value })}
          className={inputClass(uriInvalid) + ' font-mono'}
          placeholder="spotify:track:..."
        />
      </FormField>
      <div className="grid grid-cols-3 gap-2">
        <FormField label="Start at (s)">
          <input type="number" min={0} step={1} value={seg.startAtSeconds} onChange={(e) => setSegField({ startAtSeconds: Number(e.target.value) || 0 })} className={inputClass()} />
        </FormField>
        <FormField label="Play seconds">
          <input type="number" min={1} step={1} value={seg.playSeconds} onChange={(e) => setSegField({ playSeconds: Number(e.target.value) || 1 })} className={inputClass()} />
        </FormField>
        <FormField label="Why this track">
          <input value={seg.why ?? ''} onChange={(e) => setSegField({ why: e.target.value })} className={inputClass()} />
        </FormField>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs tracking-[0.15em] uppercase text-[var(--color-muted)]">Voiceovers</div>
          <button onClick={addVoiceover} className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5">+ Voiceover</button>
        </div>
        {(seg.voiceovers ?? []).map((_, voIdx) => (
          <VoiceoverEditor
            key={voIdx}
            chapterIndex={chapterIndex}
            segmentIndex={segmentIndex}
            voiceoverIndex={voIdx}
            onRemove={() => removeVoiceover(voIdx)}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create `src/renderer/editor/forms/VoiceoverEditor.tsx`**

```tsx
import { useEditorStore } from '../editorStore'
import { FormField, inputClass, textareaClass } from './FormField'

interface VoiceoverEditorProps {
  chapterIndex: number
  segmentIndex: number
  voiceoverIndex: number
  onRemove: () => void
}

export function VoiceoverEditor({ chapterIndex, segmentIndex, voiceoverIndex, onRemove }: VoiceoverEditorProps) {
  const draft = useEditorStore((s) => s.currentDraft)
  const update = useEditorStore((s) => s.updateDraft)
  if (!draft) return null
  const seg = draft.chapters[chapterIndex]?.segments[segmentIndex]
  if (!seg || seg.type !== 'song') return null
  const vo = seg.voiceovers?.[voiceoverIndex]
  if (!vo) return null

  function setField<K extends keyof typeof vo>(key: K, value: (typeof vo)[K]) {
    update((m) => ({
      ...m,
      chapters: m.chapters.map((c, ci) => ci !== chapterIndex ? c : {
        ...c,
        segments: c.segments.map((s, si) => {
          if (si !== segmentIndex || s.type !== 'song') return s
          const voiceovers = (s.voiceovers ?? []).map((v, vi) => vi !== voiceoverIndex ? v : { ...v, [key]: value })
          return { ...s, voiceovers }
        }),
      }),
    }))
  }

  const hostExists = draft.hosts.some((h) => h.id === vo.hostId)
  return (
    <div className="border border-[var(--color-hairline)] rounded-md p-2 space-y-2 bg-[var(--color-surface)]/60">
      <div className="grid grid-cols-3 gap-2">
        <FormField label="VO ID">
          <input value={vo.id} onChange={(e) => setField('id', e.target.value)} className={inputClass()} />
        </FormField>
        <FormField label="Host">
          <select value={vo.hostId} onChange={(e) => setField('hostId', e.target.value)} className={inputClass(!hostExists)}>
            {draft.hosts.map((h) => <option key={h.id} value={h.id}>{h.name || h.id}</option>)}
            {!hostExists && <option value={vo.hostId}>⚠ {vo.hostId}</option>}
          </select>
        </FormField>
        <FormField label="At (s)">
          <input type="number" min={0} step={1} value={vo.atSeconds} onChange={(e) => setField('atSeconds', Number(e.target.value) || 0)} className={inputClass()} />
        </FormField>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <FormField label="Duck to %" hint="0–100, default 55">
          <input type="number" min={0} max={100} step={1} value={vo.duckTo} onChange={(e) => setField('duckTo', Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className={inputClass()} />
        </FormField>
        <label className="flex items-center gap-2 text-xs pt-5">
          <input type="checkbox" checked={vo.holdDuck} onChange={(e) => setField('holdDuck', e.target.checked)} />
          <span>Hold duck (chain to next VO)</span>
        </label>
        <div className="pt-5 flex justify-end">
          <button onClick={onRemove} className="text-xs text-[var(--color-muted)] hover:text-red-400">Remove</button>
        </div>
      </div>
      <FormField label="Voiceover text">
        <textarea value={vo.text} onChange={(e) => setField('text', e.target.value)} className={textareaClass()} />
      </FormField>
    </div>
  )
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run build`
Expected: passes.

Run: `npm run dev` briefly. In Editor mode, duplicate a bundled episode and confirm:
- All chapters, segments, voiceovers are editable.
- Reorder chapters/segments works.
- Saving and reopening preserves edits.

---

## Task 11: `CoverEditor` — cover replacement

**Files:**
- Create: `src/renderer/editor/forms/CoverEditor.tsx`
- Modify: `src/renderer/editor/DraftEditor.tsx`

We need a way for the renderer to pick a file. Use `<input type="file" accept="image/*">` — Chromium gives us the user-chosen `File` object. To get a real path we can pass to main, use the existing Electron behavior: in non-sandboxed renderers, files from `<input>` carry a `path` property.

- [ ] **Step 1: Create `src/renderer/editor/forms/CoverEditor.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useEditorStore } from '../editorStore'

export function CoverEditor() {
  const draftId = useEditorStore((s) => s.currentDraftId)
  const [coverSrc, setCoverSrc] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    if (!draftId) return
    const url = await window.deepcuts.drafts.coverUrl(draftId).catch(() => null)
    setCoverSrc(url ? `${url}?ts=${Date.now()}` : null)
  }
  useEffect(() => { refresh() }, [draftId])

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    if (!draftId) return
    const file = e.target.files?.[0] as (File & { path?: string }) | undefined
    if (!file) return
    if (!file.path) { setError('Could not access file path.'); return }
    setWorking(true); setError(null)
    try {
      await window.deepcuts.drafts.setCover(draftId, file.path)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cover update failed')
    } finally { setWorking(false) }
    e.target.value = ''
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">Cover</h2>
      <div className="flex items-start gap-4">
        <div className="w-40 h-40 rounded-md bg-[var(--color-surface)] border border-[var(--color-hairline)] overflow-hidden flex items-center justify-center text-[var(--color-muted)]">
          {coverSrc ? <img src={coverSrc} alt="Cover" className="w-full h-full object-cover" /> : <span className="text-xs uppercase tracking-wide">No cover</span>}
        </div>
        <div className="space-y-2">
          <label className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-hairline)] hover:bg-white/5 inline-block cursor-pointer">
            {working ? 'Saving…' : coverSrc ? 'Replace cover…' : 'Choose cover…'}
            <input type="file" accept="image/*" onChange={pick} disabled={working} className="hidden" />
          </label>
          {error && <div className="text-xs text-red-400">{error}</div>}
          <div className="text-xs text-[var(--color-muted)]">PNG, JPG, or WebP. Square works best.</div>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Wire `CoverEditor` into `DraftEditor.tsx`**

Modify the imports + body. Replace the imports section and the JSX section.

Imports addition:
```tsx
import { CoverEditor } from './forms/CoverEditor'
```

Insert `<CoverEditor />` between `<MetadataEditor />` and `<HostsEditor />` so the layout becomes:

```tsx
<MetadataEditor />
<CoverEditor />
<HostsEditor />
<ChaptersEditor />
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: passes.

Run: `npm run dev`, open a draft, click "Choose cover…", pick an image, confirm it appears.

---

## Task 12: Preview integration

**Files:**
- Modify: `src/renderer/player/playerStore.ts`
- Create: `src/renderer/editor/DraftPreviewBanner.tsx`
- Modify: `src/renderer/editor/editorStore.ts`
- Modify: `src/renderer/editor/DraftList.tsx`
- Modify: `src/renderer/editor/DraftEditor.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Add `startWithManifest` to `playerStore.ts`**

Add the action to the interface:
```ts
startWithManifest(manifest: EpisodeManifest): Promise<void>
```

And implement it inside the `create((set, get) => ({ ... }))` block alongside `openAndPlay`:

```ts
async startWithManifest(manifest: EpisodeManifest) {
  currentHostCount = manifest.hosts.length
  await scheduler.start(manifest, { hasElevenLabsKey: get().hasElevenLabsKey })
},
```

Refactor `openAndPlay` to delegate:

```ts
async openAndPlay(manifestPath: string) {
  const raw = (await window.deepcuts.manifest.load(manifestPath)) as unknown
  const manifest: EpisodeManifest = episodeManifestSchema.parse(raw)
  await get().startWithManifest(manifest)
},
```

- [ ] **Step 2: Add preview state to `editorStore.ts`**

Append to the interface:
```ts
previewingDraftId: string | null
startPreview(draftId: string): Promise<{ ok: true } | { ok: false; errors: string[] }>
exitPreview(): void
```

In the initial state add `previewingDraftId: null`.

Add the methods (use the strict `episodeManifestSchema` for validation):

```ts
async startPreview(draftId) {
  try {
    const raw = await window.deepcuts.drafts.load(draftId)
    const parsed = episodeManifestSchema.safeParse(raw)
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message) }
    }
    set({ previewingDraftId: draftId })
    await usePlayerStore.getState().startWithManifest(parsed.data)
    return { ok: true }
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : 'Preview failed'] }
  }
},

exitPreview() {
  usePlayerStore.getState().stop()
  set({ previewingDraftId: null })
},
```

Update imports at the top:
```ts
import { draftManifestSchema, episodeManifestSchema, type DraftManifest, type DraftSummary } from '../../shared/manifest'
import { usePlayerStore } from '../player/playerStore'
```

- [ ] **Step 3: Create `src/renderer/editor/DraftPreviewBanner.tsx`**

```tsx
import { useEditorStore } from './editorStore'

export function DraftPreviewBanner() {
  const exit = useEditorStore((s) => s.exitPreview)
  return (
    <div className="fixed top-9 left-0 right-0 z-40 px-4 py-1.5 bg-[var(--color-accent)]/15 border-b border-[var(--color-accent)]/30 text-xs text-center">
      Previewing draft.{' '}
      <button onClick={exit} className="underline text-[var(--color-accent)] hover:text-[var(--color-text)]">
        Exit preview
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Wire Preview button in `DraftList.tsx`** — replace the empty `onPreview` handler

```tsx
onPreview={async () => {
  const result = await useEditorStore.getState().startPreview(d.draftId)
  if (!result.ok) {
    alert('Cannot preview — manifest is incomplete:\n\n' + result.errors.join('\n'))
  }
}}
```

- [ ] **Step 5: Add a Preview button in `DraftEditor.tsx`**

In the top toolbar (next to Save), add:

```tsx
<button
  onClick={async () => {
    const id = useEditorStore.getState().currentDraftId
    if (!id) return
    const dirty = useEditorStore.getState().dirty
    if (dirty) {
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
```

Place it immediately before the Save button.

- [ ] **Step 6: Render the banner + Player when previewing in `App.tsx`**

Replace the previous return block with:

```tsx
import { useEditorStore } from './editor/editorStore'
import { DraftPreviewBanner } from './editor/DraftPreviewBanner'

// inside App():
const previewing = useEditorStore((s) => s.previewingDraftId)
const playerActive = status !== 'idle' && status !== 'done'

return (
  <main className="min-h-screen">
    <div className="drag fixed top-0 left-0 right-0 h-9 z-50" aria-hidden />
    <div className="fixed top-1.5 right-3 z-[60]">
      <ModeToggle />
    </div>
    {previewing && <DraftPreviewBanner />}
    {previewing && playerActive ? (
      <Player />
    ) : appMode === 'editor' ? (
      <EditorView />
    ) : playerActive ? (
      <Player />
    ) : (
      <Catalog />
    )}
    {showSettings && <Settings onClose={() => setShowSettings(false)} />}
  </main>
)
```

Add the imports:
```tsx
import { useEditorStore } from './editor/editorStore'
import { DraftPreviewBanner } from './editor/DraftPreviewBanner'
```

- [ ] **Step 7: When preview ends (player status becomes done), auto-exit**

In the same App.tsx, add an effect that watches the player status while previewing:

```tsx
useEffect(() => {
  if (previewing && status === 'done') {
    useEditorStore.getState().exitPreview()
  }
}, [previewing, status])
```

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass.

Run: `npm run dev`. In Editor mode, duplicate "The Long Song", click Preview. The Player should appear with the preview banner. Hit "Exit preview" → return to editor.

---

## Task 13: Final wiring, polish, full verify

**Files:**
- Modify: `README.md` (add an "Editor" section)

- [ ] **Step 1: Update `README.md`** — append a section

```markdown
## Editor

Open the app, click the **Editor** pill at the top right.

- **+ New project** — start from a blank manifest or duplicate one of the bundled episodes for editing.
- Edit any field — title, subject, hosts, chapter structure, narration text, song picks, voiceover timing.
- **Preview** plays the draft using the same player as the bundled episodes, with a banner indicating preview mode. Exit preview returns to the editor.
- Drafts are stored locally under `~/Library/Application Support/deepcuts/drafts/<id>/`.

Publishing drafts to the library catalog comes in a later spec.
```

- [ ] **Step 2: Final gates**

Run: `npm run typecheck`
Expected: passes.

Run: `npm test`
Expected: all tests pass (existing + new schema + drafts module + editorStore tests).

Run: `npm run build`
Expected: clean.

Run: `npm run dev`. Walk through the end-to-end:
1. Toggle to Editor.
2. Click + New project → Duplicate → pick "The Long Song" → opens in editor.
3. Edit narrator name from "The Narrator" to "Itai", save.
4. Click Preview → episode starts with new name in the now-playing label.
5. Exit preview → back to editor.
6. Return to Drafts list, delete the draft → confirmation → draft gone.
7. Toggle back to Library → bundled episodes unchanged.

---

## Self-review

**1. Spec coverage:**

| Spec requirement | Task |
|---|---|
| Mode toggle (Library/Editor) persisted | 4, 5 |
| Drafts under `userData/drafts/<id>/` | 2 |
| Bundled `episodes/` read-only | 2 (no write paths to episodesRoot) |
| `draftManifestSchema` (permissive) | 1 |
| Strict validation only on Preview | 12 (`episodeManifestSchema.safeParse`) |
| IPC: list/load/save/create/delete/duplicate/coverUrl/setCover | 3 |
| `editorStore` with refresh/open/update/save/createEmpty/duplicate/remove | 6 |
| Editor screen with cards | 7 |
| New project modal (Empty + Duplicate) | 8 |
| Metadata + Hosts editing | 9 |
| Chapters + Segments + Voiceovers editing | 10 |
| Cover replacement | 11 |
| Preview via existing player + banner | 12 |
| README updated | 13 |
| Tests for schema, drafts module, editorStore | 1, 2, 6 |

All spec sections mapped to tasks.

**2. Placeholder scan:** No "TBD", "TODO", "fill in details" in the plan. Every step has complete code or a concrete verification command.

**3. Type consistency:**
- `DraftSummary` defined in Task 1 and used in Tasks 2, 3, 6, 7.
- `DraftManifest` defined in Task 1 and used in Tasks 2, 6.
- `window.deepcuts.drafts.*` method names match exactly between Tasks 3 (preload) and 6 (editorStore use).
- `useEditorStore` actions match between definition (Task 6) and consumers (Tasks 7, 8, 9, 10, 11, 12).
- `startWithManifest` signature in Task 12 matches the call site in `startPreview`.
