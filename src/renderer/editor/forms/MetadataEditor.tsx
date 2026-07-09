import { useEditorStore } from '../editorStore'
import { FormField, inputClass } from './FormField'

export function MetadataEditor() {
  const draft = useEditorStore((s) => s.currentDraft)
  const update = useEditorStore((s) => s.updateDraft)
  if (!draft) return null
  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">Metadata</h2>
      <FormField label="Title">
        <input
          value={draft.title}
          onChange={(e) => update((m) => ({ ...m, title: e.target.value }))}
          className={inputClass()}
        />
      </FormField>
      <FormField label="Subject">
        <input
          value={draft.subject}
          onChange={(e) => update((m) => ({ ...m, subject: e.target.value }))}
          className={inputClass()}
        />
      </FormField>
      <FormField label="Estimated minutes" hint="Used as a rough length indicator in the catalog.">
        <input
          type="number"
          min={1}
          step={1}
          value={draft.estimatedMinutes}
          onChange={(e) => update((m) => ({ ...m, estimatedMinutes: Number(e.target.value) || 1 }))}
          className={inputClass()}
        />
      </FormField>
    </section>
  )
}
