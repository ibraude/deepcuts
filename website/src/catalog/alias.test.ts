import { describe, it, expect } from 'vitest'
import { remoteCatalogSchema, type RemoteCatalogIndex } from '@shared/catalog'

describe('@shared alias', () => {
  it('imports remoteCatalogSchema from the app', () => {
    expect(typeof remoteCatalogSchema.parse).toBe('function')
  })

  it('parses a minimal valid catalog', () => {
    const valid: RemoteCatalogIndex = {
      schemaVersion: 1,
      updatedAt: '2026-07-10T00:00:00Z',
      episodes: [
        { id: 'x', status: 'upcoming', expectedRelease: 'Q1', order: 1 },
      ],
    }
    expect(() => remoteCatalogSchema.parse(valid)).not.toThrow()
  })
})
