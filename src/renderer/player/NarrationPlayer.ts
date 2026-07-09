import type { NarrationSegment } from '../../shared/manifest'

export interface PlayAudioTick {
  currentTime: number
  duration: number
}

export interface NarrationPlayerDeps {
  playAudio: (src: string, signal?: AbortSignal, onTick?: (t: PlayAudioTick) => void) => Promise<void>
  elevenLabs: (
    text: string,
    voiceRef: string,
    segmentId: string,
    modelId?: string,
  ) => Promise<{ filePath: string; cached: boolean }>
  systemSpeak: (
    text: string,
    onBoundary?: (charIndex: number, charLength: number) => void,
  ) => { done: Promise<void>; cancel: () => void }
}

export interface PlayHandle {
  done: Promise<void>
  cancel: () => void
}

export interface PlayOpts {
  hasElevenLabsKey: boolean
  /** Per-host ElevenLabs model. Undefined → ElevenLabsTTS default (v2). */
  ttsModel?: string
  onProgress?: (charIndex: number) => void
  onElevenLabsFailure?: (err: unknown) => void
}

export class NarrationPlayer {
  constructor(private deps: NarrationPlayerDeps) {}

  play(segment: NarrationSegment, hostVoiceRef: string, opts: PlayOpts): PlayHandle {
    let cancelled = false
    let onCancel: () => void = () => {}
    const setCancel = (fn: () => void) => { onCancel = fn }

    const totalChars = segment.text.length
    const audioTick = (t: PlayAudioTick) => {
      if (!opts.onProgress || t.duration === 0) return
      const frac = Math.min(1, Math.max(0, t.currentTime / t.duration))
      opts.onProgress(Math.floor(frac * totalChars))
    }

    const done = (async () => {
      if (segment.audio) {
        await this.playAudioSrc(segment.audio, setCancel, () => cancelled, audioTick)
        return
      }
      if (opts.hasElevenLabsKey && hostVoiceRef.startsWith('elevenlabs:')) {
        try {
          const { filePath } = await this.deps.elevenLabs(segment.text, hostVoiceRef, segment.id, opts.ttsModel)
          if (cancelled) return
          const src = filePath.startsWith('file://') ? filePath : `file://${filePath}`
          await this.playAudioSrc(src, setCancel, () => cancelled, audioTick)
          return
        } catch (err) {
          const detail = (err as { detail?: string } | undefined)?.detail
          console.warn('ElevenLabs failed, falling back to SystemTTS:', err, detail ? `\nResponse body: ${detail}` : '')
          opts.onElevenLabsFailure?.(err)
        }
      }
      const handle = this.deps.systemSpeak(segment.text, (charIndex) => {
        opts.onProgress?.(charIndex)
      })
      setCancel(handle.cancel)
      await handle.done
    })()

    return {
      done,
      cancel: () => {
        cancelled = true
        try { onCancel() } catch {}
      },
    }
  }

  private async playAudioSrc(
    src: string,
    setCancel: (fn: () => void) => void,
    isCancelled: () => boolean,
    onTick?: (t: PlayAudioTick) => void,
  ): Promise<void> {
    const controller = new AbortController()
    setCancel(() => controller.abort())
    if (isCancelled()) return
    await this.deps.playAudio(src, controller.signal, onTick)
  }
}
