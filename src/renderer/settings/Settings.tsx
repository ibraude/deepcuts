import { useEffect, useMemo, useState } from 'react'
import { usePlayerStore } from '../player/playerStore'
import { SystemTTS } from '../player/SystemTTS'
import { ELEVENLABS_VOICES } from './voiceCatalog'
import {
  loadGenerationConfig,
  saveGenerationConfig,
  PROVIDER_OPTIONS,
  type GenerationProviderId,
} from './generationConfig'

export function Settings({ onClose }: { onClose: () => void }) {
  const refreshKey = usePlayerStore((s) => s.refreshKey)
  const hasKey = usePlayerStore((s) => s.hasElevenLabsKey)
  const voicePick = usePlayerStore((s) => s.voicePick)
  const userVoiceRef = usePlayerStore((s) => s.userVoiceRef)
  const setUserVoiceRef = usePlayerStore((s) => s.setUserVoiceRef)
  const [keyInput, setKeyInput] = useState('')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [customInput, setCustomInput] = useState('')

  const [genConfig, setGenConfig] = useState(loadGenerationConfig())
  const [vertexJsonInput, setVertexJsonInput] = useState('')
  const [hasVertexCredentials, setHasVertexCredentials] = useState(false)
  const [vertexError, setVertexError] = useState<string | null>(null)

  useEffect(() => {
    SystemTTS.listVoices().then(setVoices)
  }, [])

  useEffect(() => {
    ;(async () => {
      const json = await window.deepcuts.keychain.get('gemini-vertex-credentials')
      setHasVertexCredentials(!!json)
    })()
  }, [])

  function setProviderId(id: GenerationProviderId) {
    const cfg = { ...genConfig, providerId: id }
    setGenConfig(cfg)
    saveGenerationConfig(cfg)
  }

  function setModelId(modelId: string) {
    const cfg = { ...genConfig, modelId }
    setGenConfig(cfg)
    saveGenerationConfig(cfg)
  }

  function setImageModelId(imageModelId: string) {
    const cfg = { ...genConfig, imageModelId }
    setGenConfig(cfg)
    saveGenerationConfig(cfg)
  }

  function setVertexProject(vertexProject: string) {
    const cfg = { ...genConfig, vertexProject }
    setGenConfig(cfg)
    saveGenerationConfig(cfg)
  }

  function setVertexLocation(vertexLocation: string) {
    const cfg = { ...genConfig, vertexLocation }
    setGenConfig(cfg)
    saveGenerationConfig(cfg)
  }

  function setVertexImageLocation(vertexImageLocation: string) {
    const cfg = { ...genConfig, vertexImageLocation }
    setGenConfig(cfg)
    saveGenerationConfig(cfg)
  }

  async function saveVertexJson() {
    setVertexError(null)
    const raw = vertexJsonInput.trim()
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
        throw new Error('JSON missing client_email or private_key')
      }
    } catch (e) {
      setVertexError(e instanceof Error ? e.message : 'Invalid JSON')
      return
    }
    await window.deepcuts.keychain.set('gemini-vertex-credentials', raw)
    setHasVertexCredentials(true)
    setVertexJsonInput('')
  }

  async function clearVertexJson() {
    await window.deepcuts.keychain.delete('gemini-vertex-credentials')
    setHasVertexCredentials(false)
  }

  const currentVoiceId = userVoiceRef?.startsWith('elevenlabs:') ? userVoiceRef.slice('elevenlabs:'.length) : ''
  const isCustom = useMemo(
    () => !!currentVoiceId && !ELEVENLABS_VOICES.some((v) => v.id === currentVoiceId),
    [currentVoiceId],
  )

  async function save() {
    setSaving(true)
    setError(null)
    try {
      if (keyInput.trim()) {
        await window.deepcuts.keychain.set('elevenlabs', keyInput.trim())
      }
      await refreshKey()
      setKeyInput('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function clear() {
    await window.deepcuts.keychain.delete('elevenlabs')
    await refreshKey()
  }

  function onVoiceSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    if (id === '__manifest__') setUserVoiceRef(null)
    else if (id === '__custom__') {
      // keep selection until user types a custom ID and clicks Apply
    } else {
      setUserVoiceRef(`elevenlabs:${id}`)
    }
  }

  function applyCustom() {
    const trimmed = customInput.trim()
    if (!trimmed) return
    setUserVoiceRef(`elevenlabs:${trimmed}`)
    setCustomInput('')
  }

  const lowQuality =
    voicePick.quality === 'standard' ||
    voicePick.quality === 'fallback' ||
    voicePick.quality === 'none'

  const selectValue =
    !userVoiceRef ? '__manifest__' :
    isCustom ? '__custom__' :
    currentVoiceId

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-8" onClick={onClose}>
      <div
        className="bg-[var(--color-surface)] border border-[var(--color-hairline)] rounded-lg w-[520px] max-w-full p-6 space-y-6 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Settings</h2>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-text)]" aria-label="Close">×</button>
        </div>

        <section className="space-y-2">
          <div className="text-sm">ElevenLabs API key</div>
          <div className="text-xs text-[var(--color-muted)]">
            Optional. With a key, narration uses your chosen ElevenLabs voice. Without, Deepcuts uses your Mac's built-in voice.
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={hasKey ? '••••••••• (key on file)' : 'sk_...'}
              className="flex-1 bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
            />
            <button
              onClick={save}
              disabled={saving}
              className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50"
            >
              Save
            </button>
            {hasKey && (
              <button onClick={clear} className="text-sm px-3 py-1.5 rounded-md text-[var(--color-muted)] hover:bg-white/5">
                Clear
              </button>
            )}
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
        </section>

        <section className="space-y-2">
          <div className="text-sm">ElevenLabs voice</div>
          <div className="text-xs text-[var(--color-muted)]">
            Overrides the episode's narrator on single-host episodes. Multi-host episodes use their authored voices.
            Voices marked 🔒 require a paid ElevenLabs plan.
          </div>
          <select
            value={selectValue}
            onChange={onVoiceSelect}
            className="w-full bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]"
          >
            <option value="__manifest__">Episode default</option>
            {ELEVENLABS_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} — {v.blurb}{v.requiresPaidTier ? ' 🔒' : ''}
              </option>
            ))}
            <option value="__custom__">Custom voice ID…</option>
          </select>

          {selectValue === '__custom__' && (
            <div className="flex gap-2 pt-1">
              <input
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder={isCustom ? currentVoiceId : 'paste ElevenLabs voice ID'}
                className="flex-1 bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-[var(--color-accent)]"
              />
              <button
                onClick={applyCustom}
                className="text-sm px-3 py-1.5 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30"
              >
                Apply
              </button>
            </div>
          )}

          {isCustom && selectValue !== '__custom__' && (
            <div className="text-xs text-[var(--color-muted)] font-mono">Using custom: {currentVoiceId}</div>
          )}
        </section>

        <section className="space-y-2">
          <div className="text-sm">System voice</div>
          <div className="text-xs text-[var(--color-muted)]">Used when no ElevenLabs key is set, or as a fallback.</div>
          <div className="text-sm">
            {voicePick.voice ? (
              <span>Using <strong>{voicePick.voice.name}</strong> <span className="text-[var(--color-muted)]">({voicePick.quality})</span></span>
            ) : (
              <span className="text-[var(--color-muted)]">No voice available.</span>
            )}
          </div>
          {lowQuality && (
            <button
              onClick={() =>
                window.deepcuts.shell.openExternal(
                  'x-apple.systempreferences:com.apple.preference.universalaccess?SpokenContent',
                )
              }
              className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-hairline)] hover:bg-white/5"
            >
              Download a premium voice
            </button>
          )}
          <details className="text-xs text-[var(--color-muted)]">
            <summary className="cursor-pointer">All available system voices ({voices.length})</summary>
            <ul className="mt-1 max-h-40 overflow-auto pl-4 list-disc">
              {voices.map((v, i) => (
                <li key={`${v.voiceURI}-${i}`}>{v.name} ({v.lang})</li>
              ))}
            </ul>
          </details>
        </section>

        <section className="space-y-3 pt-2 border-t border-[var(--color-hairline)]">
          <div className="text-sm">Generation</div>
          <div className="text-xs text-[var(--color-muted)]">
            Which LLM to use when generating new episodes in the Editor. Keys stay on this Mac (Electron safeStorage).
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-[var(--color-muted)]">
              Provider
              <select
                value={genConfig.providerId}
                onChange={(e) => setProviderId(e.target.value as GenerationProviderId)}
                className="w-full mt-1 bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
              >
                {PROVIDER_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.id !== 'gemini'}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[var(--color-muted)]">
              Text model id
              <input
                value={genConfig.modelId}
                onChange={(e) => setModelId(e.target.value)}
                placeholder="gemini-2.5-pro"
                className="w-full mt-1 bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm font-mono text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
              />
            </label>
          </div>
          <label className="text-xs text-[var(--color-muted)] block">
            Image model id
            <input
              value={genConfig.imageModelId}
              onChange={(e) => setImageModelId(e.target.value)}
              placeholder="gemini-2.5-flash-image-preview"
              className="w-full mt-1 bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm font-mono text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
            />
            <span className="text-[10px] block mt-1">Used for cover-art generation.</span>
          </label>
          <div className="space-y-2 pt-3 border-t border-[var(--color-hairline)]">
            <div className="text-xs flex items-center justify-between">
              <span>Google Cloud Vertex AI</span>
              {hasVertexCredentials && (
                <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--color-accent)]">
                  service account on file
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-[var(--color-muted)]">
                Project ID
                <input
                  value={genConfig.vertexProject}
                  onChange={(e) => setVertexProject(e.target.value)}
                  placeholder="my-gcp-project"
                  className="w-full mt-1 bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm font-mono text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </label>
              <label className="text-xs text-[var(--color-muted)]">
                Text location
                <input
                  value={genConfig.vertexLocation}
                  onChange={(e) => setVertexLocation(e.target.value)}
                  placeholder="us-central1 or global"
                  className="w-full mt-1 bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm font-mono text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
                />
              </label>
            </div>
            <label className="text-xs text-[var(--color-muted)] block">
              Image location
              <input
                value={genConfig.vertexImageLocation}
                onChange={(e) => setVertexImageLocation(e.target.value)}
                placeholder="us-central1"
                className="w-full mt-1 bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-sm font-mono text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
              />
              <span className="text-[10px] block mt-1">
                Imagen models (e.g. <code className="font-mono">imagen-4.0-generate-001</code>) are regional only —
                use <code className="font-mono">us-central1</code> here even if text is on <code className="font-mono">global</code>.
              </span>
            </label>
            <div className="text-xs text-[var(--color-muted)]">
              Auth: leave the service account JSON below blank if you have run{' '}
              <code className="font-mono text-[var(--color-text)]">gcloud auth application-default login</code>{' '}
              on this Mac. Otherwise, paste a service account JSON (GCP Console → IAM → Service Accounts → Create Key).
            </div>
            <textarea
              value={vertexJsonInput}
              onChange={(e) => setVertexJsonInput(e.target.value)}
              placeholder={
                hasVertexCredentials
                  ? '{ ... } — JSON on file. Paste a new one to replace.'
                  : '{\n  "type": "service_account",\n  "client_email": "...",\n  "private_key": "..."\n}'
              }
              className="w-full bg-[var(--color-background)] border border-[var(--color-hairline)] rounded-md px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-[var(--color-accent)] min-h-[80px]"
            />
            <div className="flex gap-2">
              <button
                onClick={saveVertexJson}
                disabled={!vertexJsonInput.trim()}
                className="text-xs px-2 py-1 rounded-md bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30 disabled:opacity-50"
              >
                Save JSON
              </button>
              {hasVertexCredentials && (
                <button
                  onClick={clearVertexJson}
                  className="text-xs px-2 py-1 rounded-md text-[var(--color-muted)] hover:bg-white/5"
                >
                  Clear (use ADC)
                </button>
              )}
            </div>
            {vertexError && <div className="text-xs text-red-400">{vertexError}</div>}
          </div>
        </section>
      </div>
    </div>
  )
}
