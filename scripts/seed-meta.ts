import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

interface Seed {
  id: string
  artistName: string
  albumName: string
  blurb: string
  palette: { bg: string; ink: string; accent: string }
  expectedRelease: string
}

const SEEDS: Seed[] = [
  {
    id: 'almost-blue', artistName: 'Chet Baker', albumName: 'Almost Blue',
    blurb: 'A portrait of Chet Baker. The music. The silence. The beauty. And the blues that never left.',
    palette: { bg: '#e8e4d6', ink: '#0e2a44', accent: '#2f6ea1' },
    expectedRelease: 'Summer 2026',
  },
  {
    id: 'waiting-around-to-die', artistName: 'Townes Van Zandt', albumName: 'Waiting Around to Die',
    blurb: 'The outcast poet of American song. A voice like no other. Beautiful, broken, and impossible to forget.',
    palette: { bg: '#eee6d3', ink: '#182234', accent: '#a45a1d' },
    expectedRelease: 'Summer 2026',
  },
  {
    id: 'bill-withers-carnegie', artistName: 'Bill Withers', albumName: 'Live at Carnegie Hall',
    blurb: 'The songs. The stories. The man. A night to remember at Carnegie Hall, 1972.',
    palette: { bg: '#efe4d0', ink: '#1a1512', accent: '#b6501f' },
    expectedRelease: 'Summer 2026',
  },
  {
    id: 'solid-air', artistName: 'John Martyn', albumName: 'Solid Air',
    blurb: 'Late-night, small-room, big-feeling. Martyn’s tender, fractured tribute to Nick Drake, and the album’s ghost that never quite leaves.',
    palette: { bg: '#eae4d1', ink: '#1e3247', accent: '#87a5c2' },
    expectedRelease: 'Summer 2026',
  },
  {
    id: 'blonde-on-blonde', artistName: 'Bob Dylan', albumName: 'Blonde on Blonde',
    blurb: 'That thin, wild mercury sound. Nashville, 1966. The first double album in rock and one of its most enduring puzzles.',
    palette: { bg: '#e8ded1', ink: '#2c1e12', accent: '#8a6134' },
    expectedRelease: 'Autumn 2026',
  },
  {
    id: 'heart-of-saturday-night', artistName: 'Tom Waits', albumName: 'The Heart of Saturday Night',
    blurb: 'Bar-stool poetry, honking horns, and the promise of a lonesome city Saturday. Waits before Waits became Waits.',
    palette: { bg: '#e6dccb', ink: '#1b1610', accent: '#7c3f1f' },
    expectedRelease: 'Autumn 2026',
  },
  {
    id: 'dusk', artistName: 'The The', albumName: 'Dusk',
    blurb: 'Matt Johnson’s aching, apocalyptic love-letter to grief, sex, and the end of things. The most human record of its decade.',
    palette: { bg: '#dfd6c2', ink: '#241b18', accent: '#6b2b2b' },
    expectedRelease: 'Autumn 2026',
  },
  {
    id: 'five-leaves-left', artistName: 'Nick Drake', albumName: 'Five Leaves Left',
    blurb: 'A twenty-year-old with a guitar, a string section, and eternity in his voice. The debut that still hasn’t stopped whispering.',
    palette: { bg: '#e9e3d1', ink: '#232a20', accent: '#5a6d3f' },
    expectedRelease: 'Winter 2026',
  },
  {
    id: 'small-change', artistName: 'Tom Waits', albumName: 'Small Change',
    blurb: 'The piano-and-whiskey Waits at his most romantic and ruined. A skid-row masterpiece dressed in a rumpled tux.',
    palette: { bg: '#e5dbc5', ink: '#181410', accent: '#8d5b25' },
    expectedRelease: 'Winter 2026',
  },
  {
    id: 'strangeways', artistName: 'The Smiths', albumName: 'Strangeways, Here We Come',
    blurb: 'Their final record. Their best record. Morrissey and Marr at the edge of the cliff, still holding hands.',
    palette: { bg: '#e2dccc', ink: '#1a2634', accent: '#5b7fa1' },
    expectedRelease: 'Winter 2026',
  },
  {
    id: 'prince-of-darkness', artistName: 'Nick Cave', albumName: 'The Prince of Darkness',
    blurb: 'The murder ballads, the love songs, the god-haunted noise. Cave from the Birthday Party to the pulpit.',
    palette: { bg: '#d9d1c0', ink: '#0e0e10', accent: '#7a1e1e' },
    expectedRelease: '2027-Q1',
  },
  {
    id: 'there-goes-rhymin-simon', artistName: 'Paul Simon', albumName: 'There Goes Rhymin’ Simon',
    blurb: 'Muscle Shoals, gospel, reggae, calypso, and one of the sharpest song-writers alive putting them all in the same room.',
    palette: { bg: '#ebe3ce', ink: '#182920', accent: '#3d6b52' },
    expectedRelease: '2027-Q1',
  },
  {
    id: 'mad-dogs-and-englishmen', artistName: 'Joe Cocker', albumName: 'Mad Dogs & Englishmen',
    blurb: 'Leon Russell’s Circus, Cocker’s wounded lion of a voice, and the most gloriously chaotic tour in rock history.',
    palette: { bg: '#eadfc7', ink: '#1c1610', accent: '#a04a1c' },
    expectedRelease: '2027-Q1',
  },
  {
    id: 'rumours', artistName: 'Fleetwood Mac', albumName: 'Rumours',
    blurb: 'Five people, five heartbreaks, one impossible record. The most beautiful bad breakup in pop.',
    palette: { bg: '#ebe1cc', ink: '#251a12', accent: '#a67435' },
    expectedRelease: '2027-Q2',
  },
  {
    id: 'music-from-big-pink', artistName: 'The Band', albumName: 'Music from Big Pink',
    blurb: 'A pink house in Woodstock, five men, and the record that quietly rewrote what American music could be.',
    palette: { bg: '#e6d9c1', ink: '#221a12', accent: '#7a4e26' },
    expectedRelease: '2027-Q2',
  },
  {
    id: 'blue', artistName: 'Joni Mitchell', albumName: 'Blue',
    blurb: 'The record that gave the confessional song-writer form its blueprint. Ten small windows onto the biggest interior in music.',
    palette: { bg: '#dee5e9', ink: '#182f45', accent: '#4a86ad' },
    expectedRelease: '2027-Q2',
  },
  {
    id: 'tapestry', artistName: 'Carole King', albumName: 'Tapestry',
    blurb: 'The Brill Building song-writer stepping out from behind the curtain. Warm, wise, and quietly world-changing.',
    palette: { bg: '#ece0c8', ink: '#2a1e14', accent: '#a56638' },
    expectedRelease: '2027-Q3',
  },
  {
    id: 'i-never-loved-a-man', artistName: 'Aretha Franklin', albumName: 'I Never Loved a Man the Way I Love You',
    blurb: 'Muscle Shoals. Jerry Wexler. And the moment Aretha stopped being a great singer and became the Queen.',
    palette: { bg: '#e8ddc4', ink: '#1e120c', accent: '#a1341c' },
    expectedRelease: '2027-Q3',
  },
  {
    id: 'nebraska', artistName: 'Bruce Springsteen', albumName: 'Nebraska',
    blurb: 'A four-track cassette, ten haunted songs, and Springsteen’s bleakest, most private record. The America nobody sings about.',
    palette: { bg: '#dfd6c2', ink: '#141414', accent: '#4b4e4f' },
    expectedRelease: '2027-Q3',
  },
  {
    id: 'blood-on-the-tracks', artistName: 'Bob Dylan', albumName: 'Blood on the Tracks',
    blurb: 'The divorce record. The masterpiece. Dylan alone in a room in New York, remembering everything, forgiving nothing.',
    palette: { bg: '#e6dcc7', ink: '#231610', accent: '#8a3b1e' },
    expectedRelease: '2027-Q4',
  },
]

const here = dirname(fileURLToPath(import.meta.url))
const contentDir = join(here, '..', 'content')

for (const seed of SEEDS) {
  const dir = join(contentDir, 'episodes', seed.id)
  await fs.mkdir(dir, { recursive: true })
  const meta = {
    schemaVersion: 1,
    artistName: seed.artistName,
    albumName: seed.albumName,
    blurb: seed.blurb,
    palette: seed.palette,
    releaseDate: null,
    expectedRelease: seed.expectedRelease,
  }
  await fs.writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
  console.log(`meta.json  ${seed.id}`)
}
console.log(`\n${SEEDS.length} episodes seeded.`)
