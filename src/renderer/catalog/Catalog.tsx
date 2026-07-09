import { useEffect, useState } from 'react'
import { Cover } from '../ui/Cover'
import { loadEpisodeManifest, loadUnifiedCatalog, type UnifiedCatalogEntry } from './loadLocal'
import { usePlayerStore } from '../player/playerStore'

export function Catalog() {
  const [entries, setEntries] = useState<UnifiedCatalogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const startWithManifest = usePlayerStore((s) => s.startWithManifest)

  async function refresh() {
    try {
      const list = await loadUnifiedCatalog()
      setEntries(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load catalog')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function play(entry: UnifiedCatalogEntry) {
    try {
      const manifest = await loadEpisodeManifest(entry)
      await startWithManifest(manifest)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load episode')
    }
  }

  async function unpublish(entry: UnifiedCatalogEntry) {
    if (entry.source !== 'library') return
    if (!window.confirm(`Unpublish "${entry.title}"? It'll be removed from your library but the draft stays.`)) {
      return
    }
    await window.deepcuts.library.unpublish(entry.id)
    await refresh()
  }

  if (error) return <div className="p-8 text-[var(--color-muted)]">{error}</div>
  if (!entries) return <div className="p-8 text-[var(--color-muted)]">Loading…</div>

  return (
    <div className="p-12 max-w-5xl mx-auto">
      <div className="text-xs tracking-[0.2em] uppercase text-[var(--color-muted)] mb-2">Deepcuts</div>
      <h1 className="text-2xl font-medium mb-12">Listening documentaries</h1>
      {entries.length === 0 ? (
        <div className="text-[var(--color-muted)]">No episodes yet.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-12">
          {entries.map((e) => (
            <div key={`${e.source}:${e.id}`} className="group flex flex-col gap-3 relative">
              <button
                onClick={() => play(e)}
                className="aspect-square w-full rounded-md bg-[var(--color-surface)] border border-[var(--color-hairline)] flex items-center justify-center overflow-hidden focus:outline-none focus:border-[var(--color-accent)] relative"
              >
                {e.source === 'library' ? (
                  e.coverImage ? (
                    <img src={e.coverImage} alt={e.title} className="w-full h-full object-cover" draggable={false} />
                  ) : (
                    <span className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                      {e.title.slice(0, 2)}
                    </span>
                  )
                ) : (
                  <Cover coverPath={e.coverImage} alt={e.title} size={220} />
                )}
                {e.source === 'library' && (
                  <span className="absolute top-2 left-2 text-[10px] tracking-[0.2em] uppercase px-1.5 py-0.5 rounded-sm bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                    Yours
                  </span>
                )}
              </button>
              <div>
                <button
                  onClick={() => play(e)}
                  className="text-base font-medium text-left group-hover:text-[var(--color-accent)] transition-colors"
                >
                  {e.title}
                </button>
                <div className="text-sm text-[var(--color-muted)] mt-0.5">{e.subject}</div>
                <div className="text-xs text-[var(--color-muted)] mt-1">{Math.round(e.estimatedMinutes)} min</div>
              </div>
              {e.source === 'library' && (
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => unpublish(e)}
                    className="text-xs px-2 py-1 rounded-md text-[var(--color-muted)] hover:text-red-400 hover:bg-white/5"
                  >
                    Unpublish
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
