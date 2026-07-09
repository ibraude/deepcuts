import { useEffect, useState } from 'react'
import { useEditorStore } from './editorStore'
import { DraftCard } from './DraftCard'
import { NewDraftModal } from './NewDraftModal'

export function DraftList() {
  const drafts = useEditorStore((s) => s.drafts)
  const loading = useEditorStore((s) => s.loadingList)
  const refresh = useEditorStore((s) => s.refreshList)
  const openDraft = useEditorStore((s) => s.openDraft)
  const remove = useEditorStore((s) => s.remove)
  const [showNewModal, setShowNewModal] = useState(false)

  useEffect(() => {
    refresh()
  }, [refresh])

  async function confirmDelete(id: string, title: string) {
    if (window.confirm(`Delete "${title || 'Untitled draft'}"? This can't be undone.`)) {
      await remove(id)
    }
  }

  return (
    <div className="p-12 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-12">
        <div>
          <div className="text-xs tracking-[0.2em] uppercase text-[var(--color-muted)] mb-2">Deepcuts</div>
          <h1 className="text-2xl font-medium">Editor</h1>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30"
        >
          + New project
        </button>
      </div>

      {loading && drafts.length === 0 ? (
        <div className="text-[var(--color-muted)]">Loading drafts…</div>
      ) : drafts.length === 0 ? (
        <div className="text-[var(--color-muted)] py-12">
          No drafts yet. Click <strong className="text-[var(--color-text)]">+ New project</strong> to start one.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-10">
          {drafts.map((d) => (
            <DraftCard
              key={d.draftId}
              draft={d}
              onOpen={() => openDraft(d.draftId)}
              onPreview={async () => {
                const result = await useEditorStore.getState().startPreview(d.draftId)
                if (!result.ok) {
                  alert('Cannot preview — manifest is incomplete:\n\n' + result.errors.join('\n'))
                }
              }}
              onDelete={() => confirmDelete(d.draftId, d.title)}
            />
          ))}
        </div>
      )}

      {showNewModal && <NewDraftModal onClose={() => setShowNewModal(false)} />}
    </div>
  )
}
