/**
 * @vitest-environment jsdom
 *
 * PurchaseOrderCard (specs/022 AC-2.3, AC-2.4, AC-3.1 – AC-3.3, specs/021 AC-3.1): the purchase order of a
 * project made from a deal — the deal as a link to the CRM, the "no longer won" notice, the estimate link
 * into EstimAI, the Bexio order id (editable only with the `bexio` scope) and its terms, which only a
 * holder of manage projects changes. There is no control that detaches, moves or deletes it (D38, D39).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ScopeContext } from '../hooks/useScope'
import { fakeApi, problem, projectDetail, purchaseOrderOf, scope, termsOf } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'
import type { Project, PurchaseOrder, Scope } from '../lib/types'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada', name: 'Ada Lovelace' } } }),
}))

import PurchaseOrderCard from './PurchaseOrderCard'

const FIXED = { deadline: '2026-12-01', estimatedManDays: 12.5, maxEffortManDays: 40 }

const projectWith = (po: Partial<PurchaseOrder> = {}, over: Partial<Project> = {}): Project =>
  projectDetail({
    type: 'fixed_price',
    purchaseOrder: purchaseOrderOf(po),
    terms: termsOf('fixed_price', FIXED),
    startDate: '2026-02-01',
    ...over,
  })

const onChanged = vi.fn()
const onStale = vi.fn()

const renderCard = (
  project: Project,
  callerScope: Scope = scope({ manage: ['welld_ch'] }),
  routes: Record<string, FakeHandler> = {},
) => {
  apiFetch.mockImplementation(fakeApi(routes))
  render(
    <ScopeContext.Provider value={callerScope}>
      <PurchaseOrderCard
        project={project}
        canManage={callerScope.manage.includes('welld_ch')}
        onChanged={onChanged}
        onStale={onStale}
      />
    </ScopeContext.Provider>,
  )
  return screen.getByTestId('project-purchase-order')
}

beforeEach(() => {
  window.scrollTo = () => undefined
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const writes = () =>
  apiFetch.mock.calls
    .filter(([, init]) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes((init as RequestInit | undefined)?.method ?? ''))
    .map(([input, init]) => ({
      method: (init as RequestInit).method!,
      path: new URL(String(input)).pathname,
      ifMatch: ((init as RequestInit).headers as Record<string, string>)['If-Match'],
      body: JSON.parse(String((init as RequestInit).body ?? 'null')) as unknown,
    }))

describe('the card (AC-3.3)', () => {
  it('is titled "Purchase order", with its terms below a "Terms" heading', () => {
    const card = renderCard(projectWith())
    expect(within(card).getByRole('heading', { level: 3, name: 'Purchase order' })).not.toBeNull()
    expect(within(card).getByRole('heading', { level: 4, name: 'Terms' })).not.toBeNull()
    expect(card.textContent).toContain('01.12.2026')
    expect(card.textContent).toContain('12.5 man-days')
    expect(card.textContent).toContain('40 man-days')
  })

  it('shows the deal’s title as a link to the CRM, and no "origin": every PO is from a deal', () => {
    const card = renderCard(projectWith({ deal: { id: 'd1', title: 'Website relaunch', won: true } }))
    expect(within(card).getByRole('link', { name: 'Website relaunch' }).getAttribute('href')).toBe('/crm/deals/d1')
    expect(card.textContent).not.toMatch(/origin|entered by hand|from a deal/i)
  })

  it('keeps the link to the deal when the CRM could not name it', () => {
    const card = renderCard(projectWith({ deal: { id: 'd1', title: null, won: null } }))
    expect(within(card).getByRole('link', { name: 'Deal title unavailable' }).getAttribute('href')).toBe(
      '/crm/deals/d1',
    )
  })

  it('renders no amount, price or rate', () => {
    const card = renderCard(projectWith())
    expect(card.textContent).not.toMatch(/\b(price|rate|amount|fee|budget|cost)\b|CHF|EUR|€/i)
  })

  it('shows the terms of its type: positions for time and material', () => {
    const card = renderCard(
      projectWith(
        {},
        {
          type: 't_and_m',
          terms: termsOf('t_and_m', { positions: [{ profile: 'Senior developer', plannedManDays: 20 }] }),
        },
      ),
    )
    expect(card.textContent).toContain('Senior developer')
  })
})

describe('the estimate (AC-3.2)', () => {
  it('shows the estimate as a link that opens it in EstimAI', () => {
    const card = renderCard(projectWith({ estimate: { id: 'est-1' } }))
    expect(within(card).getByRole('link', { name: 'Open the estimate' }).getAttribute('href')).toBe(
      '/estimai/estimates/est-1',
    )
  })

  it('has no estimate link when the deal had no estimate', () => {
    const card = renderCard(projectWith({ estimate: null }))
    expect(within(card).queryByRole('link', { name: 'Open the estimate' })).toBeNull()
  })
})

describe('the "no longer won" notice (AC-2.3, AC-2.4)', () => {
  it('says "the deal is no longer won" when the deal was reopened, and changes nothing else', () => {
    const card = renderCard(projectWith({ deal: { id: 'd1', title: 'Website relaunch', won: false } }))
    expect(within(card).getByTestId('purchase-order-deal-not-won').textContent).toContain('The deal is no longer won')
    expect(within(card).getByRole('button', { name: 'Edit' })).not.toBeNull()
    expect(card.textContent).toContain('12.5 man-days')
  })

  it.each([
    ['won again (AC-2.4)', true],
    ['not known because the CRM could not answer', null],
  ])('has no notice when the deal is %s', (_name, won) => {
    const card = renderCard(projectWith({ deal: { id: 'd1', title: won === null ? null : 'Website relaunch', won } }))
    expect(within(card).queryByTestId('purchase-order-deal-not-won')).toBeNull()
    expect(card.textContent).not.toContain('no longer won')
  })
})

describe('who may change its terms (AC-4.4)', () => {
  it('a manager can edit and set an end date, and has no way to detach, move or delete the PO (D38, D39)', () => {
    const card = renderCard(projectWith(), scope({ manage: ['welld_ch'], bexio: true }))
    const controls = [...within(card).queryAllByRole('button'), ...within(card).queryAllByRole('link')]
      .map((control) => control.textContent)
      .join(' | ')
    expect(controls).toContain('Edit')
    expect(controls).toContain('Set end date')
    expect(controls).not.toMatch(/detach|unlink|move|reassign|delet|remove|attach|scollega|sposta|elimin/i)
    expect(card.querySelector('[data-testid*="delete"]')).toBeNull()
  })

  it('a reader gets neither Edit nor a date control', () => {
    const card = renderCard(projectWith(), scope())
    expect(within(card).queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Set end date' })).toBeNull()
  })

  it('editing the terms PATCHes them with the terms version (not the purchase order’s) and tells the page', async () => {
    const card = renderCard(
      projectWith({ version: 9 }, { terms: termsOf('fixed_price', FIXED, { version: 4 }) }),
      scope({ manage: ['welld_ch'] }),
      { 'PATCH /projects/p1/terms': () => ({ status: 200, body: termsOf('fixed_price', FIXED, { version: 5 }) }) },
    )
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit terms' })
    fireEvent.change(within(dialog).getByLabelText(/^Max effort/), { target: { value: '55' } })
    fireEvent.click(within(dialog).getByTestId('terms-form-submit'))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Terms saved.'))
    expect(writes().map((write) => [write.method, write.path, write.ifMatch])).toEqual([
      ['PATCH', '/projects/p1/terms', '"4"'],
    ])
  })

  it('the man-days of an estimate-backed PO are read-only in the terms edit and not sent (AC-3.1)', async () => {
    const card = renderCard(projectWith({ estimate: { id: 'est-1' } }), scope({ manage: ['welld_ch'] }), {
      'PATCH /projects/p1/terms': () => ({ status: 200, body: termsOf('fixed_price', FIXED, { version: 5 }) }),
    })
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit terms' })
    expect((within(dialog).getByLabelText(/^Estimated man-days/) as HTMLInputElement).readOnly).toBe(true)
    fireEvent.change(within(dialog).getByLabelText(/^Max effort/), { target: { value: '55' } })
    fireEvent.click(within(dialog).getByTestId('terms-form-submit'))
    await waitFor(() => expect(writes().length).toBe(1))
    expect(writes()[0]!.body).not.toHaveProperty('estimatedManDays')
  })
})

describe('the Bexio order id (AC-3.1)', () => {
  it('a project manager reads it and has no field; accounting gets the field', () => {
    const project = projectWith({ bexioOrderId: 'AB-100' })
    const card = renderCard(project, scope({ manage: ['welld_ch'] }))
    expect(within(card).queryByLabelText('Bexio order')).toBeNull()
    expect(card.textContent).toContain('AB-100')
    cleanup()
    const accounting = renderCard(project, scope({ bexio: true }))
    expect((within(accounting).getByLabelText('Bexio order') as HTMLInputElement).value).toBe('AB-100')
  })

  it('saving it PUTs it with the purchase order version and tells the page', async () => {
    const card = renderCard(projectWith({ version: 7 }), scope({ manage: ['welld_ch'], bexio: true }), {
      'PUT /projects/p1/purchase-order/bexio-order': () => ({
        status: 200,
        body: purchaseOrderOf({ bexioOrderId: 'AB-200', version: 8 }),
      }),
    })
    fireEvent.change(within(card).getByLabelText('Bexio order'), { target: { value: 'AB-200' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Bexio order saved.'))
    expect(writes()).toEqual([
      {
        method: 'PUT',
        path: '/projects/p1/purchase-order/bexio-order',
        ifMatch: '"7"',
        body: { bexioOrderId: 'AB-200' },
      },
    ])
  })

  it('a stale Bexio save (the purchase order changed meanwhile) is the page’s to handle', async () => {
    const card = renderCard(projectWith(), scope({ bexio: true }), {
      'PUT /projects/p1/purchase-order/bexio-order': () => problem(409, 'version_conflict', { currentVersion: 9 }),
    })
    fireEvent.change(within(card).getByLabelText('Bexio order'), { target: { value: 'AB-200' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onStale).toHaveBeenCalledTimes(1))
  })
})
