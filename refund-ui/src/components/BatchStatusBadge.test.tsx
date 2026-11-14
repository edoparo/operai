/**
 * @vitest-environment jsdom
 *
 * Component tests for BatchStatusBadge (T10, specs/20260719-refund-monthly-
 * processing/tasks.md). Covers: all three variants render a glyph AND a
 * text label (never color-only), and `paid` is distinguishable from
 * `compiled`/`discarded` by a non-color signal.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import BatchStatusBadge from './BatchStatusBadge'
import { BATCH_STATUS_MEANING } from '../lib/statusMeaning'

afterEach(() => {
  cleanup()
})

describe('BatchStatusBadge', () => {
  it.each([
    ['compiled', 'Compiled'],
    ['paid', 'Paid'],
    ['discarded', 'Discarded'],
  ] as const)('renders the %s variant with an icon and its label', (status, label) => {
    render(<BatchStatusBadge status={status} />)

    const badge = screen.getByTestId('batch-status-badge')
    expect(badge.textContent).toBe(label)
    expect(badge.querySelector('[aria-hidden="true"] svg')).not.toBeNull()
  })

  it('maps every batch status to the suite status dictionary in one place (INC-23)', () => {
    expect(BATCH_STATUS_MEANING).toEqual({ compiled: 'pending', paid: 'settled', discarded: 'voided' })
  })

  it('the icon is aria-hidden (label text alone carries the accessible name)', () => {
    render(<BatchStatusBadge status="compiled" />)

    const badge = screen.getByTestId('batch-status-badge')
    const glyphSpan = badge.querySelector('[aria-hidden="true"]')
    expect(glyphSpan?.querySelector('svg')).not.toBeNull()
    expect(glyphSpan?.textContent).toBe('')
  })

  it('uses a distinct color per variant', () => {
    const colors = (['compiled', 'paid', 'discarded'] as const).map((status) => {
      const { container } = render(<BatchStatusBadge status={status} />)
      const badge = container.querySelector('[data-testid="batch-status-badge"]') as HTMLElement
      const color = badge.className
      cleanup()
      return color
    })

    expect(new Set(colors).size).toBe(3)
  })

  it('each variant carries its own icon, never relying on color alone to disambiguate', () => {
    const glyphs = (['compiled', 'paid', 'discarded'] as const).map((status) => {
      const { container } = render(<BatchStatusBadge status={status} />)
      const glyph = container.querySelector('[aria-hidden="true"]')?.innerHTML
      cleanup()
      return glyph
    })

    expect(new Set(glyphs).size).toBe(3)
  })
})
