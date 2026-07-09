import type { ImageGenerationInput, ImageGenerationResult, ImageProvider } from './ImageProvider'
import { getAccessToken, makeGoogleAuth, vertexEndpoint, type VertexConfig } from '../generation/vertexAuth'

export interface GeminiImageProviderConfig {
  vertex: VertexConfig
  modelId?: string
  fetchFn?: typeof fetch
}

function base64ToBytes(b64: string): Uint8Array {
  const buf = Buffer.from(b64, 'base64')
  return new Uint8Array(buf)
}

function aspectInstruction(aspect: ImageGenerationInput['aspect']): string {
  switch (aspect) {
    case '16:9':
      return ' Widescreen 16:9 cover art.'
    case '9:16':
      return ' Vertical 9:16 cover art.'
    case 'square':
    default:
      return ' Square cover art.'
  }
}

function aspectRatioForImagen(aspect: ImageGenerationInput['aspect']): string {
  switch (aspect) {
    case '16:9':
      return '16:9'
    case '9:16':
      return '9:16'
    case 'square':
    default:
      return '1:1'
  }
}

export class GeminiImageProvider implements ImageProvider {
  readonly id = 'gemini' as const
  private vertex: VertexConfig
  private modelId: string
  private fetchFn: typeof fetch

  constructor(config: GeminiImageProviderConfig) {
    this.vertex = config.vertex
    this.modelId = config.modelId || 'gemini-2.5-flash-image-preview'
    this.fetchFn = config.fetchFn ?? fetch
  }

  async generateImage(
    input: ImageGenerationInput,
    signal?: AbortSignal,
  ): Promise<ImageGenerationResult> {
    const auth = makeGoogleAuth(this.vertex.credentials)
    const token = await getAccessToken(auth)
    // Imagen models use :predict with instances/parameters body.
    // Gemini image models use :generateContent with contents/parts body.
    const isImagen = this.modelId.startsWith('imagen-')
    if (isImagen) {
      return this.callImagen(input, token, signal)
    }
    return this.callGeminiImage(input, token, signal)
  }

  private async callGeminiImage(
    input: ImageGenerationInput,
    token: string,
    signal?: AbortSignal,
  ): Promise<ImageGenerationResult> {
    const url = vertexEndpoint(this.vertex, this.modelId, 'generateContent')
    const promptText = input.prompt + aspectInstruction(input.aspect)
    const body = {
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) {
      let detail = ''
      try { detail = await res.text() } catch {}
      throw new Error(`Vertex image API ${res.status}: ${detail.slice(0, 600)}`)
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; text?: string }> } }>
      error?: { message?: string; status?: string }
    }
    if (data.error) {
      throw new Error(`Vertex image API error: ${data.error.message ?? data.error.status ?? 'unknown'}`)
    }
    const parts = data.candidates?.[0]?.content?.parts ?? []
    const imagePart = parts.find((p) => p.inlineData?.data)
    if (!imagePart?.inlineData?.data) {
      const textPart = parts.find((p) => p.text)
      const note = textPart?.text ? ` Model returned text instead: "${textPart.text.slice(0, 200)}"` : ''
      throw new Error(`Vertex image API returned no image.${note}`)
    }
    return {
      bytes: base64ToBytes(imagePart.inlineData.data),
      mimeType: imagePart.inlineData.mimeType || 'image/png',
    }
  }

  private async callImagen(
    input: ImageGenerationInput,
    token: string,
    signal?: AbortSignal,
  ): Promise<ImageGenerationResult> {
    const url = vertexEndpoint(this.vertex, this.modelId, 'predict')
    const body = {
      instances: [{ prompt: input.prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: aspectRatioForImagen(input.aspect),
      },
    }
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    })
    if (!res.ok) {
      let detail = ''
      try { detail = await res.text() } catch {}
      throw new Error(`Imagen API ${res.status}: ${detail.slice(0, 600)}`)
    }
    const data = (await res.json()) as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>
      error?: { message?: string; status?: string }
    }
    if (data.error) {
      throw new Error(`Imagen API error: ${data.error.message ?? data.error.status ?? 'unknown'}`)
    }
    const pred = data.predictions?.[0]
    if (!pred?.bytesBase64Encoded) {
      throw new Error('Imagen API returned no image bytes.')
    }
    return {
      bytes: base64ToBytes(pred.bytesBase64Encoded),
      mimeType: pred.mimeType || 'image/png',
    }
  }
}
