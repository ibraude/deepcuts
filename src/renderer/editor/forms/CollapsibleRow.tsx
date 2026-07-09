import type { ReactNode } from 'react'

interface CollapsibleRowProps {
  expanded: boolean
  onToggle: () => void
  summary: ReactNode
  actions?: ReactNode
  children: ReactNode
  density?: 'normal' | 'compact'
}

export function CollapsibleRow({
  expanded,
  onToggle,
  summary,
  actions,
  children,
  density = 'normal',
}: CollapsibleRowProps) {
  const headerPadY = density === 'compact' ? 'py-2' : 'py-2.5'
  return (
    <div className="border-b border-[var(--color-hairline)] last:border-b-0">
      <div className={`flex items-center gap-3 ${headerPadY}`}>
        <button
          onClick={onToggle}
          className="flex-1 flex items-center gap-3 text-left hover:bg-white/[0.02] -mx-2 px-2 py-1 rounded-md transition-colors min-w-0"
        >
          <span className="text-[10px] text-[var(--color-muted)] w-3 inline-block">
            {expanded ? '▾' : '▸'}
          </span>
          <div className="flex-1 min-w-0">{summary}</div>
        </button>
        {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
      </div>
      {expanded && <div className="pl-6 pr-1 pb-4 pt-1">{children}</div>}
    </div>
  )
}
