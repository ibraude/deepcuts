import { useEditorStore } from '../editorStore'
import { FormField, inputClass, textareaClass } from './FormField'
import { PreviewButton } from './PreviewButton'

interface Props {
  chapterIndex: number
  segmentIndex: number
}

export function NarrationSegmentEditor({ chapterIndex, segmentIndex }: Props) {
  const draft = useEditorStore((s) => s.currentDraft)
  const update = useEditorStore((s) => s.updateDraft)
  if (!draft) return null
  const seg = draft.chapters[chapterIndex]?.segments[segmentIndex]
  if (!seg || seg.type !== 'narration') return null

  function setField(patch: { id?: string; hostId?: string; text?: string }) {
    update((m) => ({
      ...m,
      chapters: m.chapters.map((c, ci) =>
        ci !== chapterIndex
          ? c
          : {
              ...c,
              segments: c.segments.map((s, si) =>
                si !== segmentIndex || s.type !== 'narration' ? s : { ...s, ...patch },
              ),
            },
      ),
    }))
  }

  const hostExists = draft.hosts.some((h) => h.id === seg.hostId)
  const host = draft.hosts.find((h) => h.id === seg.hostId)
  const voiceRef = host?.voiceRef ?? ''
  const ttsModel = host?.ttsModel
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <FormField label="Segment ID">
          <input value={seg.id} onChange={(e) => setField({ id: e.target.value })} className={inputClass()} />
        </FormField>
        <FormField label="Host">
          <select
            value={seg.hostId}
            onChange={(e) => setField({ hostId: e.target.value })}
            className={inputClass(!hostExists)}
          >
            {draft.hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name || h.id}
              </option>
            ))}
            {!hostExists && <option value={seg.hostId}>⚠ {seg.hostId} (unknown)</option>}
          </select>
        </FormField>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-[0.15em] text-[var(--color-muted)]">
            Narration text
          </span>
          <PreviewButton text={seg.text} voiceRef={voiceRef} segmentId={seg.id} ttsModel={ttsModel} />
        </div>
        <textarea
          value={seg.text}
          onChange={(e) => setField({ text: e.target.value })}
          className={textareaClass()}
        />
      </div>
    </div>
  )
}
