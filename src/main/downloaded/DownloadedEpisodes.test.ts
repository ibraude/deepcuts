import { describe, expect, it, vi } from 'vitest'
import { createDownloadedEpisodes } from './DownloadedEpisodes'
import type { EpisodeManifest } from '../../shared/manifest'

const FIXTURE_MANIFEST: EpisodeManifest = {
  schemaVersion: 1,
  id: 'almost-blue',
  title: 'Chet Baker',
  subject: 'Almost Blue',
  coverImage: 'cover.png',
  estimatedMinutes: 42,
  hosts: [{ id: 'h1', name: 'H', persona: '', voiceRef: 'elevenlabs:x' }],
  chapters: [{
    title: 'C1',
    segments: [
      { type: 'narration', id: 'n-01', hostId: 'h1', text: 'Hi',
        audio: 'https://cdn.example.com/content/episodes/almost-blue/audio/n-01.mp3' },
      { type: 'narration', id: 'n-02', hostId: 'h1', text: 'Hi2',
        audio: 'https://cdn.example.com/content/episodes/almost-blue/audio/n-02.mp3' },
    ],
  }],
  sources: [], facts: [],
}

function makeFakeFs() {
  const files = new Map<string, Uint8Array | string>()
  const dirs = new Set<string>()
  return {
    files, dirs,
    fs: {
      readFile: vi.fn(async (p: string) => {
        const v = files.get(p)
        if (v === undefined) { const e: NodeJS.ErrnoException = Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); throw e }
        return v
      }),
      writeFile: vi.fn(async (p: string, data: Uint8Array | string) => { files.set(p, data) }),
      mkdir: vi.fn(async (p: string) => { dirs.add(p); return undefined }),
      rm: vi.fn(async (p: string) => {
        for (const key of [...files.keys()]) if (key.startsWith(p)) files.delete(key)
      }),
      stat: vi.fn(async (p: string) => {
        if (files.has(p) || dirs.has(p)) return { isDirectory: () => dirs.has(p) }
        const e: NodeJS.ErrnoException = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        throw e
      }),
    },
  }
}

function makeFetcher(bytes = new Uint8Array([1, 2, 3])) {
  return vi.fn(async () => ({
    ok: true, status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }))
}

describe('DownloadedEpisodes', () => {
  it('start() fetches all audio + cover and writes to downloadedRoot', async () => {
    const { fs, files } = makeFakeFs()
    const fetcher = makeFetcher()
    const dl = createDownloadedEpisodes({
      downloadedRoot: () => '/dl',
      catalog: {
        loadEpisode: async () => FIXTURE_MANIFEST,
        coverUrl: () => 'https://cdn.example.com/content/episodes/almost-blue/cover.png',
        loadMeta: async () => ({
          schemaVersion: 1, artistName: 'X', albumName: 'Y', blurb: 'Z',
          palette: { bg: '#000000', ink: '#000000', accent: '#000000' },
          releaseDate: '2026-06-10', expectedRelease: null,
        }),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetcher: fetcher as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fs: fs as any,
    })
    await dl.start('almost-blue')
    expect(files.has('/dl/almost-blue/audio/n-01.mp3')).toBe(true)
    expect(files.has('/dl/almost-blue/audio/n-02.mp3')).toBe(true)
    expect(files.has('/dl/almost-blue/cover.png')).toBe(true)
    expect(files.has('/dl/almost-blue/manifest.json')).toBe(true)
  })

  it('loadManifestLocal() returns null when not downloaded', async () => {
    const { fs } = makeFakeFs()
    const dl = createDownloadedEpisodes({
      downloadedRoot: () => '/dl',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      catalog: { loadEpisode: async () => FIXTURE_MANIFEST } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetcher: (async () => ({})) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fs: fs as any,
    })
    expect(await dl.loadManifestLocal('almost-blue')).toBeNull()
  })

  it('loadManifestLocal() returns manifest with file:// audio URLs after download', async () => {
    const { fs } = makeFakeFs()
    const fetcher = makeFetcher()
    const dl = createDownloadedEpisodes({
      downloadedRoot: () => '/dl',
      catalog: {
        loadEpisode: async () => FIXTURE_MANIFEST,
        coverUrl: () => 'https://cdn.example.com/content/episodes/almost-blue/cover.png',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        loadMeta: async () => ({} as any),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetcher: fetcher as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fs: fs as any,
    })
    await dl.start('almost-blue')
    const local = await dl.loadManifestLocal('almost-blue')
    expect(local).not.toBeNull()
    const audioUrls = local!.chapters.flatMap(c => c.segments)
      .filter(s => s.type === 'narration')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map(s => (s as any).audio)
    expect(audioUrls.every((u: string) => u.startsWith('file:///dl/almost-blue/audio/'))).toBe(true)
  })

  it('remove() clears the dir and isDownloaded returns false', async () => {
    const { fs } = makeFakeFs()
    const fetcher = makeFetcher()
    const dl = createDownloadedEpisodes({
      downloadedRoot: () => '/dl',
      catalog: {
        loadEpisode: async () => FIXTURE_MANIFEST,
        coverUrl: () => 'https://c',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        loadMeta: async () => ({} as any),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetcher: fetcher as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fs: fs as any,
    })
    await dl.start('almost-blue')
    expect(await dl.isDownloaded('almost-blue')).toBe(true)
    await dl.remove('almost-blue')
    expect(await dl.isDownloaded('almost-blue')).toBe(false)
  })

  it('start() reports progress once per file', async () => {
    const { fs } = makeFakeFs()
    const fetcher = makeFetcher()
    const dl = createDownloadedEpisodes({
      downloadedRoot: () => '/dl',
      catalog: {
        loadEpisode: async () => FIXTURE_MANIFEST,
        coverUrl: () => 'https://c',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        loadMeta: async () => ({} as any),
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetcher: fetcher as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fs: fs as any,
    })
    const events: Array<{ total: number; done: number; currentUrl: string }> = []
    await dl.start('almost-blue', (p) => events.push(p))
    expect(events.length).toBeGreaterThanOrEqual(2)
    const last = events[events.length - 1]!
    expect(last.done).toBe(last.total)
  })
})
