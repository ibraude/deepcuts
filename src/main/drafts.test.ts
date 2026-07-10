import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDrafts } from './drafts'
import type { DraftManifest } from '../shared/manifest'

const mkTmp = async () => {
  const d = join(tmpdir(), 'deepcuts-drafts-' + Math.random().toString(36).slice(2))
  await fs.mkdir(d, { recursive: true })
  return d
}

function freshManifest(over: Partial<DraftManifest> = {}): DraftManifest {
  return {
    schemaVersion: 1,
    id: 'x',
    title: 'X',
    subject: '',
    coverImage: '',
    estimatedMinutes: 5,
    hosts: [{ id: 'h', name: 'H', persona: '', voiceRef: '' }],
    chapters: [
      { title: 'C', segments: [{ type: 'narration', id: 'n0', hostId: 'h', text: '' }] },
    ],
    sources: [],
    facts: [],
    ...over,
  } as DraftManifest
}

describe('drafts module', () => {
  it('creates a draft and returns a 16-char id', async () => {
    const root = await mkTmp()
    const episodesRoot = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root })
    const id = await m.createDraft(freshManifest())
    expect(id).toMatch(/^[a-f0-9]{16}$/)
    const onDisk = await fs.readFile(join(root, id, 'manifest.json'), 'utf-8')
    expect(JSON.parse(onDisk).title).toBe('X')
  })

  it('lists drafts with summary data', async () => {
    const root = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root })
    await m.createDraft(freshManifest({ title: 'First', subject: 'sub' }))
    await m.createDraft(freshManifest({ title: 'Second' }))
    const list = await m.listDrafts()
    expect(list).toHaveLength(2)
    const titles = list.map((d) => d.title).sort()
    expect(titles).toEqual(['First', 'Second'])
    expect(list[0]!.hostCount).toBe(1)
    expect(list[0]!.segmentCount).toBe(1)
  })

  it('loads a saved draft', async () => {
    const root = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root })
    const id = await m.createDraft(freshManifest({ title: 'Loadable' }))
    const loaded = await m.loadDraft(id)
    expect(loaded.title).toBe('Loadable')
  })

  it('saves overwriting an existing draft', async () => {
    const root = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root })
    const id = await m.createDraft(freshManifest({ title: 'Old' }))
    await m.saveDraft(id, freshManifest({ title: 'New' }))
    const loaded = await m.loadDraft(id)
    expect(loaded.title).toBe('New')
  })

  it('deletes a draft', async () => {
    const root = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root })
    const id = await m.createDraft(freshManifest())
    await m.deleteDraft(id)
    await expect(m.loadDraft(id)).rejects.toThrow()
    const list = await m.listDrafts()
    expect(list).toHaveLength(0)
  })

  it('rejects unsafe draftIds', async () => {
    const root = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root })
    await expect(m.loadDraft('../etc/passwd')).rejects.toThrow()
    await expect(m.deleteDraft('../etc/passwd')).rejects.toThrow()
  })

  it('reports hasCover=false when no cover file, true when one exists', async () => {
    const root = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root })
    const id = await m.createDraft(freshManifest())
    let list = await m.listDrafts()
    expect(list[0]!.hasCover).toBe(false)
    await fs.writeFile(join(root, id, 'cover.png'), 'fake')
    list = await m.listDrafts()
    expect(list[0]!.hasCover).toBe(true)
  })

  it('returns a file:// URL for the cover when present', async () => {
    const root = await mkTmp()
    const m = createDrafts({ draftsRoot: () => root })
    const id = await m.createDraft(freshManifest())
    expect(await m.draftCoverUrl(id)).toBeNull()
    await fs.writeFile(join(root, id, 'cover.png'), 'fake')
    expect(await m.draftCoverUrl(id)).toBe('file://' + join(root, id, 'cover.png'))
  })
})
