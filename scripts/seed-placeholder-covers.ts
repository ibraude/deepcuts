import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { episodeMetaSchema } from '../src/shared/meta'

const here = dirname(fileURLToPath(import.meta.url))
const contentDir = join(here, '..', 'content')

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

// Minimal PNG encoder: solid-color 128x128 image with a smaller square in the accent color.
// This is a placeholder; real covers will overwrite these files.
function makeSolidPng(w: number, h: number, bg: [number, number, number], accent: [number, number, number]): Uint8Array {
  const insetStart = Math.floor(w * 0.35)
  const insetEnd = Math.floor(w * 0.65)

  // Raw pixel data — one filter byte (0) per scanline, then RGB triples.
  const rowLen = 1 + w * 3
  const raw = Buffer.alloc(rowLen * h)
  for (let y = 0; y < h; y++) {
    raw[y * rowLen] = 0 // filter type: none
    for (let x = 0; x < w; x++) {
      const inInset = x >= insetStart && x < insetEnd && y >= insetStart && y < insetEnd
      const c = inInset ? accent : bg
      const off = y * rowLen + 1 + x * 3
      raw[off] = c[0]
      raw[off + 1] = c[1]
      raw[off + 2] = c[2]
    }
  }
  const compressed = deflateSync(raw)

  function chunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
    const typeBuf = Buffer.from(type, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
    return Buffer.concat([len, typeBuf, data, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const out = Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
}

// Table-driven CRC32 for PNG chunks.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  return table
})()
function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)) >>> 0
  return (c ^ 0xffffffff) >>> 0
}

// Use hash to shut up unused-import warnings (createHash is imported but unused here).
void createHash

const episodesDir = join(contentDir, 'episodes')
const ids = await fs.readdir(episodesDir)
let wrote = 0, skipped = 0
for (const id of ids) {
  const coverPath = join(episodesDir, id, 'cover.png')
  const exists = await fs.stat(coverPath).then(() => true).catch(() => false)
  if (exists) { skipped++; console.log(`skip  ${id} (cover exists)`); continue }
  const metaRaw = await fs.readFile(join(episodesDir, id, 'meta.json'), 'utf-8')
  const meta = episodeMetaSchema.parse(JSON.parse(metaRaw))
  const bg = hexToRgb(meta.palette.bg)
  const accent = hexToRgb(meta.palette.accent)
  const png = makeSolidPng(128, 128, bg, accent)
  await fs.writeFile(coverPath, png)
  wrote++
  console.log(`wrote ${id}`)
}
console.log(`\n${wrote} placeholder covers written, ${skipped} real covers kept.`)
