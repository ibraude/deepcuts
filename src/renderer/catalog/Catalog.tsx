import { useEffect, useState } from 'react'
import {
  loadCatalog,
  loadEpisodeManifestById,
  type CatalogView,
  type ReleasedEntry,
  type UpcomingEntry,
  type LibraryEntry,
} from './loadCatalog'
import { usePlayerStore } from '../player/playerStore'

export function Catalog() {
  const [view, setView] = useState<CatalogView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloadedIds, setDownloadedIds] = useState<Set<string>>(new Set())
  const [progressById, setProgressById] = useState<Record<string, { done: number; total: number }>>({})
  const startWithManifest = usePlayerStore((s) => s.startWithManifest)

  async function refresh() {
    try {
      const next = await loadCatalog()
      setView(next)
      const flags = await Promise.all(next.released.map(async (e) => [e.id, await window.deepcuts.downloaded.isDownloaded(e.id)] as const))
      setDownloadedIds(new Set(flags.filter(([, dl]) => dl).map(([id]) => id)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load catalog')
    }
  }

  useEffect(() => { refresh() }, [])

  useEffect(() => {
    const off = window.deepcuts.downloaded.onProgress((p) => {
      setProgressById((prev) => ({ ...prev, [p.id]: { done: p.done, total: p.total } }))
      if (p.done === p.total) {
        setDownloadedIds((prev) => new Set(prev).add(p.id))
        setProgressById((prev) => { const next = { ...prev }; delete next[p.id]; return next })
      }
    })
    return off
  }, [])

  async function downloadEpisode(id: string) {
    setProgressById((prev) => ({ ...prev, [id]: { done: 0, total: 1 } }))
    try {
      await window.deepcuts.downloaded.start(id)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Download failed')
      setProgressById((prev) => { const next = { ...prev }; delete next[id]; return next })
    }
  }

  async function removeDownload(id: string) {
    await window.deepcuts.downloaded.remove(id)
    setDownloadedIds((prev) => { const next = new Set(prev); next.delete(id); return next })
  }

  async function play(entry: ReleasedEntry | LibraryEntry) {
    try {
      const manifest = await loadEpisodeManifestById(
        entry.id,
        entry.source === 'library' ? 'library' : 'remote',
      )
      await startWithManifest(manifest)
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load episode')
    }
  }

  async function unpublish(entry: LibraryEntry) {
    if (!window.confirm(`Unpublish "${entry.title}"? It'll be removed from your library but the draft stays.`)) return
    await window.deepcuts.library.unpublish(entry.id)
    await refresh()
  }

  if (error) return <div className="p-8 text-[var(--color-muted)]">{error}</div>
  if (!view) return <div className="p-8 text-[var(--color-muted)]">Loading…</div>

  const librarySection: Array<ReleasedEntry | LibraryEntry> = [...view.released, ...view.library]

  return (
    <div className="p-12 max-w-5xl mx-auto">
      <div className="text-xs tracking-[0.2em] uppercase text-[var(--color-muted)] mb-2">Deepcuts</div>
      <h1 className="text-2xl font-medium mb-12">Listening documentaries</h1>

      {librarySection.length === 0 ? (
        <div className="text-[var(--color-muted)] mb-12">No episodes yet.</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-12 mb-24">
          {librarySection.map((e) => (
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
                  <img src={e.coverUrl} alt={`${e.meta.artistName} — ${e.meta.albumName}`} className="w-full h-full object-cover" draggable={false} />
                )}
                {e.source === 'library' && (
                  <span className="absolute top-2 left-2 text-[10px] tracking-[0.2em] uppercase px-1.5 py-0.5 rounded-sm bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                    Yours
                  </span>
                )}
                {e.source === 'remote' && downloadedIds.has(e.id) && (
                  <span className="absolute top-2 left-2 text-[10px] tracking-[0.2em] uppercase px-1.5 py-0.5 rounded-sm bg-black/50 text-white">
                    Downloaded
                  </span>
                )}
                {e.source === 'remote' && progressById[e.id] && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
                    <div
                      className="h-full bg-[var(--color-accent)] transition-all"
                      style={{ width: `${Math.round((progressById[e.id]!.done / Math.max(1, progressById[e.id]!.total)) * 100)}%` }}
                    />
                  </div>
                )}
              </button>
              <div>
                {e.source === 'library' ? (
                  <>
                    <button onClick={() => play(e)} className="text-base font-medium text-left group-hover:text-[var(--color-accent)] transition-colors">
                      {e.title}
                    </button>
                    <div className="text-sm text-[var(--color-muted)] mt-0.5">{e.subject}</div>
                    <div className="text-xs text-[var(--color-muted)] mt-1">{Math.round(e.estimatedMinutes)} min</div>
                  </>
                ) : (
                  <>
                    <button onClick={() => play(e)} className="text-base font-medium text-left group-hover:text-[var(--color-accent)] transition-colors">
                      {e.meta.artistName}
                    </button>
                    <div className="text-sm text-[var(--color-muted)] mt-0.5">{e.meta.albumName}</div>
                    <div className="text-xs text-[var(--color-muted)] mt-1 leading-relaxed">{e.meta.blurb}</div>
                  </>
                )}
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
              {e.source === 'remote' && (
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                  {downloadedIds.has(e.id) ? (
                    <button
                      onClick={() => removeDownload(e.id)}
                      className="text-xs px-2 py-1 rounded-md text-[var(--color-muted)] hover:text-red-400 hover:bg-white/5"
                    >
                      Remove download
                    </button>
                  ) : progressById[e.id] ? (
                    <div className="text-xs px-2 py-1 text-[var(--color-muted)]">
                      Downloading… {progressById[e.id]!.done}/{progressById[e.id]!.total}
                    </div>
                  ) : (
                    <button
                      onClick={() => downloadEpisode(e.id)}
                      className="text-xs px-2 py-1 rounded-md text-[var(--color-muted)] hover:text-[var(--color-accent)] hover:bg-white/5"
                    >
                      Download for offline
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {view.upcoming.length > 0 && (
        <>
          <div className="text-xs tracking-[0.2em] uppercase text-[var(--color-muted)] mb-2">Upcoming</div>
          <h2 className="text-xl font-medium mb-8">Coming soon</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-12">
            {view.upcoming.map((e: UpcomingEntry) => (
              <div key={`upcoming:${e.id}`} className="flex flex-col gap-3">
                <div className="aspect-square w-full rounded-md bg-[var(--color-surface)] border border-[var(--color-hairline)] overflow-hidden opacity-80">
                  <img src={e.coverUrl} alt={`${e.meta.artistName} — ${e.meta.albumName}`} className="w-full h-full object-cover" draggable={false} />
                </div>
                <div>
                  <div className="text-base font-medium">{e.meta.artistName}</div>
                  <div className="text-sm text-[var(--color-muted)] mt-0.5">{e.meta.albumName}</div>
                  <div className="text-xs tracking-[0.2em] uppercase text-[var(--color-muted)] mt-2">{e.expectedRelease}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
