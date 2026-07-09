import { generateObject, generateText, NoObjectGeneratedError } from 'ai'
import { createVertex } from '@ai-sdk/google-vertex'

/** Quick existence check against Spotify's public track page. Real IDs return
 * HTTP 200; hallucinated 22-char strings return 404. Uses HEAD to avoid
 * downloading the page body. Times out fast — we'd rather skip verification
 * on a network blip than block resolution. */
async function verifySpotifyTrackId(trackId: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    const res = await fetch(`https://open.spotify.com/track/${trackId}`, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    })
    clearTimeout(timer)
    return res.status === 200
  } catch {
    // Network blip / timeout — give the model the benefit of the doubt.
    return true
  }
}
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildResearchPrompt,
  buildOutlinePrompt,
  buildScriptPromptFromOutline,
} from './prompts'
import { generatedManifestSchema, draftOutlineSchema, type DraftOutlineParsed } from './generationSchema'
import type { GenerationInput, GenerationResult, ScriptProvider } from './ScriptProvider'
import type { VertexConfig } from './vertexAuth'

export interface GeminiProviderConfig {
  vertex: VertexConfig
  modelId?: string
}

export class GeminiProvider implements ScriptProvider {
  readonly id = 'gemini' as const
  private vertex: VertexConfig
  private modelId: string

  constructor(config: GeminiProviderConfig) {
    this.vertex = config.vertex
    this.modelId = config.modelId || 'gemini-2.5-pro'
  }

  private vertexClient() {
    return createVertex({
      project: this.vertex.project,
      location: this.vertex.location,
      googleAuthOptions: this.vertex.credentials
        ? {
            credentials: {
              client_email: this.vertex.credentials.client_email,
              private_key: this.vertex.credentials.private_key,
            },
          }
        : undefined,
    })
  }

  private wrapGenerateObjectError(stepLabel: string, err: unknown): Error {
    if (NoObjectGeneratedError.isInstance(err)) {
      const rawText = err.text ?? '(no text)'
      const causeMessage = err.cause instanceof Error ? err.cause.message : String(err.cause ?? err.message)
      const truncated = rawText.length > 2000 ? rawText.slice(0, 2000) + '\n…' : rawText
      console.error(`[Gemini ${stepLabel}] schema mismatch`, { cause: causeMessage, rawText })
      return new Error(
        `${stepLabel}: model output did not match schema.\n\n${causeMessage}\n\nRaw model output:\n${truncated}`,
      )
    }
    return err instanceof Error ? err : new Error(String(err))
  }

  async generateManifest(input: GenerationInput, signal?: AbortSignal): Promise<GenerationResult> {
    const model = this.vertexClient()(this.modelId)
    void input.useSearch
    try {
      const result = await generateObject({
        model,
        schema: generatedManifestSchema,
        system: buildSystemPrompt(),
        prompt: buildUserPrompt(input),
        abortSignal: signal,
      })
      return { manifest: result.object }
    } catch (err) {
      throw this.wrapGenerateObjectError('generateManifest', err)
    }
  }

  async runResearch(input: GenerationInput, signal?: AbortSignal): Promise<{ markdown: string }> {
    const vertex = this.vertexClient()
    const model = vertex(this.modelId)
    const { system, prompt } = buildResearchPrompt(input.subject, input.hints)
    // @ai-sdk/google-vertex@5 moved web search from providerOptions.google.useSearchGrounding
    // (silently dropped in v5) to the tool registry: vertex.tools.googleSearch.
    const result = await generateText({
      model,
      system,
      prompt,
      abortSignal: signal,
      tools: input.useSearch ? { googleSearch: vertex.tools.googleSearch({}) } : undefined,
    })
    return { markdown: result.text }
  }

  async runOutline(
    subject: string,
    researchMarkdown: string,
    lengthMinutes: number | undefined,
    signal?: AbortSignal,
  ): Promise<{ outline: DraftOutlineParsed }> {
    const model = this.vertexClient()(this.modelId)
    const { system, prompt } = buildOutlinePrompt(subject, researchMarkdown, lengthMinutes)
    try {
      const result = await generateObject({
        model,
        schema: draftOutlineSchema,
        system,
        prompt,
        abortSignal: signal,
      })
      return { outline: result.object }
    } catch (err) {
      throw this.wrapGenerateObjectError('runOutline', err)
    }
  }

  async findSpotifyUri(
    title: string,
    artist: string,
    searchHint: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ spotifyUri: string; title: string; artist: string } | null> {
    const vertex = this.vertexClient()
    const model = vertex(this.modelId)
    const hint = searchHint ? ` — ${searchHint}` : ''
    // generateText + regex extraction. Google search grounding doesn't compose
    // cleanly with generateObject's structured-output enforcement on this model.
    const prompt = `Find the Spotify track URI for: "${title}" by ${artist}${hint}

Procedure:
1. First, search the web for the track's open.spotify.com page (try queries like \`site:open.spotify.com/track "${title}" "${artist}"\` and \`"${title}" "${artist}" spotify\`).
2. If search results contain a Spotify URL, use it.
3. If web search does NOT surface a Spotify URL but you know this track's canonical Spotify entry from your training knowledge (which covers most well-known tracks), answer from that knowledge.
4. Only reply NOT_FOUND if the song is obscure enough that you have no information at all from search OR training.

When multiple versions exist (remaster, live, demo, single), prefer the ORIGINAL studio recording from the artist's canonical album release — NOT the remaster.

Output format (strict):
- Reply with ONLY the URI or URL, no preamble, no explanation, no markdown.
- Acceptable examples:
  - spotify:track:3PqRZTAyQiK6Hg8mZdmGmM
  - https://open.spotify.com/track/3PqRZTAyQiK6Hg8mZdmGmM
- If you truly have no information: NOT_FOUND`
    try {
      const result = await generateText({
        model,
        prompt,
        abortSignal: signal,
        tools: { googleSearch: vertex.tools.googleSearch({}) },
      })
      const text = (result.text ?? '').trim()
      if (/^NOT[_\s]?FOUND/i.test(text)) {
        // eslint-disable-next-line no-console
        console.log(`[findSpotifyUri] not found: "${title}" by ${artist}`)
        return null
      }
      const idMatch =
        text.match(/spotify:track:([A-Za-z0-9]{22})/) ??
        text.match(/open\.spotify\.com\/track\/([A-Za-z0-9]{22})/)
      if (!idMatch) {
        // eslint-disable-next-line no-console
        console.warn(
          `[findSpotifyUri] could not extract URI from model reply for "${title}" by ${artist}. Raw text:\n${text.slice(0, 500)}`,
        )
        return null
      }
      const candidateId = idMatch[1]!
      // Hallucination guard: verify the URI actually exists on Spotify before
      // returning it. A real track ID returns HTTP 200 from open.spotify.com;
      // a hallucinated 22-char string returns 404.
      const verified = await verifySpotifyTrackId(candidateId)
      if (!verified) {
        // eslint-disable-next-line no-console
        console.warn(
          `[findSpotifyUri] model returned a URI that doesn't exist on Spotify (likely hallucination) for "${title}" by ${artist}: spotify:track:${candidateId}`,
        )
        return null
      }
      // eslint-disable-next-line no-console
      console.log(`[findSpotifyUri] resolved "${title}" by ${artist} → spotify:track:${candidateId}`)
      return {
        spotifyUri: `spotify:track:${candidateId}`,
        title,
        artist,
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[findSpotifyUri] threw for "${title}" by ${artist}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }

  async runScript(
    subject: string,
    researchMarkdown: string,
    outline: DraftOutlineParsed,
    lengthMinutes: number | undefined,
    useAudioTags: boolean | undefined,
    signal?: AbortSignal,
  ): Promise<GenerationResult> {
    const model = this.vertexClient()(this.modelId)
    const { system, prompt } = buildScriptPromptFromOutline(
      subject,
      researchMarkdown,
      outline,
      lengthMinutes,
      useAudioTags,
    )
    try {
      const result = await generateObject({
        model,
        schema: generatedManifestSchema,
        system,
        prompt,
        abortSignal: signal,
      })
      return { manifest: result.object }
    } catch (err) {
      throw this.wrapGenerateObjectError('runScript', err)
    }
  }
}
