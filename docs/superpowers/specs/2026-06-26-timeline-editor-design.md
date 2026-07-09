# Spec D — Voiceover Timeline Editor

**Date:** 2026-06-26
**Scope:** Replace the static `atSeconds` number input with a draggable visual timeline above each song's voiceover list. The current row editor stays as the detail view; the timeline is added on top.

## Goal

In the editor's SongSegmentEditor, render a horizontal timeline (0 → playSeconds) above the voiceover list. Each voiceover is a draggable marker. Drag updates `atSeconds` live; releasing commits the value. Click a marker to expand the corresponding row in the list.

## Design

```
Voiceovers                                     [+ Voiceover]
─────────────────────────────────────────────────────────────────
  0:00         1:00         2:00         3:00         4:00      5:00
  │            │            │            │            │         │
  ─────────█────────────────────█────█────────────────█────────────
            0:25                3:00 3:40             4:15

(drag any marker; click to expand the row below)
```

- Markers are positioned by `(atSeconds / playSeconds) * 100%` of the timeline width.
- Drag math: `dxPx / timelineWidth * playSeconds`, clamped to `[0, playSeconds]`, rounded to integer seconds, committed via the same `setField('atSeconds', ...)` path the inline editor uses.
- Active marker (the one currently expanded below) gets a brighter accent.
- Tick marks every 30s for short songs, 60s for songs > 5 min, 120s for songs > 10 min.

## Component

`src/renderer/editor/forms/VoiceoverTimeline.tsx`:

```ts
interface VoiceoverTimelineProps {
  voiceovers: Voiceover[]
  totalSec: number
  activeIdx: number | null
  onActivate(idx: number): void
  onAtSecondsChange(idx: number, atSec: number): void
}
```

Pure presentational — no editor store coupling. Owner (`SongSegmentEditor`) wires it in.

## Drag implementation

- `onMouseDown` on a marker captures the current `atSeconds` and starting `clientX`.
- Attaches global `mousemove` / `mouseup` listeners.
- Each `mousemove` computes the new atSeconds and calls `onAtSecondsChange` — the store updates immediately, the marker re-renders at the new position.
- `mouseup` removes the listeners.
- No preview state; commit-on-move keeps it simple and responsive.

## Non-goals

- Touch / multi-touch support (Mac trackpad mouse events are fine for v1)
- Adding new voiceovers by clicking empty timeline space (use existing "+ Voiceover" button)
- Showing the song's *real* track duration distinct from `playSeconds` (no manifest field for that yet)
- Snapping to grid or to other markers
- Showing voiceover durations as ranges (markers stay as point-in-time pills)

## Tests

No new tests — pure UI component, behavior driven by simple props. Existing scheduler tests still pass since the data model is unchanged.

## Definition of done

1. Each song segment in the editor shows a timeline above its voiceover list
2. Markers are positioned correctly
3. Dragging a marker updates `atSeconds` smoothly; release commits
4. Clicking a marker activates / expands the corresponding voiceover row
5. `npm run typecheck`, `npm test`, `npm run build` all pass
