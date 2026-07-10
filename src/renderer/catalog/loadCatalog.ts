import type { EpisodeManifest, LibrarySummary } from '../../shared/manifest'
import type { EpisodeMeta } from '../../shared/meta'
import { episodeManifestSchema } from '../../shared/manifest'

export interface ReleasedEntry {
  source: 'remote'
  id: string
  coverUrl: string
  meta: EpisodeMeta
  releaseDate: string
}

export interface UpcomingEntry {
  source: 'remote-upcoming'
  id: string
  coverUrl: string
  meta: EpisodeMeta
  expectedRelease: string
}

export interface LibraryEntry {
  source: 'library'
  id: string
  title: string
  subject: string
  coverImage: string
  estimatedMinutes: number
}

export interface CatalogView {
  released: ReleasedEntry[]
  upcoming: UpcomingEntry[]
  library: LibraryEntry[]
}

export async function loadCatalog(): Promise<CatalogView> {
  const [index, libraryRaw] = await Promise.all([
    window.deepcuts.remoteCatalog.list(),
    window.deepcuts.library.list(),
  ])
  const sorted = [...index.episodes].sort((a, b) => a.order - b.order)

  const metaPairs = await Promise.all(sorted.map(async (e) => {
    const meta = await window.deepcuts.remoteCatalog.loadMeta(e.id)
    const coverUrl = await window.deepcuts.remoteCatalog.coverUrl(e.id)
    return { entry: e, meta, coverUrl }
  }))

  const released: ReleasedEntry[] = []
  const upcoming: UpcomingEntry[] = []
  for (const { entry, meta, coverUrl } of metaPairs) {
    if (entry.status === 'released' && entry.releaseDate) {
      released.push({ source: 'remote', id: entry.id, coverUrl, meta, releaseDate: entry.releaseDate })
    } else if (entry.status === 'upcoming') {
      upcoming.push({
        source: 'remote-upcoming', id: entry.id, coverUrl, meta,
        expectedRelease: entry.expectedRelease ?? 'TBA',
      })
    }
  }

  const library: LibraryEntry[] = await Promise.all(
    (libraryRaw as LibrarySummary[]).map(async (l) => ({
      source: 'library' as const,
      id: l.libraryId,
      title: l.title,
      subject: l.subject,
      coverImage: (await window.deepcuts.library.coverUrl(l.libraryId)) ?? '',
      estimatedMinutes: l.estimatedMinutes,
    })),
  )

  return { released, upcoming, library }
}

export async function loadEpisodeManifestById(
  id: string,
  source: 'remote' | 'library',
): Promise<EpisodeManifest> {
  if (source === 'library') {
    const raw = await window.deepcuts.library.loadManifest(id)
    const manifest = episodeManifestSchema.parse(raw)
    const libraryCoverUrl = await window.deepcuts.library.coverUrl(id).catch(() => null)
    return libraryCoverUrl ? { ...manifest, coverImage: libraryCoverUrl } : manifest
  }
  // Remote manifests store coverImage as a relative path ("cover.png"). Rewrite
  // to the absolute CDN URL so the Player's <Cover> component (which now only
  // renders full URLs, not repo-relative paths) can display it.
  const manifest = await window.deepcuts.remoteCatalog.loadEpisode(id)
  const remoteCoverUrl = await window.deepcuts.remoteCatalog.coverUrl(id)
  return { ...manifest, coverImage: remoteCoverUrl }
}
