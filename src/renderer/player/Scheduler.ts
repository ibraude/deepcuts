import { type EpisodeManifest, type FlatSegment, flattenSegments } from '../../shared/manifest'
import type { DeepcutsErrorKind } from '../../shared/errors'

export type SchedulerStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'playing-narration'; segmentId: string }
  | { kind: 'playing-song'; segmentId: string; positionSec: number; trackDurationSec: number | null }
  | {
      kind: 'playing-narration-over-song'
      segmentId: string
      voiceoverId: string
      positionSec: number
      trackDurationSec: number | null
    }
  | { kind: 'paused'; reason: 'user' | 'interrupted'; segmentId: string }
  | { kind: 'done' }
  | { kind: 'error'; errorKind: DeepcutsErrorKind; message: string }

export interface SchedulerState {
  status: SchedulerStatus
  manifest: EpisodeManifest | null
  segments: FlatSegment[]
  segmentIndex: number
}

export interface SchedulerMusic {
  ensureReady(): Promise<void>
  play(uri: string): Promise<void>
  pause(): Promise<void>
  getPosition(): Promise<number>
  getState(): Promise<'playing' | 'paused' | 'stopped'>
  getCurrentTrack(): Promise<{ id: string; uri: string }>
  getDuration(): Promise<number>
  getVolume(): Promise<number>
  setVolume(pct: number): Promise<void>
}

export interface SchedulerDeps {
  music: SchedulerMusic
  playNarration: (segmentId: string, text: string, hostVoiceRef: string, ttsModel?: string, audio?: string) => { done: Promise<void>; cancel: () => void }
  pollIntervalMs?: number
  // Fade duration applied when cutting a song mid-play before the next segment.
  // Defaults to 1800ms; injectable so tests don't have to wait real time.
  songEndFadeMs?: number
}

type Listener = (state: SchedulerState) => void

export class Scheduler {
  private state: SchedulerState = { status: { kind: 'idle' }, manifest: null, segments: [], segmentIndex: 0 }
  private listeners = new Set<Listener>()
  private narrationHandle: { done: Promise<void>; cancel: () => void } | null = null
  private songControl: { stop: () => void } | null = null
  private pauseSignal: { paused: boolean } = { paused: false }
  private skipSignal: { skip: boolean } = { skip: false }
  private stopSignal: { stop: boolean } = { stop: false }
  private resumeWaiter: (() => void) | null = null
  private runPromise: Promise<void> | null = null

  constructor(private deps: SchedulerDeps) {}

  getState(): SchedulerState {
    return this.state
  }

  on(_event: 'change', handler: Listener): () => void {
    this.listeners.add(handler)
    return () => { this.listeners.delete(handler) }
  }

  private setState(next: Partial<SchedulerState>) {
    this.state = { ...this.state, ...next }
    for (const l of this.listeners) l(this.state)
  }

  async start(manifest: EpisodeManifest, _opts: { hasElevenLabsKey: boolean }): Promise<void> {
    if (this.runPromise) await this.stop()
    const segments = flattenSegments(manifest)
    this.pauseSignal = { paused: false }
    this.skipSignal = { skip: false }
    this.stopSignal = { stop: false }
    this.setState({ manifest, segments, segmentIndex: 0, status: { kind: 'loading' } })
    this.runPromise = this.run()
    return this.runPromise
  }

  async pause(): Promise<void> {
    const current = this.state.status
    if (current.kind === 'playing-narration') {
      this.pauseSignal.paused = true
      this.narrationHandle?.cancel()
      this.setState({ status: { kind: 'paused', reason: 'user', segmentId: current.segmentId } })
    } else if (current.kind === 'playing-song') {
      this.pauseSignal.paused = true
      this.songControl?.stop()
      await this.deps.music.pause().catch(() => {})
      this.setState({ status: { kind: 'paused', reason: 'user', segmentId: current.segmentId } })
    }
  }

  async resume(): Promise<void> {
    const status = this.state.status
    if (status.kind !== 'paused') return
    this.pauseSignal.paused = false
    const waiter = this.resumeWaiter
    this.resumeWaiter = null
    waiter?.()
    // For paused-interrupted (Spotify paused externally), kick Spotify back into playback
    // so the polling loop sees state === 'playing' and exits the interrupted state.
    if (status.reason === 'interrupted') {
      const segment = this.state.segments[this.state.segmentIndex]
      if (segment?.type === 'song') {
        await this.deps.music.play(segment.track.spotifyUri).catch(() => {})
      }
    }
  }

  async next(): Promise<void> {
    this.skipSignal.skip = true
    this.narrationHandle?.cancel()
    this.songControl?.stop()
    await this.deps.music.pause().catch(() => {})
  }

  async previous(): Promise<void> {
    if (this.state.segmentIndex === 0) return
    await this.jumpToSegment(this.state.segmentIndex - 1)
  }

  async jumpToSegment(index: number): Promise<void> {
    const target = Math.max(0, Math.min(index, this.state.segments.length - 1))
    this.skipSignal.skip = true
    this.setState({ segmentIndex: target })
    this.narrationHandle?.cancel()
    this.songControl?.stop()
    await this.deps.music.pause().catch(() => {})
  }

  async stop(): Promise<void> {
    this.stopSignal.stop = true
    this.skipSignal.skip = true
    this.pauseSignal.paused = false
    this.narrationHandle?.cancel()
    this.songControl?.stop()
    const waiter = this.resumeWaiter
    this.resumeWaiter = null
    waiter?.()
    await this.deps.music.pause().catch(() => {})
    if (this.runPromise) await this.runPromise.catch(() => {})
    this.runPromise = null
    this.setState({ status: { kind: 'idle' } })
  }

  private async run(): Promise<void> {
    while (!this.stopSignal.stop && this.state.segmentIndex < this.state.segments.length) {
      const idx = this.state.segmentIndex
      const segment = this.state.segments[idx]!
      this.skipSignal.skip = false

      if (this.pauseSignal.paused) {
        await this.waitForResume()
        if (this.stopSignal.stop) return
      }

      if (segment.type === 'narration') {
        await this.runNarration(segment)
      } else {
        await this.runSong(segment)
      }

      if (this.stopSignal.stop) return
      if (this.state.segmentIndex === idx) {
        this.setState({ segmentIndex: idx + 1 })
      }
    }
    if (!this.stopSignal.stop) this.setState({ status: { kind: 'done' } })
  }

  private async runNarration(segment: FlatSegment & { type: 'narration' }): Promise<void> {
    const host = this.state.manifest?.hosts.find((h) => h.id === segment.hostId)
    const voiceRef = host?.voiceRef ?? 'system:default'
    this.setState({ status: { kind: 'playing-narration', segmentId: segment.id } })
    this.narrationHandle = this.deps.playNarration(segment.id, segment.text, voiceRef, host?.ttsModel, segment.audio)
    try {
      await this.narrationHandle.done
    } finally {
      this.narrationHandle = null
    }
  }

  private async runSong(segment: FlatSegment & { type: 'song' }): Promise<void> {
    this.setState({ status: { kind: 'playing-song', segmentId: segment.id, positionSec: 0, trackDurationSec: null } })
    // Fail fast on placeholder/unresolved URIs. Surface the error so the user
    // can fix the manifest, but advance past this segment so the rest of the
    // episode can still play instead of getting stuck on the first bad song.
    if (!/^spotify:track:[A-Za-z0-9]{22}$/.test(segment.track.spotifyUri)) {
      // eslint-disable-next-line no-console
      console.warn(
        '[Scheduler] skipping song with unresolved/invalid URI',
        { segmentId: segment.id, uri: segment.track.spotifyUri, title: segment.track.title },
      )
      this.surfaceError({
        kind: 'AppleScript',
        message: `Song "${segment.track.title}" has no Spotify URI yet. Resolve it in the editor.`,
      })
      return
    }
    try {
      await this.deps.music.ensureReady()
      if (this.stopSignal.stop || this.skipSignal.skip) return
      await this.deps.music.play(segment.track.spotifyUri)
    } catch (err) {
      this.surfaceError(err)
      await this.waitForResume()
      if (this.stopSignal.stop) return
      try {
        await this.deps.music.ensureReady()
        await this.deps.music.play(segment.track.spotifyUri)
      } catch (err2) {
        this.surfaceError(err2)
        return
      }
    }

    // Read track duration with retry — Spotify often returns 0 / missing right after play()
    // while the track is still loading. Try a handful of times across poll ticks.
    let trackDuration: number | null = null
    let durationAttempts = 0
    const MAX_DURATION_ATTEMPTS = 6
    const tryGetDuration = async () => {
      if (trackDuration !== null || durationAttempts >= MAX_DURATION_ATTEMPTS) return
      durationAttempts++
      try {
        const d = await this.deps.music.getDuration()
        if (d > 0 && Number.isFinite(d)) trackDuration = d
      } catch {
        // try again next poll
      }
    }
    await tryGetDuration()

    // Voiceover state — narration that talks over the music with ducked Spotify volume.
    const voiceovers = segment.voiceovers ?? []
    const triggeredVoiceovers = new Set<number>()
    let activeVoiceoverIndex: number | null = null
    let activeVoiceoverHandle: { done: Promise<void>; cancel: () => void } | null = null
    let preDuckVolume: number | null = null
    let duckedToVolume: number | null = null

    // Quick duck for voiceover (must finish before the host starts speaking).
    const DUCK_FADE_MS = 600
    // Slow, gradual fade for song-end cuts so the transition into the next narration
    // feels musical rather than abrupt.
    const SONG_END_FADE_MS = this.deps.songEndFadeMs ?? 1800
    // Beat of silence between phases (post-fade → next narration, voiceover end → music return).
    // Kept short because the TTS load latency already provides natural separation.
    const BEAT_MS = 100
    // Step interval ~100ms regardless of total duration — smoother fade on longer ones.
    const FADE_STEP_MS = 100

    const fadeVolume = async (from: number, to: number, durationMs: number = DUCK_FADE_MS) => {
      const steps = Math.max(4, Math.round(durationMs / FADE_STEP_MS))
      const stepInterval = Math.floor(durationMs / steps)
      for (let i = 1; i <= steps; i++) {
        const v = Math.round(from + (to - from) * (i / steps))
        await this.deps.music.setVolume(v).catch(() => {})
        if (i < steps) await new Promise((r) => setTimeout(r, stepInterval))
      }
    }

    const restoreVolume = async () => {
      // Used on cancel/interrupt paths — set instantly, no fade.
      if (preDuckVolume !== null) {
        const target = preDuckVolume
        preDuckVolume = null
        duckedToVolume = null
        await this.deps.music.setVolume(target).catch(() => {})
      }
    }

    let stopped = false
    this.songControl = {
      stop: () => {
        stopped = true
        activeVoiceoverHandle?.cancel()
      },
    }
    const poll = this.deps.pollIntervalMs ?? 500
    const startedAt = Date.now()
    let pausedInterrupted = false
    let exitReason: 'cut' | 'trackChanged' | 'cancelled' = 'cancelled'
    // Grace period: Spotify may briefly still report the previous track right after
    // play(). Only treat a URI mismatch as a real track change AFTER we've seen
    // our target track at least once, OR after a settle deadline has passed.
    // Without this, a stale read on the very first poll causes a false "trackChanged"
    // and the segment is abandoned milliseconds after it starts.
    let sawOurTrack = false
    const SETTLE_GRACE_MS = 4000
    // AppleScript reads sometimes flicker mid-playback — Spotify may briefly
    // report a queued/adjacent track URI while still playing ours. Require the
    // mismatch to persist across two consecutive polls (~1s at the default
    // 500ms interval) before treating it as a real track change. A real user
    // skip / natural song end holds the new URI indefinitely; a transient
    // stale read clears on the next poll.
    let mismatchStreak = 0
    const MISMATCH_TRIGGER = 2

    while (!stopped && !this.stopSignal.stop && !this.skipSignal.skip) {
      // App-side pause (user clicked our Pause button).
      if (this.pauseSignal.paused) {
        activeVoiceoverHandle?.cancel()
        activeVoiceoverHandle = null
        activeVoiceoverIndex = null
        await restoreVolume()
        await this.waitForResume()
        if (this.stopSignal.stop) return
        if (!this.pauseSignal.paused) {
          await this.deps.music.play(segment.track.spotifyUri).catch(() => {})
        }
      }
      if (trackDuration === null) await tryGetDuration()
      let pos = 0
      let state: 'playing' | 'paused' | 'stopped' = 'playing'
      // uriRead distinguishes "we actually got a URI from Spotify" from "the read
      // failed and we're using the default". Without this, the default value
      // equals segment.track.spotifyUri and falsely flips sawOurTrack to true
      // even when Spotify is on a different track or unreachable.
      let uri = ''
      let uriRead = false
      try {
        pos = await this.deps.music.getPosition()
        state = await this.deps.music.getState()
        const t = await this.deps.music.getCurrentTrack()
        uri = t.uri
        uriRead = true
      } catch {
        // transient — try again next tick
      }
      if (stopped || this.stopSignal.stop || this.skipSignal.skip) break

      // Exit paused-interrupted state if Spotify resumed externally OR our app resume queued play().
      if (pausedInterrupted) {
        if (state === 'playing' && uri === segment.track.spotifyUri) {
          pausedInterrupted = false
        } else {
          await new Promise((r) => setTimeout(r, poll))
          continue
        }
      }

      // Trigger any due voiceovers (only one at a time).
      if (activeVoiceoverIndex === null) {
        for (let i = 0; i < voiceovers.length; i++) {
          if (triggeredVoiceovers.has(i)) continue
          const vo = voiceovers[i]!
          if (pos >= vo.atSeconds) {
            triggeredVoiceovers.add(i)
            activeVoiceoverIndex = i
            const host = this.state.manifest?.hosts.find((h) => h.id === vo.hostId)
            const voiceRef = host?.voiceRef ?? 'system:default'
            const voHostTtsModel = host?.ttsModel

            // Fade-down only if we're not already ducked from a previous voiceover with holdDuck.
            if (preDuckVolume === null) {
              try {
                preDuckVolume = await this.deps.music.getVolume()
              } catch {
                preDuckVolume = 100
              }
              duckedToVolume = vo.duckTo ?? 60
              await fadeVolume(preDuckVolume, duckedToVolume)
              await new Promise((r) => setTimeout(r, BEAT_MS))
            }
            // else: continuing a conversation; volume already ducked, no fade or beat.

            const handle = this.deps.playNarration(vo.id, vo.text, voiceRef, voHostTtsModel, vo.audio)
            activeVoiceoverHandle = handle
            const capturedIndex = i
            const holdDuck = vo.holdDuck === true
            handle.done.then(async () => {
              if (activeVoiceoverIndex !== capturedIndex) return
              if (holdDuck) {
                // Conversation continues; leave the volume ducked for the next voiceover.
                if (activeVoiceoverIndex === capturedIndex) {
                  activeVoiceoverIndex = null
                  activeVoiceoverHandle = null
                }
                return
              }
              await new Promise((r) => setTimeout(r, BEAT_MS))
              if (activeVoiceoverIndex !== capturedIndex) return
              if (preDuckVolume !== null && duckedToVolume !== null) {
                const from = duckedToVolume
                const to = preDuckVolume
                preDuckVolume = null
                duckedToVolume = null
                await fadeVolume(from, to)
              }
              if (activeVoiceoverIndex === capturedIndex) {
                activeVoiceoverIndex = null
                activeVoiceoverHandle = null
              }
            })
            break
          }
        }
      }

      // Status reflects voiceover-over-song when narration is active.
      if (activeVoiceoverIndex !== null) {
        const vo = voiceovers[activeVoiceoverIndex]!
        this.setState({
          status: {
            kind: 'playing-narration-over-song',
            segmentId: segment.id,
            voiceoverId: vo.id,
            positionSec: pos,
            trackDurationSec: trackDuration,
          },
        })
      } else {
        this.setState({
          status: { kind: 'playing-song', segmentId: segment.id, positionSec: pos, trackDurationSec: trackDuration },
        })
      }

      if (pos >= segment.playSeconds) {
        exitReason = 'cut'
        break
      }

      // Detect when Spotify settles on our target track. Only counts if we
      // actually read a URI from Spotify — the default value would also match,
      // creating a false positive when getCurrentTrack() fails.
      if (uriRead && uri === segment.track.spotifyUri) {
        sawOurTrack = true
        mismatchStreak = 0
      }

      // Any track change — natural end, user skipped in Spotify, autoplay advance — means move forward.
      // But ignore mismatches during the settle window, and require the mismatch
      // to persist across MISMATCH_TRIGGER consecutive polls to filter out
      // transient stale reads mid-track.
      const inSettleWindow = !sawOurTrack && Date.now() - startedAt < SETTLE_GRACE_MS
      const uriMismatch = uriRead && !!uri && uri !== segment.track.spotifyUri && !inSettleWindow
      if (uriMismatch) {
        mismatchStreak++
      } else if (uriRead) {
        // Only reset when we successfully read a matching (or empty) URI —
        // don't reset on failed reads (uriRead=false), those are noise.
        mismatchStreak = 0
      }
      if (mismatchStreak >= MISMATCH_TRIGGER) {
        // eslint-disable-next-line no-console
        console.warn(
          '[Scheduler] track changed during song segment',
          {
            segmentId: segment.id,
            expected: segment.track.spotifyUri,
            actual: uri,
            sawOurTrack,
            ageMs: Date.now() - startedAt,
            streak: mismatchStreak,
          },
        )
        exitReason = 'trackChanged'
        break
      }

      // Spotify paused/stopped while still on OUR track → user paused Spotify directly.
      const stoppedPlaying = state !== 'playing' && Date.now() - startedAt > 1000
      if (stoppedPlaying) {
        pausedInterrupted = true
        // Cancel any active voiceover narration when the music underneath stops.
        activeVoiceoverHandle?.cancel()
        activeVoiceoverHandle = null
        activeVoiceoverIndex = null
        await restoreVolume()
        this.setState({ status: { kind: 'paused', reason: 'interrupted', segmentId: segment.id } })
      }
      await new Promise((r) => setTimeout(r, poll))
    }

    const wasCancelled = stopped || this.stopSignal.stop || this.skipSignal.skip

    // Drain any active voiceover before ending this segment, so the narrator gets to finish.
    if (activeVoiceoverHandle && !wasCancelled) {
      try { await activeVoiceoverHandle.done } catch {}
    } else {
      activeVoiceoverHandle?.cancel()
    }
    await restoreVolume()

    // If we cut the song mid-play (didn't end naturally, wasn't cancelled by the user),
    // fade the music down smoothly + insert a beat before whatever comes next.
    if (exitReason === 'cut' && !wasCancelled) {
      let currentVolume = 80
      try {
        const v = await this.deps.music.getVolume()
        if (Number.isFinite(v)) currentVolume = v
      } catch {}
      await fadeVolume(currentVolume, 0, SONG_END_FADE_MS)
      await this.deps.music.pause().catch(() => {})
      // Restore Spotify volume so the user's setting isn't left at 0 for the next play().
      await this.deps.music.setVolume(currentVolume).catch(() => {})
      await new Promise((r) => setTimeout(r, BEAT_MS))
    } else {
      await this.deps.music.pause().catch(() => {})
    }
    this.songControl = null
  }

  private surfaceError(err: unknown): void {
    const e = err as { kind?: string; message?: string }
    this.setState({
      status: {
        kind: 'error',
        errorKind: (e.kind as DeepcutsErrorKind | undefined) ?? 'Unknown',
        message: e.message ?? 'Unknown error',
      },
    })
  }

  private waitForResume(): Promise<void> {
    return new Promise((resolve) => {
      this.resumeWaiter = resolve
    })
  }
}
