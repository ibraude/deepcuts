import { useEffect, useState } from 'react'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { fetchCatalog, type CatalogView } from './catalog/fetchCatalog'

export default function App() {
  const [view, setView] = useState<CatalogView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchCatalog().then(setView).catch((e: Error) => setError(e.message))
  }, [])

  return (
    <main className="min-h-screen">
      <Header />
      <div id="top" />
      <Hero featured={view?.featured ?? null} />
      {error && (
        <div className="max-w-[600px] mx-auto p-12 text-sm" style={{ color: 'var(--muted)' }}>
          Catalog failed to load: {error}
        </div>
      )}
    </main>
  )
}
