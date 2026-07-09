import { useEffect, useState } from 'react'
import { useEditorStore } from '../editorStore'
import { loadGenerationConfig } from '../../settings/generationConfig'

export function CoverEditor() {
  const draftId = useEditorStore((s) => s.currentDraftId)
  const draft = useEditorStore((s) => s.currentDraft)
  const [coverSrc, setCoverSrc] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [showPromptEditor, setShowPromptEditor] = useState(false)
  const [prompt, setPrompt] = useState('')

  async function refresh() {
    if (!draftId) return
    const url = await window.deepcuts.drafts.coverUrl(draftId).catch(() => null)
    setCoverSrc(url ? `${url}?ts=${Date.now()}` : null)
  }

  useEffect(() => {
    refresh()
  }, [draftId])

  useEffect(() => {
    if (!draft || prompt) return
    const t = draft.title || ''
    const s = draft.subject || ''
    setPrompt(
      `Cover art for an audio documentary titled "${t}".${s ? ` Subject: ${s}.` : ''} Minimal, evocative, confident typography. Dark, atmospheric.`,
    )
  }, [draft, prompt])

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    if (!draftId) return
    const file = e.target.files?.[0] as (File & { path?: string }) | undefined
    if (!file) return
    if (!file.path) {
      setError('Could not access file path. Try dragging the file into a different location and try again.')
      return
    }
    setWorking(true)
    setError(null)
    try {
      await window.deepcuts.drafts.setCover(draftId, file.path)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cover update failed')
    } finally {
      setWorking(false)
    }
    e.target.value = ''
  }

  async function generate() {
    if (!draftId) return
    if (!prompt.trim()) {
      setError('Prompt is empty.')
      return
    }
    setWorking(true)
    setError(null)
    try {
      const cfg = loadGenerationConfig()
      await window.deepcuts.image.generateAndSetCover({
        draftId,
        prompt: prompt.trim(),
        providerId: 'gemini',
        modelId: cfg.imageModelId,
        vertexProject: cfg.vertexProject,
        vertexImageLocation: cfg.vertexImageLocation,
      })
      await refresh()
      setShowPromptEditor(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cover generation failed')
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">Cover</h2>
      <div className="flex items-start gap-4">
        <div className="w-40 h-40 rounded-md bg-[var(--color-surface)] border border-[var(--color-hairline)] overflow-hidden flex items-center justify-center text-[var(--color-muted)]">
          {coverSrc ? (
            <img src={coverSrc} alt="Cover" className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs uppercase tracking-wide">No cover</span>
          )}
        </div>
        <div className="space-y-2 flex-1">
          <div className="flex flex-wrap gap-2">
            <label className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-hairline)] hover:bg-white/5 inline-block cursor-pointer">
              {working ? 'Saving…' : coverSrc ? 'Replace cover…' : 'Choose cover…'}
              <input type="file" accept="image/*" onChange={pick} disabled={working} className="hidden" />
            </label>
            <button
              onClick={() => setShowPromptEditor((v) => !v)}
              disabled={working}
              className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50"
            >
              {showPromptEditor ? 'Hide prompt' : 'Generate cover…'}
            </button>
          </div>
          {showPromptEditor && (
            <div className="space-y-2">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={working}
                placeholder="Describe the cover…"
                className="w-full bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)] min-h-[80px]"
              />
              <button
                onClick={generate}
                disabled={working || !prompt.trim()}
                className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50"
              >
                {working ? 'Generating…' : 'Generate'}
              </button>
            </div>
          )}
          {error && <div className="text-xs text-red-400 whitespace-pre-wrap">{error}</div>}
          <div className="text-xs text-[var(--color-muted)]">
            PNG, JPG, or WebP. Square works best. Generation uses your Gemini key.
          </div>
        </div>
      </div>
    </section>
  )
}
