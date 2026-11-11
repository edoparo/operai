/**
 * @vitest-environment jsdom
 *
 * ActivityTimeline on a company page (specs/028 AC-1.1, AC-1.5): activities are read from activities-api;
 * when it cannot answer (`host_unavailable`, `maintenance`) the Activity card says so — words of its own,
 * distinct from the authorization outage — and the rest of the page stays. A write refused for the same
 * reason says nothing was saved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import CrmShell from './CrmShell'
import { createAppRouter } from '../router'
import { ADA, companySummary, fakeApi, page } from '../test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: ADA.id } } }),
}))

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

const company = {
  ...companySummary(),
  legalName: null,
  street: null,
  postalCode: null,
  website: null,
  notes: null,
  version: 1,
  createdAt: '2026-10-01T10:00:00.000Z',
}
const crmRoutes = {
  'GET /scope': () => ({
    status: 200,
    body: { deal: ['welld_ch'], canErase: false, financials: true, managesAll: false },
  }),
  'GET /companies/c1': () => ({ status: 200, body: company }),
  'GET /contacts': () => ({ status: 200, body: page([]) }),
  'GET /deals': () => ({ status: 200, body: page([]) }),
}
const problem = (code: string) => ({ status: 503, body: { status: 503, title: 'Service Unavailable', code } })

describe('ActivityTimeline — activities-api', () => {
  it.each([
    ['host_unavailable', 'Activities cannot be shown right now', 'The service could not confirm your access.'],
    ['maintenance', 'Activities are paused for maintenance', 'They will be back shortly.'],
  ])('%s: the card shows its own state with Retry, the page stays', async (code, title, body) => {
    let loads = 0
    apiFetch.mockImplementation(
      fakeApi({
        ...crmRoutes,
        'GET /activities': () => {
          loads += 1
          return loads === 1 ? problem(code) : { status: 200, body: page([]) }
        },
      }),
    )
    window.history.pushState(null, '', '/companies/c1')
    render(<RouterProvider router={createAppRouter(undefined, CrmShell)} />)

    const banner = await screen.findByTestId('crm-activities-unavailable')
    expect(within(banner).getByText(title)).not.toBeNull()
    expect(within(banner).getByText(body, { exact: false })).not.toBeNull()
    expect(screen.queryByText('Authorization service unavailable')).toBeNull()
    // Everything else on the page renders, and the card keeps its action.
    expect(screen.getByRole('heading', { level: 2, name: 'Acme SA' })).not.toBeNull()
    expect(screen.getByRole('heading', { level: 3, name: 'Activity' })).not.toBeNull()
    expect(screen.getByTestId('crm-activity-log')).not.toBeNull()
    // The activities were asked of activities-api, not of crm-api.
    const origins = apiFetch.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname === '/activities')
      .map((url) => url.origin)
    expect(origins).toEqual(['http://activities-api.test'])

    fireEvent.click(screen.getByTestId('crm-activities-unavailable-retry'))
    expect(await screen.findByText('No activity yet')).not.toBeNull()
  })

  it('a save refused as host_unavailable says nothing was saved and keeps the dialog and its values', async () => {
    apiFetch.mockImplementation(
      fakeApi({
        ...crmRoutes,
        'GET /activities': () => ({ status: 200, body: page([]) }),
        'POST /activities': () => problem('host_unavailable'),
      }),
    )
    window.history.pushState(null, '', '/companies/c1')
    render(<RouterProvider router={createAppRouter(undefined, CrmShell)} />)
    fireEvent.click(await screen.findByTestId('crm-activity-log'))
    const dialog = await screen.findByRole('dialog', { name: 'Log activity' })
    fireEvent.change(within(dialog).getByLabelText('Subject', { exact: false }), { target: { value: 'Called Acme' } })
    fireEvent.click(within(dialog).getByTestId('crm-activity-form-submit'))
    await waitFor(() =>
      expect(
        within(dialog).getByText('Your access could not be confirmed. Nothing was saved. Try again.'),
      ).not.toBeNull(),
    )
    expect((within(dialog).getByLabelText('Subject', { exact: false }) as HTMLInputElement).value).toBe('Called Acme')
  })
})
