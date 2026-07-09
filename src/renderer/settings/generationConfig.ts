export type GenerationProviderId = 'gemini' | 'claude' | 'openai'

export interface GenerationConfig {
  providerId: GenerationProviderId
  modelId: string
  imageModelId: string
  /** GCP project ID — required for Vertex auth. */
  vertexProject: string
  /** GCP region for TEXT generation (e.g. us-central1, or 'global' for newest models like gemini-3.x). */
  vertexLocation: string
  /** GCP region for IMAGE generation. Imagen models are regional (no 'global'), so this defaults to us-central1. */
  vertexImageLocation: string
}

const KEY = 'deepcuts.generation.v1'
const DEFAULT: GenerationConfig = {
  providerId: 'gemini',
  modelId: 'gemini-2.5-pro',
  imageModelId: 'gemini-2.5-flash-image-preview',
  vertexProject: '',
  vertexLocation: 'us-central1',
  vertexImageLocation: 'us-central1',
}

export function loadGenerationConfig(): GenerationConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT
    const v = JSON.parse(raw) as Partial<GenerationConfig>
    return {
      providerId: (v.providerId as GenerationProviderId) ?? DEFAULT.providerId,
      modelId: typeof v.modelId === 'string' && v.modelId.length > 0 ? v.modelId : DEFAULT.modelId,
      imageModelId:
        typeof v.imageModelId === 'string' && v.imageModelId.length > 0
          ? v.imageModelId
          : DEFAULT.imageModelId,
      vertexProject:
        typeof v.vertexProject === 'string' ? v.vertexProject : DEFAULT.vertexProject,
      vertexLocation:
        typeof v.vertexLocation === 'string' && v.vertexLocation.length > 0
          ? v.vertexLocation
          : DEFAULT.vertexLocation,
      vertexImageLocation:
        typeof v.vertexImageLocation === 'string' && v.vertexImageLocation.length > 0
          ? v.vertexImageLocation
          : DEFAULT.vertexImageLocation,
    }
  } catch {
    return DEFAULT
  }
}

export function saveGenerationConfig(config: GenerationConfig): void {
  localStorage.setItem(KEY, JSON.stringify(config))
}

export const PROVIDER_OPTIONS: Array<{
  id: GenerationProviderId
  label: string
  defaultModelId: string
  helpText: string
}> = [
  {
    id: 'gemini',
    label: 'Gemini',
    defaultModelId: 'gemini-2.5-pro',
    helpText:
      'Create an API key at https://aistudio.google.com/app/apikey or in your GCP project. If your key is restricted to Vertex AI, fill in the Project ID + Location below to hit the Vertex endpoint.',
  },
  {
    id: 'claude',
    label: 'Claude (Anthropic) — coming soon',
    defaultModelId: 'claude-sonnet-4-6',
    helpText: 'Stub for future support.',
  },
  {
    id: 'openai',
    label: 'OpenAI — coming soon',
    defaultModelId: 'gpt-4o',
    helpText: 'Stub for future support.',
  },
]
