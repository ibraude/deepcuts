import { promises as nodefs } from 'node:fs'
import { dirname, join } from 'node:path'
import { flattenSegments, type EpisodeManifest } from '../../shared/manifest'
import type { RemoteCatalog } from '../catalog/RemoteCatalog'

export interface DownloadProgress {
  total: number
  done: number
  currentUrl: string
}

export interface DownloadedEpisodes {
  isDownloaded(id: string): Promise<boolean>
  start(id: string, onProgress?: (p: DownloadProgress) => void): Promise<void>
  remove(id: string): Promise<void>
  loadManifestLocal(id: string): Promise<EpisodeManifest | null>
}

export interface DownloadedEpisodesDeps {
  downloadedRoot: () => string
  catalog: Pick<RemoteCatalog, 'loadEpisode' | 'coverUrl' | 'loadMeta'>
  fetcher?: typeof fetch
  fs?: Pick<typeof nodefs, 'readFile' | 'writeFile' | 'mkdir' | 'rm' | 'stat'>
}

export function createDownloadedEpisodes(deps: DownloadedEpisodesDeps): DownloadedEpisodes {
  const fetcher = deps.fetcher ?? (globalThis.fetch as typeof fetch)
  const fs = deps.fs ?? nodefs

  function episodeDir(id: string) { return join(deps.downloadedRoot(), id) }
  function localManifestPath(id: string) { return join(episodeDir(id), 'manifest.json') }
  function localAudioPath(id: string, segmentId: string) { return join(episodeDir(id), 'audio', `${segmentId}.mp3`) }

  async function writeBytes(path: string, url: string): Promise<void> {
    const resp = await fetcher(url)
    if (!resp.ok) throw new Error(`Download ${url} failed: ${resp.status}`)
    const buf = new Uint8Array(await resp.arrayBuffer())
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(path, buf)
  }

  async function isDownloaded(id: string): Promise<boolean> {
    try { await fs.stat(localManifestPath(id)); return true } catch { return false }
  }

  async function loadManifestLocal(id: string): Promise<EpisodeManifest | null> {
    try {
      const raw = await fs.readFile(localManifestPath(id), 'utf-8')
      return JSON.parse(raw as unknown as string) as EpisodeManifest
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async function start(id: string, onProgress?: (p: DownloadProgress) => void): Promise<void> {
    const manifest = await deps.catalog.loadEpisode(id)
    const flat = flattenSegments(manifest)
    const audioUrls: Array<{ segmentId: string; url: string }> = []
    for (const seg of flat) {
      if (seg.type === 'narration' && seg.audio) audioUrls.push({ segmentId: seg.id, url: seg.audio })
      if (seg.type === 'song' && seg.voiceovers) {
        for (const vo of seg.voiceovers) {
          if (vo.audio) audioUrls.push({ segmentId: vo.id, url: vo.audio })
        }
      }
    }
    const total = audioUrls.length + 1
    let done = 0

    await writeBytes(join(episodeDir(id), 'cover.png'), deps.catalog.coverUrl(id))
    done++; onProgress?.({ total, done, currentUrl: 'cover.png' })

    for (const { segmentId, url } of audioUrls) {
      await writeBytes(localAudioPath(id, segmentId), url)
      done++; onProgress?.({ total, done, currentUrl: url })
    }

    const localManifest: EpisodeManifest = {
      ...manifest,
      chapters: manifest.chapters.map((ch) => ({
        ...ch,
        segments: ch.segments.map((s) => {
          if (s.type === 'narration') {
            return { ...s, audio: `file://${localAudioPath(id, s.id)}` }
          }
          if (s.type === 'song' && s.voiceovers) {
            return {
              ...s,
              voiceovers: s.voiceovers.map((vo) =>
                vo.audio ? { ...vo, audio: `file://${localAudioPath(id, vo.id)}` } : vo,
              ),
            }
          }
          return s
        }),
      })),
    }
    await fs.mkdir(dirname(localManifestPath(id)), { recursive: true })
    await fs.writeFile(localManifestPath(id), JSON.stringify(localManifest), 'utf-8')
  }

  async function remove(id: string): Promise<void> {
    await fs.rm(episodeDir(id), { recursive: true, force: true })
  }

  return { isDownloaded, start, remove, loadManifestLocal }
}
