import { useEffect, useState } from 'react'
import { useEditorStore } from './editorStore'
import { GenerationProgress } from './GenerationProgress'
import { loadGenerationConfig } from '../settings/generationConfig'

interface BundledEpisodeOption {
  manifestPath: string
  title: string
  subject: string
}

type Tab = 'empty' | 'duplicate' | 'generate'

interface ProgressState {
  step: 'idle' | 'researching' | 'resolving' | 'finalizing' | 'done' | 'error'
  detail?: string
  index?: number
  total?: number
  error?: string
  warnings?: string[]
}

export function NewDraftModal({ onClose }: { onClose: () => void }) {
  const createEmpty = useEditorStore((s) => s.createEmpty)
  const duplicate = useEditorStore((s) => s.duplicate)
  const openDraft = useEditorStore((s) => s.openDraft)
  const refreshList = useEditorStore((s) => s.refreshList)

  const [tab, setTab] = useState<Tab>('empty')
  const [title, setTitle] = useState('')
  const [episodes, setEpisodes] = useState<BundledEpisodeOption[] | null>(null)
  const [selectedEp, setSelectedEp] = useState<string>('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Generate tab state
  const [subject, setSubject] = useState('')
  const [hints, setHints] = useState('')
  const [lengthMinutes, setLengthMinutes] = useState(12)
  const [useSearch, setUseSearch] = useState(true)
  const [progress, setProgress] = useState<ProgressState>({ step: 'idle' })

  useEffect(() => {
    window.deepcuts.catalog
      .loadLocal()
      .then((c) =>
        setEpisodes(
          c.episodes.map((e) => ({
            manifestPath: e.manifestPath,
            title: e.title,
            subject: e.subject,
          })),
        ),
      )
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    const off = window.deepcuts.generation.onProgress((event: unknown) => {
      const e = event as ProgressState
      setProgress((prev) => ({ ...prev, ...e }))
    })
    return off
  }, [])

  async function submitEmpty() {
    if (!title.trim()) return
    setWorking(true)
    setError(null)
    try {
      const id = await createEmpty(title.trim())
      await openDraft(id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setWorking(false)
    }
  }

  async function submitDuplicate() {
    if (!selectedEp) return
    setWorking(true)
    setError(null)
    try {
      const id = await duplicate(selectedEp)
      await openDraft(id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Duplicate failed')
    } finally {
      setWorking(false)
    }
  }

  async function submitGenerate() {
    if (!subject.trim()) return
    setWorking(true)
    setError(null)
    setProgress({ step: 'researching' })
    try {
      const cfg = loadGenerationConfig()
      const result = await window.deepcuts.generation.start({
        providerId: cfg.providerId,
        modelId: cfg.modelId,
        vertexProject: cfg.vertexProject,
        vertexLocation: cfg.vertexLocation,
        input: {
          subject: subject.trim(),
          hints: hints.trim() || undefined,
          lengthMinutes,
          useSearch,
        },
      })
      setProgress({ step: 'done', warnings: result.warnings })
      await refreshList()
      await openDraft(result.draftId)
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Generate failed'
      setError(msg)
      setProgress({ step: 'error', error: msg })
    } finally {
      setWorking(false)
    }
  }

  function cancelGenerate() {
    window.deepcuts.generation.cancel().catch(() => {})
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center p-8"
      onClick={working ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[var(--color-surface)] border border-[var(--color-hairline)] rounded-lg w-[520px] max-w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">New project</h2>
          <button
            onClick={onClose}
            disabled={working}
            className="text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-40"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex gap-2 text-xs tracking-[0.2em] uppercase">
          {(['empty', 'duplicate', 'generate'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              disabled={working}
              className={
                'px-2.5 py-1 rounded-md transition-colors duration-150 ' +
                (tab === t
                  ? 'bg-[var(--color-accent)]/15 text-[var(--color-text)]'
                  : 'text-[var(--color-muted)] hover:text-[var(--color-text)]')
              }
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'empty' && (
          <div className="space-y-2">
            <label className="text-sm">Title</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My new episode"
              className="w-full bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
            />
            <div className="text-xs text-[var(--color-muted)]">
              A blank manifest with one narrator and one empty narration segment.
            </div>
            <div className="flex justify-end pt-2 gap-2">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-md text-[var(--color-muted)] hover:bg-white/5">
                Cancel
              </button>
              <button
                disabled={!title.trim() || working}
                onClick={submitEmpty}
                className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        )}

        {tab === 'duplicate' && (
          <div className="space-y-2">
            <label className="text-sm">Source episode</label>
            {episodes === null ? (
              <div className="text-xs text-[var(--color-muted)]">Loading episodes…</div>
            ) : episodes.length === 0 ? (
              <div className="text-xs text-[var(--color-muted)]">No bundled episodes to duplicate.</div>
            ) : (
              <select
                value={selectedEp}
                onChange={(e) => setSelectedEp(e.target.value)}
                className="w-full bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
              >
                <option value="">Select an episode…</option>
                {episodes.map((e) => (
                  <option key={e.manifestPath} value={e.manifestPath}>
                    {e.title} — {e.subject}
                  </option>
                ))}
              </select>
            )}
            <div className="text-xs text-[var(--color-muted)]">Creates an editable copy.</div>
            <div className="flex justify-end pt-2 gap-2">
              <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-md text-[var(--color-muted)] hover:bg-white/5">
                Cancel
              </button>
              <button
                disabled={!selectedEp || working}
                onClick={submitDuplicate}
                className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50"
              >
                Duplicate
              </button>
            </div>
          </div>
        )}

        {tab === 'generate' && (
          <div className="space-y-3">
            <label className="text-sm">Subject</label>
            <input
              autoFocus
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={working}
              placeholder='e.g. "Bob Dylan — Blonde on Blonde"'
              className="w-full bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
            />
            <label className="text-sm">Style hints (optional)</label>
            <textarea
              value={hints}
              onChange={(e) => setHints(e.target.value)}
              disabled={working}
              placeholder='e.g. "Two hosts — a calm narrator and a chatty guest who plays bass on session work."'
              className="w-full bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)] min-h-[60px]"
            />
            <div className="grid grid-cols-2 gap-3 items-end">
              <label className="text-sm">
                <span className="block">Target length (min)</span>
                <input
                  type="number"
                  min={3}
                  max={120}
                  value={lengthMinutes}
                  onChange={(e) =>
                    setLengthMinutes(Math.max(3, Math.min(120, Number(e.target.value) || 12)))
                  }
                  disabled={working}
                  className="w-full bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm mt-1 focus:outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="flex items-center gap-2 text-sm pb-2">
                <input
                  type="checkbox"
                  checked={useSearch}
                  onChange={(e) => setUseSearch(e.target.checked)}
                  disabled={working}
                />
                <span>Use web search</span>
              </label>
            </div>

            <GenerationProgress {...progress} />

            <div className="flex justify-end pt-2 gap-2">
              {working ? (
                <button
                  onClick={cancelGenerate}
                  className="text-sm px-3 py-1.5 rounded-md text-[var(--color-muted)] hover:bg-white/5"
                >
                  Cancel
                </button>
              ) : (
                <>
                  <button onClick={onClose} className="text-sm px-3 py-1.5 rounded-md text-[var(--color-muted)] hover:bg-white/5">
                    Close
                  </button>
                  <button
                    disabled={!subject.trim()}
                    onClick={submitGenerate}
                    className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50"
                  >
                    Generate
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>
    </div>
  )
}
