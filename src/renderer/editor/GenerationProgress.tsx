type ProgressStep = 'idle' | 'researching' | 'resolving' | 'finalizing' | 'done' | 'error'

interface Props {
  step: ProgressStep
  detail?: string
  index?: number
  total?: number
  error?: string
  warnings?: string[]
}

const STEP_LABELS: Record<ProgressStep, string> = {
  idle: '',
  researching: 'Researching and writing draft…',
  resolving: 'Resolving songs…',
  finalizing: 'Finalizing draft…',
  done: 'Done',
  error: 'Error',
}

export function GenerationProgress({ step, detail, index, total, error, warnings }: Props) {
  if (step === 'idle') return null
  let label = STEP_LABELS[step]
  if (step === 'resolving' && total && total > 0) {
    label = `Resolving songs… (${Math.min(index ?? 0, total)}/${total})`
  }
  if (step === 'error') label = `Error: ${error ?? 'Unknown error'}`
  return (
    <div className="space-y-2 pt-2 border-t border-[var(--color-hairline)]">
      <div className="flex items-center gap-2">
        {step !== 'done' && step !== 'error' && (
          <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
        )}
        <span className={'text-sm ' + (step === 'error' ? 'text-red-400' : 'text-[var(--color-text)]')}>
          {label}
        </span>
      </div>
      {detail && <div className="text-xs text-[var(--color-muted)]">{detail}</div>}
      {warnings && warnings.length > 0 && (
        <details className="text-xs text-amber-300/80">
          <summary className="cursor-pointer">
            {warnings.length} warning{warnings.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-1 list-disc pl-4 space-y-1">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
