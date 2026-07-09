import type { SchedulerState } from '../player/Scheduler'
import type { FlatSegment } from '../../shared/manifest'
import { SongProgress } from './SongProgress'

export function NowPlaying({ state }: { state: SchedulerState }) {
  const segment = state.segments[state.segmentIndex] as FlatSegment | undefined
  if (!segment) return null

  const status = state.status
  const isSong = status.kind === 'playing-song'
  const isNarration = status.kind === 'playing-narration'
  const isVoiceover = status.kind === 'playing-narration-over-song'
  const isPaused = status.kind === 'paused'

  const trackLabel = segment.type === 'song' ? `${segment.track.artist} — ${segment.track.title}` : null

  let voiceoverHostName: string | null = null
  if (isVoiceover && segment.type === 'song') {
    const vo = segment.voiceovers?.find((v) => v.id === status.voiceoverId)
    const host = vo ? state.manifest?.hosts.find((h) => h.id === vo.hostId) : undefined
    voiceoverHostName = host?.name ?? null
  }

  const narrationHost =
    segment.type === 'narration'
      ? state.manifest?.hosts.find((h) => h.id === segment.hostId)
      : undefined

  const positionSec = (isSong || isVoiceover) ? status.positionSec : 0
  const trackDurationSec = (isSong || isVoiceover) ? status.trackDurationSec : null

  return (
    <div>
      <div className="flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-[var(--color-muted)] flex-wrap">
        {(isSong || isVoiceover) && (
          <span className="flex items-center gap-2">
            <span className="relative inline-flex h-2 w-2" aria-hidden>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1DB954] opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#1DB954]" />
            </span>
            <span>playing in Spotify</span>
          </span>
        )}
        {isNarration && (
          <span className="flex items-center gap-2">
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-accent)]" aria-hidden />
            <span>narration</span>
          </span>
        )}
        {isVoiceover && voiceoverHostName && (
          <span className="flex items-center gap-2">
            <span className="text-[var(--color-muted)]/60">·</span>
            <span className="relative inline-flex h-2 w-2" aria-hidden>
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-accent)] opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-accent)]" />
            </span>
            <span>{voiceoverHostName} over the song</span>
          </span>
        )}
        {isPaused && <span>paused</span>}
      </div>
      <div className="text-lg font-medium mt-1 transition-opacity duration-200">
        {segment.type === 'song' ? trackLabel : narrationHost?.name ?? 'Narrator'}
      </div>
      {(isSong || isVoiceover) && (
        <div className="mt-3">
          <SongProgress positionSec={positionSec} durationSec={trackDurationSec} />
        </div>
      )}
    </div>
  )
}
