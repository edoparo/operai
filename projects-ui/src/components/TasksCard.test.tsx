/**
 * @vitest-environment jsdom
 *
 * TasksCard (specs/20261110-activities AC-3.2 – AC-3.4, AC-3.8, AC-4.2, AC-5.2): the project's tasks as a board —
 * Open, In progress and Done lanes in the order the server sent, a compact card per task (title, due date, assignee,
 * a badge only for Blocked / Overdue, no buttons), and a drawer per task with everything else and the actions the
 * server's `may` flags allow (never Add on a closed project), complete / reopen / delete with their refusals, and
 * the card-local load failures. Rendered against a fake activities-api.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { fakeApi, personRef, problem, projectDetail, projectTask } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'
import { factValue, laneCards, openCard } from '../test-support/taskBoard'
import type { Project } from '../lib/types'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  usePermissions: () => ({ epoch: 0, apps: [], roles: [], departments: [], permissions: [] }),
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada', name: 'Ada Lovelace' } } }),
}))

import TasksCard from './TasksCard'

const page = (items: unknown[], total = items.length, pageNumber = 1) => ({
  items,
  total,
  page: pageNumber,
  pageSize: 100,
})
const done = (id: string, over: Record<string, unknown> = {}) =>
  projectTask(id, over, {
    status: 'done',
    completedAt: '2026-11-05T10:00:00.000Z',
    completedBy: personRef('u-bob', 'Bob Builder'),
  })

/** `GET /tasks` answering `open` and `done` separately, as activities-api does. */
const tasks =
  (open: unknown[], finished: unknown[] = []): FakeHandler =>
  (url) => ({ status: 200, body: page(url.searchParams.get('status') === 'done' ? finished : open) })

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

const lane = (id: 'open' | 'in_progress' | 'done') => laneCards('project-tasks', id, 'project-task')

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

describe('the board', () => {
  it('asks for the open tasks of this project and the done ones of the last 30 days, 100 a page, and keeps the server order', async () => {
    renderCard({ 'GET /tasks': tasks([projectTask('t1'), projectTask('t2'), projectTask('t3')], [done('d1')]) })

    await screen.findByTestId('project-task-t1')
    expect(lane('open')).toEqual(['project-task-t1', 'project-task-t2', 'project-task-t3'])
    expect(lane('done')).toEqual(['project-task-d1'])
    const [openRead, doneRead] = calls('GET')
    expect(openRead?.origin).toBe('http://activities-api.test')
    expect(Object.fromEntries(openRead!.searchParams)).toEqual({
      projectId: 'p1',
      status: 'open',
      page: '1',
      pageSize: '100',
    })
    const since = doneRead!.searchParams.get('completedSince')!
    expect(Object.fromEntries(doneRead!.searchParams)).toEqual({
      projectId: 'p1',
      status: 'done',
      page: '1',
      pageSize: '100',
      completedSince: since,
    })
    const days = (Date.now() - Date.parse(since)) / (24 * 60 * 60 * 1000)
    expect(Math.round(days)).toBe(30)
  })

  it('is one named region with three named lanes, and no tabs', async () => {
    renderCard({ 'GET /tasks': tasks([projectTask('t1')]) })
    await screen.findByTestId('project-task-t1')
    expect(screen.getByRole('region', { name: 'Project tasks' })).toBeTruthy()
    for (const name of ['Open tasks', 'Tasks in progress', 'Tasks done'])
      expect(screen.getByRole('region', { name })).toBeTruthy()
    expect(screen.queryByRole('tab')).toBeNull()
  })

  it('a card shows its title, due date and assignee (You), and no button', async () => {
    renderCard({
      'GET /tasks': tasks([
        projectTask('t1', { participants: [personRef('u-bob', 'Bob Builder')] }),
        projectTask('t2', {}, { dueDate: null, assignee: personRef('u-bob', 'Bob Builder') }),
      ]),
    })

    const first = await screen.findByTestId('project-task-t1')
    expect(first.textContent).toContain('Task t1')
    expect(first.textContent).toContain('Due 20.11.2026')
    expect(first.textContent).toContain('Assigned to Ada Lovelace (You)')
    // Participants are the drawer's.
    expect(first.textContent).not.toContain('Bob Builder')
    expect(first.getAttribute('aria-label')).toBe('Task t1, Overdue, Due 20.11.2026, Assigned to Ada Lovelace (You)')
    expect(within(first).queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByTestId('project-task-t2').textContent).toContain('No due date')
  })

  it('badges only a card that needs attention: Overdue, Blocked; never Open, In progress or Done', async () => {
    renderCard({
      'GET /tasks': tasks(
        [
          projectTask('late', {}, { dueDate: '2020-01-01' }),
          projectTask('wait', {}, { blocked: true, blockedBy: [{ id: 'a', subject: 'Draft', completed: false }] }),
          projectTask('fine', {}, { dueDate: '2099-01-01' }),
        ],
        [done('d1')],
      ),
    })
    expect(within(await screen.findByTestId('project-task-late')).getByText('Overdue')).toBeTruthy()
    expect(within(screen.getByTestId('project-task-wait')).getByText('Blocked')).toBeTruthy()
    expect(screen.getByTestId('project-task-fine').querySelector('.badge')).toBeNull()
    expect(screen.getByTestId('project-task-d1').querySelector('.badge')).toBeNull()
  })

  it('empty lanes say so, and the Open lane points a manager at Add task', async () => {
    renderCard({ 'GET /tasks': tasks([]) })
    expect(await screen.findByText(/No open tasks. Use Add task/)).toBeTruthy()
    expect(screen.getByText('No tasks in progress.')).toBeTruthy()
    expect(screen.getByText('No tasks done in the last 30 days.')).toBeTruthy()
  })

  it('a reader’s empty Open lane does not point at Add task', async () => {
    renderCard({ 'GET /tasks': tasks([]) }, { canManage: false })
    expect(await screen.findByText('No open tasks. Nothing is left to do on this project.')).toBeTruthy()
    expect(screen.queryByText(/Use Add task/)).toBeNull()
  })

  it('"Load more" appends the next page when the total exceeds what is loaded', async () => {
    renderCard({
      'GET /tasks': (url) =>
        url.searchParams.get('status') === 'done'
          ? { status: 200, body: page([]) }
          : {
              status: 200,
              body: page([projectTask(`p${url.searchParams.get('page')}`)], 130, Number(url.searchParams.get('page'))),
            },
    })
    await screen.findByTestId('project-task-p1')

    fireEvent.click(within(screen.getByTestId('project-tasks-open-more')).getByRole('button', { name: 'Load more' }))

    await screen.findByTestId('project-task-p2')
    expect(lane('open')).toEqual(['project-task-p1', 'project-task-p2'])
    expect(calls('GET').at(-1)?.searchParams.get('page')).toBe('2')
  })

  it('"Show older" reads every done task, without completedSince', async () => {
    renderCard({
      'GET /tasks': (url) =>
        url.searchParams.get('status') !== 'done'
          ? { status: 200, body: page([]) }
          : {
              status: 200,
              body: page(url.searchParams.has('completedSince') ? [done('d1')] : [done('d1'), done('d0')]),
            },
    })
    await screen.findByTestId('project-task-d1')
    expect(screen.getByText('Done in the last 30 days')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show older' }))

    await screen.findByTestId('project-task-d0')
    expect(calls('GET').at(-1)?.searchParams.has('completedSince')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
    expect(screen.queryByText('Done in the last 30 days')).toBeNull()
  })
})

describe('the drawer', () => {
  it('opens on a click with the whole task as labelled facts: due date, assignee, participants one per line', async () => {
    renderCard({
      'GET /tasks': tasks([
        projectTask('t1', { participants: [personRef('u-bob', 'Bob Builder'), personRef('u-cara', 'Cara Coder')] }),
      ]),
    })
    const drawer = await openCard('project-task', 't1')
    expect(screen.getByRole('dialog', { name: 'Task t1' })).toBeTruthy()
    const terms = Array.from(screen.getByTestId('task-drawer').querySelectorAll('dt')).map((term) => term.textContent)
    expect(terms).toEqual(['Due date', 'Assignee', 'With'])
    expect(factValue('project-task', 't1', 'due')).toBe('20.11.2026')
    expect(factValue('project-task', 't1', 'assignee')).toBe('Ada Lovelace (You)')
    const people = drawer.getByTestId('project-task-t1-fact-participants').nextElementSibling!
    expect(Array.from(people.querySelectorAll('li')).map((item) => item.textContent)).toEqual([
      'Bob Builder',
      'Cara Coder',
    ])
    // No description: no Description section.
    expect(drawer.queryByRole('heading', { name: 'Description' })).toBeNull()
  })

  it('puts the primary actions first: Start and Mark done (primary), full width, before the facts', async () => {
    renderCard({ 'GET /tasks': tasks([projectTask('t1')]) })
    const drawer = await openCard('project-task', 't1')
    const primary = drawer.getByRole('group', { name: 'Progress of Task t1' })
    expect(Array.from(primary.querySelectorAll('button')).map((button) => button.textContent)).toEqual([
      'Start',
      'Mark done',
    ])
    expect(drawer.getByRole('button', { name: 'Mark done' }).className).toContain('btn-primary')
    expect(drawer.getByRole('button', { name: 'Start' }).className).toContain('btn-secondary')
    const facts = screen.getByTestId('task-drawer').querySelector('dl')!
    expect(primary.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Delete is last in More, set apart, danger.
    const more = drawer.getByRole('group', { name: 'Actions for Task t1' })
    expect(more.lastElementChild?.textContent).toBe('Delete')
    expect(drawer.getByRole('button', { name: 'Delete' }).className).toContain('btn-danger')
    expect(drawer.getByRole('heading', { name: 'More' })).toBeTruthy()
  })

  it('opens on Enter too, and gives focus back to the card when closed', async () => {
    renderCard({ 'GET /tasks': tasks([projectTask('t1')]) })
    const card = await screen.findByTestId('project-task-t1')
    card.focus()
    fireEvent.keyDown(card, { key: 'Enter', code: 'Enter' })
    expect(await screen.findByTestId('task-drawer')).toBeTruthy()

    fireEvent.click(screen.getByTestId('task-drawer-close'))

    await waitFor(() => expect(screen.queryByTestId('task-drawer')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('project-task-t1')))
  })

  it('a done task says who finished it and when', async () => {
    renderCard({ 'GET /tasks': tasks([], [done('d1')]) })
    const drawer = await openCard('project-task', 'd1')
    expect(drawer.getByText('Done', { selector: '.badge, .badge *' })).toBeTruthy()
    expect(drawer.getByTestId('project-task-d1-fact-completed').textContent).toBe('Done')
    expect(factValue('project-task', 'd1', 'completed')).toBe('05.11.2026 · Bob Builder')
  })

  it('a blocked task names what it waits on, not what is already finished', async () => {
    renderCard({
      'GET /tasks': tasks([
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
    })
    const drawer = await openCard('project-task', 'wait')
    expect(drawer.getByTestId('project-task-wait-waiting').textContent).toBe(
      'Waiting on Draft the spec. Finish those first.',
    )
    expect(drawer.getByText('Blocked')).toBeTruthy()
  })

  it('a blocked task’s Mark done is reachable but does nothing, and is described by the waiting line (AC-4.2)', async () => {
    renderCard({
      'GET /tasks': tasks([
        projectTask('wait', {}, { blocked: true, blockedBy: [{ id: 'a', subject: 'Draft', completed: false }] }),
      ]),
      'POST /activities/wait/complete': () => ({ status: 200, body: projectTask('wait') }),
    })
    const drawer = await openCard('project-task', 'wait')
    const button = drawer.getByRole('button', { name: 'Mark done' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toContain('Waiting on Draft')
    fireEvent.click(button)
    expect(calls('POST')).toHaveLength(0)
  })
})

describe('who sees which action', () => {
  it('shows Add task to a manager of an open project, and a dialog opens from it', async () => {
    renderCard({ 'GET /tasks': tasks([]) })
    const add = await screen.findByRole('button', { name: 'Add task' })
    expect(add.getAttribute('aria-haspopup')).toBe('dialog')
  })

  it('shows no Add task to someone who cannot manage the entity', async () => {
    renderCard({ 'GET /tasks': tasks([projectTask('t1')]) }, { canManage: false })
    await screen.findByTestId('project-task-t1')
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull()
  })

  it.each(['closed', 'cancelled'] as const)(
    'shows no Add task on a %s project, and says why (AC-3.8); the drawer keeps Mark done only where the server allows it',
    async (state) => {
      renderCard(
        { 'GET /tasks': tasks([projectTask('t1', { may: { edit: false, delete: false, complete: true } })]) },
        { project: projectDetail({ state }) },
      )

      await screen.findByTestId('project-task-t1')
      expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull()
      expect(screen.getByText(/This project is closed or cancelled/)).toBeTruthy()
      const drawer = await openCard('project-task', 't1')
      expect(drawer.getByRole('button', { name: 'Mark done' })).toBeTruthy()
      expect(drawer.queryByRole('button', { name: 'Edit' })).toBeNull()
      expect(drawer.queryByRole('button', { name: 'Delete' })).toBeNull()
    },
  )

  it('an empty board on a closed project has no pointer at Add task', async () => {
    renderCard({ 'GET /tasks': tasks([]) }, { project: projectDetail({ state: 'closed' }) })
    expect(await screen.findByText(/^No open tasks/)).toBeTruthy()
    expect(screen.queryByText(/Use Add task/)).toBeNull()
  })

  it('follows each task’s own `may` flags, never the caller’s scope or assignee', async () => {
    const someoneElse = { author: personRef('u-o', 'O'), participants: [] }
    const theirs = { assignee: personRef('u-o', 'O') }
    renderCard({
      'GET /tasks': tasks([
        projectTask('all'),
        projectTask('none', { ...someoneElse, may: { edit: false, delete: false, complete: false } }, theirs),
        projectTask('editOnly', { ...someoneElse, may: { edit: true, delete: false, complete: false } }, theirs),
      ]),
    })

    let drawer = await openCard('project-task', 'all')
    expect(drawer.getByRole('button', { name: 'Mark done' })).toBeTruthy()
    expect(drawer.getByRole('button', { name: 'Edit' }).getAttribute('aria-haspopup')).toBe('dialog')
    expect(drawer.getByRole('button', { name: 'Delete' }).getAttribute('aria-haspopup')).toBe('dialog')
    fireEvent.click(drawer.getByTestId('task-drawer-close'))

    drawer = await openCard('project-task', 'none')
    expect(drawer.queryByRole('group', { name: 'Actions for Task none' })).toBeNull()
    expect(drawer.queryByRole('group', { name: 'Progress of Task none' })).toBeNull()
    expect(within(screen.getByTestId('project-task-none-details')).queryAllByRole('button')).toHaveLength(0)
    fireEvent.click(drawer.getByTestId('task-drawer-close'))

    drawer = await openCard('project-task', 'editOnly')
    expect(drawer.queryByRole('button', { name: 'Mark done' })).toBeNull()
    expect(drawer.getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(drawer.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('names the drawer’s action group after its task', async () => {
    renderCard({ 'GET /tasks': tasks([projectTask('t1', { subject: 'Send offer' })]) })
    await openCard('project-task', 't1')
    expect(screen.getByRole('group', { name: 'Actions for Send offer' })).toBeTruthy()
  })

  it('Edit opens the task’s form over the drawer; a save confirms in the drawer and reads the lists again', async () => {
    renderCard({
      'GET /tasks': tasks([projectTask('t1', { subject: 'Send offer' })]),
      'GET /authz/users/directory': () => ({ status: 200, body: { users: [] } }),
      'PATCH /activities/t1': () => ({ status: 200, body: projectTask('t1', { subject: 'Send the offer' }) }),
    })
    const drawer = await openCard('project-task', 't1')

    fireEvent.click(drawer.getByRole('button', { name: 'Edit' }))
    const form = await screen.findByRole('dialog', { name: 'Edit task' })
    expect(form.closest('[data-testid="task-drawer"]')).toBeNull()
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }))

    expect(await drawer.findByText('Task saved.')).toBeTruthy()
    await waitFor(() =>
      expect(
        calls('GET').filter((url) => url.pathname === '/tasks' && url.searchParams.get('status') === 'done').length,
      ).toBe(2),
    )
    expect(document.querySelectorAll('form form')).toHaveLength(0)
  })
})

describe('complete and reopen from the drawer', () => {
  it('marks a task done, confirms in the drawer, and reads the lists again: the card moves to Done', async () => {
    let finished = false
    renderCard({
      'GET /tasks': (url) =>
        url.searchParams.get('status') === 'done'
          ? { status: 200, body: page(finished ? [done('t1')] : []) }
          : { status: 200, body: page(finished ? [] : [projectTask('t1')]) },
      'POST /activities/t1/complete': () => {
        finished = true
        return { status: 200, body: done('t1') }
      },
    })
    const drawer = await openCard('project-task', 't1')

    fireEvent.click(drawer.getByRole('button', { name: 'Mark done' }))

    expect(await drawer.findByText('Task marked done.')).toBeTruthy()
    await waitFor(() => expect(lane('done')).toEqual(['project-task-t1']))
    expect(lane('open')).toEqual([])
    // The drawer follows the task: it now offers Mark not done.
    expect(drawer.getByRole('button', { name: 'Mark not done' })).toBeTruthy()
  })

  it('reopens a done task through the reopen route', async () => {
    renderCard({
      'GET /tasks': tasks([], [done('d1')]),
      'POST /activities/d1/reopen': () => ({ status: 200, body: projectTask('d1') }),
    })
    const drawer = await openCard('project-task', 'd1')

    fireEvent.click(drawer.getByRole('button', { name: 'Mark not done' }))

    expect(await drawer.findByText('Task marked not done.')).toBeTruthy()
    expect(calls('POST').map((url) => url.pathname)).toEqual(['/activities/d1/reopen'])
  })

  it('409 task_blocked names the blockers in the drawer and reads the lists again (a blocker reopened meanwhile)', async () => {
    let loads = 0
    renderCard({
      'GET /tasks': (url) => {
        if (url.searchParams.get('status') === 'open') loads += 1
        return tasks([projectTask('t1')])(url, undefined)
      },
      'POST /activities/t1/complete': () =>
        problem(409, 'task_blocked', {
          blockers: [
            { id: 'a', subject: 'Draft the spec' },
            { id: 'b', subject: 'Review it' },
          ],
        }),
    })
    const drawer = await openCard('project-task', 't1')

    fireEvent.click(drawer.getByRole('button', { name: 'Mark done' }))

    const alert = await drawer.findByRole('alert')
    expect(alert.textContent).toContain('Waiting on Draft the spec, Review it. Finish those first.')
    await waitFor(() => expect(loads).toBe(2))
    // The alert survives the re-read: the drawer stays mounted.
    expect(drawer.getByRole('alert').textContent).toContain('Draft the spec')
  })

  it('403 forbidden: "You can no longer change this task", and the lists are read again with fresh flags', async () => {
    let loads = 0
    renderCard({
      'GET /tasks': (url) => {
        if (url.searchParams.get('status') === 'open') loads += 1
        return tasks([projectTask('t1')])(url, undefined)
      },
      'POST /activities/t1/complete': () => problem(403, 'forbidden'),
    })
    const drawer = await openCard('project-task', 't1')

    fireEvent.click(drawer.getByRole('button', { name: 'Mark done' }))

    expect((await drawer.findByRole('alert')).textContent).toContain('You can no longer change this task.')
    await waitFor(() => expect(loads).toBe(2))
  })

  it('any other refusal shows the Problem detail in the drawer and keeps focus on the button', async () => {
    renderCard({
      'GET /tasks': tasks([projectTask('t1')]),
      'POST /activities/t1/complete': () => problem(500, undefined, {}, 'Boom'),
    })
    const drawer = await openCard('project-task', 't1')
    const button = drawer.getByRole('button', { name: 'Mark done' })
    button.focus()

    fireEvent.click(button)

    expect((await drawer.findByRole('alert')).textContent).toBe('Boom')
    expect(document.activeElement).toBe(drawer.getByRole('button', { name: 'Mark done' }))
  })
})

describe('delete', () => {
  it('asks first, naming the task and saying it leaves other tasks’ blockers; then deletes, closes and reads again', async () => {
    let gone = false
    renderCard({
      'GET /tasks': (url) => tasks(gone ? [] : [projectTask('t1', { subject: 'Send offer' })])(url, undefined),
      'DELETE /activities/t1': () => {
        gone = true
        return { status: 204 }
      },
    })
    const drawer = await openCard('project-task', 't1')

    fireEvent.click(drawer.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('Delete task “Send offer”?')
    expect(dialog.textContent).toContain('removed as a blocker of other tasks')
    expect(calls('DELETE')).toHaveLength(0)
    expect(document.querySelectorAll('form form')).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete task' }))

    expect(await screen.findByText('Task deleted.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('project-task-t1')).toBeNull())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByTestId('task-drawer')).toBeNull()
  })

  it('a refused delete stays in the dialog with the reason', async () => {
    renderCard({
      'GET /tasks': tasks([projectTask('t1')]),
      'DELETE /activities/t1': () => problem(403, 'forbidden'),
    })
    const drawer = await openCard('project-task', 't1')
    fireEvent.click(drawer.getByRole('button', { name: 'Delete' }))
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
      'GET /tasks': (url) => (healthy ? tasks([projectTask('t1')])(url, undefined) : problem(503, 'host_unavailable')),
    })

    const banner = await screen.findByTestId('project-tasks-error')
    expect(banner.textContent).toContain('Tasks cannot be shown right now')
    expect(banner.textContent).toContain('could not confirm your access')
    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeTruthy()

    healthy = true
    fireEvent.click(within(banner).getByRole('button', { name: 'Retry' }))
    await screen.findByTestId('project-task-t1')
  })

  it('a failed Done read alone is the same failure, and Retry reads it again', async () => {
    let healthy = false
    renderCard({
      'GET /tasks': (url) =>
        url.searchParams.get('status') === 'done' && !healthy
          ? problem(500, undefined, {}, 'Done is down')
          : tasks([projectTask('t1')], [done('d1')])(url, undefined),
    })
    const banner = await screen.findByTestId('project-tasks-error')
    expect(banner.textContent).toContain('Done is down')
    healthy = true
    fireEvent.click(within(banner).getByRole('button', { name: 'Retry' }))
    await screen.findByTestId('project-task-d1')
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
