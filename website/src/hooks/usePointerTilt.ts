import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from './useReducedMotion'

export function usePointerTilt<T extends HTMLElement>(max = 2.5): {
  ref: React.RefObject<T>
  style: React.CSSProperties
} {
  const ref = useRef<T>(null)
  const [style, setStyle] = useState<React.CSSProperties>({})
  const reduced = useReducedMotion()

  const handle = useCallback(
    (e: PointerEvent) => {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dx = (e.clientX - cx) / (rect.width / 2)
      const dy = (e.clientY - cy) / (rect.height / 2)
      const rY = Math.max(-1, Math.min(1, dx)) * max
      const rX = -Math.max(-1, Math.min(1, dy)) * max
      setStyle({
        transform: `perspective(800px) rotateX(${rX}deg) rotateY(${rY}deg) scale(1.02) translateZ(0)`,
        transition: 'transform 120ms var(--easing-expo)',
      })
    },
    [max],
  )

  const reset = useCallback(() => {
    setStyle({
      transform: 'perspective(800px) rotateX(0) rotateY(0) scale(1)',
      transition: 'transform 200ms var(--easing-expo)',
    })
  }, [])

  useEffect(() => {
    if (reduced) return
    const el = ref.current
    if (!el) return
    const enter = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') handle(e)
    }
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') handle(e)
    }
    const leave = () => reset()
    el.addEventListener('pointerenter', enter)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointerenter', enter)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  }, [handle, reset, reduced])

  return { ref, style }
}
