import { readFile, readdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { episodeMetaSchema } from '../src/shared/meta'

const here = dirname(fileURLToPath(import.meta.url))
const episodesDir = join(here, '..', 'content', 'episodes')

const dirs = await readdir(episodesDir)
let ok = 0
for (const d of dirs) {
  const raw = await readFile(join(episodesDir, d, 'meta.json'), 'utf-8')
  episodeMetaSchema.parse(JSON.parse(raw))
  ok++
}
console.log(`validated ${ok} meta.json files`)
