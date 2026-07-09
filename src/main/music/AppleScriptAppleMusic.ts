import type { MusicProvider } from './MusicProvider'
import { DeepcutsError } from '../../shared/errors'

export class AppleScriptAppleMusic implements MusicProvider {
  async isAvailable(): Promise<boolean> { return false }
  async ensureReady(): Promise<void> { this.fail() }
  async play(): Promise<void> { this.fail() }
  async pause(): Promise<void> { this.fail() }
  async getPosition(): Promise<number> { this.fail() }
  async getState(): Promise<never> { this.fail() }
  async getCurrentTrack(): Promise<never> { this.fail() }
  async getDuration(): Promise<number> { this.fail() }
  async getVolume(): Promise<number> { this.fail() }
  async setVolume(): Promise<void> { this.fail() }
  private fail(): never {
    throw new DeepcutsError('Unknown', 'Apple Music adapter not implemented.')
  }
}
