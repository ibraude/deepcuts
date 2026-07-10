import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { EASE_EXPO_OUT } from '../lib/easing'
import { useReducedMotion } from '../hooks/useReducedMotion'

export function RevealOnScroll({
  children,
  delay = 0,
}: {
  children: ReactNode
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const reduced = useReducedMotion()

  useEffect(() => {
    if (visible) return
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  return (
    <motion.div
      ref={ref}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
      animate={visible ? (reduced ? { opacity: 1 } : { opacity: 1, y: 0 }) : undefined}
      transition={{
        duration: reduced ? 0.2 : 0.5,
        ease: EASE_EXPO_OUT as unknown as number[],
        delay,
      }}
    >
      {children}
    </motion.div>
  )
}
