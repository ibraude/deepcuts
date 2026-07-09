import { useEditorStore } from '../editorStore'
import type { DraftManifest } from '../../../shared/manifest'
import { FormField, inputClass, textareaClass } from './FormField'
import { PreviewButton } from './PreviewButton'

type SongSegment = Extract<DraftManifest['chapters'][number]['segments'][number], { type: 'song' }>
type Voiceover = NonNullable<SongSegment['voiceovers']>[number]

interface VoiceoverEditorProps {
  chapterIndex: number
  segmentIndex: number
  voiceoverIndex: number
}

export function VoiceoverEditor({
  chapterIndex,
  segmentIndex,
  voiceoverIndex,
}: VoiceoverEditorProps) {
  const draft = useEditorStore((s) => s.currentDraft)
  const update = useEditorStore((s) => s.updateDraft)
  if (!draft) return null
  const seg = draft.chapters[chapterIndex]?.segments[segmentIndex]
  if (!seg || seg.type !== 'song') return null
  const vo = seg.voiceovers?.[voiceoverIndex]
  if (!vo) return null

  function setField(patch: Partial<Voiceover>) {
    update((m) => ({
      ...m,
      chapters: m.chapters.map((c, ci) =>
        ci !== chapterIndex
          ? c
          : {
              ...c,
              segments: c.segments.map((s, si) => {
                if (si !== segmentIndex || s.type !== 'song') return s
                const voiceovers = (s.voiceovers ?? []).map((v, vi) =>
                  vi !== voiceoverIndex ? v : { ...v, ...patch },
                )
                return { ...s, voiceovers }
              }),
            },
      ),
    }))
  }

  const hostExists = draft.hosts.some((h) => h.id === vo.hostId)
  const host = draft.hosts.find((h) => h.id === vo.hostId)
  const voiceRef = host?.voiceRef ?? ''
  const ttsModel = host?.ttsModel
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <FormField label="VO ID">
          <input value={vo.id} onChange={(e) => setField({ id: e.target.value })} className={inputClass()} />
        </FormField>
        <FormField label="Host">
          <select
            value={vo.hostId}
            onChange={(e) => setField({ hostId: e.target.value })}
            className={inputClass(!hostExists)}
          >
            {draft.hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name || h.id}
              </option>
            ))}
            {!hostExists && <option value={vo.hostId}>⚠ {vo.hostId}</option>}
          </select>
        </FormField>
        <FormField label="At (s)">
          <input
            type="number"
            min={0}
            step={1}
            value={vo.atSeconds}
            onChange={(e) => setField({ atSeconds: Number(e.target.value) || 0 })}
            className={inputClass()}
          />
        </FormField>
      </div>
      <div className="grid grid-cols-3 gap-3 items-end">
        <FormField label="Duck to %" hint="0–100, default 55">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={vo.duckTo}
            onChange={(e) =>
              setField({ duckTo: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })
            }
            className={inputClass()}
          />
        </FormField>
        <label className="flex items-center gap-2 text-xs pb-2">
          <input
            type="checkbox"
            checked={vo.holdDuck}
            onChange={(e) => setField({ holdDuck: e.target.checked })}
          />
          <span>Hold duck (chain to next VO)</span>
        </label>
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-[0.15em] text-[var(--color-muted)]">
            Voiceover text
          </span>
          <PreviewButton text={vo.text} voiceRef={voiceRef} segmentId={vo.id} ttsModel={ttsModel} />
        </div>
        <textarea
          value={vo.text}
          onChange={(e) => setField({ text: e.target.value })}
          className={textareaClass()}
        />
      </div>
    </div>
  )
}
