/**
 * @vitest-environment jsdom
 *
 * Component tests for RequestStatusBadge (T15, specs/20260716-refund-service,
 * design.md F3 step 2 / AC-3.4; +`paid` variant, T9,
 * specs/20260719-refund-monthly-processing/tasks.md).
 *
 * Covers: all five variants render a glyph AND a text label (never
 * color-only), `submitted` reads "Awaiting decision" — never confusable with
 * approved/rejected (AC-3.4) — and `paid` is distinguishable from `approved`
 * by its glyph even though both intentionally share the same `--grn`
 * "positive/success" color (design.md's Component inventory: the glyph, not
 * color, is the disambiguating signal between the suite's two "success"
 * states, AC-5.2).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import RequestStatusBadge from './RequestStatusBadge'
import { REQUEST_STATUS_MEANING } from '../lib/statusMeaning'

afterEach(() => {
  cleanup()
})

describe('RequestStatusBadge', () => {
  it.each([
    ['draft', 'Draft'],
    ['submitted', 'Awaiting decision'],
    ['approved', 'Approved'],
    ['rejected', 'Rejected'],
    ['paid', 'Paid'],
  ] as const)('renders the %s variant with an icon and its label', (status, label) => {
    render(<RequestStatusBadge status={status} />)

    const badge = screen.getByTestId('request-status-badge')
    expect(badge.textContent).toBe(label)
    expect(badge.querySelector('[aria-hidden="true"] svg')).not.toBeNull()
  })

  it('maps every status to the suite status dictionary in one place (INC-23)', () => {
    expect(REQUEST_STATUS_MEANING).toEqual({
      draft: 'draft',
      submitted: 'pending',
      approved: 'active',
      rejected: 'failed',
      paid: 'settled',
    })
  })

  it('never labels "submitted" as approved or rejected (AC-3.4)', () => {
    render(<RequestStatusBadge status="submitted" />)

    const badge = screen.getByTestId('request-status-badge')
    expect(badge.textContent).toBe('Awaiting decision')
    expect(badge.textContent?.toLowerCase()).not.toContain('approved')
    expect(badge.textContent?.toLowerCase()).not.toContain('rejected')
  })

  it('the icon is aria-hidden (label text alone carries the accessible name)', () => {
    render(<RequestStatusBadge status="approved" />)

    const badge = screen.getByTestId('request-status-badge')
    const glyphSpan = badge.querySelector('[aria-hidden="true"]')
    expect(glyphSpan?.querySelector('svg')).not.toBeNull()
    expect(glyphSpan?.textContent).toBe('')
  })

  it('uses a distinct color per variant, except paid/approved which deliberately share the success tone', () => {
    const colors = (['draft', 'submitted', 'approved', 'rejected', 'paid'] as const).map((status) => {
      const { container } = render(<RequestStatusBadge status={status} />)
      const badge = container.querySelector('[data-testid="request-status-badge"]') as HTMLElement
      const color = badge.className
      cleanup()
      return { status, color }
    })

    // draft/submitted/approved/rejected are all pairwise distinct.
    const nonPaidColors = colors.filter((c) => c.status !== 'paid').map((c) => c.color)
    expect(new Set(nonPaidColors).size).toBe(4)

    // paid intentionally shares approved's color (both "success" states) —
    // the glyph is the disambiguating signal instead (next test).
    const approvedColor = colors.find((c) => c.status === 'approved')?.color
    const paidColor = colors.find((c) => c.status === 'paid')?.color
    expect(paidColor).toBe(approvedColor)
  })

  it('paid is distinguishable from approved by icon alone, never by color (AC-5.2, non-color signal)', () => {
    const { container: approvedContainer } = render(<RequestStatusBadge status="approved" />)
    const approvedGlyph = approvedContainer.querySelector('[aria-hidden="true"]')?.innerHTML
    cleanup()

    const { container: paidContainer } = render(<RequestStatusBadge status="paid" />)
    const paidGlyph = paidContainer.querySelector('[aria-hidden="true"]')?.innerHTML
    const paidBadge = paidContainer.querySelector('[data-testid="request-status-badge"]') as HTMLElement
    cleanup()

    expect(paidGlyph).not.toBe(approvedGlyph)
    expect(paidBadge).toBeDefined()
  })
})
