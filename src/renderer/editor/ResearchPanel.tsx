import { useEffect, useState } from 'react'
import { useEditorStore } from './editorStore'
import { loadGenerationConfig } from '../settings/generationConfig'

export function ResearchPanel() {
  const draftId = useEditorStore((s) => s.currentDraftId)
  const draft = useEditorStore((s) => s.currentDraft)
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!draftId) return
    setLoaded(false)
    window.deepcuts.drafts.loadResearch(draftId).then((md) => {
      setText(md)
      setLoaded(true)
      setDirty(false)
    })
  }, [draftId])

  async function save() {
    if (!draftId) return
    await window.deepcuts.drafts.saveResearch(draftId, text)
    setDirty(false)
  }

  async function regenerate() {
    if (!draftId || !draft) return
    if (text.trim() && !window.confirm('Replace the current research with a fresh generation?')) return
    setRunning(true)
    setError(null)
    try {
      const cfg = loadGenerationConfig()
      await window.deepcuts.generation.runStep({
        draftId,
        step: 'research',
        providerId: cfg.providerId,
        modelId: cfg.modelId,
        vertexProject: cfg.vertexProject,
        vertexLocation: cfg.vertexLocation,
        input: { subject: draft.subject || draft.title, useSearch: true },
      })
      const md = await window.deepcuts.drafts.loadResearch(draftId)
      setText(md)
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Research failed')
    } finally {
      setRunning(false)
    }
  }

  if (!loaded) return <div className="text-[var(--color-muted)]">Loading research…</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] tracking-[0.2em] uppercase text-[var(--color-muted)]">
          {text.trim() ? (dirty ? 'Edited' : 'Saved') : 'Empty'}
        </div>
        <div className="flex gap-2">
          {dirty && (
            <button
              onClick={save}
              className="text-xs px-2 py-1 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30"
            >
              Save
            </button>
          )}
          <button
            onClick={regenerate}
            disabled={running}
            className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5 disabled:opacity-40"
          >
            {running ? 'Researching…' : text.trim() ? 'Re-generate' : 'Generate research'}
          </button>
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
        placeholder="Click 'Generate research' to fill this in via Gemini with web search…"
        className="w-full min-h-[400px] bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:border-[var(--color-accent)]"
      />
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  )
}
