/**
 * @vitest-environment jsdom
 *
 * Component tests for AccessRequestsPage (T9, specs/023, design.md F1-F4, F7, S1-S3).
 *
 * `../lib/adminApi` is mocked at module level keeping the real `ApiError`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import AccessRequestsPage from './AccessRequestsPage'
import type { AccessRequestDetail, Department, InvitationDetail, Paginated, Role } from '../lib/adminApi'

vi.mock('../lib/adminApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/adminApi')>()
  return {
    ...original,
    listAccessRequests: vi.fn(),
    approveAccessRequest: vi.fn(),
    rejectAccessRequest: vi.fn(),
    listRoles: vi.fn(),
    listDepartments: vi.fn(),
  }
})

import * as adminApi from '../lib/adminApi'
import { ApiError } from '../lib/adminApi'

const listAccessRequests = vi.mocked(adminApi.listAccessRequests)
const approveAccessRequest = vi.mocked(adminApi.approveAccessRequest)
const rejectAccessRequest = vi.mocked(adminApi.rejectAccessRequest)

function renderPage() {
  window.history.pushState(null, '', '/users/access-requests')
  const rootRoute = createRootRoute()
  const mk = (path: string, component: () => React.ReactNode) =>
    createRoute({ getParentRoute: () => rootRoute, path, component })
  const routeTree = rootRoute.addChildren([
    mk('/users', () => null),
    mk('/users/invitations', () => <p>invitations screen</p>),
    mk('/users/access-requests', AccessRequestsPage),
  ])
  return render(<RouterProvider router={createRouter({ routeTree })} />)
}

const role: Role = { id: 'r1', name: 'accounting', description: null, isSystem: false, createdAt: '', updatedAt: '' }
const dept: Department = { id: 'd1', name: 'Finance', description: null, createdAt: '', updatedAt: '' }

const ada: AccessRequestDetail = {
  id: 'ar-1',
  email: 'ada@welld.ch',
  name: 'Ada Lovelace',
  provider: 'google',
  status: 'pending',
  firstRequestedAt: '2026-11-01T09:00:00.000Z',
  requestedAt: '2026-11-04T09:00:00.000Z',
  decidedAt: null,
  decidedBy: null,
  invitationId: null,
}
const grace: AccessRequestDetail = {
  ...ada,
  id: 'ar-2',
  email: 'grace@welld.ch',
  name: 'Grace Hopper',
  provider: 'github',
}

const page = (items: AccessRequestDetail[]): Paginated<AccessRequestDetail> => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 20,
})

const invitation = (emailDelivery: 'sent' | 'failed'): InvitationDetail =>
  ({ id: 'inv-1', email: 'ada@welld.ch', emailDelivery }) as unknown as InvitationDetail

beforeEach(() => {
  vi.mocked(adminApi.listRoles).mockResolvedValue([role])
  vi.mocked(adminApi.listDepartments).mockResolvedValue([dept])
  listAccessRequests.mockResolvedValue(page([ada, grace]))
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  window.history.pushState(null, '', '/')
})

const openApprove = async (id = 'ar-1') => {
  const btn = await screen.findByTestId(`access-request-approve-${id}`)
  await waitFor(() => expect(btn.hasAttribute('disabled')).toBe(false))
  fireEvent.click(btn)
}

describe('list states (F1, S1)', () => {
  it('shows the loading state first', async () => {
    listAccessRequests.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(await screen.findByText('Loading access requests')).not.toBeNull()
  })

  it('opens on Pending and lists email, name, provider, last asked, with labelled row actions (AC-3.1)', async () => {
    renderPage()
    const row = await screen.findByTestId('access-request-row-ar-1')
    expect(listAccessRequests).toHaveBeenCalledWith({ status: 'pending', page: 1, pageSize: 20 })
    expect(within(row).getByText('ada@welld.ch')).not.toBeNull()
    expect(within(row).getByText('Ada Lovelace')).not.toBeNull()
    expect(within(row).getByText('Google')).not.toBeNull()
    expect(within(screen.getByTestId('access-request-row-ar-2')).getByText('GitHub')).not.toBeNull()
    expect(screen.getByRole('table', { name: 'Access requests' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Approve access request from ada@welld.ch' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Reject access request from grace@welld.ch' })).not.toBeNull()
    // Pending has no State / Decided columns.
    expect(screen.queryByRole('columnheader', { name: 'Decided by' })).toBeNull()
    expect((screen.getByTestId('access-requests-status-filter') as HTMLSelectElement).value).toBe('pending')
  })

  it('renders an unknown provider as text and never as a mailto link or markup', async () => {
    listAccessRequests.mockResolvedValue(page([{ ...ada, name: '<b>Eve</b>', provider: 'unknown' }]))
    renderPage()
    const row = await screen.findByTestId('access-request-row-ar-1')
    expect(within(row).getByText('<b>Eve</b>')).not.toBeNull()
    expect(within(row).getByText('Unknown')).not.toBeNull()
    expect(row.querySelector('a, b')).toBeNull()
  })

  it.each([
    ['pending', 'No one is waiting for access'],
    ['approved', 'No approved requests'],
    ['rejected', 'No rejected requests'],
  ] as const)('shows the empty state for %s', async (status, title) => {
    listAccessRequests.mockResolvedValue(page([]))
    renderPage()
    if (status !== 'pending') {
      await screen.findByText('No one is waiting for access')
      fireEvent.change(screen.getByTestId('access-requests-status-filter'), { target: { value: status } })
    }
    expect(await screen.findByText(title)).not.toBeNull()
  })

  it('shows the error with the server detail and Retry reloads', async () => {
    listAccessRequests.mockRejectedValueOnce(new ApiError({ status: 500, title: 'Boom', detail: 'db down' } as never))
    renderPage()
    expect((await screen.findByTestId('error-banner')).textContent).toContain('db down')
    fireEvent.click(screen.getByTestId('error-banner-retry'))
    expect(await screen.findByTestId('access-request-row-ar-1')).not.toBeNull()
    expect(listAccessRequests).toHaveBeenCalledTimes(2)
  })

  it('shows PermissionDenied on a 403 (F7, AC-3.10)', async () => {
    listAccessRequests.mockRejectedValue(new ApiError({ status: 403, title: 'Forbidden' } as never))
    renderPage()
    expect(await screen.findByTestId('permission-denied')).not.toBeNull()
    expect(screen.queryByTestId('access-requests-table')).toBeNull()
  })

  it('switching to Approved refetches page 1 and shows who decided and when', async () => {
    renderPage()
    await screen.findByTestId('access-request-row-ar-1')
    listAccessRequests.mockResolvedValue(
      page([
        {
          ...ada,
          status: 'approved',
          decidedAt: '2026-11-05T10:00:00.000Z',
          decidedBy: { id: 'u1', name: 'Boss', email: 'boss@welld.ch' },
        },
        { ...grace, status: 'rejected', decidedAt: '2026-11-05T10:00:00.000Z', decidedBy: null },
      ]),
    )
    fireEvent.change(screen.getByTestId('access-requests-status-filter'), { target: { value: 'approved' } })
    await waitFor(() =>
      expect(listAccessRequests).toHaveBeenLastCalledWith({ status: 'approved', page: 1, pageSize: 20 }),
    )
    const row = await screen.findByTestId('access-request-row-ar-1')
    expect(within(row).getByText('Boss')).not.toBeNull()
    expect(within(row).getByText('Approved')).not.toBeNull()
    expect(within(screen.getByTestId('access-request-row-ar-2')).getByText('—')).not.toBeNull()
    expect(screen.queryByTestId('access-request-approve-ar-1')).toBeNull()
  })
})

describe('approve (F2)', () => {
  it('opens the dialog with roles and departments, none selected, posts the selection, closes, reloads, announces sent (AC-3.2, 3.3)', async () => {
    approveAccessRequest.mockResolvedValue({ request: { ...ada, status: 'approved' }, invitation: invitation('sent') })
    renderPage()
    await openApprove()
    expect(screen.getByRole('dialog')).not.toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'accounting' }))
    fireEvent.click(screen.getByTestId('approve-access-request-submit'))
    await waitFor(() =>
      expect(approveAccessRequest).toHaveBeenCalledWith('ar-1', { roleIds: ['r1'], departmentIds: [] }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((await screen.findByTestId('access-requests-announcement')).textContent).toBe(
      'Approved. Invitation sent to ada@welld.ch.',
    )
    expect(listAccessRequests).toHaveBeenCalledTimes(2)
  })

  it('approves with zero selections (AC-3.2)', async () => {
    approveAccessRequest.mockResolvedValue({ request: { ...ada, status: 'approved' }, invitation: invitation('sent') })
    renderPage()
    await openApprove()
    fireEvent.click(screen.getByTestId('approve-access-request-submit'))
    await waitFor(() => expect(approveAccessRequest).toHaveBeenCalledWith('ar-1', { roleIds: [], departmentIds: [] }))
  })

  it('email failed: a persistent warning with an Open Invitations link (AC-3.7)', async () => {
    approveAccessRequest.mockResolvedValue({
      request: { ...ada, status: 'approved' },
      invitation: invitation('failed'),
    })
    renderPage()
    await openApprove()
    fireEvent.click(screen.getByTestId('approve-access-request-submit'))
    const msg = await screen.findByTestId('access-requests-announcement')
    expect(msg.textContent).toBe('Approved, but the invitation email could not be sent to ada@welld.ch.')
    const banner = screen.getByTestId('access-requests-announcement-banner')
    expect(banner.getAttribute('role')).toBe('alert')
    const link = within(banner).getByRole('link', { name: 'Open Invitations' })
    fireEvent.click(link)
    expect(await screen.findByText('invitations screen')).not.toBeNull()
  })

  it('409 active_user_exists: inline, dialog stays open, nothing reloaded (AC-3.5)', async () => {
    approveAccessRequest.mockRejectedValue(
      new ApiError({ status: 409, title: 'C', code: 'active_user_exists' } as never),
    )
    renderPage()
    await openApprove()
    fireEvent.click(screen.getByTestId('approve-access-request-submit'))
    expect((await screen.findByRole('alert')).textContent).toContain('ada@welld.ch already has an Operai account.')
    expect(screen.getByRole('dialog')).not.toBeNull()
    expect(listAccessRequests).toHaveBeenCalledTimes(1)
  })

  it('409 pending_invitation_exists: inline (AC-3.5)', async () => {
    approveAccessRequest.mockRejectedValue(
      new ApiError({ status: 409, title: 'C', code: 'pending_invitation_exists' } as never),
    )
    renderPage()
    await openApprove()
    fireEvent.click(screen.getByTestId('approve-access-request-submit'))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'An invitation is already pending for ada@welld.ch.',
    )
  })

  it('409 already_decided: closes, reloads, warns, focus lands on the results region (F4, AC-3.6)', async () => {
    approveAccessRequest.mockRejectedValue(new ApiError({ status: 409, title: 'C', code: 'already_decided' } as never))
    renderPage()
    await openApprove()
    fireEvent.click(screen.getByTestId('approve-access-request-submit'))
    expect((await screen.findByTestId('access-requests-announcement')).textContent).toBe(
      'Someone else already decided this request. The earlier decision stands.',
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(listAccessRequests).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('access-requests-results')))
  })

  it('404: closes, reloads, warns that the request no longer exists', async () => {
    approveAccessRequest.mockRejectedValue(new ApiError({ status: 404, title: 'NF' } as never))
    renderPage()
    await openApprove()
    fireEvent.click(screen.getByTestId('approve-access-request-submit'))
    expect((await screen.findByTestId('access-requests-announcement')).textContent).toBe(
      'This request no longer exists.',
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('403: PermissionDenied replaces the page content', async () => {
    approveAccessRequest.mockRejectedValue(new ApiError({ status: 403, title: 'F' } as never))
    renderPage()
    await openApprove()
    fireEvent.click(screen.getByTestId('approve-access-request-submit'))
    expect(await screen.findByTestId('permission-denied')).not.toBeNull()
  })

  it('network failure: generic inline message, dialog stays open', async () => {
    approveAccessRequest.mockRejectedValue(new Error('net'))
    renderPage()
    await openApprove()
    fireEvent.click(screen.getByTestId('approve-access-request-submit'))
    expect((await screen.findByRole('alert')).textContent).toContain('Could not approve this request. Try again.')
    expect(screen.getByRole('dialog')).not.toBeNull()
  })

  it('Cancel closes without a call and returns focus to the row trigger', async () => {
    renderPage()
    // A real click focuses the button first; fireEvent does not.
    const trigger = await screen.findByTestId('access-request-approve-ar-1')
    await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(false))
    trigger.focus()
    await openApprove()
    fireEvent.click(screen.getByTestId('approve-access-request-cancel'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(approveAccessRequest).not.toHaveBeenCalled()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('access-request-approve-ar-1')))
  })

  it('catalog failure: banner, Approve disabled, Reject still works, list renders', async () => {
    vi.mocked(adminApi.listRoles).mockRejectedValue(new Error('x'))
    renderPage()
    expect((await screen.findByTestId('error-banner')).textContent).toContain('Could not load roles and departments.')
    expect(screen.getByTestId('access-request-approve-ar-1').hasAttribute('disabled')).toBe(true)
    expect(screen.getByTestId('access-request-reject-ar-1').hasAttribute('disabled')).toBe(false)
  })
})

describe('reject (F3)', () => {
  const openReject = async (id = 'ar-1') => fireEvent.click(await screen.findByTestId(`access-request-reject-${id}`))

  it('confirms in a danger dialog saying nothing is sent, then rejects, reloads and announces (AC-3.4)', async () => {
    rejectAccessRequest.mockResolvedValue({ ...ada, status: 'rejected' })
    renderPage()
    await openReject()
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/Nothing is sent to them/)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Reject request' }))
    await waitFor(() => expect(rejectAccessRequest).toHaveBeenCalledWith('ar-1'))
    expect((await screen.findByTestId('access-requests-announcement')).textContent).toBe(
      'Request from ada@welld.ch rejected.',
    )
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(listAccessRequests).toHaveBeenCalledTimes(2)
  })

  it('409 already_decided: closes and warns (F4, AC-3.6)', async () => {
    rejectAccessRequest.mockRejectedValue(new ApiError({ status: 409, title: 'C', code: 'already_decided' } as never))
    renderPage()
    await openReject()
    fireEvent.click(screen.getByRole('button', { name: 'Reject request' }))
    expect((await screen.findByTestId('access-requests-announcement')).textContent).toBe(
      'Someone else already decided this request. The earlier decision stands.',
    )
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('other failure: inline in the dialog, stays open', async () => {
    rejectAccessRequest.mockRejectedValue(new Error('net'))
    renderPage()
    await openReject()
    fireEvent.click(screen.getByRole('button', { name: 'Reject request' }))
    expect(await screen.findByText('Could not reject this request. Try again.')).not.toBeNull()
    expect(screen.getByRole('alertdialog')).not.toBeNull()
  })

  it('Cancel makes no call', async () => {
    renderPage()
    await openReject()
    fireEvent.click(screen.getByTestId('access-request-reject-dialog-cancel'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(rejectAccessRequest).not.toHaveBeenCalled()
  })
})
