import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DeepcutsError } from '../../shared/errors'
import type { CurrentTrack, MusicProvider, PlayerState } from './MusicProvider'

const execFileAsync = promisify(execFile)

// Real Spotify track IDs are exactly 22 base62 characters. Placeholders like
// "UNRESOLVED1" technically match a looser /[A-Za-z0-9]+/, so we anchor the
// length precisely — that's what catches unresolved tracks at the boundary.
const SPOTIFY_URI_RE = /^spotify:track:[A-Za-z0-9]{22}$/
const SPOTIFY_ID_PREFIXED_RE = /(?:spotify:track:|open\.spotify\.com\/track\/)([A-Za-z0-9]+)/
const SPOTIFY_BARE_ID_RE = /^[A-Za-z0-9]{22}$/

// Spotify's AppleScript dictionary exposes two track-identifier properties:
//   - `id of theTrack`      → typically "spotify:track:XXX" (URI form),
//                              but observed as a bare 22-char base62 ID on some versions
//   - `spotify url of theTrack` → "https://open.spotify.com/track/XXX" (HTTPS form)
// We accept any of these and emit the canonical URI form so callers can compare
// with the exact string they passed to play().
function normalizeToSpotifyUri(...candidates: string[]): string {
  for (const c of candidates) {
    const m = c.match(SPOTIFY_ID_PREFIXED_RE)
    if (m) return `spotify:track:${m[1]}`
  }
  for (const c of candidates) {
    if (SPOTIFY_BARE_ID_RE.test(c)) return `spotify:track:${c}`
  }
  return candidates[0] ?? ''
}
const TCC_PATTERNS = [
  /Not authorized to send Apple events/i,
  /-1743/,
]
const APP_MISSING_PATTERNS = [
  /Application can't be found/i,
  /-10814/,
]

export interface OsascriptResult {
  stdout: string
  stderr: string
  code: number
}

export interface AppleScriptSpotifyDeps {
  runOsascript?: (args: string[]) => Promise<OsascriptResult>
}

async function defaultRun(args: string[]): Promise<OsascriptResult> {
  try {
    const { stdout, stderr } = await execFileAsync('osascript', args, { timeout: 5000 })
    return { stdout, stderr, code: 0 }
  } catch (err: any) {
    return {
      stdout: err?.stdout ?? '',
      stderr: err?.stderr ?? String(err?.message ?? err),
      code: typeof err?.code === 'number' ? err.code : 1,
    }
  }
}

function osa(...lines: string[]): string[] {
  return ['-e', lines.join('\n')]
}

function classifyError(stderr: string): DeepcutsError {
  if (TCC_PATTERNS.some((re) => re.test(stderr))) {
    return new DeepcutsError(
      'AutomationConsentDenied',
      'macOS has not granted Deepcuts permission to control Spotify.',
      stderr,
    )
  }
  if (APP_MISSING_PATTERNS.some((re) => re.test(stderr))) {
    return new DeepcutsError(
      'SpotifyNotInstalled',
      'Spotify desktop app was not found on this Mac.',
      stderr,
    )
  }
  return new DeepcutsError('AppleScript', 'AppleScript call failed.', stderr.trim())
}

export class AppleScriptSpotify implements MusicProvider {
  private run: (args: string[]) => Promise<OsascriptResult>

  constructor(deps: AppleScriptSpotifyDeps = {}) {
    this.run = deps.runOsascript ?? defaultRun
  }

  async isAvailable(): Promise<boolean> {
    const probe = await this.run(
      osa(
        'try',
        '  tell application "Finder" to get application file id "com.spotify.client"',
        '  return "yes"',
        'on error',
        '  return "no"',
        'end try',
      ),
    )
    return probe.stdout.trim() === 'yes'
  }

  async ensureReady(): Promise<void> {
    await this.callExpectingOk(
      osa('tell application "Spotify" to activate'),
    )
    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      try {
        await this.getState()
        return
      } catch {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
  }

  async play(trackUri: string): Promise<void> {
    if (!SPOTIFY_URI_RE.test(trackUri)) {
      throw new DeepcutsError('AppleScript', `Invalid Spotify track URI: ${trackUri}`)
    }
    // Disable shuffle and repeat before playing. With shuffle on, Spotify accepts
    // `play track URI` but then immediately advances to a random track from the
    // active context. Wrapped in `try` so older Spotify versions that don't expose
    // these properties don't break the play command.
    //
    // Do NOT `pause` before `play track "URI"`. Reproduced 2026-07-10: with a
    // pause in the same tell-block, Spotify plays the NEXT track in its active
    // context (e.g. the next album track) instead of the requested URI. Without
    // the pause, `play track` correctly plays the URI regardless of prior state.
    await this.callExpectingOk(
      osa(
        'tell application "Spotify"',
        '  try',
        '    set shuffling to false',
        '  end try',
        '  try',
        '    set repeating to false',
        '  end try',
        `  play track "${trackUri}"`,
        'end tell',
      ),
    )
  }

  async pause(): Promise<void> {
    await this.callExpectingOk(osa('tell application "Spotify" to pause'))
  }

  async getPosition(): Promise<number> {
    const out = await this.callExpectingStdout(
      osa('tell application "Spotify" to get player position'),
    )
    const n = Number.parseFloat(out)
    if (Number.isNaN(n)) throw new DeepcutsError('AppleScript', `Could not parse position: ${out}`)
    return n
  }

  async getState(): Promise<PlayerState> {
    const out = (await this.callExpectingStdout(
      osa('tell application "Spotify" to get player state as string'),
    )).trim().toLowerCase()
    if (out === 'playing' || out === 'paused' || out === 'stopped') return out
    throw new DeepcutsError('AppleScript', `Unexpected player state: ${out}`)
  }

  async getDuration(): Promise<number> {
    const out = await this.callExpectingStdout(
      osa('tell application "Spotify" to get duration of current track'),
    )
    const raw = Number.parseFloat(out.trim())
    if (Number.isNaN(raw)) throw new DeepcutsError('AppleScript', `Could not parse duration: ${out}`)
    // Spotify's AppleScript dictionary returns duration in milliseconds.
    // Defensive: anything ≥ 1000 is treated as ms; smaller values are already seconds.
    return raw >= 1000 ? raw / 1000 : raw
  }

  async getCurrentTrack(): Promise<CurrentTrack> {
    const out = (await this.callExpectingStdout(
      osa(
        'tell application "Spotify"',
        '  set theTrack to current track',
        '  set theId to id of theTrack',
        '  set theUri to spotify url of theTrack',
        '  set theName to name of theTrack',
        '  set theArtist to artist of theTrack',
        '  return theId & "|" & theUri & "|" & theName & "|" & theArtist',
        'end tell',
      ),
    )).trim()
    const parts = out.split('|')
    const rawId = parts[0] ?? ''
    const rawUri = parts[1] ?? ''
    const normalized = normalizeToSpotifyUri(rawId, rawUri)
    const name = parts[2]
    const artist = parts[3]
    return { id: rawId, uri: normalized, name, artist }
  }

  async getVolume(): Promise<number> {
    const out = await this.callExpectingStdout(
      osa('tell application "Spotify" to get sound volume'),
    )
    const n = Number.parseFloat(out.trim())
    if (Number.isNaN(n)) throw new DeepcutsError('AppleScript', `Could not parse volume: ${out}`)
    return Math.max(0, Math.min(100, n))
  }

  async setVolume(pct: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)))
    await this.callExpectingOk(
      osa(`tell application "Spotify" to set sound volume to ${clamped}`),
    )
  }

  private async callExpectingOk(args: string[]): Promise<void> {
    const { stderr, code } = await this.run(args)
    if (code !== 0 || stderr) {
      if (stderr) throw classifyError(stderr)
      throw new DeepcutsError('AppleScript', `osascript exited ${code}`)
    }
  }

  private async callExpectingStdout(args: string[]): Promise<string> {
    const { stdout, stderr, code } = await this.run(args)
    if (code !== 0 || stderr) {
      if (stderr) throw classifyError(stderr)
      throw new DeepcutsError('AppleScript', `osascript exited ${code}`)
    }
    return stdout
  }
}
