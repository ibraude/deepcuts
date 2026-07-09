import { describe, expect, it, vi } from 'vitest'
import { ElevenLabsTTS } from './ElevenLabsTTS'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mkTmp = async () => {
  const d = join(tmpdir(), 'deepcuts-test-' + Math.random().toString(36).slice(2))
  await fs.mkdir(d, { recursive: true })
  return d
}

describe('ElevenLabsTTS', () => {
  it('writes mp3 bytes from the API to disk and returns the path', async () => {
    const cacheDir = await mkTmp()
    const fakeMp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0])
    const fetchFn = vi.fn(async () => new Response(fakeMp3, { status: 200 }))
    const tts = new ElevenLabsTTS({
      apiKey: 'key',
      cacheDir,
      fetchFn: fetchFn as any,
    })
    const { filePath, cached } = await tts.synthesize('Hello', 'elevenlabs:VOICE1', { segmentId: 's0' })
    expect(cached).toBe(false)
    const onDisk = await fs.readFile(filePath)
    expect(onDisk.byteLength).toBe(fakeMp3.byteLength)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('returns the cached path on second call without re-fetching', async () => {
    const cacheDir = await mkTmp()
    const fakeMp3 = new Uint8Array([1, 2, 3, 4])
    const fetchFn = vi.fn(async () => new Response(fakeMp3, { status: 200 }))
    const tts = new ElevenLabsTTS({ apiKey: 'k', cacheDir, fetchFn: fetchFn as any })
    await tts.synthesize('Hi', 'elevenlabs:V', { segmentId: 's0' })
    const result = await tts.synthesize('Hi', 'elevenlabs:V', { segmentId: 's0' })
    expect(result.cached).toBe(true)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('throws ElevenLabs error on non-2xx', async () => {
    const cacheDir = await mkTmp()
    const fetchFn = vi.fn(async () => new Response('{"detail":"bad key"}', { status: 401 }))
    const tts = new ElevenLabsTTS({ apiKey: 'k', cacheDir, fetchFn: fetchFn as any })
    await expect(tts.synthesize('Hi', 'elevenlabs:V', { segmentId: 's0' })).rejects.toMatchObject({
      kind: 'ElevenLabs',
    })
  })

  it('reuses legacy cache files hashed without model id (v2 backward compat)', async () => {
    // Simulate a pre-existing legacy cache file: name = {segmentId}-{sha1(voiceRef|text)}.mp3
    const cacheDir = await mkTmp()
    const { createHash } = await import('node:crypto')
    const legacyHash = createHash('sha1').update('elevenlabs:V').update('|').update('Legacy hi').digest('hex').slice(0, 16)
    const legacyPath = join(cacheDir, `s-legacy-${legacyHash}.mp3`)
    await fs.writeFile(legacyPath, new Uint8Array([0xde, 0xad, 0xbe, 0xef]))

    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }))
    const tts = new ElevenLabsTTS({ apiKey: 'k', cacheDir, fetchFn: fetchFn as any })
    const r = await tts.synthesize('Legacy hi', 'elevenlabs:V', { segmentId: 's-legacy' })
    expect(r.cached).toBe(true)
    expect(r.filePath).toBe(legacyPath)
    // The legacy hit means no network call.
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('does not fall back to legacy hash when the current model is v3', async () => {
    const cacheDir = await mkTmp()
    const { createHash } = await import('node:crypto')
    const legacyHash = createHash('sha1').update('elevenlabs:V').update('|').update('X').digest('hex').slice(0, 16)
    await fs.writeFile(join(cacheDir, `s-x-${legacyHash}.mp3`), new Uint8Array([0]))
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }))
    const tts = new ElevenLabsTTS({
      apiKey: 'k',
      cacheDir,
      fetchFn: fetchFn as any,
      modelId: 'eleven_v3',
    })
    const r = await tts.synthesize('X', 'elevenlabs:V', { segmentId: 's-x' })
    // v3 request must NOT reuse a legacy v2 file — those clips sound like v2.
    expect(r.cached).toBe(false)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('produces distinct cache files when the model id changes', async () => {
    const cacheDir = await mkTmp()
    const fakeMp3 = new Uint8Array([0xaa, 0xbb, 0xcc])
    const fetchFn = vi.fn(async () => new Response(fakeMp3, { status: 200 }))
    const v2 = new ElevenLabsTTS({
      apiKey: 'k',
      cacheDir,
      fetchFn: fetchFn as any,
      modelId: 'eleven_multilingual_v2',
    })
    const v3 = new ElevenLabsTTS({
      apiKey: 'k',
      cacheDir,
      fetchFn: fetchFn as any,
      modelId: 'eleven_v3',
    })
    const a = await v2.synthesize('Same text', 'elevenlabs:V', { segmentId: 's0' })
    const b = await v3.synthesize('Same text', 'elevenlabs:V', { segmentId: 's0' })
    // Different model → different file, and the second call must not think it
    // was cached from the first.
    expect(a.filePath).not.toBe(b.filePath)
    expect(b.cached).toBe(false)
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('rejects voiceRefs that do not start with elevenlabs:', async () => {
    const cacheDir = await mkTmp()
    const tts = new ElevenLabsTTS({ apiKey: 'k', cacheDir, fetchFn: vi.fn() as any })
    await expect(tts.synthesize('Hi', 'system:default', { segmentId: 's0' })).rejects.toMatchObject({
      kind: 'ElevenLabs',
    })
  })
})
