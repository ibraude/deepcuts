import { useState } from 'react'
import { useEditorStore } from '../editorStore'
import { CollapsibleRow } from './CollapsibleRow'
import { NarrationSegmentEditor } from './NarrationSegmentEditor'
import { SongSegmentEditor } from './SongSegmentEditor'

const SPOTIFY_URI_RE = /^spotify:track:[A-Za-z0-9]{22}$/

export function SegmentList({ chapterIndex }: { chapterIndex: number }) {
  const draft = useEditorStore((s) => s.currentDraft)
  const update = useEditorStore((s) => s.updateDraft)
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  if (!draft) return null
  const chapter = draft.chapters[chapterIndex]
  if (!chapter) return null

  function addNarration() {
    update((m) => {
      const ch = m.chapters[chapterIndex]!
      const segments = [
        ...ch.segments,
        {
          type: 'narration' as const,
          id: `n${Date.now()}`,
          hostId: m.hosts[0]?.id ?? 'host_a',
          text: '',
        },
      ]
      setOpenIdx(segments.length - 1)
      return {
        ...m,
        chapters: m.chapters.map((c, i) => (i === chapterIndex ? { ...c, segments } : c)),
      }
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
      setOpenIdx(segments.length - 1)
      return {
        ...m,
        chapters: m.chapters.map((c, i) => (i === chapterIndex ? { ...c, segments } : c)),
      }
    })
  }
  function removeSegment(segIdx: number) {
    if (openIdx === segIdx) setOpenIdx(null)
    update((m) => ({
      ...m,
      chapters: m.chapters.map((c, i) =>
        i === chapterIndex ? { ...c, segments: c.segments.filter((_, j) => j !== segIdx) } : c,
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
      if (openIdx === segIdx) setOpenIdx(tgt)
      else if (openIdx === tgt) setOpenIdx(segIdx)
      return {
        ...m,
        chapters: m.chapters.map((c, i) => (i === chapterIndex ? { ...c, segments: segs } : c)),
      }
    })
  }

  return (
    <div className="pl-2 border-l border-[var(--color-hairline)]">
      <div className="px-1">
        {chapter.segments.map((segment, segIdx) => {
          const isOpen = openIdx === segIdx
          const hostName =
            segment.type === 'narration'
              ? draft.hosts.find((h) => h.id === segment.hostId)?.name ?? segment.hostId
              : null
          const summary =
            segment.type === 'narration' ? (
              <div className="flex items-baseline gap-3 min-w-0">
                <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--color-muted)] shrink-0">
                  Narration
                </span>
                <span className="text-sm text-[var(--color-text)] shrink-0">{hostName || '—'}</span>
                <span className="text-sm text-[var(--color-muted)] truncate">
                  {segment.text || <span className="italic">empty</span>}
                </span>
              </div>
            ) : (
              <div className="flex items-baseline gap-3 min-w-0">
                {!SPOTIFY_URI_RE.test(segment.track.spotifyUri) && (
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.7)] shrink-0 self-center"
                    title="This song has no valid Spotify URI yet — re-resolve or paste one."
                    aria-label="Unresolved song"
                  />
                )}
                <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--color-muted)] shrink-0">
                  Song
                </span>
                <span className="text-sm text-[var(--color-text)] truncate">
                  {segment.track.title || <span className="italic text-[var(--color-muted)]">untitled</span>}
                  {segment.track.artist && (
                    <span className="text-[var(--color-muted)]"> — {segment.track.artist}</span>
                  )}
                </span>
                <span className="text-xs text-[var(--color-muted)] shrink-0">
                  {segment.playSeconds}s
                  {segment.voiceovers && segment.voiceovers.length > 0
                    ? ` · ${segment.voiceovers.length} vo`
                    : ''}
                </span>
              </div>
            )
          return (
            <CollapsibleRow
              key={segIdx}
              expanded={isOpen}
              onToggle={() => setOpenIdx(isOpen ? null : segIdx)}
              summary={summary}
              actions={
                <>
                  <button
                    onClick={() => moveSegment(segIdx, -1)}
                    className="text-xs px-1.5 py-1 rounded-sm hover:bg-white/5 text-[var(--color-muted)]"
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveSegment(segIdx, 1)}
                    className="text-xs px-1.5 py-1 rounded-sm hover:bg-white/5 text-[var(--color-muted)]"
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => removeSegment(segIdx)}
                    className="text-xs px-2 py-1 text-[var(--color-muted)] hover:text-red-400"
                  >
                    Remove
                  </button>
                </>
              }
            >
              {segment.type === 'narration' ? (
                <NarrationSegmentEditor chapterIndex={chapterIndex} segmentIndex={segIdx} />
              ) : (
                <SongSegmentEditor chapterIndex={chapterIndex} segmentIndex={segIdx} />
              )}
            </CollapsibleRow>
          )
        })}
      </div>
      <div className="flex gap-2 mt-3 pl-1">
        <button
          onClick={addNarration}
          className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5 text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          + Narration
        </button>
        <button
          onClick={addSong}
          className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5 text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          + Song
        </button>
      </div>
    </div>
  )
}
