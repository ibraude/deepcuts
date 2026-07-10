import { useCallback, useEffect, useRef, useState } from 'react'
import { flattenSegments } from '@shared/manifest'
import { fetchManifest } from '../catalog/fetchCatalog'

export interface PlayerState {
  activeId: string | null
  status: 'idle' | 'loading' | 'playing' | 'paused'
  currentTime: number
  duration: number
  accent: string | null
  previewUrl: string | null
  error: string | null
}

export interface PlayerApi {
  state: PlayerState
  playEpisode(id: string, accent: string): Promise<void>
  pause(): void
  resume(): void
  seek(fraction: number): void
  audioRef: React.RefObject<HTMLAudioElement>
}

const INITIAL: PlayerState = {
  activeId: null,
  status: 'idle',
  currentTime: 0,
  duration: 0,
  accent: null,
  previewUrl: null,
  error: null,
}

export function usePlayer(): PlayerApi {
  const [state, setState] = useState<PlayerState>(INITIAL)
  const audioRef = useRef<HTMLAudioElement>(null)

  const playEpisode = useCallback(async (id: string, accent: string) => {
    setState((s) => ({ ...s, status: 'loading', activeId: id, error: null }))
    try {
      const manifest = await fetchManifest(id)
      const flat = flattenSegments(manifest)
      const first = flat.find((s) => s.type === 'narration' && s.audio)
      const previewUrl =
        first && first.type === 'narration' ? first.audio ?? null : null
      if (!previewUrl) {
        setState({ ...INITIAL, error: 'No preview audio available for this episode.' })
        return
      }
      setState((s) => ({
        ...s,
        activeId: id,
        accent,
        previewUrl,
        currentTime: 0,
        status: 'playing',
      }))
      const el = audioRef.current
      if (el) {
        el.src = previewUrl
        el.load()
        await el.play().catch(() => { /* autoplay policy */ })
      }
    } catch (err) {
      setState({
        ...INITIAL,
        error: err instanceof Error ? err.message : 'Failed to load preview',
      })
    }
  }, [])

  const pause = useCallback(() => {
    audioRef.current?.pause()
    setState((s) => (s.status === 'playing' ? { ...s, status: 'paused' } : s))
  }, [])

  const resume = useCallback(() => {
    void audioRef.current?.play().catch(() => {})
    setState((s) => (s.status === 'paused' ? { ...s, status: 'playing' } : s))
  }, [])

  const seek = useCallback((fraction: number) => {
    const el = audioRef.current
    if (!el || !el.duration || !isFinite(el.duration)) return
    el.currentTime = Math.max(0, Math.min(1, fraction)) * el.duration
  }, [])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onTime = () => setState((s) => ({ ...s, currentTime: el.currentTime }))
    const onMeta = () => setState((s) => ({ ...s, duration: el.duration }))
    const onEnded = () => setState((s) => ({ ...s, status: 'idle', currentTime: 0 }))
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('ended', onEnded)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('ended', onEnded)
    }
  }, [])

  return { state, playEpisode, pause, resume, seek, audioRef }
}
