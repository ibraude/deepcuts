# Spec E — Publish Drafts to Library

**Date:** 2026-06-26
**Scope:** A draft becomes a playable, listed episode via a "Publish" button. Published episodes live in a user library that shows alongside bundled episodes in the catalog.

## Goal

In DraftEditor, a "Publish" button. Click → strict schema validation → copy manifest + cover into `userData/library/<id>/`. The Catalog shows the result alongside bundled episodes. Drafts remain editable; re-publishing overwrites the same library entry. Unpublish removes from library.

## Non-goals

- No remote/hosted publishing (Spec is "live catalog" from M2's brief — separate future feature)
- No pre-rendering ElevenLabs narration into the published artifact (live synthesis still happens at playback)
- No edit history / version comparison

## Data model

- Library entry id === draft id at publish time. A draft has at most one library entry.
- Storage: `userData/library/<libraryId>/manifest.json` and `cover.png` (mirror of draft).
- Library entries are independent of drafts after creation — if the user deletes the draft, the library entry persists.

## IPC surface (additions)

```ts
window.deepcuts.library = {
  list(): Promise<LibrarySummary[]>
  publish(draftId: string): Promise<string>     // returns libraryId (== draftId)
  unpublish(libraryId: string): Promise<void>
  loadManifest(libraryId: string): Promise<unknown>  // renderer validates strict
  coverUrl(libraryId: string): Promise<string | null>
  isPublished(draftId: string): Promise<boolean>
}
```

`LibrarySummary` mirrors `CatalogEntry` plus a `libraryId` field:
```ts
{ libraryId, title, subject, hostCount, segmentCount, estimatedMinutes, hasCover, publishedAt }
```

## Main process — `src/main/library.ts`

Same DI pattern as `drafts.ts`. Exposes `createLibrary({ libraryRoot, draftsRoot })` returning:

- `listLibrary()`
- `publish(draftId)` — reads draft manifest, parses STRICT (`episodeManifestSchema`), copies into library dir; copies cover if present.
- `unpublish(libraryId)` — removes the library dir.
- `loadManifest(libraryId)` — parses strict and returns.
- `coverUrl(libraryId)`
- `isPublished(draftId)` — checks for library dir existence.

Failure modes:
- Strict validation fails on publish → throw `PublishValidationError` with list of issues. The renderer surfaces these inline.
- Filesystem errors propagate.

## Renderer — Catalog UI changes

`src/renderer/catalog/Catalog.tsx`:

- Fetch both `catalog.loadLocal()` (bundled) and `library.list()` (user) in parallel.
- Render as one combined grid, with a subtle `YOURS` pill on user library entries (similar to `DRAFT` pill in editor).
- Click on a user library entry calls `library.loadManifest(libraryId)` and `playerStore.startWithManifest(parsed)`.
- Hover overlay on user library cards: "Unpublish" (removes from library but doesn't touch draft).

To keep catalog logic centralized, the `loadLocalCatalog()` helper returns a combined list with each entry tagged `source: 'bundled' | 'library'`.

## Renderer — DraftEditor changes

`src/renderer/editor/DraftEditor.tsx`:

- New "Publish" button next to Save/Preview.
- Disabled while `dirty`. Tooltip: "Save changes first."
- On click: calls `library.publish(currentDraftId)`. On success: show toast "Published". On validation error: show inline error block with the schema issues.
- If already published, button label is "Re-publish" and tooltip indicates an overwrite.
- "Unpublish" button appears (next to Publish) when `isPublished(draftId) === true`.

## State

- `editorStore` gains `publishedDraftIds: Set<string>` populated by `refreshList()` (call `library.list()` and intersect).
- Or simpler: per-draft, on `openDraft` call `library.isPublished(draftId)` and store in component state.

For minimal scope, do the simple per-draft check via component state in DraftEditor.

## Visual

- `YOURS` pill: small uppercase `0.2em` tracking, accent color, top-left of card.
- Bundled pill (implicit — no pill needed; that's the default).
- Library card "Unpublish" only shows on hover-overlay; not a primary action.

## Tests

- `library.ts` (main): publish copies manifest + cover; strict validation rejects empty title; unpublish removes; isPublished reflects state.
- No new scheduler/store tests required.

## Definition of done

1. DraftEditor has Publish / Re-publish / Unpublish buttons that behave correctly.
2. Strict validation surfaces inline errors if a draft can't be published.
3. Catalog shows both bundled and library episodes, with a YOURS pill on library entries.
4. Clicking a library episode plays it through the existing player.
5. Unpublish removes from catalog but leaves the draft.
6. `npm run typecheck`, `npm test`, `npm run build` all pass.
