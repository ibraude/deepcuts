import type { FlatSegment } from '../../shared/manifest'

const PREFETCH_AHEAD = 3

export interface PrefetchWarmer {
  warm(flatSegments: FlatSegment[], currentIndex: number): void
  reset(): void
}

export interface PrefetchWarmerDeps {
  fetcher?: typeof fetch
}

export function createPrefetchWarmer(deps: PrefetchWarmerDeps = {}): PrefetchWarmer {
  const fetcher = deps.fetcher ?? (globalThis.fetch as typeof fetch)
  const seen = new Set<string>()

  function collectNext(flatSegments: FlatSegment[], currentIndex: number): string[] {
    const urls: string[] = []
    for (let i = currentIndex + 1; i < flatSegments.length && urls.length < PREFETCH_AHEAD; i++) {
      const seg = flatSegments[i]
      if (!seg || seg.type !== 'narration') continue
      const audio = seg.audio
      if (!audio || audio.length === 0) continue
      urls.push(audio)
    }
    return urls
  }

  return {
    warm(flatSegments, currentIndex) {
      for (const url of collectNext(flatSegments, currentIndex)) {
        if (seen.has(url)) continue
        seen.add(url)
        void fetcher(url, { cache: 'force-cache' }).catch(() => {})
      }
    },
    reset() { seen.clear() },
  }
}
