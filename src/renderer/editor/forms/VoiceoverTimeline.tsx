import { useRef } from 'react'
import type { DraftManifest } from '../../../shared/manifest'

type SongSegment = Extract<DraftManifest['chapters'][number]['segments'][number], { type: 'song' }>
type Voiceover = NonNullable<SongSegment['voiceovers']>[number]

interface VoiceoverTimelineProps {
  voiceovers: Voiceover[]
  totalSec: number
  activeIdx: number | null
  onActivate: (idx: number) => void
  onAtSecondsChange: (idx: number, atSec: number) => void
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, '0')
  return `${m}:${s}`
}

function computeTicks(totalSec: number): number[] {
  if (totalSec <= 0) return [0]
  let interval = 30
  if (totalSec > 300) interval = 60
  if (totalSec > 600) interval = 120
  const ticks: number[] = []
  for (let t = 0; t <= totalSec; t += interval) ticks.push(t)
  if (ticks[ticks.length - 1] !== totalSec) ticks.push(totalSec)
  return ticks
}

export function VoiceoverTimeline({
  voiceovers,
  totalSec,
  activeIdx,
  onActivate,
  onAtSecondsChange,
}: VoiceoverTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null)

  function startDrag(idx: number, downEvent: React.MouseEvent) {
    downEvent.preventDefault()
    const startX = downEvent.clientX
    const startAtSec = voiceovers[idx]?.atSeconds ?? 0

    function move(e: MouseEvent) {
      const width = trackRef.current?.offsetWidth ?? 0
      if (width <= 0) return
      const dxPx = e.clientX - startX
      const dSec = (dxPx / width) * totalSec
      const newAtSec = Math.max(0, Math.min(totalSec, Math.round(startAtSec + dSec)))
      onAtSecondsChange(idx, newAtSec)
    }
    function up() {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const ticks = computeTicks(totalSec)

  return (
    <div className="space-y-1 py-3">
      {/* Ticks row */}
      <div className="relative h-3">
        {ticks.map((t, i) => (
          <div
            key={i}
            className="absolute -translate-x-1/2 text-[9px] text-[var(--color-muted)] font-mono whitespace-nowrap"
            style={{ left: `${Math.min(100, (t / totalSec) * 100)}%` }}
          >
            {formatTime(t)}
          </div>
        ))}
      </div>
      {/* Timeline bar */}
      <div
        ref={trackRef}
        className="relative h-8 bg-[var(--color-surface)] border border-[var(--color-hairline)] rounded-md"
      >
        {/* Tick lines */}
        {ticks.map((t, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-[var(--color-hairline)]/40 pointer-events-none"
            style={{ left: `${Math.min(100, (t / totalSec) * 100)}%` }}
          />
        ))}
        {/* Voiceover markers */}
        {voiceovers.map((vo, idx) => {
          const isActive = activeIdx === idx
          const pct = Math.max(0, Math.min(100, (vo.atSeconds / totalSec) * 100))
          return (
            <div
              key={idx}
              className="absolute top-0 bottom-0 -translate-x-1/2"
              style={{ left: `${pct}%` }}
            >
              <div
                onMouseDown={(e) => startDrag(idx, e)}
                onClick={() => onActivate(idx)}
                className={
                  'h-full w-2 cursor-grab active:cursor-grabbing rounded-sm transition-colors ' +
                  (isActive
                    ? 'bg-[var(--color-accent)]'
                    : 'bg-[var(--color-accent)]/60 hover:bg-[var(--color-accent)]')
                }
                title={`${formatTime(vo.atSeconds)} — ${vo.id}`}
              />
              {isActive && (
                <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] text-[var(--color-text)] font-mono whitespace-nowrap pointer-events-none">
                  {formatTime(vo.atSeconds)}
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className="text-[10px] text-[var(--color-muted)] pt-3">
        Drag markers to retime · Click a marker to expand its row below
      </div>
    </div>
  )
}
