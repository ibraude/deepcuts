import { promises as nodefs } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  remoteCatalogSchema,
  type RemoteCatalogIndex,
} from '../../shared/catalog'
import { episodeMetaSchema, type EpisodeMeta } from '../../shared/meta'
import { episodeManifestSchema, type EpisodeManifest } from '../../shared/manifest'

export interface RemoteCatalog {
  refresh(): Promise<RemoteCatalogIndex>
  list(): Promise<RemoteCatalogIndex>
  loadMeta(id: string): Promise<EpisodeMeta>
  loadEpisode(id: string): Promise<EpisodeManifest>
  coverUrl(id: string): string
  baseUrl(): string
}

export interface RemoteCatalogDeps {
  baseUrl: string
  cacheRoot: () => string
  fetcher?: typeof fetch
  fs?: Pick<typeof nodefs, 'readFile' | 'writeFile' | 'mkdir'>
}

export function createRemoteCatalog(deps: RemoteCatalogDeps): RemoteCatalog {
  const fetcher = deps.fetcher ?? (globalThis.fetch as typeof fetch)
  const fs = deps.fs ?? nodefs
  // Tracks the freshest catalog.updatedAt we've seen this session. Used to
  // cache-bust cover URLs so <img> tags refetch when a publish updates
  // cover art at the same path.
  let latestUpdatedAt: string | null = null

  async function readCache(path: string): Promise<string | null> {
    try {
      const raw = await fs.readFile(path, 'utf-8')
      return raw as unknown as string
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async function writeCache(path: string, data: string): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, data, 'utf-8')
  }

  async function fetchJson(url: string): Promise<unknown> {
    // Node's fetch has no HTTP-level cache, so every call is a fresh
    // network hit. That's exactly what we want here — the network-first
    // semantics of list()/loadMeta()/loadEpisode() rely on it.
    const resp = await fetcher(url)
    if (!resp.ok) throw new Error(`Fetch ${url} failed: ${resp.status}`)
    return await resp.json()
  }

  function catalogCachePath() { return join(deps.cacheRoot(), 'catalog.json') }
  function metaCachePath(id: string) { return join(deps.cacheRoot(), 'episodes', id, 'meta.json') }
  function manifestCachePath(id: string) { return join(deps.cacheRoot(), 'episodes', id, 'manifest.json') }

  async function refresh(): Promise<RemoteCatalogIndex> {
    const raw = await fetchJson(`${deps.baseUrl}/catalog.json`)
    const parsed = remoteCatalogSchema.parse(raw)
    latestUpdatedAt = parsed.updatedAt
    await writeCache(catalogCachePath(), JSON.stringify(parsed))
    return parsed
  }

  async function readCatalogFromCache(): Promise<RemoteCatalogIndex | null> {
    const cached = await readCache(catalogCachePath())
    if (cached === null) return null
    try {
      const parsed = remoteCatalogSchema.parse(JSON.parse(cached))
      latestUpdatedAt = parsed.updatedAt
      return parsed
    } catch { return null }
  }

  async function list(): Promise<RemoteCatalogIndex> {
    // Network-first: catalog.json changes on every publish, so we always try
    // to fetch fresh. Fall back to cache only on network failure so the app
    // still works offline once it has cached at least once.
    try {
      return await refresh()
    } catch (netErr) {
      const cached = await readCatalogFromCache()
      if (cached) return cached
      throw new Error('no cached catalog and network unavailable', { cause: netErr })
    }
  }

  async function loadMeta(id: string): Promise<EpisodeMeta> {
    // Network-first: meta.json is tiny and can change between publishes
    // (blurb tweaks, release date flips). Cache is only for offline fallback.
    const cachePath = metaCachePath(id)
    try {
      const raw = await fetchJson(`${deps.baseUrl}/episodes/${id}/meta.json`)
      const parsed = episodeMetaSchema.parse(raw)
      await writeCache(cachePath, JSON.stringify(parsed))
      return parsed
    } catch (netErr) {
      const cached = await readCache(cachePath)
      if (cached !== null) {
        try { return episodeMetaSchema.parse(JSON.parse(cached)) } catch { /* fall through */ }
      }
      throw netErr
    }
  }

  async function loadEpisode(id: string): Promise<EpisodeManifest> {
    // Network-first: re-publishing an episode changes audio filenames
    // (they're hashed by text), so a stale cached manifest would point at
    // audio files that no longer exist. Fetched only on-play (once per
    // playback session), so the network cost is bounded.
    const cachePath = manifestCachePath(id)
    try {
      const raw = await fetchJson(`${deps.baseUrl}/episodes/${id}/manifest.json`)
      const parsed = episodeManifestSchema.parse(raw)
      await writeCache(cachePath, JSON.stringify(parsed))
      return parsed
    } catch (netErr) {
      const cached = await readCache(cachePath)
      if (cached !== null) {
        try { return episodeManifestSchema.parse(JSON.parse(cached)) } catch { /* fall through */ }
      }
      throw netErr
    }
  }

  function coverUrl(id: string): string {
    // Cache-bust with catalog.updatedAt so <img src=...> refetches when a
    // publish updates cover art at the same path. jsDelivr ignores query
    // strings for its own cache key; the ?v= just tricks the browser.
    const base = `${deps.baseUrl}/episodes/${id}/cover.png`
    return latestUpdatedAt ? `${base}?v=${encodeURIComponent(latestUpdatedAt)}` : base
  }

  return { refresh, list, loadMeta, loadEpisode, coverUrl, baseUrl: () => deps.baseUrl }
}
