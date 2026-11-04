/**
 * @vitest-environment jsdom
 *
 * AttachDealDialog (AC-1.4, AC-1.5, AC-3.1): a queued deal attached to an
 * existing project — found by name, the contract's dates and the terms of the
 * project's type asked in the same step, the man-days of a fixed-price contract
 * read-only when the deal has an estimate, the body that reaches
 * `POST /queue/{dealId}/attach`, and each refusal (internal, closed or cancelled
 * project, another company, deal already taken, no longer won) in its own words.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { fakeApi, page, problem, projectSummary } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'
import type { Contract, QueueItem } from '../lib/types'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada', name: 'Ada Lovelace' } } }),
}))

import AttachDealDialog from './AttachDealDialog'

const DEAL: QueueItem = {
  dealId: 'd1',
  title: 'Website relaunch',
  entity: 'welld_ch',
  company: { id: 'c1', name: 'Acme SA' },
  wonAt: '2026-10-20T12:00:00.000Z',
  estimate: { id: 'est-1', name: 'Relaunch estimate' },
}
const WITHOUT_ESTIMATE: QueueItem = { ...DEAL, estimate: null }

const FIXED = projectSummary({ id: 'pF', name: 'Intranet phase 2', type: 'fixed_price' })
const TM = projectSummary({ id: 'pT', name: 'Support pool', type: 't_and_m' })
const MAINT = projectSummary({ id: 'pM', name: 'Care plan', type: 'maintenance' })

const attached = { id: 'k9', projectId: 'pF' } as unknown as Contract

const onCancel = vi.fn()
const onAttached = vi.fn()
const onGone = vi.fn()

const renderDialog = (deal: QueueItem = DEAL, routes: Record<string, FakeHandler> = {}) => {
  apiFetch.mockImplementation(
    fakeApi({
      'GET /projects': () => ({ status: 200, body: page([FIXED, TM, MAINT]) }),
      'POST /queue/d1/attach': () => ({ status: 201, body: attached }),
      ...routes,
    }),
  )
  render(<AttachDealDialog deal={deal} onCancel={onCancel} onAttached={onAttached} onGone={onGone} />)
  return screen.getByRole('dialog', { name: 'Attach to a project' })
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

const posted = () => {
  const call = apiFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
  return call
    ? { url: new URL(String(call[0])), body: JSON.parse(String((call[1] as RequestInit).body)) as unknown }
    : null
}

const chooseProject = async (dialog: HTMLElement, name: RegExp) => {
  const input = within(dialog).getByRole('combobox', { name: /^Project/ })
  fireEvent.change(input, { target: { value: 'a' } })
  fireEvent.click(await within(dialog).findByRole('option', { name }))
}
const setField = (dialog: HTMLElement, label: RegExp, value: string) =>
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value } })

const fillFixedPrice = async (dialog: HTMLElement) => {
  await chooseProject(dialog, /Intranet phase 2/)
  setField(dialog, /^Start date/, '2026-11-01')
  setField(dialog, /^Deadline/, '2026-12-01')
  setField(dialog, /^Max effort/, '40')
}

describe('finding the project (AC-1.4)', () => {
  it('looks projects up by name as the person types, offering each with its type', async () => {
    const dialog = renderDialog()
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^Project/ }), { target: { value: 'intra' } })
    const option = await within(dialog).findByRole('option', { name: /Intranet phase 2/ })
    expect(option.textContent).toContain('Fixed price')
    const lookup = apiFetch.mock.calls
      .map(([input]) => new URL(String(input)))
      .find((url) => url.pathname === '/projects')!
    expect(lookup.origin).toBe('http://projects-api.test')
    expect(lookup.searchParams.get('q')).toBe('intra')
  })

  it('says so when no project matches', async () => {
    const dialog = renderDialog(DEAL, { 'GET /projects': () => ({ status: 200, body: page([]) }) })
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^Project/ }), { target: { value: 'zzz' } })
    expect(await within(dialog).findByText('No project matches.')).not.toBeNull()
  })

  it('asks for the contract only once a project is chosen, with the terms of that project’s type', async () => {
    const dialog = renderDialog()
    expect(within(dialog).getByText('Choose a project to see the terms of its contract.')).not.toBeNull()
    expect(within(dialog).queryByLabelText(/^Start date/)).toBeNull()

    await chooseProject(dialog, /Intranet phase 2/)
    expect(within(dialog).getByLabelText(/^Start date/)).not.toBeNull()
    expect(within(dialog).getByLabelText(/^End date/)).not.toBeNull()
    expect(within(dialog).getByLabelText(/^Deadline/)).not.toBeNull()

    await chooseProject(dialog, /Support pool/)
    expect(within(dialog).queryByLabelText(/^Deadline/)).toBeNull()
    expect(within(dialog).getByLabelText(/^Profile/)).not.toBeNull()

    await chooseProject(dialog, /Care plan/)
    expect(within(dialog).getByLabelText('Include an SLA')).not.toBeNull()
  })
})

describe('the man-days of a fixed-price contract (AC-3.1)', () => {
  it('are read-only, "from the estimate", for a deal with an estimate', async () => {
    const dialog = renderDialog(DEAL)
    await chooseProject(dialog, /Intranet phase 2/)
    const field = within(dialog).getByLabelText(/^Estimated man-days/) as HTMLInputElement
    expect(field.readOnly).toBe(true)
    expect(field.value).toBe('From the estimate')
  })

  it('are an optional input for a deal without one', async () => {
    const dialog = renderDialog(WITHOUT_ESTIMATE)
    await chooseProject(dialog, /Intranet phase 2/)
    expect((within(dialog).getByLabelText(/^Estimated man-days/) as HTMLInputElement).readOnly).toBe(false)
  })

  it('are not part of the request for a deal with an estimate', async () => {
    const dialog = renderDialog(DEAL)
    await fillFixedPrice(dialog)
    fireEvent.click(within(dialog).getByTestId('attach-deal-submit'))
    await waitFor(() => expect(onAttached).toHaveBeenCalled())
    const body = posted()!.body as { contract: { terms: Record<string, unknown> } }
    expect(body.contract.terms).toEqual({ deadline: '2026-12-01', maxEffortManDays: 40 })
  })
})

describe('attaching the deal (AC-1.4)', () => {
  it('asks for a project and a start date before calling the API', () => {
    const dialog = renderDialog()
    fireEvent.click(within(dialog).getByTestId('attach-deal-submit'))
    expect(within(dialog).getByText('Choose a project from the list.')).not.toBeNull()
    expect(posted()).toBeNull()
  })

  it('checks the contract before calling the API', async () => {
    const dialog = renderDialog()
    await chooseProject(dialog, /Intranet phase 2/)
    fireEvent.click(within(dialog).getByTestId('attach-deal-submit'))
    expect(within(dialog).getAllByText('This field is required.').length).toBeGreaterThanOrEqual(3)
    expect(posted()).toBeNull()
  })

  it('sends the project and the contract, with no If-Match: an attach creates', async () => {
    const dialog = renderDialog(WITHOUT_ESTIMATE)
    await fillFixedPrice(dialog)
    setField(dialog, /^Estimated man-days/, '12.5')
    setField(dialog, /^End date/, '2027-02-28')
    fireEvent.click(within(dialog).getByTestId('attach-deal-submit'))
    await waitFor(() => expect(onAttached).toHaveBeenCalled())
    const request = posted()!
    expect(request.url.origin + request.url.pathname).toBe('http://projects-api.test/queue/d1/attach')
    expect(request.body).toEqual({
      projectId: 'pF',
      contract: {
        startDate: '2026-11-01',
        endDate: '2027-02-28',
        terms: { deadline: '2026-12-01', estimatedManDays: 12.5, maxEffortManDays: 40 },
      },
    })
    const init = apiFetch.mock.calls.find(
      ([, i]) => (i as RequestInit | undefined)?.method === 'POST',
    )![1] as RequestInit
    expect((init.headers as Record<string, string>)['If-Match']).toBeUndefined()
  })

  it('hands the new contract to the page', async () => {
    const dialog = renderDialog(WITHOUT_ESTIMATE)
    await fillFixedPrice(dialog)
    fireEvent.click(within(dialog).getByTestId('attach-deal-submit'))
    await waitFor(() => expect(onAttached).toHaveBeenCalledTimes(1))
    expect((onAttached.mock.calls[0]![0] as Contract).projectId).toBe('pF')
    expect(onGone).not.toHaveBeenCalled()
  })
})

describe('refusals (AC-1.5)', () => {
  const ON_THE_PROJECT: [string, number, string][] = [
    ['contracts_not_allowed', 409, 'An internal project takes no contracts.'],
    ['project_not_open', 409, 'A closed or cancelled project takes no new contract. Reopen it first.'],
    [
      'company_mismatch',
      422,
      'A client project takes contracts for its own company only. Choose a project of this deal’s company.',
    ],
  ]

  it.each(ON_THE_PROJECT)('%s is said on the project field, with every value kept', async (code, status, text) => {
    const dialog = renderDialog(WITHOUT_ESTIMATE, { 'POST /queue/d1/attach': () => problem(status, code) })
    await fillFixedPrice(dialog)
    fireEvent.click(within(dialog).getByTestId('attach-deal-submit'))
    expect(await within(dialog).findByText(text)).not.toBeNull()
    expect(within(dialog).queryByTestId('attach-deal-error')).toBeNull()
    expect(onAttached).not.toHaveBeenCalled()
    expect((within(dialog).getByLabelText(/^Deadline/) as HTMLInputElement).value).toBe('2026-12-01')
  })

  const ON_THE_DEAL: [string, number, string][] = [
    ['deal_not_found', 404, 'This deal no longer exists in the CRM.'],
    ['deal_not_won', 409, 'This deal is no longer won in the CRM, so it cannot be taken.'],
    ['deal_taken', 409, 'A project has just taken this deal.'],
    ['out_of_scope', 403, 'You may not take deals of this entity.'],
    ['crm_unavailable', 503, 'The CRM cannot be reached right now. Try again in a moment.'],
    ['estimai_unavailable', 503, 'EstimAI cannot be reached right now'],
  ]

  it.each(ON_THE_DEAL)('%s is said in the dialog', async (code, status, text) => {
    const dialog = renderDialog(WITHOUT_ESTIMATE, { 'POST /queue/d1/attach': () => problem(status, code) })
    await fillFixedPrice(dialog)
    fireEvent.click(within(dialog).getByTestId('attach-deal-submit'))
    expect((await within(dialog).findByTestId('attach-deal-error')).textContent).toContain(text)
  })

  it.each(['deal_not_found', 'deal_not_won', 'deal_taken'])(
    '%s tells the page the deal is gone, so the queue reloads without it',
    async (code) => {
      const dialog = renderDialog(WITHOUT_ESTIMATE, { 'POST /queue/d1/attach': () => problem(409, code) })
      await fillFixedPrice(dialog)
      fireEvent.click(within(dialog).getByTestId('attach-deal-submit'))
      await within(dialog).findByTestId('attach-deal-error')
      expect(onGone).toHaveBeenCalledTimes(1)
    },
  )

  it('does not tell the page the deal is gone when only the project was refused', async () => {
    const dialog = renderDialog(WITHOUT_ESTIMATE, { 'POST /queue/d1/attach': () => problem(409, 'project_not_open') })
    await fillFixedPrice(dialog)
    fireEvent.click(within(dialog).getByTestId('attach-deal-submit'))
    await within(dialog).findByText(/Reopen it first/)
    expect(onGone).not.toHaveBeenCalled()
  })

  it('puts an unknown project (404 without a refusal code) on the project field, with the server’s detail', async () => {
    const dialog = renderDialog(WITHOUT_ESTIMATE, {
      'POST /queue/d1/attach': () => problem(404, 'not_found', {}, 'No such project.'),
    })
    await fillFixedPrice(dialog)
    fireEvent.click(within(dialog).getByTestId('attach-deal-submit'))
    expect(await within(dialog).findByText('No such project.')).not.toBeNull()
  })

  it('shows the server’s detail for a failure it has no words for', async () => {
    const dialog = renderDialog(WITHOUT_ESTIMATE, {
      'POST /queue/d1/attach': () => problem(500, undefined, {}, 'Boom'),
    })
    await fillFixedPrice(dialog)
    fireEvent.click(within(dialog).getByTestId('attach-deal-submit'))
    expect((await within(dialog).findByTestId('attach-deal-error')).textContent).toContain('Boom')
  })
})

describe('closing', () => {
  it('Cancel closes without calling the API', () => {
    const dialog = renderDialog()
    fireEvent.click(within(dialog).getByTestId('attach-deal-cancel'))
    expect(onCancel).toHaveBeenCalled()
    expect(posted()).toBeNull()
  })
})
