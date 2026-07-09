import { promises as nodefs } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  episodeManifestSchema,
  flattenSegments,
  type DraftManifest,
  type EpisodeManifest,
} from '../src/shared/manifest'
import { episodeMetaSchema, type EpisodeMeta } from '../src/shared/meta'
import { remoteCatalogSchema, type RemoteCatalogIndex } from '../src/shared/catalog'
import { resolveContentBaseUrl } from '../src/shared/config'
import type { SynthFn } from '../src/main/prerender'

export interface PublishEpisodeArgs {
  draftDir: string
  contentDir: string
  status: 'released' | 'upcoming'
  order?: number
  today?: () => string
  synthesize?: SynthFn
  fs?: Pick<typeof nodefs, 'readFile' | 'writeFile' | 'mkdir' | 'copyFile'>
  baseUrl?: string
}

export async function publishEpisode(args: PublishEpisodeArgs): Promise<void> {
  const fs = args.fs ?? nodefs
  const baseUrl = args.baseUrl ?? resolveContentBaseUrl()
  const today = (args.today ?? (() => new Date().toISOString().slice(0, 10)))()

  const draftRaw = await fs.readFile(join(args.draftDir, 'manifest.json'), 'utf-8')
  const draft = JSON.parse(draftRaw as unknown as string) as DraftManifest
  const id = draft.id
  const episodeDir = join(args.contentDir, 'episodes', id)

  await fs.mkdir(episodeDir, { recursive: true })
  await fs.copyFile(join(args.draftDir, 'cover.png'), join(episodeDir, 'cover.png'))

  const metaRaw = await fs.readFile(join(args.draftDir, 'meta.json'), 'utf-8')
  const meta: EpisodeMeta = episodeMetaSchema.parse(JSON.parse(metaRaw as unknown as string))
  await fs.writeFile(join(episodeDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')

  if (args.status === 'released') {
    if (!args.synthesize) throw new Error('synthesize is required for released episodes')
    episodeManifestSchema.parse(draft)

    const flat = flattenSegments(draft as unknown as EpisodeManifest)
    for (const seg of flat) {
      if (seg.type === 'narration' && seg.text) {
        const host = draft.hosts.find((h) => h.id === seg.hostId)
        if (!host) throw new Error(`Unknown hostId ${seg.hostId} on segment ${seg.id}`)
        const { filePath } = await args.synthesize(seg.text, host.voiceRef, {
          segmentId: seg.id, modelId: host.ttsModel,
        })
        await fs.mkdir(join(episodeDir, 'audio'), { recursive: true })
        await fs.copyFile(filePath, join(episodeDir, 'audio', `${seg.id}.mp3`))
      }
      if (seg.type === 'song' && seg.voiceovers) {
        for (const vo of seg.voiceovers) {
          const host = draft.hosts.find((h) => h.id === vo.hostId)
          if (!host) throw new Error(`Unknown hostId ${vo.hostId} on voiceover ${vo.id}`)
          const { filePath } = await args.synthesize(vo.text, host.voiceRef, {
            segmentId: vo.id, modelId: host.ttsModel,
          })
          await fs.mkdir(join(episodeDir, 'audio'), { recursive: true })
          await fs.copyFile(filePath, join(episodeDir, 'audio', `${vo.id}.mp3`))
        }
      }
    }

    const rewrittenManifest: EpisodeManifest = {
      ...(draft as unknown as EpisodeManifest),
      chapters: draft.chapters.map((ch) => ({
        ...ch,
        segments: ch.segments.map((s) => {
          if (s.type === 'narration') {
            return { ...s, audio: `${baseUrl}/episodes/${id}/audio/${s.id}.mp3` }
          }
          if (s.type === 'song' && s.voiceovers) {
            return {
              ...s,
              voiceovers: s.voiceovers.map((vo) => ({
                ...vo, audio: `${baseUrl}/episodes/${id}/audio/${vo.id}.mp3`,
              })),
            }
          }
          return s
        }),
      })),
    } as EpisodeManifest
    episodeManifestSchema.parse(rewrittenManifest)
    await fs.writeFile(
      join(episodeDir, 'manifest.json'),
      JSON.stringify(rewrittenManifest, null, 2), 'utf-8',
    )
  }

  const catalogPath = join(args.contentDir, 'catalog.json')
  const catalogRaw = await fs.readFile(catalogPath, 'utf-8')
  const catalog: RemoteCatalogIndex = remoteCatalogSchema.parse(JSON.parse(catalogRaw as unknown as string))
  const existing = catalog.episodes.find((e) => e.id === id)
  const orderValue = args.order ?? existing?.order ?? (catalog.episodes.reduce((m, e) => Math.max(m, e.order), 0) + 1)

  const entry = args.status === 'released'
    ? { id, status: 'released' as const, releaseDate: today, order: orderValue }
    : {
        id, status: 'upcoming' as const,
        expectedRelease: meta.expectedRelease ?? 'TBA',
        order: orderValue,
      }

  const others = catalog.episodes.filter((e) => e.id !== id)
  const next: RemoteCatalogIndex = {
    schemaVersion: 1,
    updatedAt: `${today}T00:00:00Z`,
    episodes: [...others, entry].sort((a, b) => a.order - b.order),
  }
  await fs.writeFile(catalogPath, JSON.stringify(next, null, 2), 'utf-8')

  console.log(`Published ${id} (${args.status}, order ${orderValue}).`)
  console.log(`Suggested commit: git add content/ && git commit -m "content: publish ${id}"`)
}

const isCli = typeof process !== 'undefined' && process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isCli) {
  const arg = (k: string): string | undefined => {
    const i = process.argv.indexOf(`--${k}`)
    return i >= 0 ? process.argv[i + 1] : undefined
  }
  const draftId = arg('draft')
  const status = (arg('status') ?? 'released') as 'released' | 'upcoming'
  const order = arg('order') ? Number(arg('order')) : undefined
  if (!draftId) {
    console.error('Usage: publish-episode --draft <id> [--status released|upcoming] [--order N]')
    process.exit(1)
  }
  const home = process.env.HOME ?? ''
  const draftDir = join(home, 'Library/Application Support/deepcuts/drafts', draftId)
  const contentDir = join(process.cwd(), 'content')
  publishEpisode({
    draftDir, contentDir, status, order,
    synthesize: async () => {
      throw new Error(
        'Live synthesis from CLI is not wired yet. Pre-render from the app first via the ' +
        'Prerender action, then re-run this script — it will pick up the cached MP3s from ' +
        'userData/narration-cache. TODO(catalog): add --from-narration-cache flag.',
      )
    },
  }).catch((err: unknown) => { console.error(err); process.exit(1) })
}
