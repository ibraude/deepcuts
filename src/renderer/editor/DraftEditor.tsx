import { useEffect, useState } from 'react'
import { useEditorStore } from './editorStore'
import { ManifestPanel } from './ManifestPanel'
import { ResearchPanel } from './ResearchPanel'
import { OutlinePanel } from './OutlinePanel'

type EditorTab = 'manifest' | 'research' | 'outline'

export function DraftEditor() {
  const draft = useEditorStore((s) => s.currentDraft)
  const dirty = useEditorStore((s) => s.dirty)
  const loading = useEditorStore((s) => s.loadingDraft)
  const close = useEditorStore((s) => s.closeDraft)
  const save = useEditorStore((s) => s.saveDraft)
  const error = useEditorStore((s) => s.error)
  const currentDraftId = useEditorStore((s) => s.currentDraftId)

  const [tab, setTab] = useState<EditorTab>('manifest')
  const [isPublished, setIsPublished] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [prerendering, setPrerendering] = useState(false)
  const [prerenderProgress, setPrerenderProgress] = useState<{ index: number; total: number } | null>(null)
  const [prerenderSummary, setPrerenderSummary] = useState<string | null>(null)
  const [prerenderError, setPrerenderError] = useState<string | null>(null)

  useEffect(() => {
    if (!currentDraftId) return
    window.deepcuts.library.isPublished(currentDraftId).then(setIsPublished).catch(() => {})
  }, [currentDraftId])

  async function publish() {
    if (!currentDraftId) return
    if (dirty) {
      if (!window.confirm('Save changes before publishing?')) return
      await save()
    }
    setPublishing(true)
    setPublishError(null)
    try {
      await window.deepcuts.library.publish(currentDraftId)
      setIsPublished(true)
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  async function runPrerender() {
    if (!currentDraftId) return
    if (dirty) {
      if (!window.confirm('Save changes before pre-rendering?')) return
      await save()
    }
    setPrerendering(true)
    setPrerenderError(null)
    setPrerenderSummary(null)
    setPrerenderProgress({ index: 0, total: 0 })
    const off = window.deepcuts.generation.onProgress((event: unknown) => {
      const e = event as { step?: string; index?: number; total?: number }
      if (e?.step === 'prerender' && typeof e.index === 'number' && typeof e.total === 'number') {
        setPrerenderProgress({ index: e.index, total: e.total })
      }
    })
    try {
      const result = await window.deepcuts.prerender.start({ draftId: currentDraftId })
      setPrerenderSummary(
        `Rendered ${result.rendered}, skipped ${result.skipped} (cached). ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}.`,
      )
    } catch (e) {
      setPrerenderError(e instanceof Error ? e.message : 'Pre-render failed')
    } finally {
      off()
      setPrerendering(false)
      setPrerenderProgress(null)
    }
  }

  async function unpublish() {
    if (!currentDraftId) return
    if (!window.confirm('Unpublish this draft? It will disappear from the catalog.')) return
    setPublishing(true)
    setPublishError(null)
    try {
      await window.deepcuts.library.unpublish(currentDraftId)
      setIsPublished(false)
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Unpublish failed')
    } finally {
      setPublishing(false)
    }
  }

  if (loading && !draft) {
    return <div className="p-12 text-[var(--color-muted)]">Loading…</div>
  }
  if (!draft) {
    return <div className="p-12 text-[var(--color-muted)]">No draft open.</div>
  }

  return (
    <div className="p-12 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <button
          onClick={close}
          className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)] hover:text-[var(--color-text)]"
        >
          ← Drafts
        </button>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-xs text-[var(--color-muted)]">unsaved</span>}
          {isPublished && (
            <span className="text-[10px] tracking-[0.2em] uppercase text-[var(--color-accent)]">
              Published
            </span>
          )}
          <button
            onClick={async () => {
              const id = useEditorStore.getState().currentDraftId
              if (!id) return
              if (useEditorStore.getState().dirty) {
                if (!window.confirm('Save changes before previewing?')) return
                await useEditorStore.getState().saveDraft()
              }
              const result = await useEditorStore.getState().startPreview(id)
              if (!result.ok) {
                alert('Cannot preview — manifest is incomplete:\n\n' + result.errors.join('\n'))
              }
            }}
            className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-hairline)] hover:bg-white/5"
          >
            Preview
          </button>
          <button
            onClick={save}
            disabled={!dirty}
            className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-hairline)] hover:bg-white/5 disabled:opacity-40"
          >
            Save
          </button>
          <button
            onClick={runPrerender}
            disabled={prerendering}
            className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-hairline)] hover:bg-white/5 disabled:opacity-40"
          >
            {prerendering
              ? prerenderProgress && prerenderProgress.total > 0
                ? `Pre-rendering ${prerenderProgress.index}/${prerenderProgress.total}`
                : 'Pre-rendering…'
              : 'Pre-render audio'}
          </button>
          {isPublished && (
            <button
              onClick={unpublish}
              disabled={publishing}
              className="text-sm px-3 py-1.5 rounded-md text-[var(--color-muted)] hover:bg-white/5 disabled:opacity-40"
            >
              Unpublish
            </button>
          )}
          <button
            onClick={publish}
            disabled={publishing}
            className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-40"
          >
            {publishing ? 'Publishing…' : isPublished ? 'Re-publish' : 'Publish'}
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-[var(--color-hairline)]">
        {(['manifest', 'research', 'outline'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              'text-xs tracking-[0.15em] uppercase px-3 py-2 border-b-2 transition-colors ' +
              (tab === t
                ? 'text-[var(--color-text)] border-[var(--color-accent)]'
                : 'text-[var(--color-muted)] hover:text-[var(--color-text)] border-transparent')
            }
          >
            {t}
          </button>
        ))}
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}
      {publishError && (
        <div className="text-xs text-red-400 whitespace-pre-wrap">{publishError}</div>
      )}
      {prerenderError && (
        <div className="text-xs text-red-400 whitespace-pre-wrap">{prerenderError}</div>
      )}
      {prerenderSummary && (
        <div className="text-xs text-[var(--color-muted)]">{prerenderSummary}</div>
      )}

      <div className="pt-2">
        {tab === 'manifest' && <ManifestPanel />}
        {tab === 'research' && <ResearchPanel />}
        {tab === 'outline' && <OutlinePanel />}
      </div>
    </div>
  )
}
