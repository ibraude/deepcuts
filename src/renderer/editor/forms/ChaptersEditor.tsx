import { useEditorStore } from '../editorStore'
import { inputClass } from './FormField'
import { SegmentList } from './SegmentList'

export function ChaptersEditor() {
  const draft = useEditorStore((s) => s.currentDraft)
  const update = useEditorStore((s) => s.updateDraft)
  if (!draft) return null

  function setChapter(idx: number, title: string) {
    update((m) => ({
      ...m,
      chapters: m.chapters.map((c, i) => (i === idx ? { ...c, title } : c)),
    }))
  }
  function addChapter() {
    update((m) => ({
      ...m,
      chapters: [
        ...m.chapters,
        {
          title: 'New chapter',
          segments: [
            {
              type: 'narration',
              id: `n${Date.now()}`,
              hostId: m.hosts[0]?.id ?? 'host_a',
              text: '',
            },
          ],
        },
      ],
    }))
  }
  function removeChapter(idx: number) {
    update((m) => ({ ...m, chapters: m.chapters.filter((_, i) => i !== idx) }))
  }
  function moveChapter(idx: number, dir: -1 | 1) {
    update((m) => {
      const next = m.chapters.slice()
      const tgt = idx + dir
      if (tgt < 0 || tgt >= next.length) return m
      ;[next[idx], next[tgt]] = [next[tgt]!, next[idx]!]
      return { ...m, chapters: next }
    })
  }

  return (
    <section className="space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">Chapters</h2>
        <button
          onClick={addChapter}
          className="text-xs px-2 py-1 rounded-md border border-[var(--color-hairline)] hover:bg-white/5"
        >
          + Chapter
        </button>
      </div>
      {draft.chapters.map((chapter, idx) => (
        <div key={idx} className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] tracking-[0.2em] uppercase text-[var(--color-muted)] shrink-0">
              Ch {idx + 1}
            </span>
            <input
              value={chapter.title}
              onChange={(e) => setChapter(idx, e.target.value)}
              placeholder="Chapter title"
              className={inputClass() + ' flex-1 text-base font-medium'}
            />
            <button
              onClick={() => moveChapter(idx, -1)}
              className="text-xs px-1.5 py-1 rounded-sm hover:bg-white/5 text-[var(--color-muted)]"
              aria-label="Move up"
            >
              ↑
            </button>
            <button
              onClick={() => moveChapter(idx, 1)}
              className="text-xs px-1.5 py-1 rounded-sm hover:bg-white/5 text-[var(--color-muted)]"
              aria-label="Move down"
            >
              ↓
            </button>
            {draft.chapters.length > 1 && (
              <button
                onClick={() => removeChapter(idx)}
                className="text-xs px-2 py-1 text-[var(--color-muted)] hover:text-red-400"
              >
                Remove
              </button>
            )}
          </div>
          <SegmentList chapterIndex={idx} />
        </div>
      ))}
    </section>
  )
}
