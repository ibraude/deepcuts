#!/usr/bin/env tsx
/**
 * Validates every file under content/ against its zod schema. Exits non-zero
 * if anything is malformed. Called from CI on every PR that touches content/
 * so a bad catalog.json or meta.json can't reach main.
 */

import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { remoteCatalogSchema } from '../src/shared/catalog'
import { episodeMetaSchema } from '../src/shared/meta'
import { episodeManifestSchema } from '../src/shared/manifest'

const here = dirname(fileURLToPath(import.meta.url))
const CONTENT_DIR = join(here, '..', 'content')

let errors = 0

function fail(where: string, err: unknown) {
  errors++
  const msg = err instanceof Error ? err.message : String(err)
  console.error(`  ✗ ${where}\n    ${msg.split('\n').join('\n    ')}`)
}

// 1. catalog.json
const catalogPath = join(CONTENT_DIR, 'catalog.json')
let catalog
try {
  catalog = remoteCatalogSchema.parse(JSON.parse(await fs.readFile(catalogPath, 'utf-8')))
  console.log(`✓ catalog.json  (${catalog.episodes.length} episodes)`)
} catch (err) {
  fail('catalog.json', err)
  console.error('\nCannot validate individual episodes without a valid catalog. Aborting.')
  process.exit(1)
}

// 2. Every episode dir in the catalog must exist and pass its schemas.
const catalogIds = new Set(catalog.episodes.map((e) => e.id))
const orders = new Set<number>()
for (const entry of catalog.episodes) {
  if (orders.has(entry.order)) fail(`catalog.json`, new Error(`duplicate order ${entry.order}`))
  orders.add(entry.order)
  if (entry.status === 'released' && !entry.releaseDate) {
    fail(`catalog.json (${entry.id})`, new Error('status=released but releaseDate missing'))
  }
  if (entry.status === 'upcoming' && !entry.expectedRelease) {
    fail(`catalog.json (${entry.id})`, new Error('status=upcoming but expectedRelease missing'))
  }

  const dir = join(CONTENT_DIR, 'episodes', entry.id)
  const isDir = await fs.stat(dir).then((s) => s.isDirectory()).catch(() => false)
  if (!isDir) {
    fail(entry.id, new Error(`missing directory ${dir}`))
    continue
  }

  // meta.json required for everyone
  try {
    const meta = episodeMetaSchema.parse(JSON.parse(await fs.readFile(join(dir, 'meta.json'), 'utf-8')))
    console.log(`✓ ${entry.id}/meta.json  (${meta.artistName} — ${meta.albumName})`)
  } catch (err) {
    fail(`${entry.id}/meta.json`, err)
  }

  // cover.png required for everyone
  const coverStat = await fs.stat(join(dir, 'cover.png')).catch(() => null)
  if (!coverStat || coverStat.size < 1024) {
    fail(`${entry.id}/cover.png`, new Error('missing or suspiciously small (<1KB)'))
  }

  // manifest.json required only for released episodes
  if (entry.status === 'released') {
    try {
      const manifest = episodeManifestSchema.parse(
        JSON.parse(await fs.readFile(join(dir, 'manifest.json'), 'utf-8')),
      )
      // Sanity: every narration segment with text must have an audio URL
      // pointing at a real file under audio/.
      const audioDir = join(dir, 'audio')
      for (const ch of manifest.chapters) {
        for (const seg of ch.segments) {
          if (seg.type === 'narration' && seg.text && !seg.audio) {
            fail(`${entry.id}/manifest.json`, new Error(`narration segment "${seg.id}" has text but no audio URL`))
          }
          if (seg.type === 'song' && seg.voiceovers) {
            for (const vo of seg.voiceovers) {
              if (vo.text && !vo.audio) {
                fail(`${entry.id}/manifest.json`, new Error(`voiceover "${vo.id}" has text but no audio URL`))
              }
            }
          }
        }
      }
      // Verify at least one audio file exists on disk.
      const audioFiles = await fs.readdir(audioDir).catch(() => [] as string[])
      const mp3s = audioFiles.filter((f) => f.endsWith('.mp3'))
      if (mp3s.length === 0) {
        fail(`${entry.id}/audio/`, new Error(`released episode has no audio files`))
      } else {
        console.log(`✓ ${entry.id}/manifest.json  (${mp3s.length} audio files)`)
      }
    } catch (err) {
      fail(`${entry.id}/manifest.json`, err)
    }
  }
}

// 3. Every episode dir on disk must correspond to a catalog entry.
const onDisk = await fs.readdir(join(CONTENT_DIR, 'episodes')).catch(() => [] as string[])
for (const d of onDisk) {
  const st = await fs.stat(join(CONTENT_DIR, 'episodes', d))
  if (!st.isDirectory()) continue
  if (!catalogIds.has(d)) {
    fail(`content/episodes/${d}`, new Error('directory exists but is not listed in catalog.json'))
  }
}

if (errors > 0) {
  console.error(`\n${errors} error(s). Fix them before merging.`)
  process.exit(1)
}
console.log('\nAll content valid.')
