import { useEffect, useState } from 'react'
import type { DraftSummary } from '../../shared/manifest'

interface DraftCardProps {
  draft: DraftSummary
  onOpen: () => void
  onPreview: () => void
  onDelete: () => void
}

export function DraftCard({ draft, onOpen, onPreview, onDelete }: DraftCardProps) {
  const [coverSrc, setCoverSrc] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!draft.hasCover) {
      setCoverSrc(null)
      return
    }
    window.deepcuts.drafts
      .coverUrl(draft.draftId)
      .then((u) => { if (!cancelled) setCoverSrc(u) })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [draft.draftId, draft.hasCover])

  return (
    <div className="group flex flex-col gap-3 relative">
      <button
        onClick={onOpen}
        className="aspect-square w-full rounded-md bg-[var(--color-surface)] border border-[var(--color-hairline)] flex items-center justify-center overflow-hidden focus:outline-none focus:border-[var(--color-accent)]"
      >
        {coverSrc ? (
          <img src={coverSrc} alt={draft.title} className="w-full h-full object-cover" draggable={false} />
        ) : (
          <span className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
            {(draft.title || 'Untitled').slice(0, 2)}
          </span>
        )}
        <span className="absolute top-2 left-2 text-[10px] tracking-[0.2em] uppercase px-1.5 py-0.5 rounded-sm bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
          Draft
        </span>
      </button>
      <div>
        <button
          onClick={onOpen}
          className="text-base font-medium text-left group-hover:text-[var(--color-accent)] transition-colors"
        >
          {draft.title || 'Untitled draft'}
        </button>
        <div className="text-sm text-[var(--color-muted)] mt-0.5">{draft.subject || '—'}</div>
        <div className="text-xs text-[var(--color-muted)] mt-1">
          {draft.hostCount} host{draft.hostCount === 1 ? '' : 's'} · {draft.segmentCount} segment
          {draft.segmentCount === 1 ? '' : 's'}
        </div>
      </div>
      <div className="flex gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onPreview}
          className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5"
        >
          Preview
        </button>
        <button
          onClick={onOpen}
          className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5"
        >
          Edit
        </button>
        <button
          onClick={onDelete}
          className="text-xs px-2 py-1 rounded-md text-[var(--color-muted)] hover:text-red-400 hover:bg-white/5"
        >
          Delete
        </button>
      </div>
    </div>
  )
}
