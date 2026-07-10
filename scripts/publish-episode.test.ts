import { describe, expect, it, vi } from 'vitest'
import { publishEpisode } from './publish-episode'
import type { DraftManifest } from '../src/shared/manifest'

const DRAFT: DraftManifest = {
  schemaVersion: 1,
  id: 'almost-blue',
  title: 'Chet Baker',
  subject: 'Almost Blue',
  coverImage: 'cover.png',
  estimatedMinutes: 42,
  hosts: [{ id: 'h1', name: 'H', persona: '', voiceRef: 'elevenlabs:vX' }],
  chapters: [{
    title: 'C1',
    segments: [
      { type: 'narration', id: 'n-01', hostId: 'h1', text: 'Hello.' },
      { type: 'narration', id: 'n-02', hostId: 'h1', text: 'World.' },
    ],
  }],
  sources: [], facts: [],
}

function makeFakeFs() {
  const files = new Map<string, string | Uint8Array>()
  return {
    files,
    fs: {
      readFile: vi.fn(async (p: string) => {
        const v = files.get(p)
        if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        return v
      }),
      writeFile: vi.fn(async (p: string, data: string | Uint8Array) => { files.set(p, data) }),
      mkdir: vi.fn(async () => undefined),
      copyFile: vi.fn(async (src: string, dst: string) => { files.set(dst, files.get(src) ?? '') }),
    },
  }
}

describe('publishEpisode', () => {
  it('for an upcoming episode: writes only cover + meta, updates catalog', async () => {
    const { fs, files } = makeFakeFs()
    files.set('/drafts/almost-blue/manifest.json', JSON.stringify(DRAFT))
    files.set('/drafts/almost-blue/cover.png', new Uint8Array([1, 2, 3]))
    files.set('/drafts/almost-blue/meta.json', JSON.stringify({
      schemaVersion: 1, artistName: 'Chet Baker', albumName: 'Almost Blue', blurb: 'A portrait.',
      palette: { bg: '#e8e4d6', ink: '#0e2a44', accent: '#2f6ea1' },
      releaseDate: null, expectedRelease: '2027-Q1',
    }))
    files.set('/content/catalog.json', JSON.stringify({
      schemaVersion: 1, updatedAt: '2026-07-09T00:00:00Z', episodes: [],
    }))

    await publishEpisode({
      draftDir: '/drafts/almost-blue',
      contentDir: '/content',
      status: 'upcoming',
      order: 5,
      today: () => '2026-07-09',
      synthesize: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fs: fs as any,
      baseUrl: 'https://cdn.example.com/content',
    })

    expect(files.has('/content/episodes/almost-blue/cover.png')).toBe(true)
    expect(files.has('/content/episodes/almost-blue/meta.json')).toBe(true)
    expect(files.has('/content/episodes/almost-blue/manifest.json')).toBe(false)
    const catalog = JSON.parse(files.get('/content/catalog.json') as string)
    expect(catalog.episodes).toContainEqual(expect.objectContaining({
      id: 'almost-blue', status: 'upcoming', order: 5, expectedRelease: '2027-Q1',
    }))
  })

  it('for a released episode: pre-renders audio, rewrites URLs, writes manifest', async () => {
    const { fs, files } = makeFakeFs()
    files.set('/drafts/almost-blue/manifest.json', JSON.stringify(DRAFT))
    files.set('/drafts/almost-blue/cover.png', new Uint8Array([1, 2, 3]))
    files.set('/drafts/almost-blue/meta.json', JSON.stringify({
      schemaVersion: 1, artistName: 'Chet Baker', albumName: 'Almost Blue', blurb: 'A portrait.',
      palette: { bg: '#e8e4d6', ink: '#0e2a44', accent: '#2f6ea1' },
      releaseDate: '2026-06-10', expectedRelease: null,
    }))
    files.set('/content/catalog.json', JSON.stringify({
      schemaVersion: 1, updatedAt: '2026-07-09T00:00:00Z', episodes: [],
    }))
    const synthesize = vi.fn(async (_text: string, _voiceRef: string, opts: { segmentId: string }) => ({
      filePath: `/synth-cache/${opts.segmentId}.mp3`, cached: false,
    }))
    files.set('/synth-cache/n-01.mp3', new Uint8Array([9]))
    files.set('/synth-cache/n-02.mp3', new Uint8Array([9]))

    await publishEpisode({
      draftDir: '/drafts/almost-blue',
      contentDir: '/content',
      status: 'released',
      order: 1,
      today: () => '2026-07-09',
      synthesize,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fs: fs as any,
      baseUrl: 'https://cdn.example.com/content',
    })

    expect(files.has('/content/episodes/almost-blue/audio/n-01.mp3')).toBe(true)
    expect(files.has('/content/episodes/almost-blue/audio/n-02.mp3')).toBe(true)
    const manifestOut = JSON.parse(files.get('/content/episodes/almost-blue/manifest.json') as string)
    const audio0 = manifestOut.chapters[0].segments[0].audio
    expect(audio0).toBe('https://cdn.example.com/content/episodes/almost-blue/audio/n-01.mp3')
    const catalog = JSON.parse(files.get('/content/catalog.json') as string)
    expect(catalog.episodes[0]).toMatchObject({
      id: 'almost-blue', status: 'released', releaseDate: '2026-07-09', order: 1,
    })
  })

  it('re-publish preserves existing order unless overridden', async () => {
    const { fs, files } = makeFakeFs()
    files.set('/drafts/almost-blue/manifest.json', JSON.stringify(DRAFT))
    files.set('/drafts/almost-blue/cover.png', new Uint8Array([1]))
    files.set('/drafts/almost-blue/meta.json', JSON.stringify({
      schemaVersion: 1, artistName: 'X', albumName: 'Y', blurb: 'Z',
      palette: { bg: '#000000', ink: '#000000', accent: '#000000' },
      releaseDate: '2026-06-10', expectedRelease: null,
    }))
    files.set('/content/catalog.json', JSON.stringify({
      schemaVersion: 1, updatedAt: '2026-07-09T00:00:00Z',
      episodes: [{ id: 'almost-blue', status: 'released', releaseDate: '2026-06-01', order: 7 }],
    }))
    const synthesize = vi.fn(async (_t: string, _v: string, opts: { segmentId: string }) => ({
      filePath: `/synth-cache/${opts.segmentId}.mp3`, cached: true,
    }))
    files.set('/synth-cache/n-01.mp3', new Uint8Array())
    files.set('/synth-cache/n-02.mp3', new Uint8Array())

    await publishEpisode({
      draftDir: '/drafts/almost-blue',
      contentDir: '/content',
      status: 'released',
      today: () => '2026-07-09',
      synthesize,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fs: fs as any,
      baseUrl: 'https://cdn.example.com/content',
    })

    const catalog = JSON.parse(files.get('/content/catalog.json') as string)
    expect(catalog.episodes[0].order).toBe(7)
  })
})
