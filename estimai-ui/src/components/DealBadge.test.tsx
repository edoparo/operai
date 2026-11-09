/**
 * @vitest-environment jsdom
 *
 * DealBadge (specs/024 AC-3.2, AC-3.3): a link to the deal with CRM access, a
 * plain badge without; never anything but the word "Deal".
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { navigateSuite } from 'shell/session'
import DealBadge from './DealBadge'
import { strings } from '../strings'

vi.mock('shell/session', () => ({ navigateSuite: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DealBadge', () => {
  it('with CRM access is a real link named after the estimate, containing the visible word "Deal"', () => {
    render(<DealBadge dealId="deal-7" estimateName="Alpha" canOpen />)

    const link = screen.getByRole('link', { name: strings.estimatesList.deal.linkName('Alpha') })
    expect(link.getAttribute('href')).toBe('/crm/deals/deal-7')
    expect(link.textContent).toBe(strings.estimatesList.deal.label)
    expect(strings.estimatesList.deal.linkName('Alpha')).toContain(strings.estimatesList.deal.label)
  })

  it('a plain left click goes through navigateSuite, not a document load', () => {
    render(<DealBadge dealId="deal-7" estimateName="Alpha" canOpen />)

    const notPrevented = fireEvent.click(screen.getByTestId('deal-badge-link'))

    expect(navigateSuite).toHaveBeenCalledExactlyOnceWith('/crm/deals/deal-7')
    expect(notPrevented).toBe(false)
  })

  it('leaves new-tab gestures (ctrl/cmd/shift/middle click) to the browser', () => {
    render(<DealBadge dealId="deal-7" estimateName="Alpha" canOpen />)
    const link = screen.getByTestId('deal-badge-link')

    fireEvent.click(link, { ctrlKey: true })
    fireEvent.click(link, { metaKey: true })
    fireEvent.click(link, { shiftKey: true })
    fireEvent.click(link, { button: 1 })

    expect(navigateSuite).not.toHaveBeenCalled()
  })

  it('without CRM access is a plain badge: not a link, with a hidden "linked to a CRM deal"', () => {
    render(<DealBadge dealId="deal-7" estimateName="Alpha" canOpen={false} />)

    expect(screen.queryByRole('link')).toBeNull()
    const badge = screen.getByTestId('deal-badge')
    expect(badge.textContent).toBe(`${strings.estimatesList.deal.label}${strings.estimatesList.deal.plainHidden}`)
  })

  it('encodes the deal id in the path', () => {
    render(<DealBadge dealId="a/b c" estimateName="Alpha" canOpen />)
    expect(screen.getByTestId('deal-badge-link').getAttribute('href')).toBe('/crm/deals/a%2Fb%20c')
  })
})
