import { GoogleAuth } from 'google-auth-library'

export interface VertexConfig {
  project: string
  location: string
  /** Parsed service account JSON, or null/undefined to use ADC */
  credentials?: {
    client_email: string
    private_key: string
    project_id?: string
  } | null
}

export function parseServiceAccountJson(raw: string): VertexConfig['credentials'] {
  if (!raw.trim()) return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch (e) {
    throw new Error('Invalid service account JSON: ' + (e instanceof Error ? e.message : 'parse error'))
  }
  const clientEmail = typeof parsed.client_email === 'string' ? parsed.client_email : null
  const privateKey = typeof parsed.private_key === 'string' ? parsed.private_key : null
  if (!clientEmail || !privateKey) {
    throw new Error('Service account JSON is missing client_email or private_key.')
  }
  return {
    client_email: clientEmail,
    private_key: privateKey,
    project_id: typeof parsed.project_id === 'string' ? parsed.project_id : undefined,
  }
}

export function makeGoogleAuth(credentials?: VertexConfig['credentials']): GoogleAuth {
  if (credentials) {
    return new GoogleAuth({
      credentials: {
        client_email: credentials.client_email,
        private_key: credentials.private_key,
      },
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
  }
  return new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  })
}

export async function getAccessToken(auth: GoogleAuth): Promise<string> {
  const client = await auth.getClient()
  const token = await client.getAccessToken()
  if (!token?.token) {
    throw new Error(
      'Failed to obtain a Google Cloud access token. If you have not pasted a service account JSON, ensure you have run `gcloud auth application-default login` on this machine.',
    )
  }
  return token.token
}

export function vertexEndpoint(config: VertexConfig, model: string, method: 'generateContent' | 'predict'): string {
  // Global location uses the unprefixed aiplatform.googleapis.com host.
  // Regional locations use {location}-aiplatform.googleapis.com.
  const host =
    config.location === 'global'
      ? 'aiplatform.googleapis.com'
      : `${config.location}-aiplatform.googleapis.com`
  return `https://${host}/v1/projects/${config.project}/locations/${config.location}/publishers/google/models/${model}:${method}`
}
