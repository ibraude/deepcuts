import { useEffect, useState } from 'react'
import { Catalog } from './catalog/Catalog'
import { Player } from './player/Player'
import { Settings } from './settings/Settings'
import { usePlayerStore } from './player/playerStore'
import { useAppStore } from './appStore'
import { ModeToggle } from './ui/ModeToggle'
import { EditorView } from './editor/EditorView'
import { useEditorStore } from './editor/editorStore'
import { DraftPreviewBanner } from './editor/DraftPreviewBanner'

// Editor and Settings are dev-only. Production builds (the .dmg users
// download from the site) ship a library + player experience only. Vite
// statically inlines this constant so unused branches are dead-code eliminated
// from the production bundle.
const IS_DEV = import.meta.env.DEV

export function App() {
  const init = usePlayerStore((s) => s.init)
  const status = usePlayerStore((s) => s.schedulerState.status.kind)
  const appMode = useAppStore((s) => s.appMode)
  const previewing = useEditorStore((s) => s.previewingDraftId)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    init()
    if (!IS_DEV) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === ',') {
        e.preventDefault()
        setShowSettings(true)
      }
      if (e.key === 'Escape') setShowSettings(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [init])

  // Auto-exit preview when the previewed episode finishes.
  useEffect(() => {
    if (previewing && status === 'done') {
      useEditorStore.getState().exitPreview()
    }
  }, [previewing, status])

  const playerActive = status !== 'idle' && status !== 'done'
  const inEditor = IS_DEV && appMode === 'editor'

  return (
    <main className="min-h-screen">
      <div className="drag fixed top-0 left-0 right-0 h-9 z-50" aria-hidden />
      {IS_DEV && (
        <div className="fixed top-1.5 right-3 z-[60]">
          <ModeToggle />
        </div>
      )}
      {previewing && <DraftPreviewBanner />}
      {previewing && playerActive ? (
        <Player />
      ) : inEditor ? (
        <EditorView />
      ) : playerActive ? (
        <Player />
      ) : (
        <Catalog />
      )}
      {IS_DEV && showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </main>
  )
}
