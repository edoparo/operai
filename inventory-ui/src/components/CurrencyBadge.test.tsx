/**
 * @vitest-environment jsdom
 *
 * Component tests for CurrencyBadge (T25, specs/015-hardware-inventory; INC-23).
 * Covers: every currency renders its ISO code as text exactly once (never
 * colour only), with no symbol glyph duplicating the code, and every variant is
 * the same neutral library badge.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import CurrencyBadge from './CurrencyBadge'

afterEach(() => {
  cleanup()
})

describe('CurrencyBadge', () => {
  // Regression: the CHF chip once read "CHF CHF" (its glyph was the code). A
  // symbol beside the code says the same thing twice, so no variant has one.
  it.each(['EUR', 'CHF'] as const)('renders %s as its ISO code exactly once, with no glyph', (currency) => {
    render(<CurrencyBadge currency={currency} />)

    const badge = screen.getByTestId('currency-badge')
    expect(badge.textContent).toBe(currency)
    expect(badge.querySelector('[aria-hidden="true"]')).toBeNull()
  })

  // Currency is neutral metadata — not good, not bad, not actionable — so one
  // shared neutral badge, never a semantic tone.
  it('renders every variant as the same neutral badge', () => {
    const classNames = (['EUR', 'CHF'] as const).map((currency) => {
      const { container } = render(<CurrencyBadge currency={currency} />)
      const className = (container.querySelector('[data-testid="currency-badge"]') as HTMLElement).className
      cleanup()
      return className
    })

    expect(new Set(classNames).size).toBe(1)
    expect(classNames[0]).toBe('badge')
  })
})
