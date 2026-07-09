import { create } from 'zustand'
import { episodeManifestSchema, type EpisodeManifest } from '../../shared/manifest'
import { Scheduler, type SchedulerState } from './Scheduler'
import { NarrationPlayer } from './NarrationPlayer'
import { SystemTTS, type VoicePick } from './SystemTTS'
import { loadUserVoiceRef, saveUserVoiceRef } from '../settings/voiceCatalog'

interface PlayerStore {
  schedulerState: SchedulerState
  voicePick: VoicePick
  hasElevenLabsKey: boolean
  userVoiceRef: string | null
  narrationCharIndex: number
  elevenLabsFailure: { message: string; detail?: string } | null
  init(): Promise<void>
  openAndPlay(manifestPath: string): Promise<void>
  startWithManifest(manifest: EpisodeManifest): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  next(): Promise<void>
  previous(): Promise<void>
  stop(): Promise<void>
  jumpToSegment(index: number): Promise<void>
  jumpToChapter(chapterIndex: number): Promise<void>
  refreshKey(): Promise<void>
  setUserVoiceRef(voiceRef: string | null): void
  dismissElevenLabsFailure(): void
}

const sys = new SystemTTS()

const playAudio = (
  src: string,
  signal?: AbortSignal,
  onTick?: (t: { currentTime: number; duration: number }) => void,
) =>
  new Promise<void>((resolve, reject) => {
    const audio = new Audio(src)
    audio.preload = 'auto'
    const cleanup = () => {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    if (onTick) {
      audio.addEventListener('timeupdate', () => {
        if (!Number.isFinite(audio.duration) || audio.duration === 0) return
        onTick({ currentTime: audio.currentTime, duration: audio.duration })
      })
    }
    audio.addEventListener('ended', () => { cleanup(); resolve() })
    audio.addEventListener('error', () => { cleanup(); reject(new Error(`Audio failed: ${src}`)) })
    signal?.addEventListener('abort', () => { cleanup(); resolve() })
    audio.play().catch(reject)
  })

const narrationPlayer = new NarrationPlayer({
  playAudio,
  elevenLabs: (text, voiceRef, segmentId, modelId) =>
    window.deepcuts.tts.elevenlabs(text, voiceRef, segmentId, modelId),
  systemSpeak: (text, onBoundary) => sys.speak(text, onBoundary),
})

let currentHasKey = false
let currentUserVoiceRef: string | null = null
let currentHostCount = 1
let progressSink: ((charIndex: number) => void) | null = null
let failureSink: ((err: unknown) => void) | null = null

const scheduler = new Scheduler({
  music: {
    ensureReady: () => window.deepcuts.spotify.ensureReady(),
    play: (uri) => window.deepcuts.spotify.play(uri),
    pause: () => window.deepcuts.spotify.pause(),
    getPosition: () => window.deepcuts.spotify.getPosition(),
    getState: () => window.deepcuts.spotify.getState(),
    getCurrentTrack: () => window.deepcuts.spotify.getCurrentTrack(),
    getDuration: () => window.deepcuts.spotify.getDuration(),
    getVolume: () => window.deepcuts.spotify.getVolume(),
    setVolume: (pct) => window.deepcuts.spotify.setVolume(pct),
  },
  playNarration: (segmentId, text, voiceRef, ttsModel) => {
    // Only apply the user's global voice override on single-host episodes.
    // Multi-host episodes intentionally use distinct authored voices per host.
    const effectiveVoiceRef = currentHostCount <= 1 && currentUserVoiceRef ? currentUserVoiceRef : voiceRef
    progressSink?.(0)
    return narrationPlayer.play(
      { type: 'narration', id: segmentId, hostId: '', text },
      effectiveVoiceRef,
      {
        hasElevenLabsKey: currentHasKey,
        ttsModel,
        onProgress: (charIndex) => progressSink?.(charIndex),
        onElevenLabsFailure: (err) => failureSink?.(err),
      },
    )
  },
})

export const usePlayerStore = create<PlayerStore>((set, get) => ({
  schedulerState: scheduler.getState(),
  voicePick: { voice: null, quality: 'none' },
  hasElevenLabsKey: false,
  userVoiceRef: null,
  narrationCharIndex: 0,
  elevenLabsFailure: null,

  async init() {
    progressSink = (charIndex) => set({ narrationCharIndex: charIndex })
    failureSink = (err) => {
      const e = err as { message?: string; detail?: string } | undefined
      const msg = e?.message ?? String(err)
      const friendly = `ElevenLabs rejected the request (${msg}). Using your Mac's system voice. See details for what ElevenLabs said.`
      set({ elevenLabsFailure: { message: friendly, detail: e?.detail } })
    }
    scheduler.on('change', (s) => {
      set({ schedulerState: s })
      // Reset progress on segment boundary or non-narration status.
      if (s.status.kind !== 'playing-narration') set({ narrationCharIndex: 0 })
    })
    const voices = await SystemTTS.listVoices()
    const pick = SystemTTS.pickBestVoice(voices)
    sys.setVoice(pick.voice)
    const userRef = loadUserVoiceRef()
    currentUserVoiceRef = userRef
    set({ voicePick: pick, userVoiceRef: userRef })
    await get().refreshKey()
  },

  async refreshKey() {
    const k = await window.deepcuts.keychain.get('elevenlabs')
    currentHasKey = !!k
    set({ hasElevenLabsKey: !!k })
  },

  setUserVoiceRef(voiceRef: string | null) {
    currentUserVoiceRef = voiceRef
    saveUserVoiceRef(voiceRef)
    set({ userVoiceRef: voiceRef })
  },

  dismissElevenLabsFailure() {
    set({ elevenLabsFailure: null })
  },

  async openAndPlay(manifestPath: string) {
    const raw = (await window.deepcuts.manifest.load(manifestPath)) as unknown
    const manifest: EpisodeManifest = episodeManifestSchema.parse(raw)
    await get().startWithManifest(manifest)
  },

  async startWithManifest(manifest: EpisodeManifest) {
    currentHostCount = manifest.hosts.length
    await scheduler.start(manifest, { hasElevenLabsKey: get().hasElevenLabsKey })
  },

  pause: () => scheduler.pause(),
  resume: () => scheduler.resume(),
  next: () => scheduler.next(),
  previous: () => scheduler.previous(),
  stop: () => scheduler.stop(),
  jumpToSegment: (index) => scheduler.jumpToSegment(index),
  async jumpToChapter(chapterIndex) {
    const segments = get().schedulerState.segments
    const target = segments.find((s) => s.chapterIndex === chapterIndex)
    if (target) await scheduler.jumpToSegment(target.indexInEpisode)
  },
}))
