# Publish to Library Implementation Plan (Spec E)

**Goal:** Drafts become playable library entries via Publish. Library entries show next to bundled episodes in the catalog.

## File structure

```
src/
  main/
    library.ts                            # NEW — CRUD over <userData>/library/<id>/
    library.test.ts                       # NEW — unit tests
    ipc.ts                                # MODIFY — register library:* handlers
  preload/
    index.ts                              # MODIFY — surface library API
  shared/
    manifest.ts                           # MODIFY — export LibrarySummary type
    ipcSchema.ts                          # MODIFY — library:* channel constants
  renderer/
    catalog/
      Catalog.tsx                         # MODIFY — combine bundled + library entries
      loadLocal.ts                        # MODIFY — fetch + tag with source
    editor/
      DraftEditor.tsx                     # MODIFY — Publish/Unpublish buttons
```

## Tasks

1. Add LibrarySummary type + ipc channels
2. `library.ts` module + tests
3. IPC handlers + preload bridge
4. Catalog combined list (bundled + library)
5. DraftEditor publish controls
6. Final verify

---

### Task 1: Shared types + channels

**Files:** Modify `src/shared/manifest.ts`, `src/shared/ipcSchema.ts`

- [ ] **Step 1: Add `LibrarySummary` to `src/shared/manifest.ts`** (after `DraftSummary`)

```ts
export interface LibrarySummary {
  libraryId: string
  title: string
  subject: string
  hostCount: number
  segmentCount: number
  estimatedMinutes: number
  hasCover: boolean
  publishedAt: number
}
```

- [ ] **Step 2: Add channel constants in `src/shared/ipcSchema.ts`**

Append inside the `IpcChannels` object:

```ts
  LibraryList: 'library:list',
  LibraryPublish: 'library:publish',
  LibraryUnpublish: 'library:unpublish',
  LibraryLoadManifest: 'library:loadManifest',
  LibraryCoverUrl: 'library:coverUrl',
  LibraryIsPublished: 'library:isPublished',
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: passes.

---

### Task 2: `library.ts` + tests

**Files:** Create `src/main/library.ts`, `src/main/library.test.ts`

- [ ] **Step 1: Write the tests** at `src/main/library.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLibrary } from './library'
import type { EpisodeManifest } from '../shared/manifest'

const mkTmp = async () => {
  const d = join(tmpdir(), 'deepcuts-library-' + Math.random().toString(36).slice(2))
  await fs.mkdir(d, { recursive: true })
  return d
}

function strictManifest(over: Partial<EpisodeManifest> = {}): EpisodeManifest {
  return {
    schemaVersion: 1,
    id: 'x',
    title: 'X',
    subject: 'S',
    coverImage: '',
    estimatedMinutes: 5,
    hosts: [{ id: 'h', name: 'H', persona: '', voiceRef: 'system:default' }],
    chapters: [
      {
        title: 'C',
        segments: [{ type: 'narration', id: 'n0', hostId: 'h', text: 'hello' }],
      },
    ],
    sources: [],
    facts: [],
    ...over,
  }
}

describe('library module', () => {
  it('publishes a strict-valid draft, copies manifest and cover', async () => {
    const libRoot = await mkTmp()
    const draftsRoot = await mkTmp()
    const draftId = 'abcd1234abcd1234'
    const draftDir = join(draftsRoot, draftId)
    await fs.mkdir(draftDir, { recursive: true })
    await fs.writeFile(join(draftDir, 'manifest.json'), JSON.stringify(strictManifest({ title: 'My ep' })))
    await fs.writeFile(join(draftDir, 'cover.png'), 'fake')
    const lib = createLibrary({ libraryRoot: () => libRoot, draftsRoot: () => draftsRoot })
    const id = await lib.publish(draftId)
    expect(id).toBe(draftId)
    const onDisk = JSON.parse(await fs.readFile(join(libRoot, id, 'manifest.json'), 'utf-8'))
    expect(onDisk.title).toBe('My ep')
    await fs.access(join(libRoot, id, 'cover.png'))  // throws if missing
  })

  it('rejects publishing an incomplete draft (strict schema)', async () => {
    const libRoot = await mkTmp()
    const draftsRoot = await mkTmp()
    const draftId = 'abcd1234abcd1234'
    const draftDir = join(draftsRoot, draftId)
    await fs.mkdir(draftDir, { recursive: true })
    // Title intentionally empty (fails strict).
    await fs.writeFile(join(draftDir, 'manifest.json'), JSON.stringify(strictManifest({ title: '' })))
    const lib = createLibrary({ libraryRoot: () => libRoot, draftsRoot: () => draftsRoot })
    await expect(lib.publish(draftId)).rejects.toThrow(/title|required|String must contain/i)
  })

  it('lists library entries with summary', async () => {
    const libRoot = await mkTmp()
    const draftsRoot = await mkTmp()
    const draftId = 'abcd1234abcd1234'
    const draftDir = join(draftsRoot, draftId)
    await fs.mkdir(draftDir, { recursive: true })
    await fs.writeFile(
      join(draftDir, 'manifest.json'),
      JSON.stringify(strictManifest({ title: 'Listed', subject: 'sub' })),
    )
    const lib = createLibrary({ libraryRoot: () => libRoot, draftsRoot: () => draftsRoot })
    await lib.publish(draftId)
    const list = await lib.listLibrary()
    expect(list).toHaveLength(1)
    expect(list[0]!.title).toBe('Listed')
    expect(list[0]!.libraryId).toBe(draftId)
  })

  it('unpublish removes the library entry', async () => {
    const libRoot = await mkTmp()
    const draftsRoot = await mkTmp()
    const draftId = 'abcd1234abcd1234'
    const draftDir = join(draftsRoot, draftId)
    await fs.mkdir(draftDir, { recursive: true })
    await fs.writeFile(join(draftDir, 'manifest.json'), JSON.stringify(strictManifest()))
    const lib = createLibrary({ libraryRoot: () => libRoot, draftsRoot: () => draftsRoot })
    await lib.publish(draftId)
    expect(await lib.isPublished(draftId)).toBe(true)
    await lib.unpublish(draftId)
    expect(await lib.isPublished(draftId)).toBe(false)
    expect(await lib.listLibrary()).toHaveLength(0)
  })

  it('isPublished is false when no library entry exists', async () => {
    const libRoot = await mkTmp()
    const draftsRoot = await mkTmp()
    const lib = createLibrary({ libraryRoot: () => libRoot, draftsRoot: () => draftsRoot })
    expect(await lib.isPublished('abcd1234abcd1234')).toBe(false)
  })

  it('rejects unsafe ids', async () => {
    const libRoot = await mkTmp()
    const draftsRoot = await mkTmp()
    const lib = createLibrary({ libraryRoot: () => libRoot, draftsRoot: () => draftsRoot })
    await expect(lib.publish('../etc/passwd')).rejects.toThrow()
    await expect(lib.unpublish('../etc/passwd')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/library.ts`**

```ts
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { episodeManifestSchema, type EpisodeManifest, type LibrarySummary } from '../shared/manifest'

const ID_RE = /^[a-f0-9]{16}$/

export interface LibraryDeps {
  libraryRoot: () => string
  draftsRoot: () => string
}

function assertSafeId(id: string): void {
  if (!ID_RE.test(id)) throw new Error(`Unsafe libraryId: ${id}`)
}

export function createLibrary(deps: LibraryDeps) {
  const libRoot = deps.libraryRoot
  const drafts = deps.draftsRoot

  async function ensureRoot(): Promise<void> {
    await fs.mkdir(libRoot(), { recursive: true })
  }

  async function listLibrary(): Promise<LibrarySummary[]> {
    await ensureRoot()
    const dirs = await fs.readdir(libRoot(), { withFileTypes: true }).catch(() => [])
    const out: LibrarySummary[] = []
    for (const entry of dirs) {
      if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue
      const id = entry.name
      const manifestPath = join(libRoot(), id, 'manifest.json')
      try {
        const raw = await fs.readFile(manifestPath, 'utf-8')
        const m = JSON.parse(raw) as EpisodeManifest
        const stat = await fs.stat(manifestPath)
        const hasCover = await fs.access(join(libRoot(), id, 'cover.png')).then(() => true).catch(() => false)
        const segmentCount = m.chapters.reduce((s, c) => s + c.segments.length, 0)
        out.push({
          libraryId: id,
          title: m.title,
          subject: m.subject,
          hostCount: m.hosts.length,
          segmentCount,
          estimatedMinutes: m.estimatedMinutes,
          hasCover,
          publishedAt: stat.mtimeMs,
        })
      } catch {
        // skip corrupt entries
      }
    }
    out.sort((a, b) => b.publishedAt - a.publishedAt)
    return out
  }

  async function publish(draftId: string): Promise<string> {
    assertSafeId(draftId)
    const draftManifestPath = join(drafts(), draftId, 'manifest.json')
    const raw = await fs.readFile(draftManifestPath, 'utf-8')
    const manifest = episodeManifestSchema.parse(JSON.parse(raw))  // strict
    const libDir = join(libRoot(), draftId)
    await fs.mkdir(libDir, { recursive: true })
    await fs.writeFile(join(libDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    // copy cover if present in the draft
    const draftCover = join(drafts(), draftId, 'cover.png')
    const libCover = join(libDir, 'cover.png')
    await fs.copyFile(draftCover, libCover).catch(() => {
      // No draft cover — leave library entry without one.
    })
    return draftId
  }

  async function unpublish(libraryId: string): Promise<void> {
    assertSafeId(libraryId)
    await fs.rm(join(libRoot(), libraryId), { recursive: true, force: true })
  }

  async function loadManifest(libraryId: string): Promise<EpisodeManifest> {
    assertSafeId(libraryId)
    const raw = await fs.readFile(join(libRoot(), libraryId, 'manifest.json'), 'utf-8')
    return episodeManifestSchema.parse(JSON.parse(raw))
  }

  async function coverUrl(libraryId: string): Promise<string | null> {
    assertSafeId(libraryId)
    const path = join(libRoot(), libraryId, 'cover.png')
    const exists = await fs.access(path).then(() => true).catch(() => false)
    return exists ? 'file://' + path : null
  }

  async function isPublished(draftId: string): Promise<boolean> {
    if (!ID_RE.test(draftId)) return false
    return fs
      .access(join(libRoot(), draftId, 'manifest.json'))
      .then(() => true)
      .catch(() => false)
  }

  return { listLibrary, publish, unpublish, loadManifest, coverUrl, isPublished }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 6 new library tests pass + all existing.

---

### Task 3: IPC handlers + preload

**Files:** Modify `src/main/ipc.ts`, `src/preload/index.ts`

- [ ] **Step 1: Update `src/main/ipc.ts`** — register library handlers

Add import:

```ts
import { createLibrary } from './library'
```

Inside `registerIpc()` after the drafts setup, add:

```ts
  const library = createLibrary({
    libraryRoot: () => join(app.getPath('userData'), 'library'),
    draftsRoot: () => join(app.getPath('userData'), 'drafts'),
  })

  ipcMain.handle(IpcChannels.LibraryList, wrap(() => library.listLibrary()))
  ipcMain.handle(IpcChannels.LibraryPublish, wrap((draftId: string) => library.publish(draftId)))
  ipcMain.handle(IpcChannels.LibraryUnpublish, wrap((id: string) => library.unpublish(id)))
  ipcMain.handle(IpcChannels.LibraryLoadManifest, wrap((id: string) => library.loadManifest(id)))
  ipcMain.handle(IpcChannels.LibraryCoverUrl, wrap((id: string) => library.coverUrl(id)))
  ipcMain.handle(IpcChannels.LibraryIsPublished, wrap((id: string) => library.isPublished(id)))
```

- [ ] **Step 2: Update `src/preload/index.ts`** — surface library API

Add to the `api` object alongside `drafts`:

```ts
  library: {
    list: () => invoke<import('../shared/manifest').LibrarySummary[]>(IpcChannels.LibraryList),
    publish: (draftId: string) => invoke<string>(IpcChannels.LibraryPublish, draftId),
    unpublish: (libraryId: string) => invoke<void>(IpcChannels.LibraryUnpublish, libraryId),
    loadManifest: (libraryId: string) => invoke<unknown>(IpcChannels.LibraryLoadManifest, libraryId),
    coverUrl: (libraryId: string) => invoke<string | null>(IpcChannels.LibraryCoverUrl, libraryId),
    isPublished: (draftId: string) => invoke<boolean>(IpcChannels.LibraryIsPublished, draftId),
  },
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: passes.

---

### Task 4: Catalog UI shows bundled + library

**Files:** Modify `src/renderer/catalog/loadLocal.ts`, `src/renderer/catalog/Catalog.tsx`

- [ ] **Step 1: Update `src/renderer/catalog/loadLocal.ts`**

```ts
import { catalogIndexSchema } from '../../shared/catalog'
import { episodeManifestSchema, type EpisodeManifest, type LibrarySummary } from '../../shared/manifest'

export interface UnifiedCatalogEntry {
  source: 'bundled' | 'library'
  id: string                 // manifestPath for bundled, libraryId for library
  title: string
  subject: string
  coverImage: string         // file:// URL (library) or repo-relative (bundled)
  estimatedMinutes: number
}

export async function loadUnifiedCatalog(): Promise<UnifiedCatalogEntry[]> {
  const [bundledRaw, libraryRaw] = await Promise.all([
    window.deepcuts.catalog.loadLocal(),
    window.deepcuts.library.list(),
  ])
  const bundled = catalogIndexSchema.parse(bundledRaw)
  const bundledEntries: UnifiedCatalogEntry[] = bundled.episodes.map((e) => ({
    source: 'bundled',
    id: e.manifestPath,
    title: e.title,
    subject: e.subject,
    coverImage: e.coverImage,
    estimatedMinutes: e.estimatedMinutes,
  }))
  const libraryEntries: UnifiedCatalogEntry[] = await Promise.all(
    (libraryRaw as LibrarySummary[]).map(async (l) => ({
      source: 'library' as const,
      id: l.libraryId,
      title: l.title,
      subject: l.subject,
      coverImage: (await window.deepcuts.library.coverUrl(l.libraryId)) ?? '',
      estimatedMinutes: l.estimatedMinutes,
    })),
  )
  return [...libraryEntries, ...bundledEntries]
}

export async function loadEpisodeManifest(entry: UnifiedCatalogEntry): Promise<EpisodeManifest> {
  const raw =
    entry.source === 'library'
      ? await window.deepcuts.library.loadManifest(entry.id)
      : await window.deepcuts.manifest.load(entry.id)
  return episodeManifestSchema.parse(raw)
}
```

- [ ] **Step 2: Update `src/renderer/catalog/Catalog.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Cover } from '../ui/Cover'
import { loadEpisodeManifest, loadUnifiedCatalog, type UnifiedCatalogEntry } from './loadLocal'
import { usePlayerStore } from '../player/playerStore'

export function Catalog() {
  const [entries, setEntries] = useState<UnifiedCatalogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const startWithManifest = usePlayerStore((s) => s.startWithManifest)

  async function refresh() {
    try {
      const list = await loadUnifiedCatalog()
      setEntries(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load catalog')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function play(entry: UnifiedCatalogEntry) {
    const manifest = await loadEpisodeManifest(entry)
    await startWithManifest(manifest)
  }

  async function unpublish(entry: UnifiedCatalogEntry) {
    if (entry.source !== 'library') return
    if (!window.confirm(`Unpublish "${entry.title}"? It'll be removed from your library but the draft stays.`)) {
      return
    }
    await window.deepcuts.library.unpublish(entry.id)
    await refresh()
  }

  if (error) return <div className="p-8 text-[var(--color-muted)]">{error}</div>
  if (!entries) return <div className="p-8 text-[var(--color-muted)]">Loading…</div>

  return (
    <div className="p-12 max-w-5xl mx-auto">
      <div className="text-xs tracking-[0.2em] uppercase text-[var(--color-muted)] mb-2">Deepcuts</div>
      <h1 className="text-2xl font-medium mb-12">Listening documentaries</h1>
      {entries.length === 0 ? (
        <div className="text-[var(--color-muted)]">No episodes yet.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-12">
          {entries.map((e) => (
            <div key={`${e.source}:${e.id}`} className="group flex flex-col gap-3 relative">
              <button
                onClick={() => play(e)}
                className="aspect-square w-full rounded-md bg-[var(--color-surface)] border border-[var(--color-hairline)] flex items-center justify-center overflow-hidden focus:outline-none focus:border-[var(--color-accent)] relative"
              >
                {e.source === 'library' ? (
                  e.coverImage ? (
                    <img src={e.coverImage} alt={e.title} className="w-full h-full object-cover" draggable={false} />
                  ) : (
                    <span className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                      {e.title.slice(0, 2)}
                    </span>
                  )
                ) : (
                  <Cover coverPath={e.coverImage} alt={e.title} size={220} />
                )}
                {e.source === 'library' && (
                  <span className="absolute top-2 left-2 text-[10px] tracking-[0.2em] uppercase px-1.5 py-0.5 rounded-sm bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                    Yours
                  </span>
                )}
              </button>
              <div>
                <button
                  onClick={() => play(e)}
                  className="text-base font-medium text-left group-hover:text-[var(--color-accent)] transition-colors"
                >
                  {e.title}
                </button>
                <div className="text-sm text-[var(--color-muted)] mt-0.5">{e.subject}</div>
                <div className="text-xs text-[var(--color-muted)] mt-1">{Math.round(e.estimatedMinutes)} min</div>
              </div>
              {e.source === 'library' && (
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => unpublish(e)}
                    className="text-xs px-2 py-1 rounded-md text-[var(--color-muted)] hover:text-red-400 hover:bg-white/5"
                  >
                    Unpublish
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

Note: For library entries, `coverImage` is already a `file://` URL, so we render with a plain `<img>`. For bundled entries, we keep the existing `Cover` component (which calls assets.coverUrl IPC).

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm run build`
Expected: passes.

---

### Task 5: DraftEditor publish controls

**Files:** Modify `src/renderer/editor/DraftEditor.tsx`

- [ ] **Step 1: Add publish state + actions to `DraftEditor.tsx`**

Replace the import block at the top with:

```tsx
import { useEffect, useState } from 'react'
import { useEditorStore } from './editorStore'
import { MetadataEditor } from './forms/MetadataEditor'
import { CoverEditor } from './forms/CoverEditor'
import { HostsEditor } from './forms/HostsEditor'
import { ChaptersEditor } from './forms/ChaptersEditor'
```

Add state + effects inside the component body (after the existing `const error = useEditorStore(...)` line):

```tsx
const [isPublished, setIsPublished] = useState(false)
const [publishing, setPublishing] = useState(false)
const [publishError, setPublishError] = useState<string | null>(null)
const currentDraftId = useEditorStore((s) => s.currentDraftId)

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
```

- [ ] **Step 2: Update the toolbar JSX** — add Publish + Unpublish buttons next to Save

Find the existing toolbar div:

```tsx
<div className="flex items-center gap-3">
  {dirty && <span className="text-xs text-[var(--color-muted)]">unsaved</span>}
  <button ...>Preview</button>
  <button ...>Save</button>
</div>
```

Replace with:

```tsx
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
```

- [ ] **Step 3: Surface publish errors**

Below the existing `{error && ...}` line, add:

```tsx
{publishError && (
  <div className="text-xs text-red-400 whitespace-pre-wrap">{publishError}</div>
)}
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm run build`
Expected: passes.

---

### Task 6: Final verify

- [ ] **Step 1: Gates**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass.

- [ ] **Step 2: Manual smoke test**

Restart `npm run dev`:

1. Editor → open a draft (or duplicate one) → Publish
   - First click: validates strict schema. If draft incomplete (empty title, etc.) → inline error.
   - If valid: button changes to "Re-publish", "Unpublish" appears, "Published" pill shows
2. Library tab → published episode appears with a YOURS pill
3. Click it → plays in the Player
4. Back in Editor → Unpublish → confirmation → entry disappears from Library
