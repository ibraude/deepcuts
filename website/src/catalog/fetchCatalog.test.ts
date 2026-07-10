import { describe, it, expect } from 'vitest'
import { fetchCatalog } from './fetchCatalog'
import type { EpisodeMeta, RemoteCatalogIndex } from './types'

const BASE = 'https://cdn.jsdelivr.net/gh/ibraude/deepcuts@main/content'

function metaFixture(over: Partial<EpisodeMeta> = {}): EpisodeMeta {
  return {
    schemaVersion: 1,
    artistName: 'A',
    albumName: 'B',
    blurb: 'C',
    palette: { bg: '#000000', ink: '#111111', accent: '#222222' },
    releaseDate: null,
    expectedRelease: 'Q1',
    ...over,
  }
}

function makeFetcher(responses: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    // Strip cache-bust query strings — fixtures are keyed on the base URL.
    const key = url.split('?')[0]!
    if (!(key in responses)) throw new Error(`No fixture for ${url}`)
    return {
      ok: true,
      status: 200,
      json: async () => responses[key],
    } as unknown as Response
  }) as unknown as typeof fetch
}

describe('fetchCatalog', () => {
  it('returns released + upcoming grouped, sorted by order', async () => {
    const catalog: RemoteCatalogIndex = {
      schemaVersion: 1,
      updatedAt: '2026-07-10T00:00:00Z',
      episodes: [
        { id: 'b', status: 'upcoming', expectedRelease: 'Q2', order: 3 },
        { id: 'a', status: 'released', releaseDate: '2026-06-01', order: 1 },
        { id: 'c', status: 'released', releaseDate: '2026-06-15', order: 2 },
      ],
    }
    const fetcher = makeFetcher({
      [`${BASE}/catalog.json`]: catalog,
      [`${BASE}/episodes/a/meta.json`]: metaFixture({ artistName: 'A' }),
      [`${BASE}/episodes/b/meta.json`]: metaFixture({ artistName: 'B' }),
      [`${BASE}/episodes/c/meta.json`]: metaFixture({ artistName: 'C' }),
    })
    const view = await fetchCatalog(fetcher)
    expect(view.released.map((e) => e.id)).toEqual(['a', 'c'])
    expect(view.upcoming.map((e) => e.id)).toEqual(['b'])
  })

  it('featured is the highest-order released episode', async () => {
    const catalog: RemoteCatalogIndex = {
      schemaVersion: 1,
      updatedAt: 't',
      episodes: [
        { id: 'a', status: 'released', releaseDate: '2026-06-01', order: 1 },
        { id: 'c', status: 'released', releaseDate: '2026-06-15', order: 5 },
        { id: 'b', status: 'upcoming', expectedRelease: 'Q2', order: 3 },
      ],
    }
    const fetcher = makeFetcher({
      [`${BASE}/catalog.json`]: catalog,
      [`${BASE}/episodes/a/meta.json`]: metaFixture(),
      [`${BASE}/episodes/b/meta.json`]: metaFixture(),
      [`${BASE}/episodes/c/meta.json`]: metaFixture(),
    })
    const view = await fetchCatalog(fetcher)
    expect(view.featured?.id).toBe('c')
  })

  it('featured falls back to lowest-order upcoming when no released', async () => {
    const catalog: RemoteCatalogIndex = {
      schemaVersion: 1,
      updatedAt: 't',
      episodes: [
        { id: 'x', status: 'upcoming', expectedRelease: 'Q2', order: 5 },
        { id: 'y', status: 'upcoming', expectedRelease: 'Q1', order: 1 },
      ],
    }
    const fetcher = makeFetcher({
      [`${BASE}/catalog.json`]: catalog,
      [`${BASE}/episodes/x/meta.json`]: metaFixture(),
      [`${BASE}/episodes/y/meta.json`]: metaFixture(),
    })
    const view = await fetchCatalog(fetcher)
    expect(view.featured?.id).toBe('y')
  })

  it('coverUrl uses the base URL', async () => {
    const catalog: RemoteCatalogIndex = {
      schemaVersion: 1,
      updatedAt: 't',
      episodes: [{ id: 'z', status: 'upcoming', expectedRelease: 'Q1', order: 1 }],
    }
    const fetcher = makeFetcher({
      [`${BASE}/catalog.json`]: catalog,
      [`${BASE}/episodes/z/meta.json`]: metaFixture(),
    })
    const view = await fetchCatalog(fetcher)
    // Cover URL includes the catalog's updatedAt as a cache-bust param.
    expect(view.upcoming[0]!.coverUrl).toBe(`${BASE}/episodes/z/cover.png?v=t`)
  })
})
