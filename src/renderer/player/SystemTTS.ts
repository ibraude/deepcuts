export type VoiceQuality = 'premium' | 'enhanced' | 'standard' | 'fallback' | 'none'

const PREMIUM_NAMES = ['Ava', 'Zoe', 'Joelle', 'Evan', 'Nathan', 'Noelle']

export interface VoicePick {
  voice: SpeechSynthesisVoice | null
  quality: VoiceQuality
}

export class SystemTTS {
  static async listVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
    const synth = window.speechSynthesis
    let voices = synth.getVoices()
    if (voices.length > 0) return voices
    await new Promise<void>((resolve) => {
      const onChange = () => {
        synth.removeEventListener('voiceschanged', onChange)
        resolve()
      }
      synth.addEventListener('voiceschanged', onChange)
      setTimeout(() => {
        synth.removeEventListener('voiceschanged', onChange)
        resolve()
      }, timeoutMs)
    })
    voices = synth.getVoices()
    return voices
  }

  static pickBestVoice(voices: SpeechSynthesisVoice[]): VoicePick {
    if (voices.length === 0) return { voice: null, quality: 'none' }
    const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
    const pool = english.length > 0 ? english : voices

    const premium = pool.find((v) => /\(Premium\)/i.test(v.name))
    if (premium) return { voice: premium, quality: 'premium' }
    const enhanced = pool.find((v) => /\(Enhanced\)/i.test(v.name))
    if (enhanced) return { voice: enhanced, quality: 'enhanced' }
    const known = pool.find((v) => PREMIUM_NAMES.some((n) => v.name === n || v.name.startsWith(`${n} `)))
    if (known) return { voice: known, quality: 'standard' }
    const samantha = pool.find((v) => v.name === 'Samantha')
    if (samantha) return { voice: samantha, quality: 'standard' }
    return { voice: pool[0]!, quality: 'fallback' }
  }

  private voice: SpeechSynthesisVoice | null = null
  private rate = 0.95

  setVoice(voice: SpeechSynthesisVoice | null) {
    this.voice = voice
  }

  setRate(rate: number) {
    this.rate = Math.max(0.5, Math.min(1.5, rate))
  }

  speak(
    text: string,
    onBoundary?: (charIndex: number, charLength: number) => void,
  ): { done: Promise<void>; cancel: () => void } {
    const synth = window.speechSynthesis
    const utterance = new SpeechSynthesisUtterance(text)
    if (this.voice) utterance.voice = this.voice
    utterance.rate = this.rate
    utterance.pitch = 1
    utterance.volume = 1

    if (onBoundary) {
      utterance.onboundary = (e) => {
        if (e.name === 'word' || e.name === undefined) {
          onBoundary(e.charIndex, e.charLength ?? 0)
        }
      }
    }

    let cancelled = false
    let safety: ReturnType<typeof setTimeout> | null = null
    const done = new Promise<void>((resolve, reject) => {
      utterance.onend = () => {
        if (safety) clearTimeout(safety)
        resolve()
      }
      utterance.onerror = (e) => {
        if (safety) clearTimeout(safety)
        if (cancelled) resolve()
        else reject(new Error(`SpeechSynthesis error: ${e.error ?? 'unknown'}`))
      }
      const seconds = Math.max(10, text.length / 8)
      safety = setTimeout(() => resolve(), seconds * 1000)
    })
    synth.cancel()
    synth.speak(utterance)

    return {
      done,
      cancel: () => {
        cancelled = true
        synth.cancel()
      },
    }
  }
}
