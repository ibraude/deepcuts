import { useEditorStore } from '../editorStore'
import type { DraftManifest } from '../../../shared/manifest'
import { FormField, inputClass, textareaClass } from './FormField'

const TTS_MODEL_OPTIONS = [
  { value: '', label: 'v2 (stable, default)' },
  { value: 'eleven_multilingual_v2', label: 'v2 (stable)' },
  { value: 'eleven_v3', label: 'v3 (alpha — supports audio tags)' },
] as const

type Host = DraftManifest['hosts'][number]

export function HostsEditor() {
  const draft = useEditorStore((s) => s.currentDraft)
  const update = useEditorStore((s) => s.updateDraft)
  if (!draft) return null

  function setHost(idx: number, patch: Partial<Host>) {
    update((m) => ({
      ...m,
      hosts: m.hosts.map((h, i) => (i === idx ? { ...h, ...patch } : h)),
    }))
  }

  function addHost() {
    update((m) => ({
      ...m,
      hosts: [
        ...m.hosts,
        {
          id: `host_${m.hosts.length}`,
          name: '',
          persona: '',
          voiceRef: 'elevenlabs:iP95p4xoKVk53GoZ742B',
        },
      ],
    }))
  }

  function removeHost(idx: number) {
    update((m) => ({ ...m, hosts: m.hosts.filter((_, i) => i !== idx) }))
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">Hosts</h2>
        <button
          onClick={addHost}
          className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5"
        >
          + Host
        </button>
      </div>
      {draft.hosts.map((host, idx) => (
        <div
          key={idx}
          className="bg-[var(--color-surface)] border border-[var(--color-hairline)] rounded-md p-3 space-y-2"
        >
          <div className="grid grid-cols-2 gap-2">
            <FormField label="ID">
              <input
                value={host.id}
                onChange={(e) => setHost(idx, { id: e.target.value })}
                className={inputClass()}
              />
            </FormField>
            <FormField label="Name">
              <input
                value={host.name}
                onChange={(e) => setHost(idx, { name: e.target.value })}
                className={inputClass()}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <FormField label="Voice ref" hint="elevenlabs:<voiceId> or system:default">
              <input
                value={host.voiceRef}
                onChange={(e) => setHost(idx, { voiceRef: e.target.value })}
                className={inputClass() + ' font-mono'}
              />
            </FormField>
            <FormField label="TTS model" hint="v3 for audio tags">
              <select
                value={host.ttsModel ?? ''}
                onChange={(e) =>
                  setHost(idx, {
                    ttsModel: e.target.value === '' ? undefined : (e.target.value as Host['ttsModel']),
                  })
                }
                className={inputClass()}
              >
                <option value="">v2 (default)</option>
                {TTS_MODEL_OPTIONS.slice(1).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField label="Persona">
            <textarea
              value={host.persona}
              onChange={(e) => setHost(idx, { persona: e.target.value })}
              className={textareaClass()}
            />
          </FormField>
          {draft.hosts.length > 1 && (
            <div className="flex justify-end">
              <button
                onClick={() => removeHost(idx)}
                className="text-xs text-[var(--color-muted)] hover:text-red-400"
              >
                Remove host
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
