export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-[2px] w-full bg-[var(--color-hairline)] overflow-hidden rounded-full">
      <div
        className="h-full bg-[var(--color-accent)] transition-[width] duration-200 ease-out"
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </div>
  )
}
