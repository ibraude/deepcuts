import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLibrary } from './library'
import type { EpisodeManifest } from '../shared/manifest'

const mkTmp = async () => {
  const d = join(tmpdir(), 'deepcuts-library-' + Math.random().toString(36).slice(2))
  await fs.mkdir(d, { recursive: true })
  return d
}

function strictManifest(over: Partial<EpisodeManifest> = {}): EpisodeManifest {
  return {
    schemaVersion: 1,
    id: 'x',
    title: 'X',
    subject: 'S',
    coverImage: 'covers/x.png',
    estimatedMinutes: 5,
    hosts: [{ id: 'h', name: 'H', persona: '', voiceRef: 'system:default' }],
    chapters: [
      {
        title: 'C',
        segments: [{ type: 'narration', id: 'n0', hostId: 'h', text: 'hello' }],
      },
    ],
    sources: [],
    facts: [],
    ...over,
  }
}

describe('library module', () => {
  const DRAFT_ID = 'abcd1234abcd1234'

  it('publishes a strict-valid draft, copies manifest and cover', async () => {
    const libRoot = await mkTmp()
    const draftsRoot = await mkTmp()
    const draftDir = join(draftsRoot, DRAFT_ID)
    await fs.mkdir(draftDir, { recursive: true })
    await fs.writeFile(
      join(draftDir, 'manifest.json'),
      JSON.stringify(strictManifest({ title: 'My ep' })),
    )
    await fs.writeFile(join(draftDir, 'cover.png'), 'fake')
    const lib = createLibrary({ libraryRoot: () => libRoot, draftsRoot: () => draftsRoot })
    const id = await lib.publish(DRAFT_ID)
    expect(id).toBe(DRAFT_ID)
    const onDisk = JSON.parse(await fs.readFile(join(libRoot, id, 'manifest.json'), 'utf-8'))
    expect(onDisk.title).toBe('My ep')
    await fs.access(join(libRoot, id, 'cover.png'))
  })

  it('rejects publishing an incomplete draft (strict schema)', async () => {
    const libRoot = await mkTmp()
    const draftsRoot = await mkTmp()
    const draftDir = join(draftsRoot, DRAFT_ID)
    await fs.mkdir(draftDir, { recursive: true })
    await fs.writeFile(
      join(draftDir, 'manifest.json'),
      JSON.stringify(strictManifest({ title: '' })),
    )
    const lib = createLibrary({ libraryRoot: () => libRoot, draftsRoot: () => draftsRoot })
    await expect(lib.publish(DRAFT_ID)).rejects.toThrow()
  })

  it('lists library entries with summary', async () => {
    const libRoot = await mkTmp()
    const draftsRoot = await mkTmp()
    const draftDir = join(draftsRoot, DRAFT_ID)
    await fs.mkdir(draftDir, { recursive: true })
    await fs.writeFile(
      join(draftDir, 'manifest.json'),
      JSON.stringify(strictManifest({ title: 'Listed', subject: 'sub' })),
    )
    const lib = createLibrary({ libraryRoot: () => libRoot, draftsRoot: () => draftsRoot })
    await lib.publish(DRAFT_ID)
    const list = await lib.listLibrary()
    expect(list).toHaveLength(1)
    expect(list[0]!.title).toBe('Listed')
    expect(list[0]!.libraryId).toBe(DRAFT_ID)
  })

  it('unpublish removes the library entry', async () => {
    const libRoot = await mkTmp()
    const draftsRoot = await mkTmp()
    const draftDir = join(draftsRoot, DRAFT_ID)
    await fs.mkdir(draftDir, { recursive: true })
    await fs.writeFile(join(draftDir, 'manifest.json'), JSON.stringify(strictManifest()))
    const lib = createLibrary({ libraryRoot: () => libRoot, draftsRoot: () => draftsRoot })
    await lib.publish(DRAFT_ID)
    expect(await lib.isPublished(DRAFT_ID)).toBe(true)
    await lib.unpublish(DRAFT_ID)
    expect(await lib.isPublished(DRAFT_ID)).toBe(false)
    expect(await lib.listLibrary()).toHaveLength(0)
  })

  it('isPublished is false when no library entry exists', async () => {
    const libRoot = await mkTmp()
    const draftsRoot = await mkTmp()
    const lib = createLibrary({ libraryRoot: () => libRoot, draftsRoot: () => draftsRoot })
    expect(await lib.isPublished(DRAFT_ID)).toBe(false)
  })

  it('rejects unsafe ids', async () => {
    const libRoot = await mkTmp()
    const draftsRoot = await mkTmp()
    const lib = createLibrary({ libraryRoot: () => libRoot, draftsRoot: () => draftsRoot })
    await expect(lib.publish('../etc/passwd')).rejects.toThrow()
    await expect(lib.unpublish('../etc/passwd')).rejects.toThrow()
  })
})
