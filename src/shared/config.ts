const CONTENT_OWNER = 'ibraude'
const CONTENT_REPO = 'deepcuts'
const CONTENT_REF = 'main'

export const CONTENT_BASE_URL_DEFAULT =
  `https://cdn.jsdelivr.net/gh/${CONTENT_OWNER}/${CONTENT_REPO}@${CONTENT_REF}/content`

export function resolveContentBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.DEEPCUTS_CONTENT_BASE_URL?.trim()
  const url = override && override.length > 0 ? override : CONTENT_BASE_URL_DEFAULT
  return url.replace(/\/+$/, '')
}
