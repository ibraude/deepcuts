import type { DraftManifest } from '../shared/manifest'

export interface PrerenderProgress {
  step: 'prerender'
  index: number
  total: number
  detail?: string
}

export interface PrerenderDone {
  step: 'done'
  rendered: number
  skipped: number
  warnings: string[]
}

export interface PrerenderError {
  step: 'error'
  message: string
}

export type PrerenderEvent = PrerenderProgress | PrerenderDone | PrerenderError

export interface PrerenderTask {
  segmentId: string
  text: string
  voiceRef: string
  ttsModel?: string
  kind: 'narration' | 'voiceover'
}

export interface SynthFn {
  (text: string, voiceRef: string, opts: { segmentId: string; modelId?: string }): Promise<{
    filePath: string
    cached: boolean
  }>
}

export interface PrerenderDeps {
  loadDraft: (draftId: string) => Promise<DraftManifest>
  synthesize: SynthFn
  emit: (event: PrerenderEvent) => void
  signal?: AbortSignal
}

export function collectPrerenderTasks(manifest: DraftManifest): PrerenderTask[] {
  const tasks: PrerenderTask[] = []
  const hostVoice = new Map<string, string>()
  const hostModel = new Map<string, string | undefined>()
  for (const h of manifest.hosts) {
    hostVoice.set(h.id, h.voiceRef)
    hostModel.set(h.id, h.ttsModel)
  }

  for (const chapter of manifest.chapters) {
    for (const segment of chapter.segments) {
      if (segment.type === 'narration') {
        const voiceRef = hostVoice.get(segment.hostId) ?? ''
        if (segment.text && voiceRef.startsWith('elevenlabs:')) {
          tasks.push({
            segmentId: segment.id,
            text: segment.text,
            voiceRef,
            ttsModel: hostModel.get(segment.hostId),
            kind: 'narration',
          })
        }
      } else if (segment.type === 'song' && segment.voiceovers) {
        for (const vo of segment.voiceovers) {
          const voiceRef = hostVoice.get(vo.hostId) ?? ''
          if (vo.text && voiceRef.startsWith('elevenlabs:')) {
            tasks.push({
              segmentId: vo.id,
              text: vo.text,
              voiceRef,
              ttsModel: hostModel.get(vo.hostId),
              kind: 'voiceover',
            })
          }
        }
      }
    }
  }
  return tasks
}

export async function prerenderDraft(
  draftId: string,
  deps: PrerenderDeps,
): Promise<{ rendered: number; skipped: number; warnings: string[] }> {
  const manifest = await deps.loadDraft(draftId)
  const tasks = collectPrerenderTasks(manifest)
  const warnings: string[] = []
  let rendered = 0
  let skipped = 0
  deps.emit({ step: 'prerender', index: 0, total: tasks.length })
  for (let i = 0; i < tasks.length; i++) {
    if (deps.signal?.aborted) throw new Error('Pre-render aborted')
    const t = tasks[i]!
    try {
      const result = await deps.synthesize(t.text, t.voiceRef, { segmentId: t.segmentId, modelId: t.ttsModel })
      if (result.cached) skipped++
      else rendered++
    } catch (err) {
      warnings.push(`Failed ${t.kind} "${t.segmentId}": ${err instanceof Error ? err.message : err}`)
    }
    deps.emit({
      step: 'prerender',
      index: i + 1,
      total: tasks.length,
      detail: `${t.kind}: ${t.segmentId}`,
    })
  }
  deps.emit({ step: 'done', rendered, skipped, warnings })
  return { rendered, skipped, warnings }
}
