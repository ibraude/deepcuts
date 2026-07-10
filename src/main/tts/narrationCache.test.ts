import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  narrationCacheKey,
  narrationCacheKeyLegacy,
  findCachedNarration,
  createCacheOnlySynth,
} from './narrationCache'

function sha1first16(...parts: string[]): string {
  const h = createHash('sha1')
  for (const p of parts) h.update(p)
  return h.digest('hex').slice(0, 16)
}

describe('narrationCacheKey', () => {
  it('matches sha1(voiceRef | modelId | text) truncated to 16', () => {
    expect(narrationCacheKey('elevenlabs:v', 'eleven_v3', 'Hello.')).toBe(
      sha1first16('elevenlabs:v', '|', 'eleven_v3', '|', 'Hello.'),
    )
  })

  it('legacy variant excludes modelId', () => {
    expect(narrationCacheKeyLegacy('elevenlabs:v', 'Hello.')).toBe(
      sha1first16('elevenlabs:v', '|', 'Hello.'),
    )
  })
})

describe('findCachedNarration', () => {
  function fakeFs(paths: Set<string>) {
    return {
      access: vi.fn(async (p: string) => {
        if (!paths.has(p)) {
          const e: NodeJS.ErrnoException = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
          throw e
        }
      }),
    }
  }

  it('returns the modern-hash path when present', async () => {
    const key = narrationCacheKey('elevenlabs:v', 'eleven_multilingual_v2', 'Hi.')
    const path = `/cache/n-01-${key}.mp3`
    const result = await findCachedNarration({
      cacheDir: '/cache',
      segmentId: 'n-01',
      voiceRef: 'elevenlabs:v',
      modelId: 'eleven_multilingual_v2',
      text: 'Hi.',
      fs: fakeFs(new Set([path])),
    })
    expect(result).toBe(path)
  })

  it('falls back to legacy hash for v2 when modern is missing', async () => {
    const legacyKey = narrationCacheKeyLegacy('elevenlabs:v', 'Hi.')
    const legacyPath = `/cache/n-01-${legacyKey}.mp3`
    const result = await findCachedNarration({
      cacheDir: '/cache',
      segmentId: 'n-01',
      voiceRef: 'elevenlabs:v',
      modelId: 'eleven_multilingual_v2',
      text: 'Hi.',
      fs: fakeFs(new Set([legacyPath])),
    })
    expect(result).toBe(legacyPath)
  })

  it('does NOT fall back to legacy for v3', async () => {
    const legacyKey = narrationCacheKeyLegacy('elevenlabs:v', 'Hi.')
    const legacyPath = `/cache/n-01-${legacyKey}.mp3`
    const result = await findCachedNarration({
      cacheDir: '/cache',
      segmentId: 'n-01',
      voiceRef: 'elevenlabs:v',
      modelId: 'eleven_v3',
      text: 'Hi.',
      fs: fakeFs(new Set([legacyPath])),
    })
    expect(result).toBeNull()
  })

  it('returns null when neither modern nor legacy exists', async () => {
    const result = await findCachedNarration({
      cacheDir: '/cache',
      segmentId: 'n-01',
      voiceRef: 'elevenlabs:v',
      modelId: 'eleven_multilingual_v2',
      text: 'Hi.',
      fs: fakeFs(new Set()),
    })
    expect(result).toBeNull()
  })

  it('defaults modelId to v2 when omitted', async () => {
    const key = narrationCacheKey('elevenlabs:v', 'eleven_multilingual_v2', 'Hi.')
    const path = `/cache/n-01-${key}.mp3`
    const result = await findCachedNarration({
      cacheDir: '/cache',
      segmentId: 'n-01',
      voiceRef: 'elevenlabs:v',
      text: 'Hi.',
      fs: fakeFs(new Set([path])),
    })
    expect(result).toBe(path)
  })
})

describe('createCacheOnlySynth', () => {
  it('returns the found file path with cached:true', async () => {
    const key = narrationCacheKey('elevenlabs:v', 'eleven_multilingual_v2', 'Hi.')
    const path = `/cache/n-01-${key}.mp3`
    const synth = createCacheOnlySynth({
      cacheDir: '/cache',
      fs: {
        access: vi.fn(async (p: string) => {
          if (p !== path) {
            const e: NodeJS.ErrnoException = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
            throw e
          }
        }),
      },
    })
    const result = await synth('Hi.', 'elevenlabs:v', { segmentId: 'n-01' })
    expect(result).toEqual({ filePath: path, cached: true })
  })

  it('throws with actionable guidance when the file is missing', async () => {
    const synth = createCacheOnlySynth({
      cacheDir: '/cache',
      fs: {
        access: vi.fn(async () => {
          const e: NodeJS.ErrnoException = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
          throw e
        }),
      },
    })
    await expect(
      synth('Hi.', 'elevenlabs:v', { segmentId: 'n-01' }),
    ).rejects.toThrow(/Run Prerender in the app first/)
  })
})
