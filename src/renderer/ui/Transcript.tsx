import { useEffect, useMemo, useRef, useState } from 'react'
import type { SchedulerState } from '../player/Scheduler'

interface Word {
  start: number
  end: number
  text: string
}

function splitWords(text: string): Word[] {
  const words: Word[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    words.push({ start: m.index, end: m.index + m[0].length, text: m[0] })
  }
  return words
}

function pickTarget(state: SchedulerState): { id: string; text: string; live: boolean } | null {
  // Active voiceover trumps everything.
  const status = state.status
  if (status.kind === 'playing-narration-over-song') {
    const seg = state.segments[state.segmentIndex]
    if (seg?.type === 'song') {
      const vo = seg.voiceovers?.find((v) => v.id === status.voiceoverId)
      if (vo) return { id: vo.id, text: vo.text, live: true }
    }
  }
  const current = state.segments[state.segmentIndex]
  if (current && current.type === 'narration') {
    return { id: current.id, text: current.text, live: state.status.kind === 'playing-narration' }
  }
  // Dimmed fallback: most-recent narration.
  const previous = [...state.segments.slice(0, state.segmentIndex)].reverse().find((s) => s.type === 'narration')
  if (previous && previous.type === 'narration') return { id: previous.id, text: previous.text, live: false }
  return null
}

export function Transcript({ state, charIndex }: { state: SchedulerState; charIndex: number }) {
  const target = pickTarget(state)

  const [renderedId, setRenderedId] = useState<string | null>(target?.id ?? null)
  const [renderedText, setRenderedText] = useState<string>(target?.text ?? '')
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (!target) {
      setRenderedId(null); setRenderedText(''); return
    }
    if (target.id === renderedId) return
    setVisible(false)
    const t = setTimeout(() => {
      setRenderedId(target.id)
      setRenderedText(target.text)
      setVisible(true)
    }, 180)
    return () => clearTimeout(t)
  }, [target, renderedId])

  const words = useMemo(() => splitWords(renderedText), [renderedText])
  const activeRef = useRef<HTMLSpanElement | null>(null)
  const containerRef = useRef<HTMLParagraphElement | null>(null)

  const isLive = !!target?.live

  useEffect(() => {
    if (!isLive || !activeRef.current || !containerRef.current) return
    const el = activeRef.current
    const container = containerRef.current
    const elRect = el.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    if (elRect.top < containerRect.top + 40 || elRect.bottom > containerRect.bottom - 40) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [charIndex, isLive])

  if (!target) return null

  return (
    <p
      ref={containerRef}
      className="leading-relaxed text-base max-w-prose transition-opacity duration-200 ease-out"
      style={{ opacity: visible ? 1 : 0 }}
    >
      {isLive
        ? words.map((w, i) => {
            const active = charIndex >= w.start && charIndex < w.end + 1
            const past = w.end <= charIndex
            const cls = active
              ? 'text-[var(--color-text)] transition-colors duration-100'
              : past
                ? 'text-[var(--color-text)]/70 transition-colors duration-200'
                : 'text-[var(--color-text)]/30 transition-colors duration-300'
            return (
              <span key={i} ref={active ? activeRef : null} className={cls}>
                {w.text}
                {i < words.length - 1 ? ' ' : ''}
              </span>
            )
          })
        : <span className="text-[var(--color-muted)]">{renderedText}</span>}
    </p>
  )
}
