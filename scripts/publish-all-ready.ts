#!/usr/bin/env tsx
/**
 * Publishes every draft that has complete narration-cache coverage as a
 * released episode, spacing releases one per week starting on the next Friday.
 * Other upcoming episodes in the catalog get sequential Friday
 * expectedRelease values after the last released one.
 */

import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { publishEpisode } from './publish-episode'
import { createCacheOnlySynth } from '../src/main/tts/narrationCache'
import { remoteCatalogSchema, type RemoteCatalogIndex } from '../src/shared/catalog'
import { episodeMetaSchema } from '../src/shared/meta'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..')
const CONTENT_DIR = join(REPO_ROOT, 'content')
const DRAFTS_ROOT = join(homedir(), 'Library/Application Support/deepcuts/drafts')
const CACHE_DIR = join(homedir(), 'Library/Application Support/deepcuts/narration-cache')

/** Draft hex ID → target catalog slug. Only "ready" drafts are listed. */
const READY: Array<{ draftId: string; slug: string; releaseDate: string }> = [
  { draftId: 'fcac36a4b86e953e', slug: 'bill-withers-carnegie', releaseDate: '2026-07-10' },
  { draftId: '1f4ee4fcf4377108', slug: 'solid-air',             releaseDate: '2026-07-17' },
  { draftId: 'a4f13f9852227236', slug: 'strangeways',           releaseDate: '2026-07-24' },
  { draftId: '395167dc4f72e0c8', slug: 'ziggy-stardust',        releaseDate: '2026-07-31' },
  { draftId: '696c14858c302cf3', slug: 'all-things-must-pass',  releaseDate: '2026-08-07' },
  { draftId: 'e6e9e58ee42cc80a', slug: 'almost-blue',           releaseDate: '2026-08-14' },
  { draftId: '1a3b8e1a9ac75cd7', slug: 'waiting-around-to-die', releaseDate: '2026-08-21' },
]

/** First Friday for still-upcoming episodes (after the last released above). */
const FIRST_UPCOMING_FRIDAY = '2026-08-28'

function nextFriday(dateIso: string): string {
  // Adds 7 days to a YYYY-MM-DD.
  const d = new Date(dateIso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 7)
  return d.toISOString().slice(0, 10)
}

async function stageDraftAssets(draftId: string, slug: string): Promise<string> {
  // The CLI expects cover.png + meta.json + manifest.json in the draft dir.
  // The manifest is already there. We copy the refreshed cover + meta from
  // content/episodes/<slug>/ so the CLI picks up the latest text.
  const draftDir = join(DRAFTS_ROOT, draftId)
  const contentEpDir = join(CONTENT_DIR, 'episodes', slug)
  await fs.copyFile(join(contentEpDir, 'cover.png'), join(draftDir, 'cover.png'))
  await fs.copyFile(join(contentEpDir, 'meta.json'), join(draftDir, 'meta.json'))
  return draftDir
}

async function publishReady() {
  const synthesize = createCacheOnlySynth({ cacheDir: CACHE_DIR })
  for (const { draftId, slug, releaseDate } of READY) {
    const draftDir = await stageDraftAssets(draftId, slug)
    process.stdout.write(`Publishing ${slug} (from draft ${draftId}, releaseDate ${releaseDate}) ...\n`)
    await publishEpisode({
      draftDir,
      contentDir: CONTENT_DIR,
      status: 'released',
      synthesize,
      idOverride: slug,
      today: () => releaseDate,
    })
  }
}

async function scheduleUpcoming() {
  // Assign sequential Friday expectedRelease values to every catalog entry
  // still marked upcoming, in `order` order.
  const catalogPath = join(CONTENT_DIR, 'catalog.json')
  const catalog: RemoteCatalogIndex = remoteCatalogSchema.parse(
    JSON.parse(await fs.readFile(catalogPath, 'utf-8')),
  )
  const upcoming = catalog.episodes.filter((e) => e.status === 'upcoming').sort((a, b) => a.order - b.order)
  let friday = FIRST_UPCOMING_FRIDAY
  for (const entry of upcoming) {
    entry.expectedRelease = friday
    // Also update the per-episode meta.json so the site shows the same date.
    const metaPath = join(CONTENT_DIR, 'episodes', entry.id, 'meta.json')
    try {
      const meta = episodeMetaSchema.parse(JSON.parse(await fs.readFile(metaPath, 'utf-8')))
      meta.expectedRelease = friday
      meta.releaseDate = null
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    } catch {
      console.warn(`  [warn] no meta.json for upcoming episode ${entry.id}`)
    }
    console.log(`  scheduled ${entry.id} → ${friday}`)
    friday = nextFriday(friday)
  }
  catalog.updatedAt = new Date().toISOString()
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2), 'utf-8')
}

await publishReady()
console.log('\nScheduling upcoming episodes on sequential Fridays...\n')
await scheduleUpcoming()
console.log('\nDone. Review with `git diff --stat` and commit.')
