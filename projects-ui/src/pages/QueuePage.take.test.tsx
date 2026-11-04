/**
 * @vitest-environment jsdom
 *
 * QueuePage — taking a deal (AC-1.2, AC-1.4, AC-1.6): "New project" and "Attach
 * to project" show only on the deals of an entity the caller manages, open the
 * dialogs for that deal, land the user on the project on success, and reload the
 * queue behind a dialog whose deal was taken meanwhile. The dialogs' own fields
 * and refusals are covered by TakeDealDialog.test.tsx and AttachDealDialog.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from '../router'
import { fakeApi, page, problem, projectDetail, projectSummary, scope } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'
import { scopeRoot } from '../test-support/scopeRoot'
import type { QueueItem, Scope } from '../lib/types'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada', name: 'Ada Lovelace' } } }),
}))

const CH: QueueItem = {
  dealId: 'd1',
  title: 'Website relaunch',
  entity: 'welld_ch',
  company: { id: 'c1', name: 'Acme SA' },
  wonAt: '2026-10-20T12:00:00.000Z',
  estimate: { id: 'est-1', name: 'Relaunch estimate' },
}
const IT: QueueItem = { ...CH, dealId: 'd2', title: 'Portale clienti', entity: 'welld_it', estimate: null }

const queue = (items: QueueItem[]) => ({ status: 200, body: { items, truncated: false } })

const renderQueue = async (routes: Record<string, FakeHandler>, callerScope: Scope) => {
  apiFetch.mockImplementation(
    fakeApi({ 'GET /authz/users/directory': () => ({ status: 200, body: { users: [] } }), ...routes }),
  )
  window.history.pushState(null, '', '/queue')
  render(<RouterProvider router={createAppRouter(undefined, scopeRoot(callerScope))} />)
  await screen.findByTestId('queue-table')
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

const queueReads = () => apiFetch.mock.calls.filter(([input]) => new URL(String(input)).pathname === '/queue').length
const rowOf = (title: string) =>
  within(screen.getByTestId('queue-table')).getByRole('rowheader', { name: title }).closest('tr')!

const fillFixedPrice = (dialog: HTMLElement) => {
  fireEvent.change(within(dialog).getByLabelText(/^Type/), { target: { value: 'fixed_price' } })
  fireEvent.change(within(dialog).getByLabelText(/^Start date/), { target: { value: '2026-11-01' } })
  fireEvent.change(within(dialog).getByLabelText(/^Deadline/), { target: { value: '2026-12-01' } })
  fireEvent.change(within(dialog).getByLabelText(/^Max effort/), { target: { value: '40' } })
}

describe('who sees the actions (AC-1.2, AC-1.4)', () => {
  it('neither action for a reader who manages no entity', async () => {
    await renderQueue({ 'GET /queue': () => queue([CH, IT]) }, scope())
    expect(screen.queryByRole('button', { name: /New project/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Attach to project/ })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).toBeNull()
  })

  it('both on the deals of an entity the caller manages, and none on the others', async () => {
    await renderQueue({ 'GET /queue': () => queue([CH, IT]) }, scope({ manage: ['welld_ch'] }))
    const mine = within(rowOf('Website relaunch'))
    expect(mine.getByRole('button', { name: 'New project: Website relaunch' })).not.toBeNull()
    expect(mine.getByRole('button', { name: 'Attach to project: Website relaunch' })).not.toBeNull()
    expect(within(rowOf('Portale clienti')).queryByRole('button')).toBeNull()
  })

  it('both on every deal for an admin', async () => {
    await renderQueue(
      { 'GET /queue': () => queue([CH, IT]) },
      scope({ manage: ['welld_ch', 'welld_it'], managesAll: true }),
    )
    expect(screen.getAllByRole('button', { name: /^New project: / })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /^Attach to project: / })).toHaveLength(2)
  })
})

describe('the dialogs', () => {
  it('"New project" opens the dialog for that deal, prefilled with its title', async () => {
    await renderQueue({ 'GET /queue': () => queue([CH, IT]) }, scope({ manage: ['welld_ch'] }))
    fireEvent.click(screen.getByRole('button', { name: 'New project: Website relaunch' }))
    const dialog = await screen.findByRole('dialog', { name: 'New project from a deal' })
    expect((within(dialog).getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Website relaunch')
  })

  it('"Attach to project" opens the dialog for that deal', async () => {
    await renderQueue({ 'GET /queue': () => queue([CH]) }, scope({ manage: ['welld_ch'] }))
    fireEvent.click(screen.getByRole('button', { name: 'Attach to project: Website relaunch' }))
    expect(await screen.findByRole('dialog', { name: 'Attach to a project' })).not.toBeNull()
  })

  it('Cancel closes the dialog and leaves the queue as it was', async () => {
    await renderQueue({ 'GET /queue': () => queue([CH]) }, scope({ manage: ['welld_ch'] }))
    fireEvent.click(screen.getByRole('button', { name: 'New project: Website relaunch' }))
    fireEvent.click(await screen.findByTestId('take-deal-cancel'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(queueReads()).toBe(1)
  })
})

describe('after the take', () => {
  it('a new project lands the user on the project page (AC-1.2, AC-1.3)', async () => {
    await renderQueue(
      {
        'GET /queue': () => queue([CH]),
        'POST /queue/d1/project': () => ({ status: 201, body: projectDetail({ id: 'pNew' }) }),
        'GET /projects/pNew': () => ({ status: 200, body: projectDetail({ id: 'pNew' }) }),
      },
      scope({ manage: ['welld_ch'] }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'New project: Website relaunch' }))
    const dialog = await screen.findByRole('dialog', { name: 'New project from a deal' })
    fillFixedPrice(dialog)
    fireEvent.click(within(dialog).getByTestId('take-deal-submit'))
    const projectPage = await screen.findByTestId('project-detail-page')
    expect(projectPage.getAttribute('data-project-id')).toBe('pNew')
    expect(screen.queryByTestId('queue-page')).toBeNull()
  })

  it('an attach lands the user on the project that took the contract (AC-1.4)', async () => {
    await renderQueue(
      {
        'GET /queue': () => queue([CH]),
        'GET /projects': () => ({
          status: 200,
          body: page([projectSummary({ id: 'pF', name: 'Intranet phase 2', type: 'fixed_price' })]),
        }),
        'POST /queue/d1/attach': () => ({ status: 201, body: { id: 'k9', projectId: 'pF' } }),
        'GET /projects/pF': () => ({ status: 200, body: projectDetail({ id: 'pF' }) }),
      },
      scope({ manage: ['welld_ch'] }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Attach to project: Website relaunch' }))
    const dialog = await screen.findByRole('dialog', { name: 'Attach to a project' })
    fireEvent.change(within(dialog).getByRole('combobox', { name: /^Project/ }), { target: { value: 'intra' } })
    fireEvent.click(await within(dialog).findByRole('option', { name: /Intranet phase 2/ }))
    fireEvent.change(within(dialog).getByLabelText(/^Start date/), { target: { value: '2026-11-01' } })
    fireEvent.change(within(dialog).getByLabelText(/^Deadline/), { target: { value: '2026-12-01' } })
    fireEvent.change(within(dialog).getByLabelText(/^Max effort/), { target: { value: '40' } })
    fireEvent.click(within(dialog).getByTestId('attach-deal-submit'))
    const projectPage = await screen.findByTestId('project-detail-page')
    expect(projectPage.getAttribute('data-project-id')).toBe('pF')
  })

  it('a deal taken meanwhile leaves the list behind the dialog, which keeps saying why (AC-1.6)', async () => {
    let taken = false
    await renderQueue(
      {
        'GET /queue': () => queue(taken ? [] : [CH]),
        'POST /queue/d1/project': () => {
          taken = true
          return problem(409, 'deal_taken')
        },
      },
      scope({ manage: ['welld_ch'] }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'New project: Website relaunch' }))
    const dialog = await screen.findByRole('dialog', { name: 'New project from a deal' })
    fillFixedPrice(dialog)
    fireEvent.click(within(dialog).getByTestId('take-deal-submit'))
    expect((await within(dialog).findByTestId('take-deal-error')).textContent).toContain(
      'A project has just taken this deal.',
    )
    await waitFor(() => expect(queueReads()).toBe(2))
    fireEvent.click(within(dialog).getByTestId('take-deal-cancel'))
    expect(await screen.findByText('Nothing waiting to start')).not.toBeNull()
  })
})
