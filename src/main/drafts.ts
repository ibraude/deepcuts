import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { draftManifestSchema, type DraftManifest, type DraftSummary } from '../shared/manifest'

const ID_RE = /^[a-f0-9]{16}$/

export interface DraftsDeps {
  draftsRoot: () => string
}

function assertSafeId(id: string): void {
  if (!ID_RE.test(id)) throw new Error(`Unsafe draftId: ${id}`)
}

export function createDrafts(deps: DraftsDeps) {
  const root = deps.draftsRoot

  async function ensureRoot(): Promise<void> {
    await fs.mkdir(root(), { recursive: true })
  }

  async function listDrafts(): Promise<DraftSummary[]> {
    await ensureRoot()
    const dirs = await fs.readdir(root(), { withFileTypes: true }).catch(() => [])
    const out: DraftSummary[] = []
    for (const entry of dirs) {
      if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue
      const id = entry.name
      const manifestPath = join(root(), id, 'manifest.json')
      try {
        const raw = await fs.readFile(manifestPath, 'utf-8')
        const m = JSON.parse(raw) as DraftManifest
        const stat = await fs.stat(manifestPath)
        const hasCover = await fs.access(join(root(), id, 'cover.png')).then(() => true).catch(() => false)
        const segmentCount = (m.chapters ?? []).reduce((sum, c) => sum + ((c.segments ?? []).length), 0)
        out.push({
          draftId: id,
          title: m.title ?? '',
          subject: m.subject ?? '',
          hostCount: (m.hosts ?? []).length,
          segmentCount,
          hasCover,
          updatedAt: stat.mtimeMs,
        })
      } catch {
        // Skip corrupt drafts in the summary list; loadDraft will surface errors.
      }
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt)
    return out
  }

  async function loadDraft(draftId: string): Promise<DraftManifest> {
    assertSafeId(draftId)
    const manifestPath = join(root(), draftId, 'manifest.json')
    const raw = await fs.readFile(manifestPath, 'utf-8')
    const manifest = draftManifestSchema.parse(JSON.parse(raw))
    // Fix-on-read: if a cover file exists but the field is empty (older drafts or
    // drafts whose cover was generated before the auto-update was wired), sync them.
    if (!manifest.coverImage) {
      const coverPath = join(root(), draftId, 'cover.png')
      const hasCover = await fs.access(coverPath).then(() => true).catch(() => false)
      if (hasCover) {
        manifest.coverImage = 'cover.png'
        await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2)).catch(() => {})
      }
    }
    return manifest
  }

  async function saveDraft(draftId: string, manifest: unknown): Promise<void> {
    assertSafeId(draftId)
    const parsed = draftManifestSchema.parse(manifest)
    const dir = join(root(), draftId)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'manifest.json'), JSON.stringify(parsed, null, 2))
  }

  async function createDraft(initial: DraftManifest, explicitId?: string): Promise<string> {
    await ensureRoot()
    const id = explicitId && ID_RE.test(explicitId) ? explicitId : randomBytes(8).toString('hex')
    const dir = join(root(), id)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'manifest.json'), JSON.stringify(initial, null, 2))
    return id
  }

  async function loadResearch(draftId: string): Promise<string> {
    assertSafeId(draftId)
    return fs
      .readFile(join(root(), draftId, 'research.md'), 'utf-8')
      .catch(() => '')
  }

  async function saveResearch(draftId: string, markdown: string): Promise<void> {
    assertSafeId(draftId)
    const dir = join(root(), draftId)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'research.md'), markdown)
  }

  async function loadOutline(draftId: string): Promise<unknown | null> {
    assertSafeId(draftId)
    try {
      const raw = await fs.readFile(join(root(), draftId, 'outline.json'), 'utf-8')
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  async function saveOutline(draftId: string, outline: unknown): Promise<void> {
    assertSafeId(draftId)
    const dir = join(root(), draftId)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'outline.json'), JSON.stringify(outline, null, 2))
  }

  async function deleteDraft(draftId: string): Promise<void> {
    assertSafeId(draftId)
    await fs.rm(join(root(), draftId), { recursive: true, force: true })
  }

  async function draftCoverUrl(draftId: string): Promise<string | null> {
    assertSafeId(draftId)
    const coverPath = join(root(), draftId, 'cover.png')
    const exists = await fs.access(coverPath).then(() => true).catch(() => false)
    return exists ? 'file://' + coverPath : null
  }

  async function updateCoverImageField(draftId: string): Promise<void> {
    // Ensures the manifest's coverImage field points to "cover.png" after a cover
    // file is written. Without this, strict validation (preview / publish) fails
    // because coverImage is an empty string.
    const manifestPath = join(root(), draftId, 'manifest.json')
    try {
      const raw = await fs.readFile(manifestPath, 'utf-8')
      const m = JSON.parse(raw) as { coverImage?: string }
      if (m.coverImage !== 'cover.png') {
        m.coverImage = 'cover.png'
        await fs.writeFile(manifestPath, JSON.stringify(m, null, 2))
      }
    } catch {
      // Manifest may not exist yet — nothing to update.
    }
  }

  async function setDraftCover(draftId: string, sourcePath: string): Promise<void> {
    assertSafeId(draftId)
    if (!sourcePath) throw new Error('Empty source path')
    const dir = join(root(), draftId)
    await fs.mkdir(dir, { recursive: true })
    await fs.copyFile(sourcePath, join(dir, 'cover.png'))
    await updateCoverImageField(draftId)
  }

  async function setDraftCoverFromBytes(draftId: string, bytes: Uint8Array): Promise<void> {
    assertSafeId(draftId)
    const dir = join(root(), draftId)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'cover.png'), bytes)
    await updateCoverImageField(draftId)
  }

  return {
    listDrafts,
    loadDraft,
    saveDraft,
    createDraft,
    deleteDraft,
    draftCoverUrl,
    setDraftCover,
    loadResearch,
    saveResearch,
    loadOutline,
    saveOutline,
    setDraftCoverFromBytes,
  }
}
