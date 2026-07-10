#!/usr/bin/env tsx
/**
 * One-shot: refresh cover + meta for every episode in the catalog,
 * add two new episodes (ziggy-stardust, all-things-must-pass),
 * and schedule expectedRelease as sequential Fridays for anything not yet
 * marked released.
 *
 * Idempotent. Rerun after tweaking the seed data below to re-apply.
 */

import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { episodeMetaSchema } from '../src/shared/meta'
import { remoteCatalogSchema, type RemoteCatalogIndex } from '../src/shared/catalog'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..')
const CONTENT_DIR = join(REPO_ROOT, 'content')
const COVERS_DIR = join(process.env.HOME ?? '', 'Documents/Deepcuts')

interface Seed {
  id: string
  cover: string // filename in COVERS_DIR
  artistName: string
  albumName: string
  blurb: string
  palette: { bg: string; ink: string; accent: string }
}

/**
 * Palettes below approximate the dominant tones of each cover — the site
 * uses `accent` for the currently-playing card's glow + progress bar.
 */
const SEEDS: Seed[] = [
  {
    id: 'almost-blue',
    cover: 'chet2.png',
    artistName: 'Chet Baker',
    albumName: 'Almost Blue',
    blurb: 'A portrait of Chet Baker. The music. The silence. The beauty. And the blues that never left.',
    palette: { bg: '#e8e4d6', ink: '#0e2a44', accent: '#2f6ea1' },
  },
  {
    id: 'waiting-around-to-die',
    cover: 'townes.png',
    artistName: 'Townes Van Zandt',
    albumName: 'Waiting Around to Die',
    blurb: 'The outcast poet of American song. A voice like no other. Beautiful, broken, and impossible to forget.',
    palette: { bg: '#eee6d3', ink: '#182234', accent: '#a45a1d' },
  },
  {
    id: 'bill-withers-carnegie',
    cover: 'bill.png',
    artistName: 'Bill Withers',
    albumName: 'Live at Carnegie Hall',
    blurb: 'The songs. The stories. The man. A night to remember at Carnegie Hall, 1972.',
    palette: { bg: '#efe4d0', ink: '#1a1512', accent: '#b6501f' },
  },
  {
    id: 'solid-air',
    cover: 'john.png',
    artistName: 'John Martyn',
    albumName: 'Solid Air',
    blurb: 'Late-night, small-room, big-feeling. Martyn’s tender, fractured tribute to Nick Drake, and the album’s ghost that never quite leaves.',
    palette: { bg: '#eae4d1', ink: '#1e3247', accent: '#87a5c2' },
  },
  {
    id: 'blonde-on-blonde',
    cover: 'image4.png',
    artistName: 'Bob Dylan',
    albumName: 'Blonde on Blonde',
    blurb: 'That thin, wild mercury sound. Nashville, 1966. The first double album in rock and one of its most enduring puzzles.',
    palette: { bg: '#e8ded1', ink: '#2c1e12', accent: '#8a6134' },
  },
  {
    id: 'heart-of-saturday-night',
    cover: 'tom waits - saturday night.png',
    artistName: 'Tom Waits',
    albumName: 'The Heart of Saturday Night',
    blurb: 'Bar-stool poetry, honking horns, and the promise of a lonesome city Saturday. Waits before Waits became Waits.',
    palette: { bg: '#e6dccb', ink: '#1b1610', accent: '#7c3f1f' },
  },
  {
    id: 'dusk',
    cover: 'the the dusk.png',
    artistName: 'The The',
    albumName: 'Dusk',
    blurb: 'Matt Johnson’s aching, apocalyptic love-letter to grief, sex, and the end of things. The most human record of its decade.',
    palette: { bg: '#dfd6c2', ink: '#241b18', accent: '#6b2b2b' },
  },
  {
    id: 'five-leaves-left',
    cover: 'nick-drake.png',
    artistName: 'Nick Drake',
    albumName: 'Five Leaves Left',
    blurb: 'A twenty-year-old with a guitar, a string section, and eternity in his voice. The debut that still hasn’t stopped whispering.',
    palette: { bg: '#e9e3d1', ink: '#232a20', accent: '#5a6d3f' },
  },
  {
    id: 'small-change',
    cover: 'tom waits small change.png',
    artistName: 'Tom Waits',
    albumName: 'Small Change',
    blurb: 'The piano-and-whiskey Waits at his most romantic and ruined. A skid-row masterpiece dressed in a rumpled tux.',
    palette: { bg: '#e5dbc5', ink: '#181410', accent: '#8d5b25' },
  },
  {
    id: 'strangeways',
    cover: 'the smiths.png',
    artistName: 'The Smiths',
    albumName: 'Strangeways, Here We Come',
    blurb: 'Their final record. Their best record. Morrissey and Marr at the edge of the cliff, still holding hands.',
    palette: { bg: '#e2dccc', ink: '#1a2634', accent: '#5b7fa1' },
  },
  {
    id: 'prince-of-darkness',
    cover: 'nick cave.png',
    artistName: 'Nick Cave',
    albumName: 'The Prince of Darkness',
    blurb: 'The murder ballads, the love songs, the god-haunted noise. Cave from the Birthday Party to the pulpit.',
    palette: { bg: '#d9d1c0', ink: '#0e0e10', accent: '#7a1e1e' },
  },
  {
    id: 'there-goes-rhymin-simon',
    cover: 'paul simon.png',
    artistName: 'Paul Simon',
    albumName: 'There Goes Rhymin’ Simon',
    blurb: 'Muscle Shoals, gospel, reggae, calypso, and one of the sharpest song-writers alive putting them all in the same room.',
    palette: { bg: '#ebe3ce', ink: '#182920', accent: '#3d6b52' },
  },
  {
    id: 'mad-dogs-and-englishmen',
    cover: 'joe cocker mad dogs.png',
    artistName: 'Joe Cocker',
    albumName: 'Mad Dogs & Englishmen',
    blurb: 'Leon Russell’s Circus, Cocker’s wounded lion of a voice, and the most gloriously chaotic tour in rock history.',
    palette: { bg: '#eadfc7', ink: '#1c1610', accent: '#a04a1c' },
  },
  {
    id: 'rumours',
    cover: 'rumours.png',
    artistName: 'Fleetwood Mac',
    albumName: 'Rumours',
    blurb: 'Five people, five heartbreaks, one impossible record. The most beautiful bad breakup in pop.',
    palette: { bg: '#ebe1cc', ink: '#251a12', accent: '#a67435' },
  },
  {
    id: 'music-from-big-pink',
    cover: 'the band big pink.png',
    artistName: 'The Band',
    albumName: 'Music from Big Pink',
    blurb: 'A pink house in Woodstock, five men, and the record that quietly rewrote what American music could be.',
    palette: { bg: '#e6d9c1', ink: '#221a12', accent: '#7a4e26' },
  },
  {
    id: 'blue',
    cover: 'blue joni.png',
    artistName: 'Joni Mitchell',
    albumName: 'Blue',
    blurb: 'The record that gave the confessional song-writer form its blueprint. Ten small windows onto the biggest interior in music.',
    palette: { bg: '#dee5e9', ink: '#182f45', accent: '#4a86ad' },
  },
  {
    id: 'tapestry',
    cover: 'carole king tapestry.png',
    artistName: 'Carole King',
    albumName: 'Tapestry',
    blurb: 'The Brill Building song-writer stepping out from behind the curtain. Warm, wise, and quietly world-changing.',
    palette: { bg: '#ece0c8', ink: '#2a1e14', accent: '#a56638' },
  },
  {
    id: 'i-never-loved-a-man',
    cover: 'aretha.png',
    artistName: 'Aretha Franklin',
    albumName: 'I Never Loved a Man the Way I Love You',
    blurb: 'Muscle Shoals. Jerry Wexler. And the moment Aretha stopped being a great singer and became the Queen.',
    palette: { bg: '#e8ddc4', ink: '#1e120c', accent: '#a1341c' },
  },
  {
    id: 'nebraska',
    cover: 'nebraska.png',
    artistName: 'Bruce Springsteen',
    albumName: 'Nebraska',
    blurb: 'A four-track cassette, ten haunted songs, and Springsteen’s bleakest, most private record. The America nobody sings about.',
    palette: { bg: '#dfd6c2', ink: '#141414', accent: '#4b4e4f' },
  },
  {
    id: 'blood-on-the-tracks',
    cover: 'blood on the tracks.png',
    artistName: 'Bob Dylan',
    albumName: 'Blood on the Tracks',
    blurb: 'The divorce record. The masterpiece. Dylan alone in a room in New York, remembering everything, forgiving nothing.',
    palette: { bg: '#e6dcc7', ink: '#231610', accent: '#8a3b1e' },
  },
  // Two new episodes:
  {
    id: 'ziggy-stardust',
    cover: 'ziggy.png',
    artistName: 'David Bowie',
    albumName: 'The Rise and Fall of Ziggy Stardust and the Spiders from Mars',
    blurb: 'The alien who came to save rock and roll — and quit before the last encore. Bowie invents pop stardom and then walks away from it.',
    palette: { bg: '#141212', ink: '#f0dcd0', accent: '#c8342b' },
  },
  {
    id: 'all-things-must-pass',
    cover: 'imageg.png',
    artistName: 'George Harrison',
    albumName: 'All Things Must Pass',
    blurb: 'The quiet Beatle steps out of the shadow with a triple album of songs he’d been waiting years to play. The masterpiece nobody saw coming.',
    palette: { bg: '#dcd2bd', ink: '#1e1a13', accent: '#5f4a29' },
  },
]

async function refresh() {
  // 1. Write covers + meta for every seed.
  for (const seed of SEEDS) {
    const episodeDir = join(CONTENT_DIR, 'episodes', seed.id)
    await fs.mkdir(episodeDir, { recursive: true })

    const src = join(COVERS_DIR, seed.cover)
    const dst = join(episodeDir, 'cover.png')
    await fs.copyFile(src, dst)

    // Preserve releaseDate/expectedRelease from existing meta if present — the
    // publish flow may have set releaseDate; we don't want to reset it.
    let releaseDate: string | null = null
    let expectedRelease: string | null = null
    try {
      const existingRaw = await fs.readFile(join(episodeDir, 'meta.json'), 'utf-8')
      const existing = episodeMetaSchema.parse(JSON.parse(existingRaw))
      releaseDate = existing.releaseDate
      expectedRelease = existing.expectedRelease
    } catch { /* new episode; leave as null */ }

    const meta = {
      schemaVersion: 1 as const,
      artistName: seed.artistName,
      albumName: seed.albumName,
      blurb: seed.blurb,
      palette: seed.palette,
      releaseDate,
      expectedRelease,
    }
    episodeMetaSchema.parse(meta)
    await fs.writeFile(join(episodeDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
    console.log(`refreshed ${seed.id}`)
  }

  // 2. Ensure the two new episodes appear in catalog.json (upcoming until published).
  const catalogPath = join(CONTENT_DIR, 'catalog.json')
  const catalogRaw = await fs.readFile(catalogPath, 'utf-8')
  const catalog: RemoteCatalogIndex = remoteCatalogSchema.parse(JSON.parse(catalogRaw))
  const knownIds = new Set(catalog.episodes.map((e) => e.id))
  const maxOrder = catalog.episodes.reduce((m, e) => Math.max(m, e.order), 0)
  let nextOrder = maxOrder
  for (const seed of SEEDS) {
    if (!knownIds.has(seed.id)) {
      nextOrder++
      catalog.episodes.push({
        id: seed.id,
        status: 'upcoming',
        expectedRelease: 'TBA',
        order: nextOrder,
      })
      console.log(`added catalog entry for ${seed.id} at order ${nextOrder}`)
    }
  }
  catalog.episodes.sort((a, b) => a.order - b.order)
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2), 'utf-8')
}

await refresh()
console.log('\nDone.')
