import { catalogIndexSchema } from '../../shared/catalog'
import { episodeManifestSchema, type EpisodeManifest, type LibrarySummary } from '../../shared/manifest'

export interface UnifiedCatalogEntry {
  source: 'bundled' | 'library'
  id: string
  title: string
  subject: string
  coverImage: string
  estimatedMinutes: number
}

export async function loadUnifiedCatalog(): Promise<UnifiedCatalogEntry[]> {
  const [bundledRaw, libraryRaw] = await Promise.all([
    window.deepcuts.catalog.loadLocal(),
    window.deepcuts.library.list(),
  ])
  const bundled = catalogIndexSchema.parse(bundledRaw)
  const bundledEntries: UnifiedCatalogEntry[] = bundled.episodes.map((e) => ({
    source: 'bundled',
    id: e.manifestPath,
    title: e.title,
    subject: e.subject,
    coverImage: e.coverImage,
    estimatedMinutes: e.estimatedMinutes,
  }))
  const libraryEntries: UnifiedCatalogEntry[] = await Promise.all(
    (libraryRaw as LibrarySummary[]).map(async (l) => ({
      source: 'library' as const,
      id: l.libraryId,
      title: l.title,
      subject: l.subject,
      coverImage: (await window.deepcuts.library.coverUrl(l.libraryId)) ?? '',
      estimatedMinutes: l.estimatedMinutes,
    })),
  )
  return [...libraryEntries, ...bundledEntries]
}

export async function loadEpisodeManifest(entry: UnifiedCatalogEntry): Promise<EpisodeManifest> {
  const raw =
    entry.source === 'library'
      ? await window.deepcuts.library.loadManifest(entry.id)
      : await window.deepcuts.manifest.load(entry.id)
  const manifest = episodeManifestSchema.parse(raw)
  // For library entries, rewrite the relative `cover.png` to the absolute
  // file:// URL pointing at the library directory's cover. Without this, the
  // Player's Cover component would resolve `cover.png` against the bundled
  // episodes root (which doesn't have it) and 404. Bundled entries already
  // resolve correctly against the bundled root, so we only swap for library.
  if (entry.source === 'library') {
    const libraryCoverUrl = await window.deepcuts.library.coverUrl(entry.id).catch(() => null)
    if (libraryCoverUrl) {
      return { ...manifest, coverImage: libraryCoverUrl }
    }
  }
  return manifest
}
