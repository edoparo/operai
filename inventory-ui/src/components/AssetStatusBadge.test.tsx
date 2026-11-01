/**
 * @vitest-environment jsdom
 *
 * Component tests for AssetStatusBadge (T26, specs/015-hardware-inventory;
 * design.md § NEW components and § Accessibility "Badges and chips").
 *
 * Covers: six variants, each readable as text (the label is the accessible
 * name, the glyph is aria-hidden); six DIFFERENT glyphs, so no state is carried
 * by colour alone; every variant carries its status in a data attribute for
 * tests/e2e; an unknown wire value from a newer server degrades to the raw text
 * rather than throwing. Since INC-23 each status maps to one meaning of the
 * suite's status dictionary (lib/statusMeanings), which picks tone and icon.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { STATUS } from '@operai/ui'
import type { StatusMeaning } from '@operai/ui'
import AssetStatusBadge from './AssetStatusBadge'
import { ASSET_STATUS_MEANING } from '../lib/statusMeanings'
import type { AssetStatus } from '../lib/types'

afterEach(() => {
  cleanup()
})

const VARIANTS = [
  ['ordered', 'Ordered', 'pending'],
  ['in_stock', 'In stock', 'stored'],
  ['assigned', 'Assigned', 'active'],
  ['in_repair', 'In repair', 'attention'],
  ['lost', 'Lost', 'missing'],
  ['disposed', 'Disposed', 'voided'],
] as const satisfies readonly (readonly [AssetStatus, string, StatusMeaning])[]

/** What a screen reader reads: the badge's text with every aria-hidden subtree removed. */
const accessibleText = (badge: HTMLElement): string => {
  const clone = badge.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove())
  return (clone.textContent ?? '').trim()
}

/** The library badge's tone class (`badge-success`), or `neutral` for the plain `badge`. */
const toneOf = (badge: HTMLElement): string =>
  Array.from(badge.classList)
    .find((name) => name.startsWith('badge-'))
    ?.slice('badge-'.length) ?? 'neutral'

describe('AssetStatusBadge', () => {
  it.each(VARIANTS)('renders %s with the accessible name "%s"', (status, label) => {
    render(<AssetStatusBadge status={status} />)

    const badge = screen.getByTestId('asset-status-badge')
    expect(accessibleText(badge)).toBe(label)
    expect(badge.textContent).toBe(label)
    expect(badge.getAttribute('data-status')).toBe(status)
  })

  it.each(VARIANTS)(
    '%s maps to its meaning: its tone and an aria-hidden icon, never a glyph character',
    (status, _label, meaning) => {
      expect(ASSET_STATUS_MEANING[status]).toBe(meaning)
      render(<AssetStatusBadge status={status} />)

      const badge = screen.getByTestId('asset-status-badge')
      expect(toneOf(badge)).toBe(STATUS[meaning].tone)
      const icon = badge.querySelector('[aria-hidden="true"] svg')
      expect(icon).not.toBeNull()
    },
  )

  it('uses six different meanings, so six different icons, and six different labels (no state is colour-only)', () => {
    const icons = new Set<string>()
    const labels = new Set<string>()
    for (const [status] of VARIANTS) {
      const { container } = render(<AssetStatusBadge status={status} />)
      const badge = container.querySelector('[data-testid="asset-status-badge"]') as HTMLElement
      icons.add(badge.querySelector('[aria-hidden="true"]')?.innerHTML ?? '')
      labels.add(accessibleText(badge))
      cleanup()
    }

    expect(icons.size).toBe(6)
    expect(labels.size).toBe(6)
  })

  it('paints only through the library badge classes: no inline style, no hex literal', () => {
    for (const [status] of VARIANTS) {
      const { container } = render(<AssetStatusBadge status={status} />)
      const badge = container.querySelector('[data-testid="asset-status-badge"]') as HTMLElement
      expect(badge.classList.contains('badge')).toBe(true)
      expect(badge.outerHTML).not.toMatch(/#[0-9a-f]{3,8}/i)
      expect(badge.getAttribute('style')).toBeNull()
      cleanup()
    }
  })

  it('does not throw on a status a newer server adds: it shows the raw value, without an icon', () => {
    render(<AssetStatusBadge status={'quarantined' as AssetStatus} />)

    const badge = screen.getByTestId('asset-status-badge')
    expect(badge.textContent).toBe('quarantined')
    expect(badge.querySelector('[aria-hidden="true"]')).toBeNull()
  })
})
