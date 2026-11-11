/**
 * @vitest-environment jsdom
 *
 * TasksPage focus (specs/028 design.md "Focus after row actions", D6): when Mark done or Reopen
 * removes the row from the current view, focus moves to the selected tab — never to `body`. Delete does the same;
 * cancelling its confirm leaves the row and the dialog returns focus to the row's Delete button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from '../router'
import { fakeApi, page } from '../test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

beforeEach(() => {
  window.scrollTo = () => undefined
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const ADA = { id: 'u-ada', name: 'Ada Lovelace', status: 'active' as const }
const task = (completedAt: string | null) => ({
  id: 't1',
  type: 'task',
  subject: 'Send the offer',
  body: null,
  occurredAt: '2026-11-04T09:00:00.000Z',
  company: { id: 'c1', name: 'Acme SA' },
  contact: null,
  deal: null,
  author: ADA,
  participants: [],
  task: {
    dueDate: null,
    assignee: ADA,
    completedAt,
    completedBy: completedAt ? ADA : null,
    blockedBy: [],
    blocked: false,
  },
  createdAt: '2026-11-04T09:00:00.000Z',
  updatedAt: '2026-11-04T09:00:00.000Z',
})

describe('TasksPage — focus after a task leaves the list', () => {
  it.each([
    ['Mark done', 'Open', null, '2026-11-11T10:00:00.000Z', 'complete'],
    ['Reopen', 'Done', '2026-11-11T10:00:00.000Z', null, 'reopen'],
  ])('%s puts focus on the selected %s tab, not body', async (button, tab, before, after, action) => {
    let moved = false
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': () => ({ status: 200, body: page(moved ? [] : [task(before)]) }),
        'GET /tasks/assignees': () => ({ status: 200, body: { items: [] } }),
        [`POST /activities/t1/${action}`]: () => {
          moved = true
          return { status: 200, body: task(after) }
        },
      }),
    )
    window.history.pushState(null, '', '/tasks')
    render(<RouterProvider router={createAppRouter()} />)
    if (tab === 'Done') fireEvent.click(await screen.findByRole('tab', { name: 'Done' }))

    const row = await screen.findByTestId('crm-activity-t1')
    const toggle = row.querySelector<HTMLButtonElement>('[data-testid="crm-activity-t1-toggle"]')!
    expect(toggle.textContent).toContain(button)
    toggle.focus()
    fireEvent.click(toggle)

    await waitFor(() => expect(screen.queryByTestId('crm-activity-t1')).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: tab }))
  })

  it('Delete puts focus on the selected Open tab, not body, once the confirm is accepted', async () => {
    let deleted = false
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': () => ({ status: 200, body: page(deleted ? [] : [task(null)]) }),
        'GET /tasks/assignees': () => ({ status: 200, body: { items: [] } }),
        'DELETE /activities/t1': () => {
          deleted = true
          return { status: 204 }
        },
      }),
    )
    window.history.pushState(null, '', '/tasks')
    render(<RouterProvider router={createAppRouter()} />)

    const row = await screen.findByTestId('crm-activity-t1')
    const remove = within(row).getByRole('button', { name: 'Delete' })
    remove.focus()
    fireEvent.click(remove)
    fireEvent.click(await screen.findByTestId('crm-activity-delete-confirm'))

    await waitFor(() => expect(screen.queryByTestId('crm-activity-t1')).toBeNull())
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(document.getElementById('crm-tasks-tab-open'))
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Open' }))
  })

  it('cancelling the Delete confirm keeps the row and returns focus to its Delete button', async () => {
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': () => ({ status: 200, body: page([task(null)]) }),
        'GET /tasks/assignees': () => ({ status: 200, body: { items: [] } }),
      }),
    )
    window.history.pushState(null, '', '/tasks')
    render(<RouterProvider router={createAppRouter()} />)

    const row = await screen.findByTestId('crm-activity-t1')
    const remove = within(row).getByRole('button', { name: 'Delete' })
    remove.focus()
    fireEvent.click(remove)
    fireEvent.click(await screen.findByTestId('crm-activity-delete-cancel'))

    await waitFor(() => expect(screen.queryByTestId('crm-activity-delete-cancel')).toBeNull())
    expect(screen.getByTestId('crm-activity-t1')).toBeTruthy()
    expect(apiFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false)
    expect(document.activeElement).toBe(
      within(screen.getByTestId('crm-activity-t1')).getByRole('button', { name: 'Delete' }),
    )
  })
})
