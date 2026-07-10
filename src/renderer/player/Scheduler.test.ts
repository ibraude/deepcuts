import { describe, expect, it, vi } from 'vitest'
import { Scheduler } from './Scheduler'
import type { EpisodeManifest } from '../../shared/manifest'

function makeManifest(): EpisodeManifest {
  return {
    schemaVersion: 1,
    id: 'demo',
    title: 'Demo',
    subject: 'Test',
    coverImage: 'covers/x.png',
    estimatedMinutes: 5,
    hosts: [{ id: 'h', name: 'H', persona: '', voiceRef: 'system:default' }],
    chapters: [
      {
        title: 'One',
        segments: [
          { type: 'narration', id: 'n1', hostId: 'h', text: 'Intro' },
          { type: 'song', id: 's1', track: { title: 'T1', artist: 'A', spotifyUri: 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa' }, startAtSeconds: 0, playSeconds: 5 },
          { type: 'narration', id: 'n2', hostId: 'h', text: 'Middle' },
        ],
      },
      {
        title: 'Two',
        segments: [
          { type: 'song', id: 's2', track: { title: 'T2', artist: 'A', spotifyUri: 'spotify:track:bbbbbbbbbbbbbbbbbbbbbb' }, startAtSeconds: 0, playSeconds: 5 },
          { type: 'narration', id: 'n3', hostId: 'h', text: 'Outro' },
        ],
      },
    ],
    sources: [],
    facts: [],
  }
}

interface MockMusicState {
  position: number
  state: 'playing' | 'paused' | 'stopped'
  uri: string
  duration: number
  volume: number
}

function buildMocks() {
  const music: MockMusicState = { position: 0, state: 'stopped', uri: '', duration: 300, volume: 80 }
  const musicCalls: Array<{ method: string; arg?: unknown }> = []
  const narrationCalls: string[] = []

  const ensureReady = vi.fn(async () => {})
  const play = vi.fn(async (uri: string) => {
    music.uri = uri
    music.state = 'playing'
    music.position = 0
    musicCalls.push({ method: 'play', arg: uri })
  })
  const pause = vi.fn(async () => {
    music.state = 'paused'
    musicCalls.push({ method: 'pause' })
  })
  const getPosition = vi.fn(async () => music.position)
  const getState = vi.fn(async () => music.state)
  const getCurrentTrack = vi.fn(async () => ({ id: music.uri, uri: music.uri }))
  const getDuration = vi.fn(async () => music.duration)
  const getVolume = vi.fn(async () => music.volume)
  const setVolume = vi.fn(async (pct: number) => {
    music.volume = pct
    musicCalls.push({ method: 'setVolume', arg: pct })
  })

  const narrationHandles: Array<{ resolve: () => void; reject: (e: unknown) => void; cancelled: boolean }> = []
  const playNarration = vi.fn((segmentId: string) => {
    narrationCalls.push(segmentId)
    const handle = { resolve: () => {}, reject: (_: unknown) => {}, cancelled: false }
    const done = new Promise<void>((resolve, reject) => {
      handle.resolve = resolve
      handle.reject = reject
    })
    narrationHandles.push(handle)
    return { done, cancel: () => { handle.cancelled = true; handle.resolve() } }
  })

  return {
    music,
    musicCalls,
    narrationCalls,
    narrationHandles,
    deps: {
      music: { ensureReady, play, pause, getPosition, getState, getCurrentTrack, getDuration, getVolume, setVolume },
      playNarration,
      pollIntervalMs: 1,
      songEndFadeMs: 10,
    },
  }
}

describe('Scheduler', () => {
  it('plays narration → song → narration → song → narration in order', async () => {
    const m = buildMocks()
    const sched = new Scheduler(m.deps)
    const run = sched.start(makeManifest(), { hasElevenLabsKey: false })

    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1']))
    m.narrationHandles[0]!.resolve()

    await vi.waitFor(() => expect(m.musicCalls.some((c) => c.method === 'play' && c.arg === 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa')).toBe(true))
    m.music.position = 5.1
    await vi.waitFor(() => expect(m.musicCalls.some((c) => c.method === 'pause')).toBe(true))

    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1', 'n2']))
    m.narrationHandles[1]!.resolve()

    await vi.waitFor(() => expect(m.musicCalls.some((c) => c.arg === 'spotify:track:bbbbbbbbbbbbbbbbbbbbbb')).toBe(true))
    m.music.position = 5.1
    await vi.waitFor(() => expect(m.musicCalls.filter((c) => c.method === 'pause').length).toBeGreaterThanOrEqual(2))

    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1', 'n2', 'n3']))
    m.narrationHandles[2]!.resolve()
    await run
    expect(sched.getState().status.kind).toBe('done')
  })

  it('pause() during narration cancels narration and surfaces paused', async () => {
    const m = buildMocks()
    const sched = new Scheduler(m.deps)
    const run = sched.start(makeManifest(), { hasElevenLabsKey: false })
    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1']))
    await sched.pause()
    expect(m.narrationHandles[0]!.cancelled).toBe(true)
    expect(sched.getState().status.kind).toBe('paused')
    await sched.stop()
    await run
  })

  it('pause() during a song pauses Spotify and surfaces paused', async () => {
    const m = buildMocks()
    const sched = new Scheduler(m.deps)
    const run = sched.start(makeManifest(), { hasElevenLabsKey: false })
    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1']))
    m.narrationHandles[0]!.resolve()
    await vi.waitFor(() => expect(m.musicCalls.some((c) => c.method === 'play')).toBe(true))
    await sched.pause()
    expect(m.musicCalls.some((c) => c.method === 'pause')).toBe(true)
    expect(sched.getState().status.kind).toBe('paused')
    await sched.stop()
    await run
  })

  it('single-poll URI flicker does NOT advance the segment', async () => {
    const m = buildMocks()
    // Slow the poll interval so we can construct a controlled single-tick flicker.
    m.deps.pollIntervalMs = 40
    const sched = new Scheduler(m.deps)
    const run = sched.start(makeManifest(), { hasElevenLabsKey: false })
    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1']))
    m.narrationHandles[0]!.resolve()
    await vi.waitFor(() =>
      expect(m.musicCalls.some((c) => c.method === 'play' && c.arg === 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa')).toBe(true),
    )
    // Let a couple of polls run so sawOurTrack becomes true.
    await new Promise((r) => setTimeout(r, 100))
    // Flicker to a wrong URI for exactly one poll tick, then restore.
    m.music.uri = 'spotify:track:ccccccccccccccccccccCC'
    await new Promise((r) => setTimeout(r, 40))
    m.music.uri = 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa'
    // Give a few more polls to confirm the scheduler didn't advance.
    await new Promise((r) => setTimeout(r, 200))
    expect(m.narrationCalls).toEqual(['n1'])
    expect(sched.getState().status.kind).toBe('playing-song')
    await sched.stop()
    await run
  })

  it('user-skipped track in Spotify advances to the next segment', async () => {
    const m = buildMocks()
    const sched = new Scheduler(m.deps)
    const run = sched.start(makeManifest(), { hasElevenLabsKey: false })
    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1']))
    m.narrationHandles[0]!.resolve()
    await vi.waitFor(() => expect(m.musicCalls.some((c) => c.method === 'play' && c.arg === 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa')).toBe(true))
    // User skips track in Spotify itself.
    m.music.uri = 'spotify:track:ccccccccccccccccccccCC'
    // Scheduler should advance to the next narration (n2), not pause.
    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1', 'n2']))
    expect(sched.getState().status.kind).toBe('playing-narration')
    await sched.stop()
    await run
  })

  it('Spotify paused externally (no track change) surfaces paused-interrupted', async () => {
    const m = buildMocks()
    const sched = new Scheduler(m.deps)
    const run = sched.start(makeManifest(), { hasElevenLabsKey: false })
    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1']))
    m.narrationHandles[0]!.resolve()
    await vi.waitFor(() => expect(m.musicCalls.some((c) => c.method === 'play')).toBe(true))
    // User pauses Spotify externally; uri unchanged.
    m.music.state = 'paused'
    await vi.waitFor(
      () => {
        const s = sched.getState().status
        return s.kind === 'paused' && s.reason === 'interrupted'
      },
      { timeout: 3000 },
    )
    await sched.stop()
    await run
  })

  it('Spotify resumed externally after pause transitions back to playing-song', async () => {
    const m = buildMocks()
    const sched = new Scheduler(m.deps)
    const run = sched.start(makeManifest(), { hasElevenLabsKey: false })
    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1']))
    m.narrationHandles[0]!.resolve()
    await vi.waitFor(() => expect(m.musicCalls.some((c) => c.method === 'play')).toBe(true))
    m.music.state = 'paused'
    await vi.waitFor(
      () => sched.getState().status.kind === 'paused',
      { timeout: 3000 },
    )
    // User clicks Resume directly in Spotify (no app interaction).
    m.music.state = 'playing'
    await vi.waitFor(
      () => sched.getState().status.kind === 'playing-song',
      { timeout: 3000 },
    )
    await sched.stop()
    await run
  })

  it('voiceover triggers ducked narration and restores volume afterwards', async () => {
    const m = buildMocks()
    m.music.volume = 80
    const voiceoverManifest = {
      schemaVersion: 1 as const,
      id: 'vo',
      title: 'VO',
      subject: 'X',
      coverImage: 'covers/x.png',
      estimatedMinutes: 5,
      hosts: [{ id: 'h', name: 'H', persona: '', voiceRef: 'system:default' }],
      chapters: [
        {
          title: 'X',
          segments: [
            { type: 'narration' as const, id: 'n1', hostId: 'h', text: 'Intro' },
            {
              type: 'song' as const,
              id: 's1',
              track: { title: 'T1', artist: 'A', spotifyUri: 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa' },
              startAtSeconds: 0,
              playSeconds: 999,
              voiceovers: [
                { id: 'vo1', hostId: 'h', text: 'Listen here', atSeconds: 3, duckTo: 25, holdDuck: false },
              ],
            },
          ],
        },
      ],
      sources: [],
      facts: [],
    }
    const sched = new Scheduler(m.deps)
    const run = sched.start(voiceoverManifest, { hasElevenLabsKey: false })
    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1']))
    m.narrationHandles[0]!.resolve()
    await vi.waitFor(() => expect(m.musicCalls.some((c) => c.method === 'play' && c.arg === 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa')).toBe(true))

    // Move song position past the voiceover trigger.
    m.music.position = 3.5
    // Voiceover narration should fire.
    await vi.waitFor(() => expect(m.narrationCalls).toContain('vo1'))
    // Volume should have been ducked to 25.
    await vi.waitFor(() => expect(m.musicCalls.some((c) => c.method === 'setVolume' && c.arg === 25)).toBe(true))
    expect(sched.getState().status.kind).toBe('playing-narration-over-song')

    // Resolve the voiceover narration.
    m.narrationHandles[1]!.resolve()
    // Volume should be restored to 80 (the previous level).
    await vi.waitFor(() => expect(m.musicCalls.some((c) => c.method === 'setVolume' && c.arg === 80)).toBe(true))

    await sched.stop()
    await run
  })

  it('next() during narration cancels narration and starts the next segment', async () => {
    const m = buildMocks()
    const sched = new Scheduler(m.deps)
    const run = sched.start(makeManifest(), { hasElevenLabsKey: false })
    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1']))
    await sched.next()
    await vi.waitFor(() => expect(m.musicCalls.some((c) => c.method === 'play' && c.arg === 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa')).toBe(true))
    m.music.position = 5.1
    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1', 'n2']))
    m.narrationHandles[1]!.resolve()
    await vi.waitFor(() => expect(m.musicCalls.some((c) => c.method === 'play' && c.arg === 'spotify:track:bbbbbbbbbbbbbbbbbbbbbb')).toBe(true))
    m.music.position = 5.1
    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1', 'n2', 'n3']))
    m.narrationHandles[2]!.resolve()
    await run
  })

  it('stop() ends the episode and idles the scheduler', async () => {
    const m = buildMocks()
    const sched = new Scheduler(m.deps)
    const run = sched.start(makeManifest(), { hasElevenLabsKey: false })
    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1']))
    await sched.stop()
    expect(sched.getState().status.kind).toBe('idle')
    await run
  })

  it('natural end of song (uri change near track duration) advances without pausing', async () => {
    const m = buildMocks()
    m.music.duration = 10
    // Build a manifest where the song's playSeconds (999) is far beyond its real duration (10),
    // so the cut won't fire first.
    const naturalEndManifest = {
      schemaVersion: 1 as const,
      id: 'natural',
      title: 'Natural',
      subject: 'T',
      coverImage: 'covers/x.png',
      estimatedMinutes: 5,
      hosts: [{ id: 'h', name: 'H', persona: '', voiceRef: 'system:default' }],
      chapters: [
        {
          title: 'X',
          segments: [
            { type: 'narration' as const, id: 'n1', hostId: 'h', text: 'Intro' },
            {
              type: 'song' as const,
              id: 's1',
              track: { title: 'T1', artist: 'A', spotifyUri: 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa' },
              startAtSeconds: 0,
              playSeconds: 999,
            },
            { type: 'narration' as const, id: 'n2', hostId: 'h', text: 'Outro' },
          ],
        },
      ],
      sources: [],
      facts: [],
    }
    const sched = new Scheduler(m.deps)
    const run = sched.start(naturalEndManifest, { hasElevenLabsKey: false })

    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1']))
    m.narrationHandles[0]!.resolve()

    // Wait for song to start playing.
    await vi.waitFor(() => expect(m.musicCalls.some((c) => c.method === 'play' && c.arg === 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa')).toBe(true))
    // Position climbs to near end of track.
    m.music.position = 9.9
    // Give the scheduler a tick to record lastPosition near end.
    await vi.waitFor(() => expect(sched.getState().status).toMatchObject({ kind: 'playing-song', positionSec: 9.9 }))
    // Spotify auto-advances to a different track.
    m.music.uri = 'spotify:track:ddddddddddddddddddddDD'
    m.music.position = 0

    // Scheduler should advance to outro narration WITHOUT entering paused state.
    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1', 'n2']))
    expect(sched.getState().status.kind).toBe('playing-narration')
    m.narrationHandles[1]!.resolve()
    await run
    expect(sched.getState().status.kind).toBe('done')
  })

  it('end-of-episode emits done', async () => {
    const m = buildMocks()
    const sched = new Scheduler(m.deps)
    const run = sched.start(makeManifest(), { hasElevenLabsKey: false })

    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1']))
    m.narrationHandles[0]!.resolve()

    await vi.waitFor(() => expect(m.musicCalls.some((c) => c.arg === 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa')).toBe(true))
    m.music.position = 5.1

    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1', 'n2']))
    m.narrationHandles[1]!.resolve()

    await vi.waitFor(() => expect(m.musicCalls.some((c) => c.arg === 'spotify:track:bbbbbbbbbbbbbbbbbbbbbb')).toBe(true))
    m.music.position = 5.1

    await vi.waitFor(() => expect(m.narrationCalls).toEqual(['n1', 'n2', 'n3']))
    m.narrationHandles[2]!.resolve()

    await run
    expect(sched.getState().status.kind).toBe('done')
  })
})
