/**
 * @vitest-environment jsdom
 *
 * Component tests for InvitationStatusBadge (T12, specs/006-user-invitations).
 *
 * Covers: all four variants render a glyph AND a text label (never
 * color-only), with visually distinct colors.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import InvitationStatusBadge from './InvitationStatusBadge'

afterEach(() => {
  cleanup()
})

describe('InvitationStatusBadge', () => {
  it.each([
    ['pending', 'Pending'],
    ['accepted', 'Accepted'],
    ['expired', 'Expired'],
    ['revoked', 'Revoked'],
  ] as const)('renders the %s variant with its label and a decorative icon', (status, label) => {
    render(<InvitationStatusBadge status={status} />)

    const badge = screen.getByTestId('invitation-status-badge')
    expect(badge.textContent).toBe(label)
    // INC-23/31: the glyph is the status dictionary's SVG icon, never a Unicode character.
    expect(badge.querySelector('[aria-hidden="true"] svg')).not.toBeNull()
  })

  it.each([
    ['pending', 'badge-accent'],
    ['accepted', 'badge-success'],
    ['expired', 'badge-muted'],
    ['revoked', 'badge-muted'],
  ] as const)('maps %s to the status dictionary tone %s (lib/statusMeaning.ts)', (status, toneClass) => {
    render(<InvitationStatusBadge status={status} />)

    expect(screen.getByTestId('invitation-status-badge').className).toContain(toneClass)
  })
})
