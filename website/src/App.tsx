import { useEffect, useState } from 'react'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { Library } from './components/Library'
import {
  fetchCatalog,
  type CatalogView,
  type EpisodeView,
} from './catalog/fetchCatalog'

export default function App() {
  const [view, setView] = useState<CatalogView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  useEffect(() => {
    fetchCatalog().then(setView).catch((e: Error) => setError(e.message))
  }, [])

  const handlePlay = (entry: EpisodeView) => {
    setActiveId((prev) => (prev === entry.id ? null : entry.id))
  }

  return (
    <main className="min-h-screen">
      <Header />
      <div id="top" />
      <Hero featured={view?.featured ?? null} />
      <Library released={view?.released ?? []} activeId={activeId} onPlay={handlePlay} />
      {error && (
        <div className="max-w-[600px] mx-auto p-12 text-sm" style={{ color: 'var(--muted)' }}>
          Catalog failed to load: {error}
        </div>
      )}
    </main>
  )
}
