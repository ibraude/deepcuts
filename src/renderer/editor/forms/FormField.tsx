import type { ReactNode } from 'react'

export function FormField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-[0.15em] text-[var(--color-muted)]">{label}</span>
      {children}
      {hint && <span className="block text-xs text-[var(--color-muted)]">{hint}</span>}
    </label>
  )
}

export function inputClass(invalid = false) {
  return (
    'w-full bg-[var(--color-background)] border rounded-md px-2 py-1.5 text-sm focus:outline-none ' +
    (invalid
      ? 'border-red-500/60 focus:border-red-500'
      : 'border-[var(--color-hairline)] focus:border-[var(--color-accent)]')
  )
}

export function textareaClass(invalid = false) {
  return inputClass(invalid) + ' min-h-[80px] leading-relaxed font-sans'
}
