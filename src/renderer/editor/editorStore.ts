import { create } from 'zustand'
import {
  draftManifestSchema,
  episodeManifestSchema,
  type DraftManifest,
  type DraftSummary,
} from '../../shared/manifest'
import { usePlayerStore } from '../player/playerStore'

interface EditorStore {
  drafts: DraftSummary[]
  currentDraftId: string | null
  currentDraft: DraftManifest | null
  dirty: boolean
  loadingList: boolean
  loadingDraft: boolean
  error: string | null
  previewingDraftId: string | null

  refreshList(): Promise<void>
  openDraft(draftId: string): Promise<void>
  closeDraft(): void
  updateDraft(updater: (m: DraftManifest) => DraftManifest): void
  saveDraft(): Promise<void>
  createEmpty(title: string): Promise<string>
  remove(draftId: string): Promise<void>
  startPreview(draftId: string): Promise<{ ok: true } | { ok: false; errors: string[] }>
  exitPreview(): void
}

function makeEmptyManifest(title: string): DraftManifest {
  return {
    schemaVersion: 1,
    id: 'draft',
    title,
    subject: '',
    coverImage: '',
    estimatedMinutes: 5,
    hosts: [
      {
        id: 'host_a',
        name: 'Narrator',
        persona: '',
        voiceRef: 'elevenlabs:iP95p4xoKVk53GoZ742B',
      },
    ],
    chapters: [
      {
        title: 'Untitled chapter',
        segments: [
          { type: 'narration', id: 'n0', hostId: 'host_a', text: '' },
        ],
      },
    ],
    sources: [],
    facts: [],
  }
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  drafts: [],
  currentDraftId: null,
  currentDraft: null,
  dirty: false,
  loadingList: false,
  loadingDraft: false,
  error: null,
  previewingDraftId: null,

  async refreshList() {
    set({ loadingList: true, error: null })
    try {
      const list = await window.deepcuts.drafts.list()
      set({ drafts: list })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to list drafts' })
    } finally {
      set({ loadingList: false })
    }
  },

  async openDraft(draftId) {
    set({ loadingDraft: true, error: null, currentDraftId: draftId })
    try {
      const raw = await window.deepcuts.drafts.load(draftId)
      const parsed = draftManifestSchema.parse(raw)
      set({ currentDraft: parsed, dirty: false })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Failed to open draft' })
    } finally {
      set({ loadingDraft: false })
    }
  },

  closeDraft() {
    set({ currentDraftId: null, currentDraft: null, dirty: false })
  },

  updateDraft(updater) {
    const cur = get().currentDraft
    if (!cur) return
    set({ currentDraft: updater(cur), dirty: true })
  },

  async saveDraft() {
    const { currentDraftId, currentDraft } = get()
    if (!currentDraftId || !currentDraft) return
    await window.deepcuts.drafts.save(currentDraftId, currentDraft)
    set({ dirty: false })
  },

  async createEmpty(title) {
    const id = await window.deepcuts.drafts.create(makeEmptyManifest(title))
    await get().refreshList()
    return id
  },

  async remove(draftId) {
    await window.deepcuts.drafts.delete(draftId)
    if (get().currentDraftId === draftId) {
      set({ currentDraftId: null, currentDraft: null, dirty: false })
    }
    await get().refreshList()
  },

  async startPreview(draftId) {
    try {
      const raw = await window.deepcuts.drafts.load(draftId)
      const parsed = episodeManifestSchema.safeParse(raw)
      if (!parsed.success) {
        return {
          ok: false,
          errors: parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message),
        }
      }
      // Rewrite coverImage to an absolute file:// URL pointing at the draft's cover.
      // Without this, the Player's Cover component would resolve `cover.png` against
      // the bundled episodes directory and fail to find it.
      const draftCoverUrl = await window.deepcuts.drafts.coverUrl(draftId).catch(() => null)
      const manifestForPreview = draftCoverUrl
        ? { ...parsed.data, coverImage: draftCoverUrl }
        : parsed.data
      set({ previewingDraftId: draftId })
      await usePlayerStore.getState().startWithManifest(manifestForPreview)
      return { ok: true }
    } catch (e) {
      return { ok: false, errors: [e instanceof Error ? e.message : 'Preview failed'] }
    }
  },

  exitPreview() {
    usePlayerStore.getState().stop()
    set({ previewingDraftId: null })
  },
}))
