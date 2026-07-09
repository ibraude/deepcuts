import { useAppStore } from '../appStore'

export function ModeToggle() {
  const mode = useAppStore((s) => s.appMode)
  const set = useAppStore((s) => s.setAppMode)
  return (
    <div className="no-drag inline-flex items-center text-[10px] tracking-[0.2em] uppercase select-none">
      <button
        onClick={() => set('library')}
        className={
          'px-2.5 py-1 rounded-l-md border transition-colors duration-150 ' +
          (mode === 'library'
            ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)]/40 text-[var(--color-text)]'
            : 'border-[var(--color-hairline)] text-[var(--color-muted)] hover:text-[var(--color-text)]')
        }
      >
        Library
      </button>
      <button
        onClick={() => set('editor')}
        className={
          'px-2.5 py-1 rounded-r-md border-y border-r transition-colors duration-150 ' +
          (mode === 'editor'
            ? 'bg-[var(--color-accent)]/15 border-[var(--color-accent)]/40 text-[var(--color-text)]'
            : 'border-[var(--color-hairline)] text-[var(--color-muted)] hover:text-[var(--color-text)]')
        }
      >
        Editor
      </button>
    </div>
  )
}
