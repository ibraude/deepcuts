import { useState } from 'react'
import { Cover } from '../ui/Cover'
import { NowPlaying } from '../ui/NowPlaying'
import { ProgressBar } from '../ui/ProgressBar'
import { Transcript } from '../ui/Transcript'
import { ErrorPanel } from '../ui/ErrorPanel'
import { ChapterStrip } from '../ui/ChapterStrip'
import { usePlayerStore } from './playerStore'
import { isVoiceBannerDismissed, dismissVoiceBanner, openVoiceSettings } from '../settings/voiceBanner'

export function Player() {
  const state = usePlayerStore((s) => s.schedulerState)
  const charIndex = usePlayerStore((s) => s.narrationCharIndex)
  const pause = usePlayerStore((s) => s.pause)
  const resume = usePlayerStore((s) => s.resume)
  const next = usePlayerStore((s) => s.next)
  const previous = usePlayerStore((s) => s.previous)
  const stop = usePlayerStore((s) => s.stop)
  const jumpToChapter = usePlayerStore((s) => s.jumpToChapter)
  const voicePick = usePlayerStore((s) => s.voicePick)
  const hasElevenLabsKey = usePlayerStore((s) => s.hasElevenLabsKey)
  const elevenLabsFailure = usePlayerStore((s) => s.elevenLabsFailure)
  const dismissElevenLabsFailure = usePlayerStore((s) => s.dismissElevenLabsFailure)
  const [bannerDismissed, setBannerDismissed] = useState(isVoiceBannerDismissed())

  const manifest = state.manifest
  if (!manifest) return null

  const total = state.segments.length
  const segment = state.segments[state.segmentIndex]
  const progress = total > 0 ? state.segmentIndex / total : 0
  const isPaused = state.status.kind === 'paused'
  const isError = state.status.kind === 'error'
  const atStart = state.segmentIndex <= 0
  const usingSystemVoice = !hasElevenLabsKey
  const lowQuality =
    usingSystemVoice &&
    (voicePick.quality === 'standard' ||
      voicePick.quality === 'fallback' ||
      voicePick.quality === 'none')

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 p-12 max-w-5xl mx-auto w-full">
        <button
          onClick={stop}
          className="no-drag text-xs uppercase tracking-[0.2em] text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          ← Library
        </button>

        {elevenLabsFailure && (
          <div className="mt-6 px-4 py-3 rounded-md bg-amber-500/10 border border-amber-500/40 text-sm space-y-2">
            <div className="flex items-start justify-between gap-4">
              <div>{elevenLabsFailure.message}</div>
              <button
                onClick={dismissElevenLabsFailure}
                className="text-[var(--color-muted)] hover:text-[var(--color-text)]"
                aria-label="Dismiss"
              >×</button>
            </div>
            {elevenLabsFailure.detail && (
              <details className="text-xs text-[var(--color-muted)]">
                <summary className="cursor-pointer">ElevenLabs response</summary>
                <pre className="mt-1 whitespace-pre-wrap break-all font-mono">{elevenLabsFailure.detail}</pre>
              </details>
            )}
          </div>
        )}

        {!elevenLabsFailure && lowQuality && !bannerDismissed && (
          <div className="mt-6 px-4 py-3 rounded-md bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 text-sm flex items-center justify-between gap-4">
            <div>
              For richer narration, download a premium voice in
              <button onClick={openVoiceSettings} className="ml-1 underline">
                System Settings → Accessibility → Spoken Content
              </button>.
            </div>
            <button
              onClick={() => { dismissVoiceBanner(); setBannerDismissed(true) }}
              className="text-[var(--color-muted)] hover:text-[var(--color-text)]"
              aria-label="Dismiss"
            >×</button>
          </div>
        )}

        <div className="mt-12 flex gap-12 items-start">
          <Cover coverPath={manifest.coverImage} alt={manifest.title} size={320} />
          <div className="flex-1 space-y-6 min-w-0">
            <div>
              <div className="text-xs tracking-[0.2em] uppercase text-[var(--color-muted)]">{manifest.subject}</div>
              <h1 className="text-3xl font-medium mt-1">{manifest.title}</h1>
              {segment && (
                <div className="text-sm text-[var(--color-muted)] mt-2">{segment.chapterTitle}</div>
              )}
            </div>
            <ChapterStrip state={state} onJump={jumpToChapter} />
            <NowPlaying state={state} />
            <div className="max-h-[40vh] overflow-y-auto pr-2">
              <Transcript state={state} charIndex={charIndex} />
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--color-hairline)] px-12 py-4 max-w-5xl mx-auto w-full">
        <ProgressBar value={progress} />
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={previous}
            disabled={atStart}
            className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-hairline)] hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Previous segment"
          >
            ← Prev
          </button>
          {isPaused ? (
            <button
              onClick={resume}
              className="text-sm px-4 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30"
            >
              Resume
            </button>
          ) : (
            <button
              onClick={pause}
              className="text-sm px-4 py-1.5 rounded-md border border-[var(--color-hairline)] hover:bg-white/5"
            >
              Pause
            </button>
          )}
          <button
            onClick={next}
            className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-hairline)] hover:bg-white/5"
            aria-label="Next segment"
          >
            Skip →
          </button>
          <div className="ml-auto text-xs text-[var(--color-muted)]">
            {state.segmentIndex + 1} / {total}
          </div>
        </div>
      </div>

      {isError && state.status.kind === 'error' && (
        <ErrorPanel
          kind={state.status.errorKind}
          message={state.status.message}
          onRetry={() => resume()}
          onDismiss={() => stop()}
        />
      )}
    </div>
  )
}
