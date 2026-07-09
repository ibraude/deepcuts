import { describe, expect, it } from 'vitest'
import { draftManifestSchema, episodeManifestSchema, flattenSegments } from './manifest'

const valid = {
  schemaVersion: 1,
  id: 'demo',
  title: 'Demo',
  subject: 'Test',
  coverImage: 'covers/demo.png',
  estimatedMinutes: 5,
  hosts: [{ id: 'h', name: 'Host', persona: 'warm', voiceRef: 'system:default' }],
  chapters: [
    {
      title: 'One',
      segments: [
        { type: 'narration', id: 's0', hostId: 'h', text: 'Hello' },
        {
          type: 'song',
          id: 's1',
          track: { title: 'T', artist: 'A', spotifyUri: 'spotify:track:aaaaaaaaaaaaaaaaaaaaaa' },
          startAtSeconds: 0,
          playSeconds: 30,
          why: 'because',
        },
      ],
    },
  ],
  sources: [],
  facts: [],
}

describe('episodeManifestSchema', () => {
  it('accepts a valid manifest', () => {
    expect(() => episodeManifestSchema.parse(valid)).not.toThrow()
  })

  it('rejects a song segment missing spotifyUri', () => {
    const bad = structuredClone(valid)
    delete (bad.chapters[0]!.segments[1] as any).track.spotifyUri
    expect(() => episodeManifestSchema.parse(bad)).toThrow()
  })

  it('rejects a song segment missing playSeconds', () => {
    const bad = structuredClone(valid)
    delete (bad.chapters[0]!.segments[1] as any).playSeconds
    expect(() => episodeManifestSchema.parse(bad)).toThrow()
  })

  it('rejects schemaVersion other than 1', () => {
    const bad = { ...valid, schemaVersion: 2 }
    expect(() => episodeManifestSchema.parse(bad)).toThrow()
  })
})

describe('flattenSegments', () => {
  it('returns segments in chapter order with chapter index attached', () => {
    const parsed = episodeManifestSchema.parse(valid)
    const flat = flattenSegments(parsed)
    expect(flat).toHaveLength(2)
    expect(flat[0]!.id).toBe('s0')
    expect(flat[0]!.chapterIndex).toBe(0)
    expect(flat[1]!.id).toBe('s1')
  })
})

describe('draftManifestSchema', () => {
  it('accepts a draft with empty narration text', () => {
    const draft = {
      schemaVersion: 1,
      id: 'd',
      title: '',
      subject: '',
      coverImage: '',
      estimatedMinutes: 5,
      hosts: [{ id: 'h', name: '', persona: '', voiceRef: '' }],
      chapters: [
        {
          title: '',
          segments: [{ type: 'narration', id: 'n0', hostId: 'h', text: '' }],
        },
      ],
      sources: [],
      facts: [],
    }
    expect(() => draftManifestSchema.parse(draft)).not.toThrow()
  })

  it('still rejects a song segment with missing playSeconds', () => {
    const draft = {
      schemaVersion: 1,
      id: 'd',
      title: '',
      subject: '',
      coverImage: '',
      estimatedMinutes: 5,
      hosts: [{ id: 'h', name: '', persona: '', voiceRef: '' }],
      chapters: [
        {
          title: '',
          segments: [
            {
              type: 'song',
              id: 's0',
              track: { title: '', artist: '', spotifyUri: '' },
              startAtSeconds: 0,
            },
          ],
        },
      ],
      sources: [],
      facts: [],
    }
    expect(() => draftManifestSchema.parse(draft)).toThrow()
  })
})
