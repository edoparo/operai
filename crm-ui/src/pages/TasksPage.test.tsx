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

const ADA_REF = { id: 'u-ada', name: 'Ada Lovelace', status: 'active' as const }
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
    participants: [{ id: 'u-paro', name: 'Paolo Paro', status: 'active' }],
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
    expect(row.textContent).toContain('With Paolo Paro')
    expect(within(row).getByTestId('crm-activity-t2-waiting').textContent).toContain(
      'Waiting on: Estimate: Grid analytics',
    )
    // aria-disabled, not disabled: the button stays in the tab order and its hint is read (design-system rule 5).
    const done = within(row).getByTestId('crm-activity-t2-toggle')
    expect(done.getAttribute('aria-disabled')).toBe('true')
    expect((done as HTMLButtonElement).disabled).toBe(false)
    const hint = within(row).getByTestId('crm-activity-t2-waiting')
    expect(done.getAttribute('aria-describedby')).toBe(hint.id)
    // The click is ignored: no complete call.
    fireEvent.click(done)
    expect(apiFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false)
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

describe('TasksPage — participants (specs/017 US-8)', () => {
  it('adds colleagues as participants, removes one, and posts the rest as participantIds', async () => {
    let posted: Record<string, unknown> | null = null
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': () => ({ status: 200, body: page([]) }),
        'GET /tasks/assignees': () => ({ status: 200, body: { items: [] } }),
        'GET /companies': () => ({ status: 200, body: page([companySummary()]) }),
        'GET /contacts': () => ({ status: 200, body: page([]) }),
        'GET /deals': () => ({ status: 200, body: page([]) }),
        'GET /activities': () => ({ status: 200, body: page([]) }),
        'GET /authz/users/directory': () => ({
          status: 200,
          body: {
            users: [
              { id: 'u-paro', name: 'Paolo Paro', email: 'paro@welld.ch', entity: 'welld_ch' },
              { id: 'u-tess', name: 'Tess Technical', email: 'tess@welld.ch', entity: 'welld_ch' },
            ],
          },
        }),
        'POST /activities': (_url, init) => {
          posted = JSON.parse(String(init?.body)) as Record<string, unknown>
          return { status: 201, body: { id: 'a1', ...posted } }
        },
      }),
    )
    window.history.pushState(null, '', '/tasks')
    render(<RouterProvider router={createAppRouter()} />)
    fireEvent.click(await screen.findByTestId('crm-tasks-new'))
    const dialog = await screen.findByRole('dialog', { name: 'New task' })
    fireEvent.change(within(dialog).getByLabelText('Subject', { exact: false }), {
      target: { value: 'Visit the client' },
    })
    fireEvent.change(within(dialog).getByTestId('crm-activity-form-company-input'), { target: { value: 'Acme' } })
    fireEvent.click(await within(dialog).findByRole('option', { name: /Acme SA/ }))

    const picker = within(dialog).getByTestId('crm-activity-form-participants-picker-input')
    for (const name of [/Paolo Paro/, /Tess Technical/]) {
      fireEvent.focus(picker)
      fireEvent.change(picker, { target: { value: name.source.split(' ')[0] } })
      fireEvent.click(await within(dialog).findByRole('option', { name }))
    }
    // a chosen person is not offered again, and the field is empty for the next one
    expect((picker as HTMLInputElement).value).toBe('')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Tess Technical' }))
    expect(within(dialog).queryByRole('button', { name: 'Remove Tess Technical' })).toBeNull()

    fireEvent.click(within(dialog).getByTestId('crm-activity-form-submit'))
    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted).toMatchObject({ type: 'task', subject: 'Visit the client', participantIds: ['u-paro'] })
  })
})

describe('TasksPage — editing contact and deal (specs/017 AC-4.2)', () => {
  it('editing an activity shows its contact and deal, and sends the change', async () => {
    let patched: Record<string, unknown> | null = null
    const TASK = {
      id: 't5',
      type: 'task',
      subject: 'Follow up',
      body: null,
      occurredAt: '2026-11-04T09:00:00.000Z',
      company: { id: 'c1', name: 'Acme SA' },
      contact: { id: 'p1', name: 'Mirko Bianchi' },
      deal: null,
      author: { id: 'u-ada', name: 'Ada Lovelace', status: 'active' },
      participants: [],
      task: { dueDate: null, assignee: null, completedAt: null, completedBy: null, blockedBy: [], blocked: false },
      createdAt: '2026-11-04T09:00:00.000Z',
      updatedAt: '2026-11-04T09:00:00.000Z',
    }
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': () => ({ status: 200, body: page([TASK]) }),
        'GET /tasks/assignees': () => ({ status: 200, body: { items: [] } }),
        'GET /contacts': () => ({
          status: 200,
          body: page([
            {
              id: 'p1',
              firstName: 'Mirko',
              lastName: 'Bianchi',
              email: null,
              phone: null,
              jobTitle: null,
              company: { id: 'c1', name: 'Acme SA' },
              archived: false,
              updatedAt: '2026-11-01T00:00:00.000Z',
            },
          ]),
        }),
        'GET /deals': () => ({
          status: 200,
          body: page([
            {
              id: 'd7',
              title: 'Data platform',
              company: { id: 'c1', name: 'Acme SA' },
              stage: 'lead',
              entity: 'welld_ch',
              expectedCloseDate: null,
              owner: ADA_REF,
              closedAt: null,
              updatedAt: '2026-11-01T00:00:00.000Z',
              version: 1,
            },
          ]),
        }),
        'GET /activities': () => ({ status: 200, body: page([]) }),
        'PATCH /activities/t5': (_url, init) => {
          patched = JSON.parse(String(init?.body)) as Record<string, unknown>
          return { status: 200, body: { ...TASK, deal: { id: 'd7', title: 'Data platform' } } }
        },
      }),
    )
    window.history.pushState(null, '', '/tasks')
    render(<RouterProvider router={createAppRouter()} />)
    const row = await screen.findByTestId('crm-activity-t5')
    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit activity' })
    const contact = within(dialog).getByLabelText('Contact') as HTMLSelectElement
    await waitFor(() => expect(contact.value).toBe('p1'))
    const deal = within(dialog).getByLabelText('Deal') as HTMLSelectElement
    await within(dialog).findByRole('option', { name: 'Data platform' })
    fireEvent.change(deal, { target: { value: 'd7' } })
    fireEvent.click(within(dialog).getByTestId('crm-activity-form-submit'))
    await waitFor(() => expect(patched).not.toBeNull())
    expect(patched).toMatchObject({ contactId: 'p1', dealId: 'd7' })
  })
})
