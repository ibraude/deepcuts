import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { DraftManifest, DraftSummary } from '../../shared/manifest'

function setupMock() {
  const drafts: Record<string, DraftManifest> = {}
  const summaries: DraftSummary[] = []
  ;(globalThis as any).window = {
    deepcuts: {
      drafts: {
        list: vi.fn(async () => summaries.slice()),
        load: vi.fn(async (id: string) => structuredClone(drafts[id])),
        save: vi.fn(async (id: string, m: DraftManifest) => { drafts[id] = m }),
        create: vi.fn(async (m: DraftManifest) => {
          const id = Math.random().toString(36).slice(2, 18).padEnd(16, '0')
          drafts[id] = m
          summaries.push({
            draftId: id,
            title: m.title,
            subject: m.subject,
            hostCount: m.hosts.length,
            segmentCount: 1,
            hasCover: false,
            updatedAt: 0,
          })
          return id
        }),
        delete: vi.fn(async (id: string) => {
          delete drafts[id]
          const i = summaries.findIndex((s) => s.draftId === id)
          if (i >= 0) summaries.splice(i, 1)
        }),
        coverUrl: vi.fn(async () => null),
        setCover: vi.fn(async () => {}),
      },
    },
  }
  return { drafts, summaries }
}

beforeEach(() => {
  setupMock()
  vi.resetModules()
})

describe('editorStore', () => {
  it('refreshList populates drafts', async () => {
    const { useEditorStore } = await import('./editorStore')
    await useEditorStore.getState().createEmpty('Foo')
    await useEditorStore.getState().refreshList()
    expect(useEditorStore.getState().drafts.length).toBe(1)
    expect(useEditorStore.getState().drafts[0]!.title).toBe('Foo')
  })

  it('openDraft loads manifest and clears dirty', async () => {
    const { useEditorStore } = await import('./editorStore')
    const id = await useEditorStore.getState().createEmpty('Bar')
    await useEditorStore.getState().openDraft(id)
    expect(useEditorStore.getState().currentDraftId).toBe(id)
    expect(useEditorStore.getState().currentDraft?.title).toBe('Bar')
    expect(useEditorStore.getState().dirty).toBe(false)
  })

  it('updateDraft marks dirty without writing to disk', async () => {
    const { useEditorStore } = await import('./editorStore')
    const id = await useEditorStore.getState().createEmpty('Baz')
    await useEditorStore.getState().openDraft(id)
    useEditorStore.getState().updateDraft((m) => ({ ...m, title: 'Edited' }))
    expect(useEditorStore.getState().currentDraft?.title).toBe('Edited')
    expect(useEditorStore.getState().dirty).toBe(true)
  })

  it('saveDraft persists and clears dirty', async () => {
    const { useEditorStore } = await import('./editorStore')
    const id = await useEditorStore.getState().createEmpty('Qux')
    await useEditorStore.getState().openDraft(id)
    useEditorStore.getState().updateDraft((m) => ({ ...m, title: 'Saved' }))
    await useEditorStore.getState().saveDraft()
    expect(useEditorStore.getState().dirty).toBe(false)
    useEditorStore.getState().closeDraft()
    await useEditorStore.getState().openDraft(id)
    expect(useEditorStore.getState().currentDraft?.title).toBe('Saved')
  })

  it('remove deletes the draft and refreshes the list', async () => {
    const { useEditorStore } = await import('./editorStore')
    const id = await useEditorStore.getState().createEmpty('Goner')
    await useEditorStore.getState().refreshList()
    expect(useEditorStore.getState().drafts.length).toBe(1)
    await useEditorStore.getState().remove(id)
    expect(useEditorStore.getState().drafts.length).toBe(0)
  })
})
