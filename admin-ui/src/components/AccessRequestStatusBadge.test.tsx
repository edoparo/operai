/**
 * @vitest-environment jsdom
 *
 * AccessRequestStatusBadge (T9, specs/023): text label AND icon, tone from lib/statusMeaning.ts.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import AccessRequestStatusBadge from './AccessRequestStatusBadge'

afterEach(cleanup)

describe('AccessRequestStatusBadge', () => {
  it.each([
    ['pending', 'Pending', 'badge-accent'],
    ['approved', 'Approved', 'badge-success'],
    ['rejected', 'Rejected', 'badge-danger'],
  ] as const)('renders %s with its label, an icon and tone %s', (status, label, tone) => {
    render(<AccessRequestStatusBadge status={status} />)
    const badge = screen.getByTestId('access-request-status-badge')
    expect(badge.textContent).toBe(label)
    expect(badge.querySelector('[aria-hidden="true"] svg')).not.toBeNull()
    expect(badge.className).toContain(tone)
  })
})
