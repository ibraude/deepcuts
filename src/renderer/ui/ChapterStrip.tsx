import type { SchedulerState } from '../player/Scheduler'

interface ChapterStripProps {
  state: SchedulerState
  onJump: (chapterIndex: number) => void
}

export function ChapterStrip({ state, onJump }: ChapterStripProps) {
  const manifest = state.manifest
  if (!manifest || manifest.chapters.length < 2) return null

  const current = state.segments[state.segmentIndex]
  const activeChapter = current?.chapterIndex ?? 0

  return (
    <div className="flex flex-wrap gap-2">
      {manifest.chapters.map((chapter, i) => {
        const isActive = i === activeChapter
        return (
          <button
            key={i}
            onClick={() => onJump(i)}
            className={
              'text-xs px-3 py-1.5 rounded-full border transition-colors duration-150 ' +
              (isActive
                ? 'border-[var(--color-accent)]/60 bg-[var(--color-accent)]/15 text-[var(--color-text)]'
                : 'border-[var(--color-hairline)] text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-white/5')
            }
          >
            {chapter.title}
          </button>
        )
      })}
    </div>
  )
}
