import type { GeneratedManifest, DraftOutlineParsed } from './generationSchema'

export type ProviderId = 'gemini' | 'claude' | 'openai'

export interface GenerationInput {
  subject: string
  hints?: string
  lengthMinutes?: number
  useSearch: boolean
  /** When true, the script prompt teaches the model to weave ElevenLabs v3
   * audio tags ([pause], [thoughtfully], etc.) into narration text. Only
   * enable when the hosts using those narrations are on the v3 TTS model —
   * v2 reads tags aloud as literal words. */
  useAudioTags?: boolean
}

export interface GenerationResult {
  manifest: GeneratedManifest
}

export interface ScriptProvider {
  id: ProviderId

  /** Single-shot full generation (Spec A flow — kept for backwards compatibility). */
  generateManifest(input: GenerationInput, signal?: AbortSignal): Promise<GenerationResult>

  /** Spec C — Step 1: research with web search. Returns markdown. */
  runResearch(input: GenerationInput, signal?: AbortSignal): Promise<{ markdown: string }>

  /** Spec C — Step 2: outline from research. lengthMinutes scales depth. */
  runOutline(
    subject: string,
    researchMarkdown: string,
    lengthMinutes: number | undefined,
    signal?: AbortSignal,
  ): Promise<{ outline: DraftOutlineParsed }>

  /** Spec C — Step 3: full script from outline + research. lengthMinutes scales depth. */
  runScript(
    subject: string,
    researchMarkdown: string,
    outline: DraftOutlineParsed,
    lengthMinutes: number | undefined,
    useAudioTags: boolean | undefined,
    signal?: AbortSignal,
  ): Promise<GenerationResult>

  /** Find a Spotify track URI via web search. Returns null if no confident match.
   * Used by the song resolver as the primary lookup — catalog-aware (handles
   * "prefer original over remaster" reasoning) and not dependent on Odesli's
   * Apple Music ↔ Spotify mapping, which is sparse for remasters. */
  findSpotifyUri(
    title: string,
    artist: string,
    searchHint: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ spotifyUri: string; title: string; artist: string } | null>
}
