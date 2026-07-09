export type ImageProviderId = 'gemini' | 'openai' | 'midjourney'

export interface ImageGenerationInput {
  prompt: string
  aspect?: 'square' | '16:9' | '9:16'
}

export interface ImageGenerationResult {
  bytes: Uint8Array
  mimeType: string
}

export interface ImageProvider {
  id: ImageProviderId
  generateImage(input: ImageGenerationInput, signal?: AbortSignal): Promise<ImageGenerationResult>
}
