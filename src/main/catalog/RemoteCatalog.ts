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
    await writeCache(catalogCachePath(), JSON.stringify(parsed))
    return parsed
  }

  async function list(): Promise<RemoteCatalogIndex> {
    const cached = await readCache(catalogCachePath())
    if (cached !== null) {
      try { return remoteCatalogSchema.parse(JSON.parse(cached)) } catch { /* fall through */ }
    }
    try {
      return await refresh()
    } catch (err) {
      throw new Error('no cached catalog and network unavailable', { cause: err })
    }
  }

  async function loadMeta(id: string): Promise<EpisodeMeta> {
    const cachePath = metaCachePath(id)
    const cached = await readCache(cachePath)
    if (cached !== null) {
      try { return episodeMetaSchema.parse(JSON.parse(cached)) } catch { /* refetch */ }
    }
    const raw = await fetchJson(`${deps.baseUrl}/episodes/${id}/meta.json`)
    const parsed = episodeMetaSchema.parse(raw)
    await writeCache(cachePath, JSON.stringify(parsed))
    return parsed
  }

  async function loadEpisode(id: string): Promise<EpisodeManifest> {
    const cachePath = manifestCachePath(id)
    const cached = await readCache(cachePath)
    if (cached !== null) {
      try { return episodeManifestSchema.parse(JSON.parse(cached)) } catch { /* refetch */ }
    }
    const raw = await fetchJson(`${deps.baseUrl}/episodes/${id}/manifest.json`)
    const parsed = episodeManifestSchema.parse(raw)
    await writeCache(cachePath, JSON.stringify(parsed))
    return parsed
  }

  function coverUrl(id: string): string {
    return `${deps.baseUrl}/episodes/${id}/cover.png`
  }

  return { refresh, list, loadMeta, loadEpisode, coverUrl, baseUrl: () => deps.baseUrl }
}
