import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { DeepcutsError } from '../../shared/errors'
import type { SynthesisResult, TTSProvider } from './TTSProvider'

export interface ElevenLabsTTSDeps {
  apiKey: string
  cacheDir: string
  fetchFn?: typeof fetch
  modelId?: string
}

export class ElevenLabsTTS implements TTSProvider {
  private apiKey: string
  private cacheDir: string
  private fetchFn: typeof fetch
  private modelId: string

  constructor(deps: ElevenLabsTTSDeps) {
    this.apiKey = deps.apiKey
    this.cacheDir = deps.cacheDir
    this.fetchFn = deps.fetchFn ?? fetch
    // v2 is the stable, consistent-sounding default. Callers who want v3
    // (audio-tag rendering, but different tonal character on the same voice
    // ID and known caveats for voice clones) must opt in explicitly, typically
    // via the per-host ttsModel field on the manifest.
    this.modelId = deps.modelId ?? 'eleven_multilingual_v2'
  }

  async synthesize(
    text: string,
    voiceRef: string,
    opts: { segmentId: string; modelId?: string },
  ): Promise<SynthesisResult> {
    if (!voiceRef.startsWith('elevenlabs:')) {
      throw new DeepcutsError('ElevenLabs', `ElevenLabs cannot handle voiceRef ${voiceRef}`)
    }
    const voiceId = voiceRef.slice('elevenlabs:'.length)
    // Per-call modelId override lets a single ElevenLabsTTS instance serve hosts
    // that pick different models (e.g. Oliver on v2, Roxy on v3).
    const effectiveModel = opts.modelId ?? this.modelId
    // Cache key mixes voiceRef + model + text so switching models (v2 ↔ v3) or
    // voices produces distinct files, and switching back reuses the earlier one.
    const hash = createHash('sha1')
      .update(voiceRef)
      .update('|')
      .update(effectiveModel)
      .update('|')
      .update(text)
      .digest('hex')
      .slice(0, 16)
    const filePath = join(this.cacheDir, `${opts.segmentId}-${hash}.mp3`)

    try {
      await fs.access(filePath)
      return { filePath, cached: true }
    } catch { /* not cached under current key */ }

    // Legacy fallback: files cached before modelId was mixed into the hash used
    // sha1(voiceRef | text). Those clips were all rendered under the v2 default
    // (the only model then), so a v2 request today can safely reuse them.
    if (effectiveModel === 'eleven_multilingual_v2') {
      const legacyHash = createHash('sha1')
        .update(voiceRef)
        .update('|')
        .update(text)
        .digest('hex')
        .slice(0, 16)
      if (legacyHash !== hash) {
        const legacyPath = join(this.cacheDir, `${opts.segmentId}-${legacyHash}.mp3`)
        try {
          await fs.access(legacyPath)
          return { filePath: legacyPath, cached: true }
        } catch { /* no legacy file either */ }
      }
    }

    await fs.mkdir(this.cacheDir, { recursive: true })

    let res: Response
    try {
      res = await this.fetchFn(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'content-type': 'application/json',
          accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: effectiveModel,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      })
    } catch (err: any) {
      throw new DeepcutsError('ElevenLabs', 'ElevenLabs request failed.', err?.message ?? String(err))
    }

    if (!res.ok) {
      let body = ''
      try { body = await res.text() } catch (e) { body = `<failed to read body: ${(e as Error).message}>` }
      const headerLines: string[] = []
      res.headers.forEach((value, key) => {
        const lower = key.toLowerCase()
        if (lower.startsWith('x-') || lower === 'content-type' || lower === 'www-authenticate') {
          headerLines.push(`${key}: ${value}`)
        }
      })
      const detail = [
        `HTTP ${res.status} ${res.statusText || ''}`.trim(),
        headerLines.length ? `Headers:\n${headerLines.join('\n')}` : '',
        body ? `Body:\n${body}` : 'Body: (empty)',
      ].filter(Boolean).join('\n\n').slice(0, 2000)
      console.error('[ElevenLabs]', detail)
      throw new DeepcutsError('ElevenLabs', `ElevenLabs API ${res.status}`, detail)
    }

    const buf = Buffer.from(await res.arrayBuffer())
    await fs.writeFile(filePath, buf)
    return { filePath, cached: false }
  }
}
