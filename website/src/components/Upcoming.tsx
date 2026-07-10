import type { EpisodeView } from '../catalog/fetchCatalog'
import { RevealOnScroll } from './RevealOnScroll'

export function Upcoming({ episodes }: { episodes: EpisodeView[] }) {
  if (episodes.length === 0) return null
  return (
    <section className="py-24 md:py-40 px-6 md:px-12">
      <div className="max-w-[1280px] mx-auto">
        <RevealOnScroll>
          <div className="tracking-caps text-xs mb-2" style={{ color: 'var(--muted)' }}>
            Coming soon
          </div>
          <h2
            className="font-display text-[28px] md:text-[36px] mb-10"
            style={{ color: 'var(--ink)' }}
          >
            Deeper cuts in the queue.
          </h2>
        </RevealOnScroll>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 md:gap-12">
          {episodes.map((entry, i) => (
            <RevealOnScroll key={entry.id} delay={i * 0.06}>
              <div className="flex flex-col gap-3 opacity-80">
                <div className="w-full aspect-square overflow-hidden">
                  <img
                    src={entry.coverUrl}
                    alt={`${entry.meta.artistName} — ${entry.meta.albumName}`}
                    className="w-full h-full object-cover block"
                    draggable={false}
                  />
                </div>
                <div>
                  <div className="text-[17px] font-medium" style={{ color: 'var(--ink)' }}>
                    {entry.meta.artistName}
                  </div>
                  <div className="text-[13px] mt-0.5" style={{ color: 'var(--muted)' }}>
                    {entry.meta.albumName}
                  </div>
                  <div
                    className="tracking-caps text-[10px] mt-2"
                    style={{ color: 'var(--muted)' }}
                  >
                    {entry.expectedRelease ?? 'TBA'}
                  </div>
                </div>
              </div>
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  )
}
