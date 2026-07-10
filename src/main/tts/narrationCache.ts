import { createHash } from 'node:crypto'
import { promises as nodefs } from 'node:fs'
import { join } from 'node:path'
import type { SynthFn } from '../prerender'

// Cache-key derivation matches ElevenLabsTTS.synthesize exactly. See
// src/main/tts/ElevenLabsTTS.ts — that file is authoritative; if the schema
// changes there, mirror it here.

export function narrationCacheKey(voiceRef: string, modelId: string, text: string): string {
  return createHash('sha1')
    .update(voiceRef)
    .update('|')
    .update(modelId)
    .update('|')
    .update(text)
    .digest('hex')
    .slice(0, 16)
}

export function narrationCacheKeyLegacy(voiceRef: string, text: string): string {
  return createHash('sha1').update(voiceRef).update('|').update(text).digest('hex').slice(0, 16)
}

// Narrow structural type for the one fs call we need. Compatible with
// node:fs/promises.access at runtime but easier to mock than the full type.
export interface AccessFs {
  access(path: string): Promise<void>
}

export interface FindOpts {
  cacheDir: string
  segmentId: string
  voiceRef: string
  modelId?: string
  text: string
  fs?: AccessFs
}

const DEFAULT_MODEL = 'eleven_multilingual_v2'

export async function findCachedNarration(opts: FindOpts): Promise<string | null> {
  const fs = opts.fs ?? nodefs
  const modelId = opts.modelId ?? DEFAULT_MODEL

  const primaryKey = narrationCacheKey(opts.voiceRef, modelId, opts.text)
  const primaryPath = join(opts.cacheDir, `${opts.segmentId}-${primaryKey}.mp3`)
  try {
    await fs.access(primaryPath)
    return primaryPath
  } catch { /* fall through to legacy check */ }

  // Legacy files (pre-modelId hashing) were all rendered under v2.
  if (modelId === DEFAULT_MODEL) {
    const legacyKey = narrationCacheKeyLegacy(opts.voiceRef, opts.text)
    if (legacyKey !== primaryKey) {
      const legacyPath = join(opts.cacheDir, `${opts.segmentId}-${legacyKey}.mp3`)
      try {
        await fs.access(legacyPath)
        return legacyPath
      } catch { /* legacy also missing */ }
    }
  }

  return null
}

export interface CacheOnlySynthDeps {
  cacheDir: string
  fs?: AccessFs
}

export function createCacheOnlySynth(deps: CacheOnlySynthDeps): SynthFn {
  return async (text, voiceRef, opts) => {
    const filePath = await findCachedNarration({
      cacheDir: deps.cacheDir,
      segmentId: opts.segmentId,
      voiceRef,
      modelId: opts.modelId,
      text,
      fs: deps.fs,
    })
    if (!filePath) {
      throw new Error(
        `No pre-rendered audio for segment "${opts.segmentId}" in ${deps.cacheDir}. ` +
        `Run Prerender in the app first, or verify the draft's text/voiceRef/model haven't drifted from the cached version.`,
      )
    }
    return { filePath, cached: true }
  }
}
