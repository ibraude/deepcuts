import { describe, expect, it, vi } from 'vitest'
import { collectPrerenderTasks, prerenderDraft, type PrerenderEvent } from './prerender'
import type { DraftManifest } from '../shared/manifest'

function makeManifest(): DraftManifest {
  return {
    schemaVersion: 1,
    id: 'd',
    title: 'D',
    subject: '',
    coverImage: '',
    estimatedMinutes: 5,
    hosts: [
      { id: 'host_a', name: 'A', persona: '', voiceRef: 'elevenlabs:VOICE_A' },
      { id: 'host_b', name: 'B', persona: '', voiceRef: 'system:default' },
    ],
    chapters: [
      {
        title: 'One',
        segments: [
          { type: 'narration', id: 'n1', hostId: 'host_a', text: 'Intro' },
          { type: 'narration', id: 'n2', hostId: 'host_b', text: 'System voice text' },
          {
            type: 'song',
            id: 's1',
            track: { title: 'T', artist: 'A', spotifyUri: 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa' },
            startAtSeconds: 0,
            playSeconds: 60,
            voiceovers: [
              { id: 'vo1', hostId: 'host_a', text: 'Listen', atSeconds: 10, duckTo: 55, holdDuck: false },
              { id: 'vo2', hostId: 'host_a', text: '', atSeconds: 20, duckTo: 55, holdDuck: false },
              { id: 'vo3', hostId: 'host_b', text: 'System', atSeconds: 30, duckTo: 55, holdDuck: false },
            ],
          },
        ],
      },
    ],
    sources: [],
    facts: [],
  }
}

describe('collectPrerenderTasks', () => {
  it('only includes elevenlabs hosts with non-empty text', () => {
    const tasks = collectPrerenderTasks(makeManifest())
    expect(tasks.map((t) => t.segmentId)).toEqual(['n1', 'vo1'])
  })
})

describe('prerenderDraft', () => {
  it('synthesizes every task, counts rendered vs skipped', async () => {
    const synth = vi
      .fn()
      .mockResolvedValueOnce({ filePath: '/x/n1.mp3', cached: false })
      .mockResolvedValueOnce({ filePath: '/x/vo1.mp3', cached: true })
    const emitted: PrerenderEvent[] = []
    const result = await prerenderDraft('d', {
      loadDraft: async () => makeManifest(),
      synthesize: synth,
      emit: (e) => emitted.push(e),
    })
    expect(synth).toHaveBeenCalledTimes(2)
    expect(result.rendered).toBe(1)
    expect(result.skipped).toBe(1)
    expect(emitted[emitted.length - 1]!.step).toBe('done')
  })

  it('collects warnings on synthesize errors', async () => {
    const synth = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ filePath: '/x.mp3', cached: false })
    const result = await prerenderDraft('d', {
      loadDraft: async () => makeManifest(),
      synthesize: synth,
      emit: () => {},
    })
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/boom/)
  })
})
