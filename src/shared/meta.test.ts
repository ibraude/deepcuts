import { describe, expect, it } from 'vitest'
import { episodeMetaSchema } from './meta'

const valid = {
  schemaVersion: 1,
  artistName: 'Chet Baker',
  albumName: 'Almost Blue',
  blurb: 'A portrait of Chet Baker.',
  palette: { bg: '#e8e4d6', ink: '#0e2a44', accent: '#2f6ea1' },
  releaseDate: '2026-06-10',
  expectedRelease: null,
}

describe('episodeMetaSchema', () => {
  it('accepts a valid released meta', () => {
    expect(() => episodeMetaSchema.parse(valid)).not.toThrow()
  })

  it('accepts a valid upcoming meta', () => {
    expect(() => episodeMetaSchema.parse({
      ...valid, releaseDate: null, expectedRelease: '2027-Q1',
    })).not.toThrow()
  })

  it('rejects bad hex color', () => {
    expect(() => episodeMetaSchema.parse({
      ...valid, palette: { ...valid.palette, bg: 'not-a-color' },
    })).toThrow()
  })

  it('rejects empty strings', () => {
    expect(() => episodeMetaSchema.parse({ ...valid, artistName: '' })).toThrow()
  })

  it('rejects unknown fields (strict)', () => {
    expect(() => episodeMetaSchema.parse({ ...valid, extraField: 'x' })).toThrow()
  })
})
