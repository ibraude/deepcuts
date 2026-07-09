import { describe, expect, it } from 'vitest'
import { GeminiProvider } from './GeminiProvider'
import { resolveTrack } from './songResolver'

/**
 * Integration test that hits real APIs (Gemini with web search → fallback to
 * iTunes / Odesli / Deezer). Verifies the resolver returns a valid Spotify URI
 * for a handful of canonical catalog tracks that the old iTunes/Odesli chain
 * was failing on (Bowie, Harrison, Drake remasters).
 *
 * Skipped by default. To run:
 *   VERTEX_PROJECT=your-project VERTEX_LOCATION=global INTEGRATION=1 npm test -- songResolver.integration
 *
 * Requires either:
 *   - `gcloud auth application-default login` (ADC) — recommended, OR
 *   - VERTEX_SERVICE_ACCOUNT_JSON set to the full service account JSON string
 */

const enabled = process.env.INTEGRATION === '1' && !!process.env.VERTEX_PROJECT

const SPOTIFY_URI_RE = /^spotify:track:[A-Za-z0-9]{22}$/

const TEST_CASES: Array<{ title: string; artist: string; searchHint?: string }> = [
  { title: 'Space Oddity', artist: 'David Bowie', searchHint: '1969 original' },
  { title: 'My Sweet Lord', artist: 'George Harrison', searchHint: 'All Things Must Pass 1970' },
  { title: 'Solid Air', artist: 'John Martyn', searchHint: '1973 album version' },
  { title: 'Pink Moon', artist: 'Nick Drake' },
]

describe.skipIf(!enabled)('songResolver integration', () => {
  const project = process.env.VERTEX_PROJECT!
  const location = process.env.VERTEX_LOCATION ?? 'global'
  const serviceAccountJson = process.env.VERTEX_SERVICE_ACCOUNT_JSON
  const credentials = serviceAccountJson
    ? (JSON.parse(serviceAccountJson) as {
        client_email: string
        private_key: string
        project_id?: string
      })
    : undefined

  const provider = new GeminiProvider({
    vertex: { project, location, credentials },
    modelId: process.env.VERTEX_MODEL ?? 'gemini-2.5-pro',
  })

  for (const tc of TEST_CASES) {
    it(`resolves "${tc.title}" by ${tc.artist} to a valid Spotify URI`, async () => {
      const spotifyUriFinder = (title: string, artist: string, searchHint: string | undefined) =>
        provider.findSpotifyUri(title, artist, searchHint, undefined)
      const result = await resolveTrack(
        { title: tc.title, artist: tc.artist, searchHint: tc.searchHint },
        { spotifyUriFinder },
      )
      // eslint-disable-next-line no-console
      console.log(`  → ${tc.title} resolved to ${result.spotifyUri}`)
      expect(result.spotifyUri).toMatch(SPOTIFY_URI_RE)
      expect(result.resolved.title.length).toBeGreaterThan(0)
      expect(result.resolved.artist.length).toBeGreaterThan(0)
    }, 60_000)
  }
})
