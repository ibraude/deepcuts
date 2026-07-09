import { describe, expect, it } from 'vitest'
import { AppleScriptSpotify } from './AppleScriptSpotify'
import { DeepcutsError } from '../../shared/errors'

type RunOsascript = (args: string[]) => Promise<{ stdout: string; stderr: string; code: number }>

function buildProvider(run: RunOsascript) {
  return new AppleScriptSpotify({ runOsascript: run })
}

describe('AppleScriptSpotify', () => {
  it('parses player position as a float', async () => {
    const p = buildProvider(async () => ({ stdout: '42.51\n', stderr: '', code: 0 }))
    expect(await p.getPosition()).toBeCloseTo(42.51, 2)
  })

  it('parses player state', async () => {
    const p = buildProvider(async () => ({ stdout: 'playing\n', stderr: '', code: 0 }))
    expect(await p.getState()).toBe('playing')
  })

  it('parses current track as id|uri|name|artist', async () => {
    const p = buildProvider(async () => ({
      stdout: 'spotify:track:3AhXZa8sUQht0UEdBJgpGc|https://open.spotify.com/track/3AhXZa8sUQht0UEdBJgpGc|Visions of Johanna|Bob Dylan\n',
      stderr: '',
      code: 0,
    }))
    const t = await p.getCurrentTrack()
    expect(t.uri).toBe('spotify:track:3AhXZa8sUQht0UEdBJgpGc')
    expect(t.name).toBe('Visions of Johanna')
    expect(t.artist).toBe('Bob Dylan')
  })

  it('normalizes Spotify\'s HTTPS URL form to spotify:track: URI', async () => {
    // Spotify's AppleScript "id" property has historically returned a bare 22-char
    // base62 ID on some macOS/Spotify versions, with the URI form only available
    // via "spotify url". Either field should normalize the same way.
    const p = buildProvider(async () => ({
      stdout: '72Z17vmmeQKAg8bptWvpVG|https://open.spotify.com/track/72Z17vmmeQKAg8bptWvpVG|Space Oddity|David Bowie\n',
      stderr: '',
      code: 0,
    }))
    const t = await p.getCurrentTrack()
    expect(t.uri).toBe('spotify:track:72Z17vmmeQKAg8bptWvpVG')
  })

  it('throws AutomationConsentDenied when stderr matches the TCC pattern', async () => {
    const p = buildProvider(async () => ({
      stdout: '',
      stderr: 'execution error: Not authorized to send Apple events to Spotify. (-1743)',
      code: 1,
    }))
    await expect(p.getState()).rejects.toMatchObject({ kind: 'AutomationConsentDenied' })
  })

  it('throws SpotifyNotInstalled when stderr matches the not-found pattern', async () => {
    const p = buildProvider(async () => ({
      stdout: '',
      stderr: "execution error: Application can't be found. (-10814)",
      code: 1,
    }))
    await expect(p.getState()).rejects.toMatchObject({ kind: 'SpotifyNotInstalled' })
  })

  it('rejects URIs that are not spotify:track:', async () => {
    const calls: string[][] = []
    const p = buildProvider(async (args) => {
      calls.push(args)
      return { stdout: '', stderr: '', code: 0 }
    })
    await expect(p.play('spotify:playlist:foo')).rejects.toBeInstanceOf(DeepcutsError)
    expect(calls).toHaveLength(0)
  })

  it('injects valid track URIs verbatim into the AppleScript', async () => {
    const calls: string[][] = []
    const p = buildProvider(async (args) => {
      calls.push(args)
      return { stdout: '', stderr: '', code: 0 }
    })
    await p.play('spotify:track:abcDEF1234567890123456')
    expect(calls[0]![1]).toContain('"spotify:track:abcDEF1234567890123456"')
  })

  it('disables shuffle and repeat before playing to avoid context jumps', async () => {
    const calls: string[][] = []
    const p = buildProvider(async (args) => {
      calls.push(args)
      return { stdout: '', stderr: '', code: 0 }
    })
    await p.play('spotify:track:abcDEF1234567890123456')
    const script = calls[0]![1]!
    expect(script).toContain('set shuffling to false')
    expect(script).toContain('set repeating to false')
    expect(script).toContain('play track "spotify:track:abcDEF1234567890123456"')
  })

  it('clamps volume to 0..100', async () => {
    const calls: string[][] = []
    const p = buildProvider(async (args) => {
      calls.push(args)
      return { stdout: '', stderr: '', code: 0 }
    })
    await p.setVolume(150)
    await p.setVolume(-10)
    expect(calls[0]![1]).toContain('set sound volume to 100')
    expect(calls[1]![1]).toContain('set sound volume to 0')
  })
})
