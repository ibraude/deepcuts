import { AppleScriptSpotify } from '../src/main/music/AppleScriptSpotify'
import { DeepcutsError } from '../src/shared/errors'

async function main() {
  const spotify = new AppleScriptSpotify()
  console.log('Checking Spotify availability…')
  const available = await spotify.isAvailable()
  console.log('  installed:', available)
  if (!available) {
    console.log('Spotify desktop app not found. Install from https://www.spotify.com/download')
    process.exit(1)
  }
  console.log('Activating Spotify…')
  await spotify.ensureReady()
  const uri = 'spotify:track:2rslQV48gNv3r9pPrQFPW1'
  console.log('Playing', uri, 'for 3 seconds…')
  await spotify.play(uri)
  await new Promise((r) => setTimeout(r, 3000))
  const pos = await spotify.getPosition()
  const state = await spotify.getState()
  const track = await spotify.getCurrentTrack()
  console.log('  position:', pos.toFixed(2), 's')
  console.log('  state:   ', state)
  console.log('  track:   ', track)
  await spotify.pause()
  console.log('Paused. Probe successful.')
}

main().catch((err) => {
  if (err instanceof DeepcutsError) {
    console.error(`[${err.kind}] ${err.message}`)
    if (err.kind === 'AutomationConsentDenied') {
      console.error('Grant Automation access in: System Settings → Privacy & Security → Automation → Deepcuts → Spotify')
    }
  } else {
    console.error(err)
  }
  process.exit(1)
})
