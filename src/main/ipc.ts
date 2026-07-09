import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { IpcChannels } from '../shared/ipcSchema'
import { toSerializable } from '../shared/errors'
import { AppleScriptSpotify } from './music/AppleScriptSpotify'
import { ElevenLabsTTS } from './tts/ElevenLabsTTS'
import { deleteSecret, getSecret, setSecret } from './keychain'
import { catalogIndexSchema } from '../shared/catalog'
import { episodeManifestSchema } from '../shared/manifest'
import { createDrafts } from './drafts'
import { createLibrary } from './library'
import { GeminiImageProvider } from './image/GeminiImageProvider'
import { prerenderDraft, type PrerenderEvent } from './prerender'
import { createRemoteCatalog } from './catalog/RemoteCatalog'
import { createDownloadedEpisodes } from './downloaded/DownloadedEpisodes'
import { resolveContentBaseUrl } from '../shared/config'
import { parseServiceAccountJson, type VertexConfig } from './generation/vertexAuth'
import { GeminiProvider } from './generation/GeminiProvider'
import {
  runFullPipeline,
  runResearchOnly,
  runOutlineOnly,
  runScriptOnly,
  resolveSongsOnly,
  type ProgressEvent,
} from './generation/pipeline'
import type { GenerationInput, ProviderId } from './generation/ScriptProvider'
import type { DraftManifest } from '../shared/manifest'

const ELEVENLABS_KEY = 'elevenlabs'

function wrap<TArgs extends unknown[], TRet>(fn: (...a: TArgs) => Promise<TRet>) {
  return async (_e: Electron.IpcMainInvokeEvent, ...a: TArgs) => {
    try {
      return { ok: true as const, value: await fn(...a) }
    } catch (err) {
      return { ok: false as const, error: toSerializable(err) }
    }
  }
}

function episodesRoot() {
  return app.isPackaged
    ? join(process.resourcesPath, 'episodes')
    : join(app.getAppPath(), 'episodes')
}

export function registerIpc() {
  const spotify = new AppleScriptSpotify()

  ipcMain.handle(IpcChannels.SpotifyIsAvailable, wrap(() => spotify.isAvailable()))
  ipcMain.handle(IpcChannels.SpotifyEnsureReady, wrap(() => spotify.ensureReady()))
  ipcMain.handle(IpcChannels.SpotifyPlay, wrap((uri: string) => spotify.play(uri)))
  ipcMain.handle(IpcChannels.SpotifyPause, wrap(() => spotify.pause()))
  ipcMain.handle(IpcChannels.SpotifyGetPosition, wrap(() => spotify.getPosition()))
  ipcMain.handle(IpcChannels.SpotifyGetState, wrap(() => spotify.getState()))
  ipcMain.handle(IpcChannels.SpotifyGetCurrentTrack, wrap(() => spotify.getCurrentTrack()))
  ipcMain.handle(IpcChannels.SpotifyGetDuration, wrap(() => spotify.getDuration()))
  ipcMain.handle(IpcChannels.SpotifyGetVolume, wrap(() => spotify.getVolume()))
  ipcMain.handle(IpcChannels.SpotifySetVolume, wrap((pct: number) => spotify.setVolume(pct)))

  ipcMain.handle(
    IpcChannels.TtsElevenLabs,
    wrap(async (text: string, voiceRef: string, segmentId: string, modelId?: string) => {
      const apiKey = await getSecret(ELEVENLABS_KEY)
      if (!apiKey) throw new Error('No ElevenLabs API key set.')
      const cacheDir = join(app.getPath('userData'), 'narration-cache')
      const tts = new ElevenLabsTTS({ apiKey, cacheDir })
      // TEMPORARY diagnostic — trace exactly what voice ID and model the
      // renderer asks for, and what the cache does with it. Remove once the
      // wrong-voice regression is understood.
      // eslint-disable-next-line no-console
      console.log(
        `[TTS] req segmentId=${segmentId} voiceRef=${voiceRef} model=${modelId ?? '(default)'} textLen=${text.length}`,
      )
      const result = await tts.synthesize(text, voiceRef, { segmentId, modelId })
      // eslint-disable-next-line no-console
      console.log(
        `[TTS] resp segmentId=${segmentId} cached=${result.cached} file=${result.filePath}`,
      )
      return result
    }),
  )

  ipcMain.handle(IpcChannels.KeychainGet, wrap((key: string) => getSecret(key)))
  ipcMain.handle(IpcChannels.KeychainSet, wrap((key: string, value: string) => setSecret(key, value)))
  ipcMain.handle(IpcChannels.KeychainDelete, wrap((key: string) => deleteSecret(key)))

  ipcMain.handle(
    IpcChannels.CatalogLoadLocal,
    wrap(async () => {
      const root = episodesRoot()
      const entries = await fs.readdir(root).catch(() => [] as string[])
      const episodes: unknown[] = []
      for (const entry of entries) {
        if (!entry.endsWith('.json')) continue
        const raw = await fs.readFile(join(root, entry), 'utf-8')
        const manifest = episodeManifestSchema.parse(JSON.parse(raw))
        episodes.push({
          id: manifest.id,
          title: manifest.title,
          subject: manifest.subject,
          coverImage: manifest.coverImage,
          estimatedMinutes: manifest.estimatedMinutes,
          manifestPath: entry,
          prerendered: manifest.chapters
            .flatMap((c) => c.segments)
            .filter((s) => s.type === 'narration')
            .every((s: any) => !!s.audio),
        })
      }
      return catalogIndexSchema.parse({ episodes })
    }),
  )

  ipcMain.handle(
    IpcChannels.ManifestLoad,
    wrap(async (manifestPath: string) => {
      if (manifestPath.includes('..') || manifestPath.startsWith('/')) {
        throw new Error('Unsafe manifest path')
      }
      const raw = await fs.readFile(join(episodesRoot(), manifestPath), 'utf-8')
      return episodeManifestSchema.parse(JSON.parse(raw))
    }),
  )

  ipcMain.handle(
    IpcChannels.CoverUrl,
    wrap(async (coverPath: string) => {
      if (coverPath.includes('..')) throw new Error('Unsafe cover path')
      return 'file://' + join(episodesRoot(), coverPath)
    }),
  )

  ipcMain.handle(
    IpcChannels.OpenExternal,
    wrap(async (url: string) => {
      const allowed =
        url.startsWith('https://') ||
        url.startsWith('x-apple.systempreferences:')
      if (!allowed) throw new Error('Refused to open URL')
      await shell.openExternal(url)
    }),
  )

  const drafts = createDrafts({
    draftsRoot: () => join(app.getPath('userData'), 'drafts'),
    episodesRoot,
  })

  ipcMain.handle(IpcChannels.DraftsList, wrap(() => drafts.listDrafts()))
  ipcMain.handle(IpcChannels.DraftsLoad, wrap((id: string) => drafts.loadDraft(id)))
  ipcMain.handle(
    IpcChannels.DraftsSave,
    wrap((id: string, manifest: unknown) => drafts.saveDraft(id, manifest)),
  )
  ipcMain.handle(
    IpcChannels.DraftsCreate,
    wrap((initial: unknown) => drafts.createDraft(initial as any)),
  )
  ipcMain.handle(IpcChannels.DraftsDelete, wrap((id: string) => drafts.deleteDraft(id)))
  ipcMain.handle(
    IpcChannels.DraftsDuplicate,
    wrap((episodePath: string) => drafts.duplicateFromEpisode(episodePath)),
  )
  ipcMain.handle(IpcChannels.DraftsCoverUrl, wrap((id: string) => drafts.draftCoverUrl(id)))
  ipcMain.handle(
    IpcChannels.DraftsSetCover,
    wrap((id: string, sourcePath: string) => drafts.setDraftCover(id, sourcePath)),
  )

  // Library
  const library = createLibrary({
    libraryRoot: () => join(app.getPath('userData'), 'library'),
    draftsRoot: () => join(app.getPath('userData'), 'drafts'),
  })

  ipcMain.handle(IpcChannels.LibraryList, wrap(() => library.listLibrary()))
  ipcMain.handle(IpcChannels.LibraryPublish, wrap((draftId: string) => library.publish(draftId)))
  ipcMain.handle(IpcChannels.LibraryUnpublish, wrap((id: string) => library.unpublish(id)))
  ipcMain.handle(IpcChannels.LibraryLoadManifest, wrap((id: string) => library.loadManifest(id)))
  ipcMain.handle(IpcChannels.LibraryCoverUrl, wrap((id: string) => library.coverUrl(id)))
  ipcMain.handle(IpcChannels.LibraryIsPublished, wrap((id: string) => library.isPublished(id)))

  // Remote catalog
  const remoteCatalog = createRemoteCatalog({
    baseUrl: resolveContentBaseUrl(),
    cacheRoot: () => join(app.getPath('userData'), 'cache'),
  })

  const downloaded = createDownloadedEpisodes({
    downloadedRoot: () => join(app.getPath('userData'), 'downloaded'),
    catalog: remoteCatalog,
  })

  ipcMain.handle(IpcChannels.RemoteCatalogList, wrap(() => remoteCatalog.list()))
  ipcMain.handle(IpcChannels.RemoteCatalogRefresh, wrap(() => remoteCatalog.refresh()))
  ipcMain.handle(IpcChannels.RemoteCatalogLoadEpisode, wrap(async (id: string) => {
    const local = await downloaded.loadManifestLocal(id)
    if (local) return local
    return remoteCatalog.loadEpisode(id)
  }))
  ipcMain.handle(IpcChannels.RemoteCatalogLoadMeta, wrap((id: string) => remoteCatalog.loadMeta(id)))
  ipcMain.handle(IpcChannels.RemoteCatalogCoverUrl, wrap(async (id: string) => remoteCatalog.coverUrl(id)))

  ipcMain.handle(IpcChannels.DownloadedIsDownloaded, wrap((id: string) => downloaded.isDownloaded(id)))
  ipcMain.handle(IpcChannels.DownloadedRemove, wrap((id: string) => downloaded.remove(id)))
  ipcMain.handle(IpcChannels.DownloadedStart, wrap(async (id: string) => {
    await downloaded.start(id, (p) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IpcChannels.DownloadedProgress, { id, ...p })
      }
    })
  }))

  // Generation
  let abortController: AbortController | null = null

  function emitProgress(e: ProgressEvent) {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.GenerationProgress, e)
    }
  }

  function pipelineDeps(provider: GeminiProvider, signal: AbortSignal) {
    return {
      provider,
      createDraft: (m: DraftManifest, explicitId?: string) => drafts.createDraft(m, explicitId),
      saveDraft: (id: string, m: DraftManifest) => drafts.saveDraft(id, m),
      saveResearch: (id: string, md: string) => drafts.saveResearch(id, md),
      saveOutline: (id: string, o: unknown) => drafts.saveOutline(id, o),
      loadResearch: (id: string) => drafts.loadResearch(id),
      loadOutline: (id: string) => drafts.loadOutline(id),
      loadDraft: (id: string) => drafts.loadDraft(id),
      emit: emitProgress,
      signal,
    }
  }

  async function buildVertexConfig(project: string, location: string): Promise<VertexConfig> {
    if (!project.trim()) throw new Error('Vertex project ID is not set. Add it in Settings → Generation.')
    if (!location.trim()) throw new Error('Vertex location is not set. Add it in Settings → Generation.')
    const json = await getSecret('gemini-vertex-credentials')
    const credentials = json ? parseServiceAccountJson(json) : null
    return { project: project.trim(), location: location.trim(), credentials }
  }

  ipcMain.handle(
    IpcChannels.GenerationStart,
    wrap(
      async (args: {
        providerId: ProviderId
        modelId?: string
        vertexProject: string
        vertexLocation: string
        input: GenerationInput
      }) => {
        const { providerId, modelId, vertexProject, vertexLocation, input } = args
        if (providerId !== 'gemini') {
          throw new Error(`Provider ${providerId} not yet implemented.`)
        }
        const vertex = await buildVertexConfig(vertexProject, vertexLocation)
        abortController = new AbortController()
        try {
          const provider = new GeminiProvider({ vertex, modelId })
          const result = await runFullPipeline(input, pipelineDeps(provider, abortController.signal))
          return result
        } catch (err) {
          emitProgress({ step: 'error', message: err instanceof Error ? err.message : String(err) })
          throw err
        } finally {
          abortController = null
        }
      },
    ),
  )

  ipcMain.handle(
    IpcChannels.GenerationRunStep,
    wrap(
      async (args: {
        draftId: string
        step: 'research' | 'outline' | 'script' | 'resolve'
        providerId: ProviderId
        modelId?: string
        vertexProject: string
        vertexLocation: string
        input: GenerationInput
      }) => {
        const { draftId, step, providerId, modelId, vertexProject, vertexLocation, input } = args
        if (providerId !== 'gemini') throw new Error(`Provider ${providerId} not yet implemented.`)
        const vertex = await buildVertexConfig(vertexProject, vertexLocation)
        abortController = new AbortController()
        try {
          const provider = new GeminiProvider({ vertex, modelId })
          const deps = pipelineDeps(provider, abortController.signal)
          if (step === 'research') {
            await runResearchOnly(draftId, input, deps)
            return { warnings: [] }
          }
          if (step === 'outline') {
            await runOutlineOnly(draftId, input.subject, deps, input.lengthMinutes)
            return { warnings: [] }
          }
          if (step === 'script') {
            const r = await runScriptOnly(
              draftId,
              input.subject,
              deps,
              input.lengthMinutes,
              input.useAudioTags,
            )
            return r
          }
          if (step === 'resolve') {
            const r = await resolveSongsOnly(draftId, deps)
            return r
          }
          throw new Error(`Unknown step: ${step}`)
        } catch (err) {
          emitProgress({ step: 'error', message: err instanceof Error ? err.message : String(err) })
          throw err
        } finally {
          abortController = null
        }
      },
    ),
  )

  ipcMain.handle(IpcChannels.DraftsLoadResearch, wrap((id: string) => drafts.loadResearch(id)))
  ipcMain.handle(
    IpcChannels.DraftsSaveResearch,
    wrap((id: string, md: string) => drafts.saveResearch(id, md)),
  )
  ipcMain.handle(IpcChannels.DraftsLoadOutline, wrap((id: string) => drafts.loadOutline(id)))
  ipcMain.handle(
    IpcChannels.DraftsSaveOutline,
    wrap((id: string, outline: unknown) => drafts.saveOutline(id, outline)),
  )

  ipcMain.handle(
    IpcChannels.GenerationCancel,
    wrap(async () => {
      abortController?.abort()
    }),
  )

  // Pre-render
  let prerenderAbort: AbortController | null = null

  function emitPrerender(e: PrerenderEvent) {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.GenerationProgress, e)
    }
  }

  ipcMain.handle(
    IpcChannels.PrerenderStart,
    wrap(async (args: { draftId: string }) => {
      const apiKey = await getSecret('elevenlabs')
      if (!apiKey) throw new Error('No ElevenLabs API key set. Add one in Settings.')
      prerenderAbort = new AbortController()
      const cacheDir = join(app.getPath('userData'), 'narration-cache')
      const tts = new ElevenLabsTTS({ apiKey, cacheDir })
      try {
        const result = await prerenderDraft(args.draftId, {
          loadDraft: (id) => drafts.loadDraft(id),
          synthesize: (text, voiceRef, opts) => tts.synthesize(text, voiceRef, opts),
          emit: emitPrerender,
          signal: prerenderAbort.signal,
        })
        return result
      } catch (err) {
        emitPrerender({ step: 'error', message: err instanceof Error ? err.message : String(err) })
        throw err
      } finally {
        prerenderAbort = null
      }
    }),
  )

  ipcMain.handle(
    IpcChannels.PrerenderCancel,
    wrap(async () => {
      prerenderAbort?.abort()
    }),
  )

  // Image generation
  ipcMain.handle(
    IpcChannels.ImageGenerateAndSetCover,
    wrap(
      async (args: {
        draftId: string
        prompt: string
        providerId: 'gemini' | 'openai' | 'midjourney'
        modelId?: string
        vertexProject: string
        vertexImageLocation: string
      }) => {
        const { draftId, prompt, providerId, modelId, vertexProject, vertexImageLocation } = args
        if (providerId !== 'gemini') {
          throw new Error(`Image provider ${providerId} not yet implemented.`)
        }
        const vertex = await buildVertexConfig(vertexProject, vertexImageLocation)
        const provider = new GeminiImageProvider({ vertex, modelId })
        const { bytes } = await provider.generateImage({ prompt, aspect: 'square' })
        await drafts.setDraftCoverFromBytes(draftId, bytes)
      },
    ),
  )
}
