import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePlayer } from './usePlayer'
import * as fetchModule from '../catalog/fetchCatalog'
import type { EpisodeManifest } from '../catalog/types'

const MANIFEST: EpisodeManifest = {
  schemaVersion: 1,
  id: 'x',
  title: 't',
  subject: 's',
  coverImage: 'cover.png',
  estimatedMinutes: 1,
  hosts: [{ id: 'h', name: 'H', persona: '', voiceRef: 'elevenlabs:v' }],
  chapters: [
    {
      title: 'c',
      segments: [
        {
          type: 'narration',
          id: 'n-01',
          hostId: 'h',
          text: 'x',
          audio: 'https://cdn.example/x/n-01.mp3',
        },
        {
          type: 'narration',
          id: 'n-02',
          hostId: 'h',
          text: 'y',
          audio: 'https://cdn.example/x/n-02.mp3',
        },
      ],
    },
  ],
  sources: [],
  facts: [],
}

describe('usePlayer', () => {
  beforeEach(() => {
    vi.spyOn(fetchModule, 'fetchManifest').mockResolvedValue(MANIFEST)
    HTMLMediaElement.prototype.play = vi.fn(async () => {})
    HTMLMediaElement.prototype.pause = vi.fn()
    HTMLMediaElement.prototype.load = vi.fn()
  })

  it('starts idle', () => {
    const { result } = renderHook(() => usePlayer())
    expect(result.current.state.status).toBe('idle')
    expect(result.current.state.activeId).toBeNull()
  })

  it('playEpisode fetches the manifest and starts the first narration MP3', async () => {
    const { result } = renderHook(() => usePlayer())
    await act(async () => {
      await result.current.playEpisode('x', '#abcdef')
    })
    expect(result.current.state.activeId).toBe('x')
    expect(result.current.state.status).toBe('playing')
    expect(result.current.state.accent).toBe('#abcdef')
    expect(result.current.state.previewUrl).toBe('https://cdn.example/x/n-01.mp3')
  })

  it('pause and resume toggle status', async () => {
    const { result } = renderHook(() => usePlayer())
    await act(async () => {
      await result.current.playEpisode('x', '#abcdef')
    })
    act(() => {
      result.current.pause()
    })
    expect(result.current.state.status).toBe('paused')
    act(() => {
      result.current.resume()
    })
    expect(result.current.state.status).toBe('playing')
  })

  it('playEpisode with a new id replaces the active id', async () => {
    const { result } = renderHook(() => usePlayer())
    await act(async () => {
      await result.current.playEpisode('x', '#abcdef')
    })
    vi.spyOn(fetchModule, 'fetchManifest').mockResolvedValueOnce({
      ...MANIFEST,
      id: 'y',
      chapters: [
        {
          title: 'c',
          segments: [
            {
              type: 'narration',
              id: 'n1',
              hostId: 'h',
              text: '',
              audio: 'https://cdn.example/y/n1.mp3',
            },
          ],
        },
      ],
    })
    await act(async () => {
      await result.current.playEpisode('y', '#123456')
    })
    expect(result.current.state.activeId).toBe('y')
    expect(result.current.state.previewUrl).toBe('https://cdn.example/y/n1.mp3')
  })

  it('sets error state when no narration audio is found', async () => {
    vi.spyOn(fetchModule, 'fetchManifest').mockResolvedValueOnce({
      ...MANIFEST,
      chapters: [
        {
          title: 'c',
          segments: [{ type: 'narration', id: 'n1', hostId: 'h', text: 'no audio' }],
        },
      ],
    })
    const { result } = renderHook(() => usePlayer())
    await act(async () => {
      await result.current.playEpisode('x', '#abcdef')
    })
    expect(result.current.state.status).toBe('idle')
    expect(result.current.state.error).toMatch(/no preview/i)
  })
})
