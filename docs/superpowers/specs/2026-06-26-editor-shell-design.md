# Spec B — Editor Shell + Drafts Library

**Date:** 2026-06-26
**Scope:** First slice of the Editor / Generation feature. Adds an in-app Editor mode for managing draft episodes — create, duplicate, edit, preview, delete. Lands the substrate that subsequent specs fill in.

**Position in the larger plan:**
- **Spec B (this doc)** — Editor shell + drafts CRUD + form-based editing + preview
- Spec A — `ScriptProvider` abstraction (Vercel AI SDK) + single-shot generation that lands drafts here
- Spec C — Multi-step pipeline (research → outline → script) with editable artifact tabs
- Spec D — Timeline editor for voiceover positioning
- Spec E — Publish flow → user library catalog

Each can be built and shipped independently.

## Goal

You can click between **Library** (existing playable catalog) and **Editor** modes in the app. The Editor lists drafts. You can:
- Create a new empty draft
- Duplicate any bundled episode into a draft
- Open a draft in a form editor and modify any field (title, subject, hosts, segments, voiceovers, song picks)
- Save changes
- Preview the draft in the existing player without leaving the app
- Delete drafts

No generation yet (Spec A) and no timeline UI yet (Spec D). All editing is form-based number/text inputs.

## Non-goals (explicitly deferred)

- LLM generation (Spec A)
- Research / outline / script artifact tabs (Spec C)
- Timeline-based voiceover positioning (Spec D)
- Publishing drafts to the user library catalog (Spec E)
- Cover-image upload from disk (later — for v1, drafts inherit the cover of the episode they're duplicated from, or a placeholder)
- Pre-rendering narration audio (later)

## Architecture

### Mode toggle

A new app-level state `appMode: 'library' | 'editor'` decides which top-level screen renders. Lives in a new lightweight `appStore` (Zustand), persisted to `localStorage`.

A small pill toggle in the drag region (top of every screen) switches between the two. Subtle — `LIBRARY | EDITOR` text, the inactive one dimmed.

### Storage layout

Drafts live in the user's data directory, one folder per draft:

```
<userData>/drafts/
  <draftId>/
    manifest.json     # the draft's EpisodeManifest (may be incomplete)
    cover.png         # optional, copied from duplicated source or pasted later
```

`<draftId>` is an 8-byte hex string generated in the main process via `crypto.randomBytes(8).toString('hex')`. No new dependency.

Bundled episodes in the repo's `episodes/` directory remain read-only — never modified.

### Schema relaxation for drafts

The existing `episodeManifestSchema` requires e.g. `text: z.string().min(1)` on narration. Drafts may be mid-edit and have temporarily empty fields. Introduce `draftManifestSchema` derived from `episodeManifestSchema` with text fields allowing empty strings. Same shape — just relaxed validation.

Drafts saved through the Editor are validated against `draftManifestSchema` (permissive). Preview requires the stricter `episodeManifestSchema` to pass; if it doesn't, the Preview button is disabled with a tooltip explaining what's missing.

### IPC surface (additions to existing `window.deepcuts.*`)

```ts
drafts: {
  list(): Promise<DraftSummary[]>
  load(draftId: string): Promise<unknown>  // raw JSON; renderer parses
  save(draftId: string, manifest: unknown): Promise<void>
  create(initial?: Partial<EpisodeManifest>): Promise<string>  // returns draftId
  delete(draftId: string): Promise<void>
  duplicateFromEpisode(episodePath: string): Promise<string>  // returns new draftId
  coverUrl(draftId: string): Promise<string | null>  // file:// URL or null
}
```

Where `DraftSummary` is `{ draftId, title, subject, hostCount, segmentCount, updatedAt }` — enough to render a card without loading the full manifest.

### Main-process implementation

- New module `src/main/drafts.ts` — wraps file-system CRUD. All paths sanitized; never accepts external paths from the renderer.
- IPC handlers in `src/main/ipc.ts` for each method above.
- `duplicateFromEpisode` reads from `episodesRoot()`, copies manifest + cover into a fresh draft directory.

### Renderer-side data model

New `editorStore.ts` (Zustand):

```ts
interface EditorStore {
  drafts: DraftSummary[]
  currentDraftId: string | null
  currentDraft: EpisodeManifest | null
  dirty: boolean
  refreshList(): Promise<void>
  openDraft(draftId: string): Promise<void>
  updateDraft(patch: Partial<EpisodeManifest>): void  // marks dirty
  saveDraft(): Promise<void>
  createEmpty(): Promise<string>  // returns draftId
  duplicate(episodePath: string): Promise<string>
  remove(draftId: string): Promise<void>
}
```

The renderer never speaks to the filesystem; everything goes through IPC.

## Components

```
src/renderer/
  appStore.ts                          # appMode + mode toggle helpers
  editor/
    EditorView.tsx                     # top-level screen (DraftList OR DraftEditor)
    DraftList.tsx                      # grid of draft cards + new/duplicate actions
    DraftCard.tsx                      # single card (cover, title, status, actions)
    NewDraftModal.tsx                  # title input + create/duplicate from episode
    DraftEditor.tsx                    # form editor for a single draft
    editorStore.ts
    forms/
      MetadataEditor.tsx               # title, subject, estimatedMinutes
      HostsEditor.tsx                  # add/remove/edit hosts list
      ChaptersEditor.tsx               # add/remove/reorder chapters
      SegmentList.tsx                  # list of segments within a chapter
      NarrationSegmentEditor.tsx       # text + hostId dropdown
      SongSegmentEditor.tsx            # track URI, playSeconds, why; lists voiceovers
      VoiceoverEditor.tsx              # text, hostId, atSeconds, duckTo, holdDuck
  ui/
    ModeToggle.tsx                     # LIBRARY | EDITOR pill in drag region
```

`App.tsx` chooses Library or Editor based on `appStore.appMode`. The mode toggle is rendered in a small bar inside the existing drag region.

## Preview playback

The Editor's "Preview" button on a draft card or in the editor view:

1. Calls `editorStore.openDraft(draftId)` if not already loaded
2. Validates against the stricter `episodeManifestSchema`. If invalid, surfaces errors inline (don't switch modes)
3. If valid: stays in `appMode: 'editor'` but renders the player chrome on top with a `previewingDraftId` flag. The player loads the draft manifest by calling `drafts:load(draftId)` (the same channel the editor uses), parses against the strict schema, hands it to `playerStore.startWithManifest(manifest)`.
4. Player chrome shows a subtle banner: "Previewing draft — exit to return to editor"
5. Clicking "Exit preview" stops playback via `scheduler.stop()`, clears `previewingDraftId`, returns to the editor view in place.

Implementation: add a new `playerStore.startWithManifest(manifest, opts)` method that bypasses the file-path loading — accepts an already-parsed manifest object. The existing `openAndPlay(manifestPath)` becomes a thin wrapper around it.

## New-draft flow

**Click "+ New project" in Editor:**

NewDraftModal opens. Two tabs:

1. **Empty** — title input, optional subject. On submit:
   - `drafts:create({ schemaVersion: 1, id: <draftId>, title, subject: subject || '', coverImage: '', estimatedMinutes: 5, hosts: [{ id: 'host_a', name: 'Narrator', persona: '', voiceRef: 'elevenlabs:iP95p4xoKVk53GoZ742B' }], chapters: [{ title: 'Untitled chapter', segments: [{ type: 'narration', id: 'n0', hostId: 'host_a', text: '' }] }], sources: [], facts: [] })`
   - Refresh list, navigate into the new draft

2. **Duplicate** — dropdown of bundled episodes, selectable. On submit:
   - `drafts:duplicateFromEpisode(<episodePath>)` — copies manifest + cover into new draft
   - Refresh list, navigate into the new draft

(Spec A will add a third tab: **Generate** — subject input, optional persona hints, provider/model select.)

## Form-based editor

Single scrollable screen with sections in this order:

1. **Header** — Editable title (large), subject (subtitle), updated timestamp, Preview/Save/Delete actions
2. **Cover** — Thumbnail, "Replace cover" button (uses a hidden file input; copies the chosen image into the draft directory) — minimal v1
3. **Hosts** — list of hosts; each row has name, persona (text area), voiceRef (text input — Spec A/D could promote this to a dropdown using `ELEVENLABS_VOICES`); add/remove buttons
4. **Chapters** — collapsible per chapter; chapter title + segments list; reorder chapters via ↑↓ buttons; add/remove chapter
5. **Segments within a chapter** — collapsible per segment; type-specific editor; reorder segments via ↑↓; add/remove

**Narration segment fields:** hostId (dropdown of hosts), text (textarea).

**Song segment fields:** track.title, track.artist, track.spotifyUri (text input), playSeconds (number), startAtSeconds (number, default 0), why (textarea), voiceovers (list of editor cards).

**Voiceover fields:** hostId (dropdown), text (textarea), atSeconds (number), duckTo (number 0-100, default 55), holdDuck (boolean checkbox).

Inline validation:
- Spotify URI matched against `/^spotify:track:[A-Za-z0-9]+$/` — red border on mismatch
- atSeconds non-negative; playSeconds positive — red border on mismatch
- Empty narration text on a non-published draft is allowed (amber asterisk to the right of the field, no red border)
- hostId references a host that no longer exists → red border on the dropdown

Save: writes the draft via `drafts:save`. Auto-save on field blur? — **No for v1**; explicit Save button only. Marks dirty state with `editorStore.dirty`.

## Visual / UX

Follow the existing design language:
- Same color tokens (`--color-background`, `--color-surface`, `--color-hairline`, `--color-accent`)
- Same Inter type, same sizes
- Editor uses a 2-column layout on wide screens (cover + metadata on left, content on right), single-column at narrower widths

DraftCard mirrors the catalog card style, with two differences:
- Status pill at top-left of card: `DRAFT` (always for v1)
- Hover reveals overlay actions (Preview / Edit / Delete)

Mode toggle: subtle. Small, top-right of the drag region. Not loud.

## Error states

- **Drafts directory unwriteable** (rare — userData should always be writable) → error toast, list shows empty
- **Corrupt draft JSON** → list shows the draft with a "Corrupt — cannot open" status; only Delete is available
- **Preview validation fails** → inline list of validation errors above the Preview button, button disabled
- **Cover file missing** → falls back to letter placeholder (existing Cover component behavior)

## Tests

- `drafts.ts` (main process) — unit tests for CRUD with a tmpdir
- `editorStore.ts` — unit tests for state transitions (open/dirty/save/discard)
- `draftManifestSchema` — accepts an empty-text narration; same shape as full schema
- No new scheduler tests (no logic changes there)

## Migration / Compatibility

- Existing `playerStore` and `Scheduler` unchanged. Preview reuses them as-is.
- Existing IPC handlers unchanged; new ones added alongside.
- Existing tests untouched.
- Existing manifests in `episodes/` are not touched by the editor; duplicating creates an independent copy.

## File layout summary

```
deepcuts/
  src/
    main/
      drafts.ts                              # NEW — CRUD over <userData>/drafts/<id>/
      ipc.ts                                 # +6 channels for drafts:*
    preload/
      index.ts                               # surface the new channels
    renderer/
      appStore.ts                            # NEW — appMode toggle
      App.tsx                                # MODIFY — render Library or Editor
      editor/                                # NEW — see Components above
      ui/
        ModeToggle.tsx                       # NEW
    shared/
      manifest.ts                            # MODIFY — export draftManifestSchema
      ipcSchema.ts                           # MODIFY — add new channel constants
  docs/superpowers/specs/
    2026-06-26-editor-shell-design.md        # this file
```

## Definition of done

1. Toggle between Library and Editor via the chrome pill.
2. Editor shows a list of drafts (initially empty).
3. "+ New project" → either empty or duplicated from a bundled episode; new draft appears in list immediately.
4. Click a draft → editor opens; every field is editable; Save persists; reopen later → values are still there.
5. Preview button on a valid draft → switches to player view → episode plays correctly using existing scheduler/voiceover logic → "Exit preview" returns to editor.
6. Delete a draft → confirmation → file removed → list updated.
7. `npm run typecheck && npm test` both pass on the maintainer's machine.
