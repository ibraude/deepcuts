function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

export function SongProgress({
  positionSec,
  durationSec,
}: {
  positionSec: number
  durationSec: number | null
}) {
  const total = durationSec ?? 0
  const pct = total > 0 ? Math.min(100, Math.max(0, (positionSec / total) * 100)) : 0
  return (
    <div className="max-w-md">
      <div className="h-[3px] w-full bg-[var(--color-hairline)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[#1DB954] transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-xs text-[var(--color-muted)] tabular-nums">
        <span>{formatTime(positionSec)}</span>
        <span>{durationSec !== null ? formatTime(total) : '—'}</span>
      </div>
    </div>
  )
}
