import { describe, expect, it, vi } from 'vitest'
import { createRemoteCatalog, type RemoteCatalogDeps } from './RemoteCatalog'
import type { RemoteCatalogIndex } from '../../shared/catalog'

function makeFakeFs() {
  const files = new Map<string, string>()
  return {
    files,
    fs: {
      readFile: vi.fn(async (p: string) => {
        const v = files.get(p)
        if (v === undefined) { const e: NodeJS.ErrnoException = Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); throw e }
        return v
      }),
      writeFile: vi.fn(async (p: string, data: string) => { files.set(p, data) }),
      mkdir: vi.fn(async () => undefined),
    },
  }
}

function makeFetcher(responses: Record<string, unknown | Error>) {
  return vi.fn(async (url: string) => {
    const r = responses[url]
    if (r === undefined) throw new Error(`No fake response for ${url}`)
    if (r instanceof Error) throw r
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(r),
      json: async () => r,
    }
  })
}

const VALID_CATALOG: RemoteCatalogIndex = {
  schemaVersion: 1,
  updatedAt: '2026-07-09T00:00:00Z',
  episodes: [
    { id: 'almost-blue', status: 'released', releaseDate: '2026-06-10', order: 1 },
    { id: 'blood-on-the-tracks', status: 'upcoming', expectedRelease: '2027-Q1', order: 20 },
  ],
}

function defaults(overrides: Partial<RemoteCatalogDeps> = {}): RemoteCatalogDeps {
  const { fs } = makeFakeFs()
  return {
    baseUrl: 'https://cdn.example.com/content',
    cacheRoot: () => '/tmp/cache',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetcher: makeFetcher({ 'https://cdn.example.com/content/catalog.json': VALID_CATALOG }) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fs: fs as any,
    ...overrides,
  }
}

describe('RemoteCatalog', () => {
  it('refresh() fetches catalog.json and writes it to cache', async () => {
    const { fs, files } = makeFakeFs()
    const fetcher = makeFetcher({ 'https://cdn.example.com/content/catalog.json': VALID_CATALOG })
    const rc = createRemoteCatalog({
      baseUrl: 'https://cdn.example.com/content',
      cacheRoot: () => '/tmp/cache',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetcher: fetcher as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fs: fs as any,
    })
    const result = await rc.refresh()
    expect(result.episodes).toHaveLength(2)
    expect(files.get('/tmp/cache/catalog.json')).toContain('almost-blue')
  })

  it('list() always fetches fresh — cache is fallback only', async () => {
    const { fs, files } = makeFakeFs()
    files.set('/tmp/cache/catalog.json', JSON.stringify(VALID_CATALOG))
    const fetcher = makeFetcher({ 'https://cdn.example.com/content/catalog.json': VALID_CATALOG })
    const rc = createRemoteCatalog({
      baseUrl: 'https://cdn.example.com/content',
      cacheRoot: () => '/tmp/cache',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetcher: fetcher as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fs: fs as any,
    })
    const result = await rc.list()
    expect(result.episodes).toHaveLength(2)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('list() falls back to cached catalog when network fails', async () => {
    const { fs, files } = makeFakeFs()
    files.set('/tmp/cache/catalog.json', JSON.stringify(VALID_CATALOG))
    const fetcher = makeFetcher({
      'https://cdn.example.com/content/catalog.json': new Error('offline'),
    })
    const rc = createRemoteCatalog({
      baseUrl: 'https://cdn.example.com/content',
      cacheRoot: () => '/tmp/cache',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetcher: fetcher as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fs: fs as any,
    })
    const result = await rc.list()
    expect(result.episodes).toHaveLength(2)
  })

  it('list() falls back to fetching when no cache exists', async () => {
    const rc = createRemoteCatalog(defaults())
    const result = await rc.list()
    expect(result.episodes).toHaveLength(2)
  })

  it('list() throws when both cache and network are unavailable', async () => {
    const { fs } = makeFakeFs()
    const fetcher = makeFetcher({
      'https://cdn.example.com/content/catalog.json': new Error('offline'),
    })
    const rc = createRemoteCatalog({
      baseUrl: 'https://cdn.example.com/content',
      cacheRoot: () => '/tmp/cache',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetcher: fetcher as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fs: fs as any,
    })
    await expect(rc.list()).rejects.toThrow(/no cached catalog/i)
  })

  it('loadMeta() fetches, validates strict, and caches', async () => {
    const meta = {
      schemaVersion: 1,
      artistName: 'Chet Baker',
      albumName: 'Almost Blue',
      blurb: 'A portrait.',
      palette: { bg: '#e8e4d6', ink: '#0e2a44', accent: '#2f6ea1' },
      releaseDate: '2026-06-10',
      expectedRelease: null,
    }
    const { fs, files } = makeFakeFs()
    const fetcher = makeFetcher({
      'https://cdn.example.com/content/episodes/almost-blue/meta.json': meta,
    })
    const rc = createRemoteCatalog({
      baseUrl: 'https://cdn.example.com/content',
      cacheRoot: () => '/tmp/cache',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetcher: fetcher as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fs: fs as any,
    })
    const result = await rc.loadMeta('almost-blue')
    expect(result.artistName).toBe('Chet Baker')
    expect(files.get('/tmp/cache/episodes/almost-blue/meta.json')).toContain('Chet Baker')
  })

  it('loadMeta() falls back to cache when network fails', async () => {
    const { fs, files } = makeFakeFs()
    const meta = {
      schemaVersion: 1, artistName: 'X', albumName: 'Y', blurb: 'Z',
      palette: { bg: '#000000', ink: '#000000', accent: '#000000' },
      releaseDate: null, expectedRelease: 'Q3',
    }
    files.set('/tmp/cache/episodes/x/meta.json', JSON.stringify(meta))
    const fetcher = makeFetcher({
      'https://cdn.example.com/content/episodes/x/meta.json': new Error('offline'),
    })
    const rc = createRemoteCatalog({
      baseUrl: 'https://cdn.example.com/content',
      cacheRoot: () => '/tmp/cache',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetcher: fetcher as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fs: fs as any,
    })
    const result = await rc.loadMeta('x')
    expect(result.artistName).toBe('X')
  })

  it('coverUrl() cache-busts with catalog.updatedAt after list() runs', async () => {
    const rc = createRemoteCatalog(defaults())
    // Before any fetch, no version is known — plain URL.
    expect(rc.coverUrl('almost-blue')).toBe('https://cdn.example.com/content/episodes/almost-blue/cover.png')
    // After list() populates latestUpdatedAt, the URL is versioned.
    await rc.list()
    expect(rc.coverUrl('almost-blue')).toBe(
      'https://cdn.example.com/content/episodes/almost-blue/cover.png?v=2026-07-09T00%3A00%3A00Z',
    )
  })

  it('coverUrl() returns a direct CDN URL without fetching', () => {
    const rc = createRemoteCatalog(defaults())
    expect(rc.coverUrl('almost-blue'))
      .toBe('https://cdn.example.com/content/episodes/almost-blue/cover.png')
  })

  it('loadEpisode() fetches and caches manifest.json', async () => {
    const manifest = {
      schemaVersion: 1,
      id: 'almost-blue',
      title: 'Chet Baker',
      subject: 'Almost Blue',
      coverImage: 'cover.png',
      estimatedMinutes: 42,
      hosts: [{ id: 'h1', name: 'Host', persona: '', voiceRef: 'elevenlabs:x' }],
      chapters: [{ title: 'C1', segments: [
        { type: 'narration', id: 'n-01', hostId: 'h1', text: 'Hello.',
          audio: 'https://cdn.example.com/content/episodes/almost-blue/audio/n-01.mp3' },
      ]}],
      sources: [], facts: [],
    }
    const { fs, files } = makeFakeFs()
    const fetcher = makeFetcher({
      'https://cdn.example.com/content/episodes/almost-blue/manifest.json': manifest,
    })
    const rc = createRemoteCatalog({
      baseUrl: 'https://cdn.example.com/content',
      cacheRoot: () => '/tmp/cache',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetcher: fetcher as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fs: fs as any,
    })
    const result = await rc.loadEpisode('almost-blue')
    expect(result.id).toBe('almost-blue')
    expect(files.get('/tmp/cache/episodes/almost-blue/manifest.json')).toContain('almost-blue')
  })
})
