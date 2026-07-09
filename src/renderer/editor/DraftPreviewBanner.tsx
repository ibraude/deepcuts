import { useEditorStore } from './editorStore'

export function DraftPreviewBanner() {
  const exit = useEditorStore((s) => s.exitPreview)
  return (
    <div className="fixed top-9 left-0 right-0 z-40 px-4 py-1.5 bg-[var(--color-accent)]/15 border-b border-[var(--color-accent)]/30 text-xs text-center">
      Previewing draft.{' '}
      <button onClick={exit} className="underline text-[var(--color-accent)] hover:text-[var(--color-text)]">
        Exit preview
      </button>
    </div>
  )
}
