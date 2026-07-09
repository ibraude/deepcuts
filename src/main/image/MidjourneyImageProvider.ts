import type { ImageGenerationInput, ImageGenerationResult, ImageProvider } from './ImageProvider'

export class MidjourneyImageProvider implements ImageProvider {
  readonly id = 'midjourney' as const
  async generateImage(_input: ImageGenerationInput, _signal?: AbortSignal): Promise<ImageGenerationResult> {
    throw new Error('MidJourney image provider not yet implemented.')
  }
}
