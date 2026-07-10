#!/usr/bin/env tsx
/**
 * Audits every draft in ~/Library/Application Support/deepcuts/drafts/
 * and reports which drafts have COMPLETE narration-cache coverage
 * (i.e. every narration+voiceover segment has a corresponding MP3 in the cache).
 *
 * Emits JSON on stdout so the calling script can pick the ready ones.
 */

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { draftManifestSchema, flattenSegments, type DraftManifest } from '../src/shared/manifest'
import { findCachedNarration } from '../src/main/tts/narrationCache'

const DRAFTS_ROOT = join(homedir(), 'Library/Application Support/deepcuts/drafts')
const CACHE_DIR = join(homedir(), 'Library/Application Support/deepcuts/narration-cache')

interface DraftAudit {
  draftId: string
  title: string
  subject: string
  totalSegments: number
  audibleSegments: number
  cached: number
  missing: number
  ready: boolean
}

async function auditDraft(draftId: string): Promise<DraftAudit | null> {
  const manifestPath = join(DRAFTS_ROOT, draftId, 'manifest.json')
  let manifest: DraftManifest
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8')
    manifest = draftManifestSchema.parse(JSON.parse(raw))
  } catch (err) {
    console.error(`[skip] ${draftId}: ${(err as Error).message}`)
    return null
  }

  const flat = flattenSegments(manifest as never)
  const audible: Array<{ segmentId: string; voiceRef: string; text: string; modelId?: string }> = []
  const hostVoice = new Map(manifest.hosts.map((h) => [h.id, { voiceRef: h.voiceRef, modelId: h.ttsModel }]))

  for (const seg of flat) {
    if (seg.type === 'narration' && seg.text) {
      const host = hostVoice.get(seg.hostId)
      if (host?.voiceRef.startsWith('elevenlabs:')) {
        audible.push({ segmentId: seg.id, voiceRef: host.voiceRef, text: seg.text, modelId: host.modelId })
      }
    }
    if (seg.type === 'song' && seg.voiceovers) {
      for (const vo of seg.voiceovers) {
        if (!vo.text) continue
        const host = hostVoice.get(vo.hostId)
        if (host?.voiceRef.startsWith('elevenlabs:')) {
          audible.push({ segmentId: vo.id, voiceRef: host.voiceRef, text: vo.text, modelId: host.modelId })
        }
      }
    }
  }

  let cached = 0
  const missingSegments: string[] = []
  for (const a of audible) {
    const path = await findCachedNarration({
      cacheDir: CACHE_DIR,
      segmentId: a.segmentId,
      voiceRef: a.voiceRef,
      modelId: a.modelId,
      text: a.text,
    })
    if (path) cached++
    else missingSegments.push(a.segmentId)
  }

  return {
    draftId,
    title: manifest.title,
    subject: manifest.subject,
    totalSegments: flat.length,
    audibleSegments: audible.length,
    cached,
    missing: audible.length - cached,
    ready: audible.length > 0 && cached === audible.length,
  }
}

const dirs = await fs.readdir(DRAFTS_ROOT)
const results: DraftAudit[] = []
for (const d of dirs) {
  const stat = await fs.stat(join(DRAFTS_ROOT, d)).catch(() => null)
  if (!stat?.isDirectory()) continue
  const r = await auditDraft(d)
  if (r) results.push(r)
}

console.log(JSON.stringify(results, null, 2))

const ready = results.filter((r) => r.ready)
console.error(`\n${ready.length} of ${results.length} drafts are publish-ready:\n`)
for (const r of results) {
  const flag = r.ready ? '✓ READY  ' : r.audibleSegments === 0 ? '  empty  ' : `  ${r.missing} missing`
  console.error(`  ${flag}  ${r.draftId}  ${r.title} — ${r.subject}  (${r.cached}/${r.audibleSegments})`)
}
