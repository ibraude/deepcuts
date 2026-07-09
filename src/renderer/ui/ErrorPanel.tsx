import type { DeepcutsErrorKind } from '../../shared/errors'

interface ErrorPanelProps {
  kind: DeepcutsErrorKind
  message: string
  detail?: string
  onRetry?: () => void
  onDismiss?: () => void
}

export function ErrorPanel({ kind, message, detail, onRetry, onDismiss }: ErrorPanelProps) {
  const action = actionFor(kind)
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-8">
      <div className="bg-[var(--color-surface)] border border-[var(--color-hairline)] rounded-lg max-w-md w-full p-6 space-y-4">
        <div className="text-xs tracking-[0.2em] uppercase text-[var(--color-muted)]">{labelFor(kind)}</div>
        <div className="text-base">{message}</div>
        {action && (
          <button
            className="px-3 py-2 rounded-md bg-[var(--color-accent)]/15 text-[var(--color-accent)] text-sm hover:bg-[var(--color-accent)]/25 transition"
            onClick={() => window.deepcuts.shell.openExternal(action.url)}
          >
            {action.label}
          </button>
        )}
        {detail && (
          <details className="text-xs text-[var(--color-muted)] mt-2">
            <summary className="cursor-pointer">Details</summary>
            <pre className="whitespace-pre-wrap mt-1">{detail}</pre>
          </details>
        )}
        <div className="flex gap-2 pt-2">
          {onRetry && (
            <button onClick={onRetry} className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-hairline)] hover:bg-white/5">
              Try again
            </button>
          )}
          {onDismiss && (
            <button onClick={onDismiss} className="text-sm px-3 py-1.5 rounded-md hover:bg-white/5 text-[var(--color-muted)]">
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function labelFor(kind: DeepcutsErrorKind): string {
  switch (kind) {
    case 'AutomationConsentDenied': return 'Permission needed'
    case 'SpotifyNotInstalled': return 'Spotify required'
    case 'SpotifyNotPlaying': return 'Spotify not playing'
    case 'ElevenLabs': return 'Narration error'
    case 'Keychain': return 'Keychain error'
    case 'AppleScript': return 'Spotify control failed'
    default: return 'Something went wrong'
  }
}

function actionFor(kind: DeepcutsErrorKind): { label: string; url: string } | null {
  switch (kind) {
    case 'AutomationConsentDenied':
      return {
        label: 'Open Privacy & Security → Automation',
        url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
      }
    case 'SpotifyNotInstalled':
      return { label: 'Download Spotify', url: 'https://www.spotify.com/download' }
    default:
      return null
  }
}
