import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useReducedMotion } from './useReducedMotion'

function Probe() {
  const reduced = useReducedMotion()
  return <div data-testid="probe">{reduced ? 'reduced' : 'full'}</div>
}

describe('useReducedMotion', () => {
  it('returns true when prefers-reduced-motion: reduce matches', () => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }))
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('reduced')
  })

  it('returns false when reduced motion is not set', () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      media: '',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }))
    render(<Probe />)
    expect(screen.getByTestId('probe').textContent).toBe('full')
  })
})
