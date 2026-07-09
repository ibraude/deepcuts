export type PlayerState = 'playing' | 'paused' | 'stopped'

export interface CurrentTrack {
  id: string
  uri: string
  name?: string
  artist?: string
}

export interface MusicProvider {
  isAvailable(): Promise<boolean>
  ensureReady(): Promise<void>
  play(trackUri: string): Promise<void>
  pause(): Promise<void>
  getPosition(): Promise<number>
  getState(): Promise<PlayerState>
  getCurrentTrack(): Promise<CurrentTrack>
  getDuration(): Promise<number>
  getVolume(): Promise<number>
  setVolume(pct: number): Promise<void>
}
