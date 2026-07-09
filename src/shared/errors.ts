export type DeepcutsErrorKind =
  | 'AutomationConsentDenied'
  | 'SpotifyNotInstalled'
  | 'SpotifyNotPlaying'
  | 'AppleScript'
  | 'ElevenLabs'
  | 'Keychain'
  | 'Unknown'

export class DeepcutsError extends Error {
  readonly kind: DeepcutsErrorKind
  readonly detail?: string

  constructor(kind: DeepcutsErrorKind, message: string, detail?: string) {
    super(message)
    this.name = 'DeepcutsError'
    this.kind = kind
    this.detail = detail
  }
}

export interface SerializableError {
  kind: DeepcutsErrorKind
  message: string
  detail?: string
}

export function toSerializable(err: unknown): SerializableError {
  if (err instanceof DeepcutsError) {
    return { kind: err.kind, message: err.message, detail: err.detail }
  }
  const message = err instanceof Error ? err.message : String(err)
  return { kind: 'Unknown', message }
}

export function fromSerializable(obj: SerializableError): DeepcutsError {
  return new DeepcutsError(obj.kind, obj.message, obj.detail)
}
