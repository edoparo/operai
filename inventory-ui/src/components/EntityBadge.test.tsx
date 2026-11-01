/**
 * @vitest-environment jsdom
 *
 * Component tests for EntityBadge (T25, specs/015-hardware-inventory; INC-23).
 * Covers: both variants render the entity's name as text (never colour only),
 * no currency and no flag emoji (flags do not render on Windows), and both use
 * the same neutral library badge — an entity is metadata, not a status.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import EntityBadge from './EntityBadge'

afterEach(() => {
  cleanup()
})

describe('EntityBadge', () => {
  it.each([
    ['welld_it', 'WellD Italia'],
    ['welld_ch', 'WellD CH'],
  ] as const)('renders the %s variant with its entity-name label, no currency', (entity, label) => {
    render(<EntityBadge entity={entity} />)

    const badge = screen.getByTestId('entity-badge')
    expect(badge.textContent).toBe(label)
    expect(badge.textContent).not.toMatch(/EUR|CHF|USD|GBP/)
  })

  it('carries no flag emoji or other glyph (INC-23)', () => {
    for (const entity of ['welld_it', 'welld_ch'] as const) {
      render(<EntityBadge entity={entity} />)
      const badge = screen.getByTestId('entity-badge')
      expect(badge.textContent).not.toMatch(/\p{Regional_Indicator}/u)
      expect(badge.querySelector('[aria-hidden="true"]')).toBeNull()
      cleanup()
    }
  })

  // An entity is neutral metadata — it is not good, not actionable, just true —
  // so both variants share the neutral badge and the name tells them apart.
  it('renders both variants as the same neutral badge, never a semantic tone', () => {
    const classNames = (['welld_it', 'welld_ch'] as const).map((entity) => {
      const { container } = render(<EntityBadge entity={entity} />)
      const badge = container.querySelector('[data-testid="entity-badge"]') as HTMLElement
      const className = badge.className
      cleanup()
      return className
    })

    expect(new Set(classNames).size).toBe(1)
    expect(classNames[0]).toBe('badge')
  })
})
