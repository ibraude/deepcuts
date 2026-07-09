import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { episodeManifestSchema, type EpisodeManifest, type LibrarySummary } from '../shared/manifest'

const ID_RE = /^[a-f0-9]{16}$/

export interface LibraryDeps {
  libraryRoot: () => string
  draftsRoot: () => string
}

function assertSafeId(id: string): void {
  if (!ID_RE.test(id)) throw new Error(`Unsafe libraryId: ${id}`)
}

export function createLibrary(deps: LibraryDeps) {
  const libRoot = deps.libraryRoot
  const drafts = deps.draftsRoot

  async function ensureRoot(): Promise<void> {
    await fs.mkdir(libRoot(), { recursive: true })
  }

  async function listLibrary(): Promise<LibrarySummary[]> {
    await ensureRoot()
    const dirs = await fs.readdir(libRoot(), { withFileTypes: true }).catch(() => [])
    const out: LibrarySummary[] = []
    for (const entry of dirs) {
      if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue
      const id = entry.name
      const manifestPath = join(libRoot(), id, 'manifest.json')
      try {
        const raw = await fs.readFile(manifestPath, 'utf-8')
        const m = JSON.parse(raw) as EpisodeManifest
        const stat = await fs.stat(manifestPath)
        const hasCover = await fs
          .access(join(libRoot(), id, 'cover.png'))
          .then(() => true)
          .catch(() => false)
        const segmentCount = m.chapters.reduce((s, c) => s + c.segments.length, 0)
        out.push({
          libraryId: id,
          title: m.title,
          subject: m.subject,
          hostCount: m.hosts.length,
          segmentCount,
          estimatedMinutes: m.estimatedMinutes,
          hasCover,
          publishedAt: stat.mtimeMs,
        })
      } catch {
        // skip corrupt entries
      }
    }
    out.sort((a, b) => b.publishedAt - a.publishedAt)
    return out
  }

  async function publish(draftId: string): Promise<string> {
    assertSafeId(draftId)
    const draftManifestPath = join(drafts(), draftId, 'manifest.json')
    const raw = await fs.readFile(draftManifestPath, 'utf-8')
    const manifest = episodeManifestSchema.parse(JSON.parse(raw))
    const libDir = join(libRoot(), draftId)
    await fs.mkdir(libDir, { recursive: true })
    await fs.writeFile(join(libDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    const draftCover = join(drafts(), draftId, 'cover.png')
    const libCover = join(libDir, 'cover.png')
    await fs.copyFile(draftCover, libCover).catch(() => {
      // No draft cover — leave library entry without one.
    })
    return draftId
  }

  async function unpublish(libraryId: string): Promise<void> {
    assertSafeId(libraryId)
    await fs.rm(join(libRoot(), libraryId), { recursive: true, force: true })
  }

  async function loadManifest(libraryId: string): Promise<EpisodeManifest> {
    assertSafeId(libraryId)
    const raw = await fs.readFile(join(libRoot(), libraryId, 'manifest.json'), 'utf-8')
    return episodeManifestSchema.parse(JSON.parse(raw))
  }

  async function coverUrl(libraryId: string): Promise<string | null> {
    assertSafeId(libraryId)
    const path = join(libRoot(), libraryId, 'cover.png')
    const exists = await fs.access(path).then(() => true).catch(() => false)
    return exists ? 'file://' + path : null
  }

  async function isPublished(draftId: string): Promise<boolean> {
    if (!ID_RE.test(draftId)) return false
    return fs
      .access(join(libRoot(), draftId, 'manifest.json'))
      .then(() => true)
      .catch(() => false)
  }

  return { listLibrary, publish, unpublish, loadManifest, coverUrl, isPublished }
}
