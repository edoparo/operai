/**
 * @vitest-environment jsdom
 *
 * TasksPage (AC-4.4): "New task" creates a task without leaving "Tasks" —
 * the company is picked in the dialog, the type is fixed to task, and the
 * assignee left empty defaults to the caller on the server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from '../router'
import { companySummary, fakeApi, page } from '../test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
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

describe('TasksPage — Assigned to', () => {
  it('shows mine by default, then everyone, then one colleague (not me) from the assignees', async () => {
    const assignees: string[] = []
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': (url) => {
          assignees.push(url.searchParams.get('assignee') ?? '')
          return { status: 200, body: page([]) }
        },
        'GET /tasks/assignees': () => ({
          status: 200,
          body: {
            items: [
              { id: 'u-ada', name: 'Ada Lovelace', status: 'active' },
              { id: 'u-bob', name: 'Bob Marley', status: 'active' },
            ],
          },
        }),
      }),
    )
    window.history.pushState(null, '', '/tasks')
    render(<RouterProvider router={createAppRouter()} />)
    await screen.findByRole('heading', { level: 2, name: 'Tasks' })
    const filter = screen.getByLabelText('Assigned to')
    await screen.findByRole('option', { name: 'Bob Marley' })
    expect(screen.queryByRole('option', { name: 'Ada Lovelace' })).toBeNull()

    fireEvent.change(filter, { target: { value: 'any' } })
    fireEvent.change(filter, { target: { value: 'u-bob' } })
    await waitFor(() => expect(assignees).toEqual(['me', 'any', 'u-bob']))
    expect(await screen.findByText('No open tasks for this filter.')).not.toBeNull()
  })
})

describe('TasksPage — New task', () => {
  it('asks for a company, fixes the type to task, and reloads the open tasks', async () => {
    let posted: Record<string, unknown> | null = null
    let taskLoads = 0
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': () => {
          taskLoads += 1
          return { status: 200, body: page([]) }
        },
        'GET /tasks/assignees': () => ({ status: 200, body: { items: [] } }),
        'GET /companies': () => ({ status: 200, body: page([companySummary()]) }),
        'GET /contacts': () => ({ status: 200, body: page([]) }),
        'GET /deals': () => ({ status: 200, body: page([]) }),
        'POST /activities': (_url, init) => {
          posted = JSON.parse(String(init?.body)) as Record<string, unknown>
          return { status: 201, body: { id: 'a1', ...posted } }
        },
      }),
    )
    window.history.pushState(null, '', '/tasks')
    render(<RouterProvider router={createAppRouter()} />)
    await screen.findByRole('heading', { level: 2, name: 'Tasks' })

    fireEvent.click(screen.getByTestId('crm-tasks-new'))
    const dialog = await screen.findByRole('dialog', { name: 'New task' })
    expect(within(dialog).queryByLabelText('Type')).toBeNull()

    // Submitting without a company names the missing field and sends nothing.
    fireEvent.change(within(dialog).getByLabelText('Subject', { exact: false }), {
      target: { value: 'Send the offer' },
    })
    fireEvent.click(within(dialog).getByTestId('crm-activity-form-submit'))
    expect(await within(dialog).findByText('This field is required.')).not.toBeNull()
    expect(posted).toBeNull()

    fireEvent.change(within(dialog).getByTestId('crm-activity-form-company-input'), { target: { value: 'Acme' } })
    fireEvent.click(await within(dialog).findByRole('option', { name: /Acme SA/ }))
    fireEvent.click(within(dialog).getByTestId('crm-activity-form-submit'))

    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted).toMatchObject({ type: 'task', companyId: 'c1', subject: 'Send the offer', dueDate: null })
    expect(posted).not.toHaveProperty('assigneeUserId')
    expect(await screen.findByText('Task created.')).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(taskLoads).toBeGreaterThan(1)
  })
})

describe('TasksPage — blocked by (specs/017 US-6)', () => {
  const blockedTask = {
    id: 't2',
    type: 'task',
    subject: 'Organise the call with Avanzato',
    body: null,
    occurredAt: '2026-11-04T09:00:00.000Z',
    company: { id: 'c1', name: 'Acme SA' },
    contact: null,
    deal: null,
    author: { id: 'u-ada', name: 'Ada Lovelace', status: 'active' },
    task: {
      dueDate: null,
      assignee: { id: 'u-ada', name: 'Ada Lovelace', status: 'active' },
      completedAt: null,
      completedBy: null,
      blockedBy: [{ id: 't1', subject: 'Estimate: Grid analytics', completed: false }],
      blocked: true,
    },
    createdAt: '2026-11-04T09:00:00.000Z',
    updatedAt: '2026-11-04T09:00:00.000Z',
  }

  it('shows Blocked and what it waits on, with Mark done disabled', async () => {
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': () => ({ status: 200, body: page([blockedTask]) }),
        'GET /tasks/assignees': () => ({ status: 200, body: { items: [] } }),
      }),
    )
    window.history.pushState(null, '', '/tasks')
    render(<RouterProvider router={createAppRouter()} />)
    const row = await screen.findByTestId('crm-activity-t2')
    expect(row.textContent).toContain('Blocked')
    expect(within(row).getByTestId('crm-activity-t2-waiting').textContent).toContain('Waiting on: Estimate: Grid analytics')
    const done = within(row).getByTestId('crm-activity-t2-toggle')
    expect((done as HTMLButtonElement).disabled).toBe(true)
    expect(done.getAttribute('aria-describedby')).toBe('crm-activity-t2-blocked-hint')
  })

  it('a new task can wait on the company’s open tasks; the choice is posted as blockedByIds', async () => {
    let posted: Record<string, unknown> | null = null
    let openQuery: string | null = null
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': () => ({ status: 200, body: page([]) }),
        'GET /tasks/assignees': () => ({ status: 200, body: { items: [] } }),
        'GET /companies': () => ({ status: 200, body: page([companySummary()]) }),
        'GET /contacts': () => ({ status: 200, body: page([]) }),
        'GET /deals': () => ({ status: 200, body: page([]) }),
        'GET /activities': (url) => {
          openQuery = url.search
          return { status: 200, body: page([{ ...blockedTask, id: 't1', subject: 'Estimate: Grid analytics' }]) }
        },
        'POST /activities': (_url, init) => {
          posted = JSON.parse(String(init?.body)) as Record<string, unknown>
          return { status: 201, body: { ...blockedTask, id: 't3' } }
        },
      }),
    )
    window.history.pushState(null, '', '/tasks')
    render(<RouterProvider router={createAppRouter()} />)
    fireEvent.click(await screen.findByTestId('crm-tasks-new'))
    const dialog = await screen.findByRole('dialog', { name: 'New task' })
    fireEvent.change(within(dialog).getByLabelText('Subject', { exact: false }), { target: { value: 'Call Avanzato' } })
    fireEvent.change(within(dialog).getByTestId('crm-activity-form-company-input'), { target: { value: 'Acme' } })
    fireEvent.click(await within(dialog).findByRole('option', { name: /Acme SA/ }))
    fireEvent.click(await within(dialog).findByTestId('crm-activity-form-blocker-t1'))
    expect(openQuery).toContain('type=task')
    expect(openQuery).toContain('open=true')
    fireEvent.click(within(dialog).getByTestId('crm-activity-form-submit'))
    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted).toMatchObject({ type: 'task', companyId: 'c1', blockedByIds: ['t1'] })
  })
})

