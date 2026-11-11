/**
 * @vitest-environment jsdom
 *
 * TasksCard (specs/028 AC-3.2 – AC-3.4, AC-3.8, AC-4.2, AC-5.2): the project's
 * tasks as the server orders them, Open / Done, overdue and blocked rows, the
 * buttons each row shows (only where the server's `may` flags say so, never on
 * a closed project's Add), complete / reopen / delete with their refusals, and
 * the card-local load failures. Rendered against a fake activities-api.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { fakeApi, personRef, problem, projectDetail, projectTask } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'
import type { Project } from '../lib/types'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada', name: 'Ada Lovelace' } } }),
}))

import TasksCard from './TasksCard'

const page = (items: unknown[], total = items.length) => ({ items, total, page: 1, pageSize: 25 })

const renderCard = (
  routes: Record<string, FakeHandler>,
  { project = projectDetail(), canManage = true }: { project?: Project; canManage?: boolean } = {},
) => {
  apiFetch.mockImplementation(fakeApi(routes))
  render(<TasksCard project={project} canManage={canManage} currentUserId="u-ada" />)
}

const calls = (method: string) =>
  apiFetch.mock.calls
    .filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === method)
    .map(([input]) => new URL(String(input)))

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

describe('the list', () => {
  it('asks for the open tasks of this project, 25 a page, and renders them in the order the server sent', async () => {
    renderCard({
      'GET /tasks': () => ({ status: 200, body: page([projectTask('t1'), projectTask('t2'), projectTask('t3')]) }),
    })

    const rows = await screen.findAllByTestId(/^project-task-t\d$/)
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'project-task-t1',
      'project-task-t2',
      'project-task-t3',
    ])
    const [url] = calls('GET')
    expect(url?.origin).toBe('http://activities-api.test')
    expect(Object.fromEntries(url!.searchParams)).toEqual({
      projectId: 'p1',
      status: 'open',
      page: '1',
      pageSize: '25',
    })
  })

  it('shows due date, assignee and participants on the row (AC-5.2), and "No due date" when there is none', async () => {
    renderCard({
      'GET /tasks': () => ({
        status: 200,
        body: page([
          projectTask('t1', { participants: [personRef('u-bob', 'Bob Builder'), personRef('u-cara', 'Cara Coder')] }),
          projectTask('t2', {}, { dueDate: null, assignee: personRef('u-bob', 'Bob Builder') }),
        ]),
      }),
    })

    const first = await screen.findByTestId('project-task-t1')
    expect(within(first).getByText(/Due 20\.11\.2026/)).toHaveProperty(
      'textContent',
      expect.stringContaining('Assigned to Ada Lovelace (You)'),
    )
    expect(within(first).getByText('With Bob Builder, Cara Coder')).toBeTruthy()
    expect(within(screen.getByTestId('project-task-t2')).getByText(/No due date/)).toBeTruthy()
  })

  it('Done swaps the list for the done tasks, with who finished them', async () => {
    renderCard({
      'GET /tasks': (url) =>
        url.searchParams.get('status') === 'done'
          ? {
              status: 200,
              body: page([
                projectTask(
                  'd1',
                  {},
                  { completedAt: '2026-11-05T10:00:00.000Z', completedBy: personRef('u-bob', 'Bob Builder') },
                ),
              ]),
            }
          : { status: 200, body: page([projectTask('t1')]) },
    })
    await screen.findByTestId('project-task-t1')

    fireEvent.click(screen.getByRole('tab', { name: 'Done' }))

    const row = await screen.findByTestId('project-task-d1')
    expect(within(row).getByText('Done', { selector: '.badge, .badge *' })).toBeTruthy()
    expect(row.textContent).toContain('Done by Bob Builder on 05.11.2026')
    expect(screen.queryByTestId('project-task-t1')).toBeNull()
    expect(calls('GET').at(-1)?.searchParams.get('status')).toBe('done')
  })

  it('marks an overdue open task, and a blocked one with what it waits on', async () => {
    renderCard({
      'GET /tasks': () => ({
        status: 200,
        body: page([
          projectTask('late', {}, { dueDate: '2020-01-01' }),
          projectTask(
            'wait',
            {},
            {
              blocked: true,
              blockedBy: [
                { id: 'a', subject: 'Draft the spec', completed: false },
                { id: 'b', subject: 'Already finished', completed: true },
              ],
            },
          ),
        ]),
      }),
    })

    const late = await screen.findByTestId('project-task-late')
    expect(within(late).getByText('Overdue')).toBeTruthy()
    const waiting = screen.getByTestId('project-task-wait')
    expect(within(waiting).getByText('Blocked')).toBeTruthy()
    expect(waiting.textContent).toContain('Waiting on Draft the spec. Finish those first.')
    expect(waiting.textContent).not.toContain('Already finished')
  })

  it('a blocked task’s Mark done is reachable but does nothing, and is described by the waiting line (AC-4.2)', async () => {
    renderCard({
      'GET /tasks': () => ({
        status: 200,
        body: page([
          projectTask('wait', {}, { blocked: true, blockedBy: [{ id: 'a', subject: 'Draft', completed: false }] }),
        ]),
      }),
      'POST /activities/wait/complete': () => ({ status: 200, body: projectTask('wait') }),
    })

    const button = await screen.findByRole('button', { name: 'Mark done' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toContain('Waiting on Draft')
    fireEvent.click(button)
    expect(calls('POST')).toHaveLength(0)
  })

  it('an empty Open list says so, and points a manager at Add task; Done has its own empty state', async () => {
    renderCard({ 'GET /tasks': () => ({ status: 200, body: page([]) }) })
    expect(await screen.findByText('No open tasks')).toBeTruthy()
    expect(screen.getByText(/Use Add task/)).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Done' }))
    expect(await screen.findByText('No tasks done yet')).toBeTruthy()
  })

  it('a reader’s empty Open list does not point at Add task', async () => {
    renderCard({ 'GET /tasks': () => ({ status: 200, body: page([]) }) }, { canManage: false })
    expect(await screen.findByText('No open tasks')).toBeTruthy()
    expect(screen.queryByText(/Use Add task/)).toBeNull()
  })

  it('pages when the total exceeds a page, asking the server for page 2', async () => {
    renderCard({
      'GET /tasks': (url) => ({
        status: 200,
        body: {
          items: [projectTask(`p${url.searchParams.get('page')}`)],
          total: 30,
          page: Number(url.searchParams.get('page')),
          pageSize: 25,
        },
      }),
    })
    await screen.findByTestId('project-task-p1')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    await screen.findByTestId('project-task-p2')
    expect(calls('GET').at(-1)?.searchParams.get('page')).toBe('2')
  })
})

describe('who sees which button', () => {
  it('shows Add task to a manager of an open project, and a dialog opens from it', async () => {
    renderCard({ 'GET /tasks': () => ({ status: 200, body: page([]) }) })
    const add = await screen.findByRole('button', { name: 'Add task' })
    expect(add.getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('shows no Add task to someone who cannot manage the entity', async () => {
    renderCard({ 'GET /tasks': () => ({ status: 200, body: page([projectTask('t1')]) }) }, { canManage: false })
    await screen.findByTestId('project-task-t1')
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull()
  })

  it.each(['closed', 'cancelled'] as const)(
    'shows no Add task on a %s project, and says why (AC-3.8); rows keep Mark done only where the server allows it',
    async (state) => {
      renderCard(
        {
          'GET /tasks': () => ({
            status: 200,
            body: page([projectTask('t1', { may: { edit: false, delete: false, complete: true } })]),
          }),
        },
        { project: projectDetail({ state }) },
      )

      const row = await screen.findByTestId('project-task-t1')
      expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull()
      expect(screen.getByText(/This project is closed or cancelled/)).toBeTruthy()
      expect(within(row).getByRole('button', { name: 'Mark done' })).toBeTruthy()
      expect(within(row).queryByRole('button', { name: 'Edit' })).toBeNull()
      expect(within(row).queryByRole('button', { name: 'Delete' })).toBeNull()
    },
  )

  it('an empty list on a closed project has no pointer at Add task', async () => {
    renderCard(
      { 'GET /tasks': () => ({ status: 200, body: page([]) }) },
      { project: projectDetail({ state: 'closed' }) },
    )
    expect(await screen.findByText('No open tasks')).toBeTruthy()
    expect(screen.queryByText(/Use Add task/)).toBeNull()
  })

  it('follows each row’s own `may` flags, never the caller’s scope or assignee', async () => {
    renderCard({
      'GET /tasks': () => ({
        status: 200,
        body: page([
          projectTask('all'),
          projectTask('none', { may: { edit: false, delete: false, complete: false } }),
          projectTask('editOnly', { may: { edit: true, delete: false, complete: false } }),
        ]),
      }),
    })
    await screen.findByTestId('project-task-all')

    const all = within(screen.getByTestId('project-task-all'))
    expect(all.getByRole('button', { name: 'Mark done' })).toBeTruthy()
    expect(all.getByRole('button', { name: 'Edit' }).getAttribute('aria-haspopup')).toBe('dialog')
    expect(all.getByRole('button', { name: 'Delete' }).getAttribute('aria-haspopup')).toBe('dialog')
    expect(within(screen.getByTestId('project-task-none')).queryAllByRole('button')).toHaveLength(0)
    const editOnly = within(screen.getByTestId('project-task-editOnly'))
    expect(editOnly.queryByRole('button', { name: 'Mark done' })).toBeNull()
    expect(editOnly.getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(editOnly.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('names each row’s action group after its task, so Edit and Delete are not ambiguous', async () => {
    renderCard({ 'GET /tasks': () => ({ status: 200, body: page([projectTask('t1', { subject: 'Send offer' })]) }) })
    expect(await screen.findByRole('group', { name: 'Actions for Send offer' })).toBeTruthy()
  })
})

describe('complete and reopen', () => {
  it('marks a task done, reloads the list, confirms politely and puts focus on the selected tab', async () => {
    let done = false
    renderCard({
      'GET /tasks': () => ({ status: 200, body: page(done ? [] : [projectTask('t1')]) }),
      'POST /activities/t1/complete': () => {
        done = true
        return { status: 200, body: projectTask('t1', {}, { completedAt: '2026-11-11T10:00:00.000Z' }) }
      },
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Mark done' }))

    expect(await screen.findByText('Task marked done.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('project-task-t1')).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Open' }))
  })

  it('reopens a done task through the reopen route', async () => {
    renderCard({
      'GET /tasks': (url) => ({
        status: 200,
        body: page(
          url.searchParams.get('status') === 'done'
            ? [
                projectTask(
                  'd1',
                  {},
                  { completedAt: '2026-11-05T10:00:00.000Z', completedBy: personRef('u-ada', 'Ada') },
                ),
              ]
            : [],
        ),
      }),
      'POST /activities/d1/reopen': () => ({ status: 200, body: projectTask('d1') }),
    })
    fireEvent.click(await screen.findByRole('tab', { name: 'Done' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Mark not done' }))

    expect(await screen.findByText('Task marked not done.')).toBeTruthy()
    expect(calls('POST').map((url) => url.pathname)).toEqual(['/activities/d1/reopen'])
  })

  it('409 task_blocked names the blockers on that row and reloads the list (a blocker reopened meanwhile)', async () => {
    let loads = 0
    renderCard({
      'GET /tasks': () => {
        loads += 1
        return { status: 200, body: page([projectTask('t1')]) }
      },
      'POST /activities/t1/complete': () =>
        problem(409, 'task_blocked', {
          blockers: [
            { id: 'a', subject: 'Draft the spec' },
            { id: 'b', subject: 'Review it' },
          ],
        }),
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Mark done' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Waiting on Draft the spec, Review it. Finish those first.')
    await waitFor(() => expect(loads).toBe(2))
    // The alert survives the reload: it is the row's, not the list's.
    await screen.findByTestId('project-task-t1')
    expect(within(screen.getByTestId('project-task-t1')).getByRole('alert').textContent).toContain('Draft the spec')
  })

  it('403 forbidden: "You can no longer change this task", and the list reloads with fresh flags', async () => {
    let loads = 0
    renderCard({
      'GET /tasks': () => {
        loads += 1
        return { status: 200, body: page([projectTask('t1')]) }
      },
      'POST /activities/t1/complete': () => problem(403, 'forbidden'),
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Mark done' }))

    expect((await screen.findByRole('alert')).textContent).toContain('You can no longer change this task.')
    await waitFor(() => expect(loads).toBe(2))
  })

  it('any other refusal shows the Problem detail on the row and keeps focus on the button', async () => {
    renderCard({
      'GET /tasks': () => ({ status: 200, body: page([projectTask('t1')]) }),
      'POST /activities/t1/complete': () => problem(500, undefined, {}, 'Boom'),
    })
    const button = await screen.findByRole('button', { name: 'Mark done' })
    button.focus()

    fireEvent.click(button)

    expect((await screen.findByRole('alert')).textContent).toBe('Boom')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mark done' }))
  })
})

describe('delete', () => {
  it('asks first, naming the task and saying it leaves other tasks’ blockers; then deletes and reloads', async () => {
    let gone = false
    renderCard({
      'GET /tasks': () => ({ status: 200, body: page(gone ? [] : [projectTask('t1', { subject: 'Send offer' })]) }),
      'DELETE /activities/t1': () => {
        gone = true
        return { status: 204 }
      },
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('Delete task “Send offer”?')
    expect(dialog.textContent).toContain('removed as a blocker of other tasks')
    expect(calls('DELETE')).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete task' }))

    expect(await screen.findByText('Task deleted.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('project-task-t1')).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('a refused delete stays in the dialog with the reason', async () => {
    renderCard({
      'GET /tasks': () => ({ status: 200, body: page([projectTask('t1')]) }),
      'DELETE /activities/t1': () => problem(403, 'forbidden'),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete task' }))

    await waitFor(() => expect(dialog.textContent).toContain('You are not allowed to change this project’s tasks.'))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })
})

describe('when the tasks cannot be loaded', () => {
  it('host_unavailable: its own words, a Retry, and nothing else on the card changes', async () => {
    let healthy = false
    renderCard({
      'GET /tasks': () =>
        healthy ? { status: 200, body: page([projectTask('t1')]) } : problem(503, 'host_unavailable'),
    })

    const banner = await screen.findByTestId('project-tasks-error')
    expect(banner.textContent).toContain('Tasks cannot be shown right now')
    expect(banner.textContent).toContain('could not confirm your access')
    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeTruthy()

    healthy = true
    fireEvent.click(within(banner).getByRole('button', { name: 'Retry' }))
    await screen.findByTestId('project-task-t1')
  })

  it('maintenance: the pause message', async () => {
    renderCard({ 'GET /tasks': () => problem(503, 'maintenance') })
    expect((await screen.findByTestId('project-tasks-error')).textContent).toContain('paused for a short maintenance')
  })

  it('403: a denied panel inside the card, no Retry', async () => {
    renderCard({ 'GET /tasks': () => problem(403, 'forbidden') })
    expect(await screen.findByText('You do not have access to this')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('any other failure shows the Problem detail', async () => {
    renderCard({ 'GET /tasks': () => problem(500, undefined, {}, 'Database is down') })
    expect((await screen.findByTestId('project-tasks-error')).textContent).toContain('Database is down')
  })
})
