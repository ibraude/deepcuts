export interface SynthesisResult {
  filePath: string
  cached: boolean
}

export interface TTSProvider {
  synthesize(text: string, voiceRef: string, opts: { segmentId: string }): Promise<SynthesisResult>
}
