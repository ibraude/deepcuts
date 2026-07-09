import { describe, expect, it, vi } from 'vitest'
import { NarrationPlayer } from './NarrationPlayer'

describe('NarrationPlayer tier selection', () => {
  it('uses segment.audio when present', async () => {
    const playAudio = vi.fn(async () => {})
    const elevenLabs = vi.fn(async () => ({ filePath: '/cache.mp3', cached: false }))
    const systemSpeak = vi.fn(() => ({ done: Promise.resolve(), cancel: () => {} }))
    const np = new NarrationPlayer({ playAudio, elevenLabs, systemSpeak })
    await np.play(
      { type: 'narration', id: 's0', hostId: 'h', text: 'Hi', audio: 'https://x/y.mp3' },
      'elevenlabs:V',
      { hasElevenLabsKey: true },
    ).done
    expect(playAudio).toHaveBeenCalledWith('https://x/y.mp3', expect.anything(), expect.any(Function))
    expect(elevenLabs).not.toHaveBeenCalled()
    expect(systemSpeak).not.toHaveBeenCalled()
  })

  it('uses ElevenLabs when no segment.audio and key present and voiceRef starts elevenlabs:', async () => {
    const playAudio = vi.fn(async () => {})
    const elevenLabs = vi.fn(async () => ({ filePath: '/cache.mp3', cached: false }))
    const systemSpeak = vi.fn(() => ({ done: Promise.resolve(), cancel: () => {} }))
    const np = new NarrationPlayer({ playAudio, elevenLabs, systemSpeak })
    await np.play(
      { type: 'narration', id: 's0', hostId: 'h', text: 'Hi' },
      'elevenlabs:V',
      { hasElevenLabsKey: true },
    ).done
    expect(elevenLabs).toHaveBeenCalledWith('Hi', 'elevenlabs:V', 's0', undefined)
    expect(playAudio).toHaveBeenCalledWith('file:///cache.mp3', expect.anything(), expect.any(Function))
    expect(systemSpeak).not.toHaveBeenCalled()
  })

  it('falls back to SystemTTS when no key, even if voiceRef is elevenlabs', async () => {
    const playAudio = vi.fn(async () => {})
    const elevenLabs = vi.fn()
    const systemSpeak = vi.fn(() => ({ done: Promise.resolve(), cancel: () => {} }))
    const np = new NarrationPlayer({ playAudio, elevenLabs, systemSpeak })
    await np.play(
      { type: 'narration', id: 's0', hostId: 'h', text: 'Hi' },
      'elevenlabs:V',
      { hasElevenLabsKey: false },
    ).done
    expect(systemSpeak).toHaveBeenCalledWith('Hi', expect.any(Function))
    expect(elevenLabs).not.toHaveBeenCalled()
  })

  it('falls back to SystemTTS when voiceRef is system:*', async () => {
    const playAudio = vi.fn(async () => {})
    const elevenLabs = vi.fn()
    const systemSpeak = vi.fn(() => ({ done: Promise.resolve(), cancel: () => {} }))
    const np = new NarrationPlayer({ playAudio, elevenLabs, systemSpeak })
    await np.play(
      { type: 'narration', id: 's0', hostId: 'h', text: 'Hi' },
      'system:default',
      { hasElevenLabsKey: true },
    ).done
    expect(systemSpeak).toHaveBeenCalled()
    expect(elevenLabs).not.toHaveBeenCalled()
  })

  it('falls back to SystemTTS when ElevenLabs throws', async () => {
    const playAudio = vi.fn(async () => {})
    const elevenLabs = vi.fn(async () => { throw new Error('boom') })
    const systemSpeak = vi.fn(() => ({ done: Promise.resolve(), cancel: () => {} }))
    const np = new NarrationPlayer({ playAudio, elevenLabs, systemSpeak })
    await np.play(
      { type: 'narration', id: 's0', hostId: 'h', text: 'Hi' },
      'elevenlabs:V',
      { hasElevenLabsKey: true },
    ).done
    expect(systemSpeak).toHaveBeenCalledWith('Hi', expect.any(Function))
  })

  it('cancel stops in-flight playback', async () => {
    let resolvePlay: () => void = () => {}
    const playAudio = vi.fn(() => new Promise<void>((r) => { resolvePlay = r }))
    const elevenLabs = vi.fn()
    const systemSpeak = vi.fn(() => ({ done: Promise.resolve(), cancel: () => {} }))
    const np = new NarrationPlayer({ playAudio, elevenLabs, systemSpeak })
    const handle = np.play(
      { type: 'narration', id: 's0', hostId: 'h', text: 'Hi', audio: 'https://x.mp3' },
      'elevenlabs:V',
      { hasElevenLabsKey: false },
    )
    handle.cancel()
    resolvePlay()
    await expect(handle.done).resolves.toBeUndefined()
  })
})
