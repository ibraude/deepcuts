import type { EpisodeView } from '../catalog/fetchCatalog'
import { usePointerTilt } from '../hooks/usePointerTilt'

export function EpisodeCard({
  entry,
  onPlay,
  isActive,
}: {
  entry: EpisodeView
  onPlay: (entry: EpisodeView) => void
  isActive: boolean
}) {
  const { ref, style } = usePointerTilt<HTMLButtonElement>()

  return (
    <div className="flex flex-col gap-3">
      <button
        ref={ref}
        style={{
          ...style,
          boxShadow: isActive
            ? `0 0 60px -20px ${entry.meta.palette.accent}66, 0 24px 48px rgba(0,0,0,0.5)`
            : undefined,
          transition: (style.transition ?? '') + ', box-shadow 300ms var(--easing-expo)',
        }}
        onClick={() => onPlay(entry)}
        aria-label={`Play preview: ${entry.meta.artistName} — ${entry.meta.albumName}`}
        className="block w-full aspect-square overflow-hidden"
      >
        <img
          src={entry.coverUrl}
          alt={`${entry.meta.artistName} — ${entry.meta.albumName}`}
          className="w-full h-full object-cover block"
          draggable={false}
        />
      </button>
      <div>
        <div className="text-[17px] font-medium" style={{ color: 'var(--ink)' }}>
          {entry.meta.artistName}
        </div>
        <div className="text-[13px] mt-0.5" style={{ color: 'var(--muted)' }}>
          {entry.meta.albumName}
        </div>
        <p
          className="text-[12px] mt-2 leading-relaxed line-clamp-2"
          style={{ color: 'var(--muted)' }}
        >
          {entry.meta.blurb}
        </p>
      </div>
    </div>
  )
}
