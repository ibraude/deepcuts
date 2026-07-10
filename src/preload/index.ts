import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '../shared/ipcSchema'
import { fromSerializable, type SerializableError } from '../shared/errors'

type IpcResult<T> = { ok: true; value: T } | { ok: false; error: SerializableError }

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!res.ok) throw fromSerializable(res.error)
  return res.value
}

const api = {
  spotify: {
    isAvailable: () => invoke<boolean>(IpcChannels.SpotifyIsAvailable),
    ensureReady: () => invoke<void>(IpcChannels.SpotifyEnsureReady),
    play: (uri: string) => invoke<void>(IpcChannels.SpotifyPlay, uri),
    pause: () => invoke<void>(IpcChannels.SpotifyPause),
    getPosition: () => invoke<number>(IpcChannels.SpotifyGetPosition),
    getState: () => invoke<'playing' | 'paused' | 'stopped'>(IpcChannels.SpotifyGetState),
    getCurrentTrack: () =>
      invoke<{ id: string; uri: string; name?: string; artist?: string }>(IpcChannels.SpotifyGetCurrentTrack),
    getDuration: () => invoke<number>(IpcChannels.SpotifyGetDuration),
    getVolume: () => invoke<number>(IpcChannels.SpotifyGetVolume),
    setVolume: (pct: number) => invoke<void>(IpcChannels.SpotifySetVolume, pct),
  },
  tts: {
    elevenlabs: (text: string, voiceRef: string, segmentId: string, modelId?: string) =>
      invoke<{ filePath: string; cached: boolean }>(
        IpcChannels.TtsElevenLabs,
        text,
        voiceRef,
        segmentId,
        modelId,
      ),
  },
  keychain: {
    get: (key: string) => invoke<string | null>(IpcChannels.KeychainGet, key),
    set: (key: string, value: string) => invoke<void>(IpcChannels.KeychainSet, key, value),
    delete: (key: string) => invoke<void>(IpcChannels.KeychainDelete, key),
  },
  shell: {
    openExternal: (url: string) => invoke<void>(IpcChannels.OpenExternal, url),
  },
  generation: {
    start: (args: {
      providerId: 'gemini' | 'claude' | 'openai'
      modelId?: string
      vertexProject: string
      vertexLocation: string
      input: {
        subject: string
        hints?: string
        lengthMinutes?: number
        useSearch: boolean
        useAudioTags?: boolean
      }
    }) => invoke<{ draftId: string; warnings: string[] }>(IpcChannels.GenerationStart, args),
    cancel: () => invoke<void>(IpcChannels.GenerationCancel),
    runStep: (args: {
      draftId: string
      step: 'research' | 'outline' | 'script' | 'resolve'
      providerId: 'gemini' | 'claude' | 'openai'
      modelId?: string
      vertexProject: string
      vertexLocation: string
      input: {
        subject: string
        hints?: string
        lengthMinutes?: number
        useSearch: boolean
        useAudioTags?: boolean
      }
    }) => invoke<{ warnings: string[] }>(IpcChannels.GenerationRunStep, args),
    onProgress: (handler: (event: unknown) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, event: unknown) => handler(event)
      ipcRenderer.on(IpcChannels.GenerationProgress, listener)
      return () => {
        ipcRenderer.removeListener(IpcChannels.GenerationProgress, listener)
      }
    },
  },
  library: {
    list: () => invoke<import('../shared/manifest').LibrarySummary[]>(IpcChannels.LibraryList),
    publish: (draftId: string) => invoke<string>(IpcChannels.LibraryPublish, draftId),
    unpublish: (libraryId: string) => invoke<void>(IpcChannels.LibraryUnpublish, libraryId),
    loadManifest: (libraryId: string) => invoke<unknown>(IpcChannels.LibraryLoadManifest, libraryId),
    coverUrl: (libraryId: string) => invoke<string | null>(IpcChannels.LibraryCoverUrl, libraryId),
    isPublished: (draftId: string) => invoke<boolean>(IpcChannels.LibraryIsPublished, draftId),
  },
  remoteCatalog: {
    list: () => invoke<import('../shared/catalog').RemoteCatalogIndex>(IpcChannels.RemoteCatalogList),
    refresh: () => invoke<import('../shared/catalog').RemoteCatalogIndex>(IpcChannels.RemoteCatalogRefresh),
    loadEpisode: (id: string) =>
      invoke<import('../shared/manifest').EpisodeManifest>(IpcChannels.RemoteCatalogLoadEpisode, id),
    loadMeta: (id: string) =>
      invoke<import('../shared/meta').EpisodeMeta>(IpcChannels.RemoteCatalogLoadMeta, id),
    coverUrl: (id: string) => invoke<string>(IpcChannels.RemoteCatalogCoverUrl, id),
  },
  downloaded: {
    isDownloaded: (id: string) => invoke<boolean>(IpcChannels.DownloadedIsDownloaded, id),
    start: (id: string) => invoke<void>(IpcChannels.DownloadedStart, id),
    remove: (id: string) => invoke<void>(IpcChannels.DownloadedRemove, id),
    onProgress: (cb: (p: { id: string; total: number; done: number; currentUrl: string }) => void) => {
      const listener = (_e: Electron.IpcRendererEvent, payload: { id: string; total: number; done: number; currentUrl: string }) => cb(payload)
      ipcRenderer.on(IpcChannels.DownloadedProgress, listener)
      return () => { ipcRenderer.removeListener(IpcChannels.DownloadedProgress, listener) }
    },
  },
  drafts: {
    list: () =>
      invoke<
        Array<{
          draftId: string
          title: string
          subject: string
          hostCount: number
          segmentCount: number
          hasCover: boolean
          updatedAt: number
        }>
      >(IpcChannels.DraftsList),
    load: (draftId: string) => invoke<unknown>(IpcChannels.DraftsLoad, draftId),
    save: (draftId: string, manifest: unknown) =>
      invoke<void>(IpcChannels.DraftsSave, draftId, manifest),
    create: (initial: unknown) => invoke<string>(IpcChannels.DraftsCreate, initial),
    delete: (draftId: string) => invoke<void>(IpcChannels.DraftsDelete, draftId),
    coverUrl: (draftId: string) => invoke<string | null>(IpcChannels.DraftsCoverUrl, draftId),
    setCover: (draftId: string, sourcePath: string) =>
      invoke<void>(IpcChannels.DraftsSetCover, draftId, sourcePath),
    loadResearch: (draftId: string) => invoke<string>(IpcChannels.DraftsLoadResearch, draftId),
    saveResearch: (draftId: string, markdown: string) =>
      invoke<void>(IpcChannels.DraftsSaveResearch, draftId, markdown),
    loadOutline: (draftId: string) => invoke<unknown>(IpcChannels.DraftsLoadOutline, draftId),
    saveOutline: (draftId: string, outline: unknown) =>
      invoke<void>(IpcChannels.DraftsSaveOutline, draftId, outline),
  },
  image: {
    generateAndSetCover: (args: {
      draftId: string
      prompt: string
      providerId: 'gemini' | 'openai' | 'midjourney'
      modelId?: string
      vertexProject: string
      vertexImageLocation: string
    }) => invoke<void>(IpcChannels.ImageGenerateAndSetCover, args),
  },
  prerender: {
    start: (args: { draftId: string }) =>
      invoke<{ rendered: number; skipped: number; warnings: string[] }>(IpcChannels.PrerenderStart, args),
    cancel: () => invoke<void>(IpcChannels.PrerenderCancel),
  },
}

contextBridge.exposeInMainWorld('deepcuts', api)

export type DeepcutsApi = typeof api
