export function Cover({ coverPath, alt, size = 200 }: { coverPath: string; alt: string; size?: number }) {
  const isUrl = /^(file|https?):\/\//.test(coverPath)
  return (
    <div
      className="rounded-md bg-[var(--color-surface)] border border-[var(--color-hairline)] flex items-center justify-center text-[var(--color-muted)] overflow-hidden"
      style={{ width: size, height: size }}
    >
      {isUrl ? (
        <img src={coverPath} alt={alt} className="w-full h-full object-cover" draggable={false} />
      ) : (
        <span className="text-xs tracking-wide uppercase opacity-60">{alt.slice(0, 2)}</span>
      )}
    </div>
  )
}
