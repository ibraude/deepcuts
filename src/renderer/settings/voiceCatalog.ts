export interface ElevenLabsVoiceOption {
  id: string
  name: string
  blurb: string
  requiresPaidTier?: boolean
}

// Voices confirmed available on ElevenLabs' free-tier API as of June 2026.
// Most "premade" voices (Rachel, Adam, Antoni, Bella, Sam, etc.) have been moved
// into the voice library and now require a paid plan to use via the API.
// To add more here, verify in your ElevenLabs dashboard that the voice ID is in
// the default voices set.
export const ELEVENLABS_VOICES: ElevenLabsVoiceOption[] = [
  { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', blurb: 'warm documentary narrator' },
  { id: 'SAz9YHcvj6GT2YYXdXww', name: 'River', blurb: 'confident, distinctive' },
  { id: 'bIHbv24MWmeRgasZH58o', name: 'Will', blurb: 'friendly male, conversational' },
  { id: 'NFG5qt843uXKj4pFvR7C', name: 'House narrator', blurb: 'paid tier only', requiresPaidTier: true },
  { id: 'uju3wxzG5OhpWcoi3SMy', name: 'Michael C. Vincent', blurb: 'paid tier only', requiresPaidTier: true },
]

const KEY = 'deepcuts.userVoiceRef.v1'

export function loadUserVoiceRef(): string | null {
  const v = localStorage.getItem(KEY)
  return v && v.length > 0 ? v : null
}

export function saveUserVoiceRef(voiceRef: string | null): void {
  if (voiceRef === null) localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, voiceRef)
}
