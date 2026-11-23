/**
 * @vitest-environment jsdom
 *
 * TasksPage — a task in progress (specs/20261110-activities US-10): Start on an open task, Stop on
 * one in progress, the "In progress" filter, and a view from an older server without `status`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from '../router'
import { fakeApi, page } from '../test-support/fakeApi'

const ADA = { id: 'u-ada', name: 'Ada Lovelace', status: 'active' as const }
const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

const task = (id: string, taskPart: Record<string, unknown>) => ({
  id,
  type: 'task',
  subject: `Task ${id}`,
  body: null,
  occurredAt: '2026-11-04T09:00:00.000Z',
  company: { id: 'c1', name: 'Acme SA' },
  contact: null,
  deal: null,
  author: ADA,
  task: { dueDate: null, assignee: ADA, completedAt: null, completedBy: null, ...taskPart },
  createdAt: '2026-11-04T09:00:00.000Z',
  updatedAt: '2026-11-04T09:00:00.000Z',
})

const posts = () =>
  apiFetch.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    .map(([url]) => String(url))

const open = async (items: unknown[], extra: Record<string, () => { status: number; body: unknown }> = {}) => {
  apiFetch.mockImplementation(
    fakeApi({
      'GET /tasks': () => ({ status: 200, body: page(items) }),
      'GET /tasks/assignees': () => ({ status: 200, body: { items: [] } }),
      ...extra,
    }),
  )
  window.history.pushState(null, '', '/tasks')
  render(<RouterProvider router={createAppRouter()} />)
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

describe('TasksPage — in progress', () => {
  it('shows Start on an open task and calls start', async () => {
    await open([task('t1', { status: 'open' })], {
      'POST /activities/t1/start': () => ({
        status: 200,
        body: task('t1', { status: 'in_progress', startedAt: '2026-11-23T08:00:00.000Z', startedBy: ADA }),
      }),
    })
    const row = await screen.findByTestId('crm-activity-t1')
    await userEvent.click(within(row).getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(posts().some((url) => url.endsWith('/activities/t1/start'))).toBe(true))
  })

  it('shows In progress with who and since when, and Stop calls stop', async () => {
    await open([task('t2', { status: 'in_progress', startedAt: '2026-11-23T08:00:00.000Z', startedBy: ADA })], {
      'POST /activities/t2/stop': () => ({ status: 200, body: task('t2', { status: 'open' }) }),
    })
    const row = await screen.findByTestId('crm-activity-t2')
    expect(within(row).getByText('In progress')).toBeTruthy()
    expect(row.textContent).toContain('In progress since 23.11.2026')
    expect(within(row).queryByRole('button', { name: 'Start' })).toBeNull()
    await userEvent.click(within(row).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(posts().some((url) => url.endsWith('/activities/t2/stop'))).toBe(true))
  })

  it('a blocked task’s Start is aria-disabled and calls nothing', async () => {
    await open([
      task('t3', { status: 'open', blocked: true, blockedBy: [{ id: 't1', subject: 'Estimate', completed: false }] }),
    ])
    const row = await screen.findByTestId('crm-activity-t3')
    const start = within(row).getByRole('button', { name: 'Start' })
    expect(start.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(start)
    expect(posts()).toEqual([])
  })

  it('the In progress filter asks for status=in_progress', async () => {
    await open([])
    await screen.findByTestId('crm-tasks-tabs')
    await userEvent.click(screen.getByRole('tab', { name: 'In progress' }))
    await waitFor(() =>
      expect(
        apiFetch.mock.calls.some(
          ([url]) => String(url).includes('/tasks?') && String(url).includes('status=in_progress'),
        ),
      ).toBe(true),
    )
  })

  it('an older server’s task without status still renders, open and done', async () => {
    await open([task('t4', {}), task('t5', { completedAt: '2026-11-20T08:00:00.000Z', completedBy: ADA })])
    const open4 = await screen.findByTestId('crm-activity-t4')
    expect(within(open4).getByRole('button', { name: 'Start' })).toBeTruthy()
    expect(within(open4).getByText('Open')).toBeTruthy()
    const done5 = screen.getByTestId('crm-activity-t5')
    expect(within(done5).getByText('Done')).toBeTruthy()
    expect(within(done5).queryByRole('button', { name: 'Start' })).toBeNull()
    expect(within(done5).getByRole('button', { name: 'Reopen' })).toBeTruthy()
  })
})
