import { useEffect, useRef, useState } from 'react'

type State = 'idle' | 'loading' | 'playing' | 'error'

// Module-level singleton so starting one preview stops any other that's playing.
// Two side-by-side buttons playing over each other is confusing and defeats the
// point of tag-tuning by ear.
let activeStop: (() => void) | null = null

interface Props {
  text: string
  voiceRef: string
  /** Only used to key the on-disk cache — different segments cache separately.
   * Prefixed with "preview-" so previews don't collide with pre-render output
   * for the same segment. */
  segmentId: string
  /** ElevenLabs model id — comes from the host's ttsModel field. Undefined
   * falls back to the ElevenLabsTTS default (v2). */
  ttsModel?: string
}

export function PreviewButton({ text, voiceRef, segmentId, ttsModel }: Props) {
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const cancelledRef = useRef(false)

  const disabled = !text.trim() || !voiceRef.startsWith('elevenlabs:')
  const tooltip = disabled
    ? !text.trim()
      ? 'Nothing to preview yet — write some text.'
      : "This host isn't using an ElevenLabs voice."
    : state === 'playing'
      ? 'Pause preview'
      : state === 'loading'
        ? 'Loading…'
        : 'Play preview'

  const stopSelf = () => {
    cancelledRef.current = true
    const a = audioRef.current
    audioRef.current = null
    if (a) {
      a.pause()
      a.removeAttribute('src')
      a.load()
    }
    setState('idle')
    if (activeStop === stopSelf) activeStop = null
  }

  useEffect(() => {
    // Cleanup on unmount — otherwise a segment closed mid-playback keeps playing.
    return () => stopSelf()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onClick() {
    if (disabled) return
    if (state === 'playing') {
      stopSelf()
      return
    }
    // Yield the "active" slot to this button, cancelling any other playback.
    if (activeStop && activeStop !== stopSelf) activeStop()
    activeStop = stopSelf
    cancelledRef.current = false

    setError(null)
    setState('loading')
    try {
      const { filePath } = await window.deepcuts.tts.elevenlabs(
        text,
        voiceRef,
        `preview-${segmentId}`,
        ttsModel,
      )
      if (cancelledRef.current) return
      const src = filePath.startsWith('file://') ? filePath : `file://${filePath}`
      const audio = new Audio(src)
      audio.preload = 'auto'
      audioRef.current = audio
      audio.addEventListener('ended', () => {
        if (audioRef.current === audio) {
          audioRef.current = null
          setState('idle')
          if (activeStop === stopSelf) activeStop = null
        }
      })
      audio.addEventListener('error', () => {
        if (audioRef.current === audio) {
          audioRef.current = null
          setState('error')
          setError('Playback failed')
          if (activeStop === stopSelf) activeStop = null
        }
      })
      await audio.play()
      if (cancelledRef.current) {
        audio.pause()
        return
      }
      setState('playing')
    } catch (e) {
      if (cancelledRef.current) return
      setState('error')
      setError(e instanceof Error ? e.message.slice(0, 120) : 'Preview failed')
      if (activeStop === stopSelf) activeStop = null
    }
  }

  const icon =
    state === 'loading' ? (
      <span className="inline-block w-3 h-3 rounded-full border-2 border-[var(--color-muted)] border-t-transparent animate-spin" />
    ) : state === 'playing' ? (
      // Pause icon (two vertical bars)
      <span className="inline-flex gap-[2px]">
        <span className="w-[2px] h-2.5 bg-current" />
        <span className="w-[2px] h-2.5 bg-current" />
      </span>
    ) : (
      // Play triangle
      <span
        className="inline-block w-0 h-0"
        style={{
          borderLeft: '7px solid currentColor',
          borderTop: '4px solid transparent',
          borderBottom: '4px solid transparent',
          marginLeft: 1,
        }}
      />
    )

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || state === 'loading'}
        title={tooltip}
        aria-label={tooltip}
        className={
          'inline-flex items-center justify-center w-6 h-6 rounded-full border ' +
          'border-[var(--color-hairline)] text-[var(--color-muted)] ' +
          'hover:text-[var(--color-text)] hover:bg-white/5 ' +
          'disabled:opacity-30 disabled:cursor-not-allowed'
        }
      >
        {icon}
      </button>
      {error && state === 'error' && (
        <span className="text-[10px] text-red-400 max-w-[240px] truncate" title={error}>
          {error}
        </span>
      )}
    </div>
  )
}
