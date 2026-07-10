import type React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { EpisodeView } from '../catalog/fetchCatalog'
import type { PlayerState } from '../hooks/usePlayer'
import { PlayIcon } from './PlayIcon'
import { PauseIcon } from './PauseIcon'
import { Equalizer } from './Equalizer'
import { formatSeconds } from '../lib/formatDuration'
import { EASE_EXPO_OUT, durations } from '../lib/easing'
import { useReducedMotion } from '../hooks/useReducedMotion'

interface Props {
  entry: EpisodeView
  state: PlayerState
  onPause: () => void
  onResume: () => void
  onSeek: (fraction: number) => void
}

export function InlinePlayer({ entry, state, onPause, onResume, onSeek }: Props) {
  const reduced = useReducedMotion()
  const isActive = state.activeId === entry.id
  const isPlaying = isActive && state.status === 'playing'

  const fraction = state.duration > 0 ? state.currentTime / state.duration : 0

  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isActive) return
    const rect = e.currentTarget.getBoundingClientRect()
    onSeek((e.clientX - rect.left) / rect.width)
  }

  return (
    <AnimatePresence initial={false}>
      {isActive && (
        <motion.div
          key="drawer"
          initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{
            duration: reduced ? 0.2 : durations.drawer,
            ease: EASE_EXPO_OUT as unknown as number[],
          }}
          style={{ overflow: 'hidden' }}
          data-testid="inline-player"
        >
          <div
            className="mt-4 p-4 flex items-center gap-4"
            style={{ background: 'var(--surface)', color: entry.meta.palette.accent }}
          >
            <button
              onClick={isPlaying ? onPause : onResume}
              className="w-9 h-9 rounded-full flex items-center justify-center transition-transform active:scale-95"
              style={{ background: entry.meta.palette.accent, color: 'var(--surface)' }}
              aria-label={isPlaying ? 'Pause preview' : 'Resume preview'}
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
            <Equalizer active={isPlaying} />
            <div
              className="flex-1 h-1 rounded-full cursor-pointer relative"
              style={{ background: 'rgba(255,255,255,0.10)' }}
              onClick={handleScrub}
              role="slider"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(fraction * 100)}
              tabIndex={0}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${fraction * 100}%`,
                  background: entry.meta.palette.accent,
                }}
              />
            </div>
            <div
              className="text-[11px] tabular-nums w-20 text-right"
              style={{ color: 'var(--muted)' }}
            >
              {formatSeconds(state.currentTime)} / {formatSeconds(state.duration)}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
