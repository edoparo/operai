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
