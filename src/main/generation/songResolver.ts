export interface SongRequest {
  title: string
  artist: string
  searchHint?: string
}

export interface ResolvedSong {
  spotifyUri: string
  resolved: { title: string; artist: string }
}

export interface ResolverDeps {
  fetchFn?: typeof fetch
  /** Primary lookup: an LLM-driven web search that finds the canonical Spotify
   * URI for a track. When provided, this runs first because it handles catalog
   * version disambiguation (original vs remaster) far better than the
   * iTunes/Odesli/Deezer chain, which is blind to such distinctions. */
  spotifyUriFinder?: (
    title: string,
    artist: string,
    searchHint: string | undefined,
  ) => Promise<{ spotifyUri: string; title: string; artist: string } | null>
}

interface ITunesResult {
  trackId: number
  trackName: string
  artistName: string
  trackViewUrl: string
}

const SPOTIFY_TRACK_URL_RE = /open\.spotify\.com\/track\/([A-Za-z0-9]+)/

const REMASTER_SUFFIX_RE =
  /\s*[\[\(][^\]\)]*(remaster|remastered|remix|deluxe|expanded|anniversary|edition|edit|version|stereo|mono|alternate|live|demo)[^\]\)]*[\]\)]/gi

function cleanTrackName(name: string): string {
  return name.replace(REMASTER_SUFFIX_RE, '').trim()
}

async function searchITunes(
  terms: string,
  fetchFn: typeof fetch,
): Promise<ITunesResult | null> {
  const url =
    'https://itunes.apple.com/search?' +
    new URLSearchParams({ term: terms, entity: 'song', limit: '1' }).toString()
  const res = await fetchFn(url)
  if (!res.ok) throw new Error(`iTunes search HTTP ${res.status}`)
  const data = (await res.json()) as { resultCount: number; results: ITunesResult[] }
  return data.results?.[0] ?? null
}

interface OdesliShape {
  linksByPlatform?: { spotify?: { url?: string } }
  entitiesByUniqueId?: Record<string, { platforms?: string[]; id?: string }>
}

function extractSpotifyFromOdesli(data: OdesliShape): string | null {
  if (data.linksByPlatform?.spotify?.url) return data.linksByPlatform.spotify.url
  if (data.entitiesByUniqueId) {
    for (const key of Object.keys(data.entitiesByUniqueId)) {
      if (key.startsWith('SPOTIFY_SONG::')) {
        const id = key.slice('SPOTIFY_SONG::'.length)
        if (id) return `https://open.spotify.com/track/${id}`
      }
    }
  }
  return null
}

async function odesliLookupByItunesId(
  trackId: number,
  fetchFn: typeof fetch,
): Promise<string | null> {
  const url =
    'https://api.song.link/v1-alpha.1/links?' +
    new URLSearchParams({
      platform: 'itunes',
      type: 'song',
      id: String(trackId),
      userCountry: 'US',
    }).toString()
  const res = await fetchFn(url)
  if (!res.ok) return null
  return extractSpotifyFromOdesli((await res.json()) as OdesliShape)
}

async function odesliLookupByUrl(
  trackUrl: string,
  fetchFn: typeof fetch,
): Promise<string | null> {
  const url =
    'https://api.song.link/v1-alpha.1/links?' +
    new URLSearchParams({ url: trackUrl, userCountry: 'US' }).toString()
  const res = await fetchFn(url)
  if (!res.ok) return null
  return extractSpotifyFromOdesli((await res.json()) as OdesliShape)
}

interface DeezerResult {
  link: string
  title: string
  artist: { name: string }
}

async function searchDeezer(
  title: string,
  artist: string,
  fetchFn: typeof fetch,
): Promise<DeezerResult | null> {
  // Deezer's advanced query: track:"X" artist:"Y" — quoted to handle multi-word terms.
  const q = `track:"${title.replace(/"/g, '')}" artist:"${artist.replace(/"/g, '')}"`
  const url = 'https://api.deezer.com/search?' + new URLSearchParams({ q, limit: '1' }).toString()
  const res = await fetchFn(url)
  if (!res.ok) return null
  const data = (await res.json()) as { data?: DeezerResult[] }
  return data.data?.[0] ?? null
}

function spotifyUrlToUri(url: string): string | null {
  const m = url.match(SPOTIFY_TRACK_URL_RE)
  return m ? `spotify:track:${m[1]}` : null
}

export async function resolveTrack(
  req: SongRequest,
  deps: ResolverDeps = {},
): Promise<ResolvedSong> {
  const fetchFn = deps.fetchFn ?? fetch

  // Attempt 0 (PRIMARY): LLM-driven web search. This is the most reliable path
  // for canonical catalog tracks because the model can read Spotify URLs in
  // search results AND reason about which version (original vs remaster) to
  // pick. The iTunes/Odesli/Deezer chain below is kept as a free fallback.
  if (deps.spotifyUriFinder) {
    try {
      const found = await deps.spotifyUriFinder(req.title, req.artist, req.searchHint)
      if (found) {
        return {
          spotifyUri: found.spotifyUri,
          resolved: { title: found.title, artist: found.artist },
        }
      }
    } catch {
      // Fall through to the iTunes/Odesli/Deezer chain on any finder failure.
    }
  }

  // Attempt 1: full query with title + artist + optional searchHint
  const fullQuery = [req.artist, req.title, req.searchHint].filter(Boolean).join(' ')
  const first = await searchITunes(fullQuery, fetchFn)
  if (!first) {
    throw new Error(`no iTunes result for "${fullQuery}"`)
  }

  let spotifyUrl = await odesliLookupByItunesId(first.trackId, fetchFn)
  let resolvedFrom: ITunesResult = first

  // Attempt 2: if the first iTunes result has a remaster/remix suffix that Odesli
  // can't cross-link, retry with a cleaned title — Odesli usually has the canonical
  // release indexed even when the remaster URL isn't.
  if (!spotifyUrl) {
    const cleaned = cleanTrackName(first.trackName)
    const looksRemastered = cleaned.length > 0 && cleaned !== first.trackName
    if (looksRemastered) {
      const cleanQuery = [req.artist, cleaned].filter(Boolean).join(' ')
      const retry = await searchITunes(cleanQuery, fetchFn)
      if (retry && retry.trackId !== first.trackId) {
        const retryUrl = await odesliLookupByItunesId(retry.trackId, fetchFn)
        if (retryUrl) {
          spotifyUrl = retryUrl
          resolvedFrom = retry
        }
      }
    }
  }

  // Attempt 3: bare title + artist (drops searchHint) — sometimes the hint pins us
  // to a version Odesli doesn't have.
  if (!spotifyUrl && req.searchHint) {
    const bareQuery = [req.artist, req.title].filter(Boolean).join(' ')
    const retry = await searchITunes(bareQuery, fetchFn)
    if (retry && retry.trackId !== first.trackId) {
      const retryUrl = await odesliLookupByItunesId(retry.trackId, fetchFn)
      if (retryUrl) {
        spotifyUrl = retryUrl
        resolvedFrom = retry
      }
    }
  }

  // Attempt 4: Deezer fallback. iTunes only carries the official remasters for many
  // catalog artists (Bowie, Beatles, etc.) and Odesli's Apple Music → Spotify map
  // is sparse for those. Deezer often has the canonical/original recording, and
  // Odesli's Deezer → Spotify cross-link is more reliable.
  if (!spotifyUrl) {
    const cleanedTitle = cleanTrackName(req.title) || req.title
    const deezer = await searchDeezer(cleanedTitle, req.artist, fetchFn).catch(() => null)
    if (deezer?.link) {
      const deezerSpotify = await odesliLookupByUrl(deezer.link, fetchFn)
      if (deezerSpotify) {
        spotifyUrl = deezerSpotify
        resolvedFrom = {
          trackId: 0,
          trackName: deezer.title,
          artistName: deezer.artist.name,
          trackViewUrl: deezer.link,
        }
      }
    }
  }

  if (!spotifyUrl) {
    throw new Error(`no Spotify link from Odesli for "${first.trackName}"`)
  }

  const uri = spotifyUrlToUri(spotifyUrl)
  if (!uri) {
    throw new Error(`unrecognized Spotify URL: ${spotifyUrl}`)
  }

  return {
    spotifyUri: uri,
    resolved: { title: resolvedFrom.trackName, artist: resolvedFrom.artistName },
  }
}
