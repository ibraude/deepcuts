import type { ImageGenerationInput, ImageGenerationResult, ImageProvider } from './ImageProvider'

export class OpenAIImageProvider implements ImageProvider {
  readonly id = 'openai' as const
  async generateImage(_input: ImageGenerationInput, _signal?: AbortSignal): Promise<ImageGenerationResult> {
    throw new Error('OpenAI image provider not yet implemented.')
  }
}
