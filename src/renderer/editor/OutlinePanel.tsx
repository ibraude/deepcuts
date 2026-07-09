import { useEffect, useState } from 'react'
import { useEditorStore } from './editorStore'
import { loadGenerationConfig } from '../settings/generationConfig'

export function OutlinePanel() {
  const draftId = useEditorStore((s) => s.currentDraftId)
  const draft = useEditorStore((s) => s.currentDraft)
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [useAudioTags, setUseAudioTags] = useState(false)

  useEffect(() => {
    if (!draftId) return
    setLoaded(false)
    window.deepcuts.drafts.loadOutline(draftId).then((o) => {
      setText(o ? JSON.stringify(o, null, 2) : '')
      setLoaded(true)
      setDirty(false)
    })
  }, [draftId])

  async function save() {
    if (!draftId) return
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      setError('Outline JSON is invalid: ' + (e instanceof Error ? e.message : 'parse error'))
      return
    }
    await window.deepcuts.drafts.saveOutline(draftId, parsed)
    setDirty(false)
    setError(null)
  }

  async function regenerate() {
    if (!draftId || !draft) return
    if (text.trim() && !window.confirm('Replace the current outline with a fresh generation?')) return
    setRunning(true)
    setError(null)
    try {
      const cfg = loadGenerationConfig()
      await window.deepcuts.generation.runStep({
        draftId,
        step: 'outline',
        providerId: cfg.providerId,
        modelId: cfg.modelId,
        vertexProject: cfg.vertexProject,
        vertexLocation: cfg.vertexLocation,
        input: { subject: draft.subject || draft.title, useSearch: false },
      })
      const o = await window.deepcuts.drafts.loadOutline(draftId)
      setText(o ? JSON.stringify(o, null, 2) : '')
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Outline generation failed')
    } finally {
      setRunning(false)
    }
  }

  async function runScript() {
    if (!draftId || !draft) return
    if (
      !window.confirm(
        'Regenerate the manifest (narration + voiceovers + song resolution) from the current outline? This will overwrite the current manifest.',
      )
    )
      return
    setRunning(true)
    setError(null)
    try {
      const cfg = loadGenerationConfig()
      const r = await window.deepcuts.generation.runStep({
        draftId,
        step: 'script',
        providerId: cfg.providerId,
        modelId: cfg.modelId,
        vertexProject: cfg.vertexProject,
        vertexLocation: cfg.vertexLocation,
        input: { subject: draft.subject || draft.title, useSearch: false, useAudioTags },
      })
      await useEditorStore.getState().openDraft(draftId)
      if (r.warnings.length) {
        setError('Script generated with warnings:\n\n' + r.warnings.join('\n'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Script generation failed')
    } finally {
      setRunning(false)
    }
  }

  async function reresolveSongs() {
    if (!draftId || !draft) return
    setRunning(true)
    setError(null)
    try {
      const cfg = loadGenerationConfig()
      const r = await window.deepcuts.generation.runStep({
        draftId,
        step: 'resolve',
        providerId: cfg.providerId,
        modelId: cfg.modelId,
        vertexProject: cfg.vertexProject,
        vertexLocation: cfg.vertexLocation,
        // input is required by the IPC signature but unused for resolve.
        input: { subject: draft.subject || draft.title, useSearch: false },
      })
      await useEditorStore.getState().openDraft(draftId)
      if (r.warnings.length) {
        setError('Resolved with warnings:\n\n' + r.warnings.join('\n'))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Re-resolve failed')
    } finally {
      setRunning(false)
    }
  }

  if (!loaded) return <div className="text-[var(--color-muted)]">Loading outline…</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
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
            {running ? 'Working…' : text.trim() ? 'Re-generate' : 'Generate outline'}
          </button>
          <label
            className="flex items-center gap-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-text)] cursor-pointer select-none"
            title="Weave ElevenLabs v3 audio tags ([pause], [thoughtfully], etc.) into narration text. Only useful for hosts whose TTS model is set to v3 — v2 hosts read tags as literal words."
          >
            <input
              type="checkbox"
              checked={useAudioTags}
              onChange={(e) => setUseAudioTags(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Audio tags
          </label>
          <button
            onClick={runScript}
            disabled={running || !text.trim()}
            className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5 disabled:opacity-40"
          >
            Regenerate manifest from outline
          </button>
          <button
            onClick={reresolveSongs}
            disabled={running}
            title="Re-run the Spotify URI resolver on every song in the current manifest, without touching narration text."
            className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5 disabled:opacity-40"
          >
            Re-resolve songs
          </button>
        </div>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
        placeholder="Click 'Generate outline' to build a chapter plan from the research…"
        className="w-full min-h-[400px] bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:border-[var(--color-accent)]"
      />
      {error && <div className="text-xs text-red-400 whitespace-pre-wrap">{error}</div>}
    </div>
  )
}
