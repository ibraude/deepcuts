import type { EpisodeView } from '../catalog/fetchCatalog'
import type { PlayerState } from '../hooks/usePlayer'
import { EpisodeCard } from './EpisodeCard'
import { RevealOnScroll } from './RevealOnScroll'

export function Library({
  released,
  state,
  onPlay,
  onPause,
  onResume,
  onSeek,
}: {
  released: EpisodeView[]
  state: PlayerState
  onPlay: (entry: EpisodeView) => void
  onPause: () => void
  onResume: () => void
  onSeek: (fraction: number) => void
}) {
  if (released.length === 0) {
    return (
      <section className="py-24 md:py-40 px-6 md:px-12">
        <div className="max-w-[1280px] mx-auto">
          <div className="tracking-caps text-xs mb-3" style={{ color: 'var(--muted)' }}>
            Library
          </div>
          <p className="text-[17px] max-w-md" style={{ color: 'var(--muted)' }}>
            First episode drops soon. Get the app and be ready.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section className="py-24 md:py-40 px-6 md:px-12">
      <div className="max-w-[1280px] mx-auto">
        <RevealOnScroll>
          <div className="tracking-caps text-xs mb-10" style={{ color: 'var(--muted)' }}>
            Library
          </div>
        </RevealOnScroll>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 md:gap-12">
          {released.map((entry, i) => (
            <RevealOnScroll key={entry.id} delay={i * 0.06}>
              <EpisodeCard
                entry={entry}
                state={state}
                onPlay={onPlay}
                onPause={onPause}
                onResume={onResume}
                onSeek={onSeek}
              />
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  )
}
