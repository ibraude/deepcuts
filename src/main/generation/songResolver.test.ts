import { describe, expect, it, vi } from 'vitest'
import { resolveTrack } from './songResolver'

describe('resolveTrack', () => {
  it('resolves via iTunes Search then Odesli (platform+id form)', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('itunes.apple.com')) {
        return new Response(
          JSON.stringify({
            resultCount: 1,
            results: [
              {
                trackId: 178050256,
                trackName: 'Visions of Johanna',
                artistName: 'Bob Dylan',
                trackViewUrl: 'https://music.apple.com/us/album/visions-of-johanna/...',
              },
            ],
          }),
          { status: 200 },
        )
      }
      if (url.includes('song.link') && url.includes('platform=itunes')) {
        return new Response(
          JSON.stringify({
            linksByPlatform: {
              spotify: { url: 'https://open.spotify.com/track/2rslQV48gNv3r9pPrQFPW1' },
            },
          }),
          { status: 200 },
        )
      }
      throw new Error('Unexpected fetch: ' + url)
    })
    const r = await resolveTrack(
      { title: 'Visions of Johanna', artist: 'Bob Dylan' },
      { fetchFn: fetchFn as any },
    )
    expect(r.spotifyUri).toBe('spotify:track:2rslQV48gNv3r9pPrQFPW1')
    expect(r.resolved.title).toBe('Visions of Johanna')
  })

  it('falls back to entitiesByUniqueId when linksByPlatform.spotify is missing', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('itunes.apple.com')) {
        return new Response(
          JSON.stringify({
            resultCount: 1,
            results: [
              { trackId: 1, trackName: 'X', artistName: 'Y', trackViewUrl: 'https://music.apple.com/x' },
            ],
          }),
          { status: 200 },
        )
      }
      return new Response(
        JSON.stringify({
          linksByPlatform: {},
          entitiesByUniqueId: {
            'SPOTIFY_SONG::abc123XYZ': { platforms: ['spotify'], id: 'abc123XYZ' },
          },
        }),
        { status: 200 },
      )
    })
    const r = await resolveTrack({ title: 'X', artist: 'Y' }, { fetchFn: fetchFn as any })
    expect(r.spotifyUri).toBe('spotify:track:abc123XYZ')
  })

  it('retries with a cleaned title when the first iTunes result is a remaster', async () => {
    let itunesCalls = 0
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('itunes.apple.com')) {
        itunesCalls++
        if (itunesCalls === 1) {
          return new Response(
            JSON.stringify({
              resultCount: 1,
              results: [
                {
                  trackId: 100,
                  trackName: 'Space Oddity (2015 Remaster)',
                  artistName: 'David Bowie',
                  trackViewUrl: 'https://music.apple.com/100',
                },
              ],
            }),
            { status: 200 },
          )
        }
        return new Response(
          JSON.stringify({
            resultCount: 1,
            results: [
              {
                trackId: 200,
                trackName: 'Space Oddity',
                artistName: 'David Bowie',
                trackViewUrl: 'https://music.apple.com/200',
              },
            ],
          }),
          { status: 200 },
        )
      }
      // Odesli — first id (remaster) has no Spotify; second id does.
      if (url.includes('id=100')) {
        return new Response(JSON.stringify({ linksByPlatform: {} }), { status: 200 })
      }
      if (url.includes('id=200')) {
        return new Response(
          JSON.stringify({
            linksByPlatform: { spotify: { url: 'https://open.spotify.com/track/ORIGspaceODD22chars000' } },
          }),
          { status: 200 },
        )
      }
      throw new Error('Unexpected fetch: ' + url)
    })
    const r = await resolveTrack(
      { title: 'Space Oddity', artist: 'David Bowie' },
      { fetchFn: fetchFn as any },
    )
    expect(r.spotifyUri).toBe('spotify:track:ORIGspaceODD22chars000')
    expect(r.resolved.title).toBe('Space Oddity')
    expect(itunesCalls).toBe(2)
  })

  it('falls back to Deezer when Odesli has no Spotify link for any iTunes match', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('itunes.apple.com')) {
        return new Response(
          JSON.stringify({
            resultCount: 1,
            results: [
              {
                trackId: 42,
                trackName: 'Five Years (2012 Remaster)',
                artistName: 'David Bowie',
                trackViewUrl: 'https://music.apple.com/42',
              },
            ],
          }),
          { status: 200 },
        )
      }
      // iTunes-based Odesli — no Spotify link at all
      if (url.includes('song.link') && url.includes('platform=itunes')) {
        return new Response(JSON.stringify({ linksByPlatform: {} }), { status: 200 })
      }
      // Deezer search — returns a canonical Bowie track URL
      if (url.includes('api.deezer.com/search')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                link: 'https://www.deezer.com/track/999',
                title: 'Five Years',
                artist: { name: 'David Bowie' },
              },
            ],
          }),
          { status: 200 },
        )
      }
      // Odesli with the Deezer URL succeeds
      if (url.includes('song.link') && url.includes('deezer.com')) {
        return new Response(
          JSON.stringify({
            linksByPlatform: {
              spotify: { url: 'https://open.spotify.com/track/DEEZERfallback22chars' },
            },
          }),
          { status: 200 },
        )
      }
      throw new Error('Unexpected fetch: ' + url)
    })
    const r = await resolveTrack(
      { title: 'Five Years', artist: 'David Bowie' },
      { fetchFn: fetchFn as any },
    )
    expect(r.spotifyUri).toBe('spotify:track:DEEZERfallback22chars')
    expect(r.resolved.title).toBe('Five Years')
    expect(r.resolved.artist).toBe('David Bowie')
  })

  it('throws when iTunes returns no results', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ resultCount: 0, results: [] }), { status: 200 }),
    )
    await expect(
      resolveTrack({ title: 'X', artist: 'Y' }, { fetchFn: fetchFn as any }),
    ).rejects.toThrow(/no iTunes result/i)
  })

  it('throws when no Spotify link can be found anywhere', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('itunes.apple.com')) {
        return new Response(
          JSON.stringify({
            resultCount: 1,
            results: [{ trackId: 1, trackName: 'X', artistName: 'Y', trackViewUrl: 'https://x' }],
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ linksByPlatform: {} }), { status: 200 })
    })
    await expect(
      resolveTrack({ title: 'X', artist: 'Y' }, { fetchFn: fetchFn as any }),
    ).rejects.toThrow(/no Spotify link/i)
  })
})
