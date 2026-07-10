import { describe, expect, it, vi } from 'vitest'
import { createPrefetchWarmer } from './PrefetchWarmer'
import type { FlatSegment } from '../../shared/manifest'

function narration(id: string, audio: string | undefined): FlatSegment {
  return {
    type: 'narration', id, hostId: 'h1', text: 'x', audio,
    chapterIndex: 0, chapterTitle: 'C', indexInEpisode: 0,
  }
}
function song(id: string): FlatSegment {
  return {
    type: 'song', id,
    track: { title: 't', artist: 'a', spotifyUri: 'spotify:track:x' },
    startAtSeconds: 0, playSeconds: 10,
    chapterIndex: 0, chapterTitle: 'C', indexInEpisode: 0,
  }
}

describe('PrefetchWarmer', () => {
  it('warms next 3 CDN audio URLs after currentIndex', () => {
    const fetcher = vi.fn(async () => new Response('', { status: 200 }))
    const w = createPrefetchWarmer({ fetcher: fetcher as unknown as typeof fetch })
    const segs: FlatSegment[] = [
      narration('n-01', 'https://cdn/x/n-01.mp3'),
      narration('n-02', 'https://cdn/x/n-02.mp3'),
      narration('n-03', 'https://cdn/x/n-03.mp3'),
      narration('n-04', 'https://cdn/x/n-04.mp3'),
      narration('n-05', 'https://cdn/x/n-05.mp3'),
    ]
    w.warm(segs, 0)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher).toHaveBeenCalledWith('https://cdn/x/n-02.mp3', { cache: 'force-cache' })
    expect(fetcher).toHaveBeenCalledWith('https://cdn/x/n-03.mp3', { cache: 'force-cache' })
    expect(fetcher).toHaveBeenCalledWith('https://cdn/x/n-04.mp3', { cache: 'force-cache' })
  })

  it('skips song segments (Spotify handles them)', () => {
    const fetcher = vi.fn(async () => new Response('', { status: 200 }))
    const w = createPrefetchWarmer({ fetcher: fetcher as unknown as typeof fetch })
    const segs: FlatSegment[] = [
      narration('n-01', 'https://cdn/x/n-01.mp3'),
      song('s-01'),
      narration('n-02', 'https://cdn/x/n-02.mp3'),
      song('s-02'),
      narration('n-03', 'https://cdn/x/n-03.mp3'),
    ]
    w.warm(segs, 0)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenCalledWith('https://cdn/x/n-02.mp3', { cache: 'force-cache' })
    expect(fetcher).toHaveBeenCalledWith('https://cdn/x/n-03.mp3', { cache: 'force-cache' })
  })

  it('skips segments without an audio URL (drafts, live-synth)', () => {
    const fetcher = vi.fn(async () => new Response('', { status: 200 }))
    const w = createPrefetchWarmer({ fetcher: fetcher as unknown as typeof fetch })
    const segs: FlatSegment[] = [
      narration('n-01', ''),
      narration('n-02', undefined),
      narration('n-03', 'https://cdn/x/n-03.mp3'),
    ]
    w.warm(segs, 0)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('https://cdn/x/n-03.mp3', { cache: 'force-cache' })
  })

  it('does not fetch a URL twice across warm() calls', () => {
    const fetcher = vi.fn(async () => new Response('', { status: 200 }))
    const w = createPrefetchWarmer({ fetcher: fetcher as unknown as typeof fetch })
    const segs: FlatSegment[] = [
      narration('n-01', 'https://cdn/x/n-01.mp3'),
      narration('n-02', 'https://cdn/x/n-02.mp3'),
    ]
    w.warm(segs, 0)
    w.warm(segs, 0)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('reset() clears the seen set', () => {
    const fetcher = vi.fn(async () => new Response('', { status: 200 }))
    const w = createPrefetchWarmer({ fetcher: fetcher as unknown as typeof fetch })
    const segs: FlatSegment[] = [narration('n-01', 'https://cdn/x/n-01.mp3')]
    w.warm(segs, -1)
    w.reset()
    w.warm(segs, -1)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
