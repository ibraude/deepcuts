import { useEffect, useState } from 'react'

export function Cover({ coverPath, alt, size = 200 }: { coverPath: string; alt: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Absolute URLs (file:// from a draft preview, or http(s):// from a library entry)
      // are used as-is. Relative paths are resolved against the bundled episodes root.
      if (/^(file|https?):\/\//.test(coverPath)) {
        if (!cancelled) setSrc(coverPath)
        return
      }
      try {
        const url = await window.deepcuts.assets.coverUrl(coverPath)
        if (!cancelled) setSrc(url)
      } catch {
        if (!cancelled) setSrc(null)
      }
    })()
    return () => { cancelled = true }
  }, [coverPath])

  return (
    <div
      className="rounded-md bg-[var(--color-surface)] border border-[var(--color-hairline)] flex items-center justify-center text-[var(--color-muted)] overflow-hidden"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt={alt} className="w-full h-full object-cover" draggable={false} />
      ) : (
        <span className="text-xs tracking-wide uppercase opacity-60">{alt.slice(0, 2)}</span>
      )}
    </div>
  )
}
