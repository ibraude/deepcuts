import type { Variants, Transition } from 'framer-motion'
import { EASE_EXPO_OUT, durations } from './easing'

export const heroLineVariants: Variants = {
  hidden: { y: 24, opacity: 0, filter: 'blur(8px)' },
  shown: { y: 0, opacity: 1, filter: 'blur(0px)' },
}

export const heroLineTransition = (i: number): Transition => ({
  duration: durations.heroLine,
  ease: EASE_EXPO_OUT as unknown as number[],
  delay: i * 0.09,
})

export const cardRevealVariants: Variants = {
  hidden: { y: 16, opacity: 0 },
  shown: { y: 0, opacity: 1 },
}

export const cardRevealTransition = (index: number): Transition => ({
  duration: 0.5,
  ease: EASE_EXPO_OUT as unknown as number[],
  delay: index * 0.06,
})
