#!/usr/bin/env tsx
/**
 * Purges paths on jsDelivr's CDN so a fresh git push shows up immediately
 * instead of waiting for the ~10-minute edge TTL. Idempotent.
 *
 * By default purges the catalog + all released-episode assets currently in
 * content/catalog.json. Pass paths as args to override.
 *
 *   npx tsx scripts/purge-jsdelivr.ts
 *   npx tsx scripts/purge-jsdelivr.ts /gh/ibraude/deepcuts@main/content/catalog.json
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { remoteCatalogSchema } from '../src/shared/catalog'

const here = dirname(fileURLToPath(import.meta.url))
const CATALOG_PATH = join(here, '..', 'content', 'catalog.json')
const PURGE_ENDPOINT = 'https://purge.jsdelivr.net/'

async function defaultPaths(): Promise<string[]> {
  const catalog = remoteCatalogSchema.parse(JSON.parse(await fs.readFile(CATALOG_PATH, 'utf-8')))
  const base = '/gh/ibraude/deepcuts@main/content'
  const paths = [`${base}/catalog.json`]
  for (const e of catalog.episodes) {
    paths.push(`${base}/episodes/${e.id}/meta.json`)
    paths.push(`${base}/episodes/${e.id}/cover.png`)
    if (e.status === 'released') {
      paths.push(`${base}/episodes/${e.id}/manifest.json`)
    }
  }
  return paths
}

const paths = process.argv.slice(2).length > 0 ? process.argv.slice(2) : await defaultPaths()
console.log(`Purging ${paths.length} paths on jsDelivr...`)
const resp = await fetch(PURGE_ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path: paths }),
})
if (!resp.ok) {
  console.error(`Purge failed: HTTP ${resp.status} — ${await resp.text()}`)
  process.exit(1)
}
const body = (await resp.json()) as { id?: string; status?: string; timestamp?: string }
console.log(`  status: ${body.status ?? 'unknown'}`)
console.log(`  id:     ${body.id ?? 'n/a'}`)
console.log(`  Purge is async — jsDelivr will refresh the paths within a few minutes.`)
