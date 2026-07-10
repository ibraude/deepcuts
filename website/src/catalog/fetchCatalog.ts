import { remoteCatalogSchema } from '@shared/catalog'
import { episodeMetaSchema } from '@shared/meta'
import { episodeManifestSchema } from '@shared/manifest'
import type { EpisodeMeta, EpisodeManifest } from './types'

export const CATALOG_BASE_URL =
  (import.meta.env.VITE_CATALOG_BASE_URL as string | undefined)?.replace(/\/+$/, '') ||
  'https://cdn.jsdelivr.net/gh/ibraude/deepcuts@main/content'

export interface EpisodeView {
  id: string
  status: 'released' | 'upcoming'
  order: number
  releaseDate?: string
  expectedRelease?: string
  meta: EpisodeMeta
  coverUrl: string
}

export interface CatalogView {
  released: EpisodeView[]
  upcoming: EpisodeView[]
  featured: EpisodeView | null
}

async function fetchJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const resp = await fetcher(url)
  if (!resp.ok) throw new Error(`Fetch ${url} failed: ${resp.status}`)
  return resp.json()
}

export async function fetchCatalog(fetcher: typeof fetch = fetch): Promise<CatalogView> {
  const catalogRaw = await fetchJson(`${CATALOG_BASE_URL}/catalog.json`, fetcher)
  const catalog = remoteCatalogSchema.parse(catalogRaw)

  const sorted = [...catalog.episodes].sort((a, b) => a.order - b.order)
  const views: EpisodeView[] = await Promise.all(
    sorted.map(async (entry) => {
      const raw = await fetchJson(`${CATALOG_BASE_URL}/episodes/${entry.id}/meta.json`, fetcher)
      const meta = episodeMetaSchema.parse(raw)
      return {
        id: entry.id,
        status: entry.status,
        order: entry.order,
        releaseDate: entry.releaseDate,
        expectedRelease: entry.expectedRelease,
        meta,
        coverUrl: `${CATALOG_BASE_URL}/episodes/${entry.id}/cover.png`,
      }
    }),
  )

  const released = views.filter((v) => v.status === 'released')
  const upcoming = views.filter((v) => v.status === 'upcoming')

  const featured =
    released.length > 0
      ? released.reduce((max, v) => (v.order > max.order ? v : max), released[0]!)
      : upcoming.length > 0
        ? upcoming.reduce((min, v) => (v.order < min.order ? v : min), upcoming[0]!)
        : null

  return { released, upcoming, featured }
}

const manifestCache = new Map<string, EpisodeManifest>()

export async function fetchManifest(
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<EpisodeManifest> {
  const cached = manifestCache.get(id)
  if (cached) return cached
  const raw = await fetchJson(`${CATALOG_BASE_URL}/episodes/${id}/manifest.json`, fetcher)
  const parsed = episodeManifestSchema.parse(raw)
  manifestCache.set(id, parsed)
  return parsed
}
