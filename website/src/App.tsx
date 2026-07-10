import { useEffect, useState } from 'react'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { Library } from './components/Library'
import { usePlayer } from './hooks/usePlayer'
import {
  fetchCatalog,
  type CatalogView,
  type EpisodeView,
} from './catalog/fetchCatalog'

export default function App() {
  const [view, setView] = useState<CatalogView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const player = usePlayer()

  useEffect(() => {
    fetchCatalog().then(setView).catch((e: Error) => setError(e.message))
  }, [])

  const handlePlay = (entry: EpisodeView) => {
    if (player.state.activeId === entry.id) {
      if (player.state.status === 'playing') player.pause()
      else player.resume()
      return
    }
    void player.playEpisode(entry.id, entry.meta.palette.accent)
  }

  return (
    <main className="min-h-screen">
      <Header />
      <div id="top" />
      <Hero featured={view?.featured ?? null} />
      <Library
        released={view?.released ?? []}
        state={player.state}
        onPlay={handlePlay}
        onPause={player.pause}
        onResume={player.resume}
        onSeek={player.seek}
      />
      {error && (
        <div className="max-w-[600px] mx-auto p-12 text-sm" style={{ color: 'var(--muted)' }}>
          Catalog failed to load: {error}
        </div>
      )}
      <audio ref={player.audioRef} preload="none" style={{ display: 'none' }} />
    </main>
  )
}
