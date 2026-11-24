/**
 * @vitest-environment jsdom
 *
 * TakeDealDialog for a won public tender (US-10): a tender becomes a project WITHOUT a purchase order, so
 * the dialog hides the ops-manager and referent pickers (and reads neither list), asks for the project
 * manager instead (required, among the people who can use Projects), sends `projectManagerId` and never
 * `opsManagerId` / `referentContactId`, and lands the server's refusals on the project manager. The
 * standard take is covered, unchanged, by TakeDealDialog.test.tsx; one check here pins that a deal with no
 * `kind` (an older server) is still a standard take.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { fakeApi, problem, projectDetail } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'
import type { QueueItem } from '../lib/types'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  usePermissions: () => ({ epoch: 0, apps: [], roles: [], departments: [], permissions: [] }),
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada', name: 'Ada Lovelace' } } }),
}))

import TakeDealDialog from './TakeDealDialog'

const BOB = { id: 'u-bob', name: 'Bob Builder', email: 'bob@welld.ch', entity: 'welld_ch' }

const TENDER: QueueItem = {
  dealId: 't1',
  title: 'Chips JU call 2026',
  entity: 'welld_ch',
  company: { id: 'fb1', name: 'Chips Joint Undertaking' },
  wonAt: '2026-11-20T12:00:00.000Z',
  estimate: null,
  kind: 'tender',
}

const onCancel = vi.fn()
const onTaken = vi.fn()
const onGone = vi.fn()

const pathsCalled = () => apiFetch.mock.calls.map(([input]) => new URL(String(input)).pathname)

const renderTender = (routes: Record<string, FakeHandler> = {}) => {
  apiFetch.mockImplementation(
    fakeApi({
      'GET /authz/users/directory': () => ({ status: 200, body: { users: [BOB] } }),
      'POST /queue/t1/project': () => ({
        status: 201,
        body: projectDetail({ id: 'pNew', name: TENDER.title, tenderDealId: 't1' }),
      }),
      ...routes,
    }),
  )
  render(<TakeDealDialog deal={TENDER} onCancel={onCancel} onTaken={onTaken} onGone={onGone} />)
  return screen.getByRole('dialog', { name: 'New project from a tender' })
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
  return call ? (JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>) : null
}

const fillTimeAndMaterial = (dialog: HTMLElement) => {
  fireEvent.change(within(dialog).getByLabelText(/^Type/), { target: { value: 't_and_m' } })
  fireEvent.change(within(dialog).getByLabelText(/^Start date/), { target: { value: '2027-01-01' } })
  fireEvent.change(within(dialog).getByLabelText(/^Profile/), { target: { value: 'Backend developer' } })
  fireEvent.change(within(dialog).getByLabelText(/^Planned man-days/), { target: { value: '30' } })
}

const pickBob = async (dialog: HTMLElement) => {
  fireEvent.focus(within(dialog).getByRole('combobox', { name: /Project manager/ }))
  fireEvent.click(await within(dialog).findByRole('option', { name: /Bob Builder/ }))
}

describe('the fields of a tender (US-10)', () => {
  it('hides the ops manager and the referent, reads neither list, and explains why', async () => {
    const dialog = renderTender()
    expect(within(dialog).queryByLabelText(/^Ops manager/)).toBeNull()
    expect(within(dialog).queryByLabelText(/^Referent/)).toBeNull()
    expect(within(dialog).getByTestId('take-deal-tender-note').textContent).toBe(
      'A tender becomes a project without a purchase order: no ops manager, no billing. Choose its project manager now.',
    )
    expect(dialog.textContent).toContain('Chips Joint Undertaking')
    expect(within(dialog).getByText('Project terms')).not.toBeNull()
    await waitFor(() => expect(pathsCalled()).toContain('/authz/users/directory'))
    expect(pathsCalled()).not.toContain('/queue/t1/ops-managers')
    expect(pathsCalled()).not.toContain('/queue/t1/contacts')
  })

  it('asks for the project manager among the people who can use Projects, with no one chosen by default', async () => {
    const dialog = renderTender()
    const manager = within(dialog).getByRole('combobox', { name: /Project manager/ }) as HTMLInputElement
    expect(manager.value).toBe('')
    await pickBob(dialog)
    const directory = apiFetch.mock.calls
      .map(([input]) => new URL(String(input)))
      .find((url) => url.pathname === '/authz/users/directory')!
    expect(directory.searchParams.get('appId')).toBe('projects')
  })
})

describe('taking a tender (US-10)', () => {
  it('requires the project manager before calling the API', async () => {
    const dialog = renderTender()
    fillTimeAndMaterial(dialog)
    fireEvent.click(within(dialog).getByTestId('take-deal-submit'))
    expect(await within(dialog).findByText('Choose the project manager of this tender.')).not.toBeNull()
    expect(posted()).toBeNull()
  })

  it('sends the project manager and never an ops manager or a referent', async () => {
    const dialog = renderTender()
    fillTimeAndMaterial(dialog)
    await pickBob(dialog)
    fireEvent.click(within(dialog).getByTestId('take-deal-submit'))
    await waitFor(() => expect(onTaken).toHaveBeenCalled())
    const body = posted()!
    expect(body).toEqual({
      name: 'Chips JU call 2026',
      type: 't_and_m',
      terms: {
        startDate: '2027-01-01',
        terms: { positions: [{ profile: 'Backend developer', plannedManDays: 30 }] },
      },
      projectManagerId: 'u-bob',
    })
    expect(body).not.toHaveProperty('opsManagerId')
    expect(body).not.toHaveProperty('referentContactId')
  })

  it('a 422 project_manager_required lands on the project manager, in its own words', async () => {
    const dialog = renderTender({
      'POST /queue/t1/project': () =>
        problem(422, 'project_manager_required', { field: 'projectManagerId' }, 'server words'),
    })
    fillTimeAndMaterial(dialog)
    await pickBob(dialog)
    fireEvent.click(within(dialog).getByTestId('take-deal-submit'))
    expect(await within(dialog).findByText('Choose the project manager of this tender.')).not.toBeNull()
    expect(
      within(dialog)
        .getByRole('combobox', { name: /Project manager/ })
        .getAttribute('aria-invalid'),
    ).toBe('true')
    expect(dialog.textContent).not.toContain('server words')
    expect(onTaken).not.toHaveBeenCalled()
  })

  it('a project manager who cannot use Projects (not_project_user) is refused on the project manager', async () => {
    const dialog = renderTender({
      'POST /queue/t1/project': () => problem(422, 'not_project_user', { userIds: ['u-bob'] }),
    })
    fillTimeAndMaterial(dialog)
    await pickBob(dialog)
    fireEvent.click(within(dialog).getByTestId('take-deal-submit'))
    expect(
      await within(dialog).findByText('This person has no access to Projects. Choose someone who does.'),
    ).not.toBeNull()
    expect(
      within(dialog)
        .getByRole('combobox', { name: /Project manager/ })
        .getAttribute('aria-invalid'),
    ).toBe('true')
  })

  it('auth down is said about the project manager, not the ops manager', async () => {
    const dialog = renderTender({ 'POST /queue/t1/project': () => problem(503, 'identity_unavailable') })
    fillTimeAndMaterial(dialog)
    await pickBob(dialog)
    fireEvent.click(within(dialog).getByTestId('take-deal-submit'))
    const error = await within(dialog).findByTestId('take-deal-error')
    expect(error.textContent).toContain('the project manager could not be checked')
  })

  it('a deal that is no longer a tender reloads the queue and says why', async () => {
    const dialog = renderTender({
      'POST /queue/t1/project': () => problem(422, 'only_for_tenders', { field: 'projectManagerId' }),
    })
    fillTimeAndMaterial(dialog)
    await pickBob(dialog)
    fireEvent.click(within(dialog).getByTestId('take-deal-submit'))
    expect((await within(dialog).findByTestId('take-deal-error')).textContent).toContain(
      'This deal is no longer a public tender',
    )
    expect(onGone).toHaveBeenCalled()
  })
})

describe('a deal with no kind (an older server)', () => {
  it('is a standard take: the ops manager and the referent, no project manager', async () => {
    const legacy: QueueItem = { ...TENDER, dealId: 'd1' }
    delete legacy.kind
    apiFetch.mockImplementation(
      fakeApi({
        'GET /queue/d1/ops-managers': () => ({
          status: 200,
          body: { items: [{ id: 'u-ops', name: 'Olga Ops', admin: false }], prefillId: 'u-ops' },
        }),
        'GET /queue/d1/contacts': () => ({ status: 200, body: { items: [] } }),
      }),
    )
    render(<TakeDealDialog deal={legacy} onCancel={onCancel} onTaken={onTaken} onGone={onGone} />)
    const dialog = screen.getByRole('dialog', { name: 'New project from a deal' })
    expect(within(dialog).getByLabelText(/^Ops manager/)).not.toBeNull()
    expect(within(dialog).getByLabelText(/^Referent/)).not.toBeNull()
    expect(within(dialog).queryByRole('combobox', { name: /Project manager/ })).toBeNull()
    expect(within(dialog).queryByTestId('take-deal-tender-note')).toBeNull()
  })
})
