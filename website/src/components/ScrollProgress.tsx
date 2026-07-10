import { useEffect, useRef } from 'react'

export function ScrollProgress() {
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let ticking = false
    const update = () => {
      const doc = document.documentElement
      const total = doc.scrollHeight - window.innerHeight
      const fraction =
        total > 0 ? Math.min(1, Math.max(0, window.scrollY / total)) : 0
      if (barRef.current) barRef.current.style.transform = `scaleY(${fraction})`
      ticking = false
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div
      aria-hidden
      className="fixed right-0 top-0 bottom-0 w-px pointer-events-none z-40"
      style={{ background: 'transparent' }}
    >
      <div
        ref={barRef}
        style={{
          width: 1,
          height: '100%',
          background: 'var(--muted)',
          transformOrigin: 'top',
          transform: 'scaleY(0)',
          transition: 'transform 80ms linear',
          opacity: 0.4,
        }}
      />
    </div>
  )
}
