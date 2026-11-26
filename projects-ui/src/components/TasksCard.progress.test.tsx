/**
 * @vitest-environment jsdom
 *
 * TasksCard — a task in progress and moving a card (specs/20261110-activities US-10): the In progress lane, Start on
 * an open task and Stop on one in progress (in the drawer), a blocked task's Start, an older server's tasks without
 * `status`, and dragging a card between lanes with the keyboard — the same writes as the buttons, allowed by the
 * task's own `may.complete` and its blocked state, refused moves shown above the board.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { stubLayoutForBoard } from '@operai/ui/board'
import { fakeApi, personRef, problem, projectDetail, projectTask as baseTask } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'
import { dragCard, factValue, laneCards, openCard } from '../test-support/taskBoard'

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

/** Due far ahead, so the card reads Open or In progress, never Overdue. */
const projectTask = (id: string, over: Record<string, unknown> = {}, task: Record<string, unknown> = {}) =>
  baseTask(id, over, { dueDate: '2099-01-01', ...task })

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 100 })
const ada = personRef('u-ada', 'Ada Lovelace')
const startedPart = { status: 'in_progress', startedAt: '2026-11-23T08:00:00.000Z', startedBy: ada }
const donePart = { status: 'done', completedAt: '2026-11-20T08:00:00.000Z', completedBy: ada }

const tasks =
  (open: unknown[], finished: unknown[] = []): FakeHandler =>
  (url) => ({ status: 200, body: page(url.searchParams.get('status') === 'done' ? finished : open) })

const renderCard = (routes: Record<string, FakeHandler>) => {
  apiFetch.mockImplementation(fakeApi(routes))
  render(<TasksCard project={projectDetail()} canManage currentUserId="u-ada" />)
}
const posts = () =>
  apiFetch.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    .map(([input]) => new URL(String(input)).pathname)
const lane = (id: 'open' | 'in_progress' | 'done') => laneCards('project-tasks', id, 'project-task')

let restoreLayout: () => void
beforeEach(() => {
  restoreLayout = stubLayoutForBoard()
  window.scrollTo = () => undefined
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  }
})
afterEach(() => {
  restoreLayout()
  cleanup()
  vi.clearAllMocks()
})

describe('TasksCard — in progress', () => {
  it('Start on an open task calls start', async () => {
    renderCard({
      'GET /tasks': tasks([projectTask('t1', {}, { status: 'open' })]),
      'POST /activities/t1/start': () => ({ status: 200, body: projectTask('t1', {}, startedPart) }),
    })
    const drawer = await openCard('project-task', 't1')
    await userEvent.click(drawer.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(posts()).toContain('/activities/t1/start'))
    expect(await drawer.findByText('Task started.')).toBeTruthy()
  })

  it('an in-progress task sits in the In progress lane; its drawer says who and since when, and has Stop', async () => {
    renderCard({
      'GET /tasks': tasks([projectTask('t2', {}, startedPart)]),
      'POST /activities/t2/stop': () => ({ status: 200, body: projectTask('t2', {}, { status: 'open' }) }),
    })
    await screen.findByTestId('project-task-t2')
    expect(lane('in_progress')).toEqual(['project-task-t2'])
    const drawer = await openCard('project-task', 't2')
    expect(drawer.getByText('In progress', { selector: '.badge, .badge *' })).toBeTruthy()
    expect(drawer.getByTestId('project-task-t2-fact-started').textContent).toBe('In progress since')
    expect(factValue('project-task', 't2', 'started')).toBe('23.11.2026 · Ada Lovelace (You)')
    expect(drawer.queryByRole('button', { name: 'Start' })).toBeNull()
    await userEvent.click(drawer.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(posts()).toContain('/activities/t2/stop'))
  })

  it('a blocked task’s Start is aria-disabled and calls nothing', async () => {
    renderCard({
      'GET /tasks': tasks([
        projectTask('t3', {}, { blocked: true, blockedBy: [{ id: 't1', subject: 'Draft', completed: false }] }),
      ]),
    })
    const drawer = await openCard('project-task', 't3')
    const start = drawer.getByRole('button', { name: 'Start' })
    expect(start.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(start)
    expect(posts()).toEqual([])
  })

  it('no Start without may.complete', async () => {
    renderCard({ 'GET /tasks': tasks([projectTask('t4', { may: { edit: false, delete: false, complete: false } })]) })
    const drawer = await openCard('project-task', 't4')
    expect(drawer.queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('an older server’s task without status still sits in Open with Start, and a done one in Done', async () => {
    renderCard({
      'GET /tasks': tasks(
        [projectTask('t5')],
        [projectTask('t6', {}, { completedAt: '2026-11-20T08:00:00.000Z', completedBy: ada })],
      ),
    })
    await screen.findByTestId('project-task-t5')
    expect(lane('open')).toEqual(['project-task-t5'])
    expect(lane('done')).toEqual(['project-task-t6'])
    let drawer = await openCard('project-task', 't5')
    expect(drawer.getByRole('button', { name: 'Start' })).toBeTruthy()
    fireEvent.click(drawer.getByTestId('task-drawer-close'))
    drawer = await openCard('project-task', 't6')
    expect(drawer.getByText('Done', { selector: '.badge, .badge *' })).toBeTruthy()
    expect(drawer.queryByRole('button', { name: 'Start' })).toBeNull()
  })
})

describe('TasksCard — dragging a card is the same write as the button', () => {
  it('Open → In progress starts the task, and the lists are read again', async () => {
    let started = false
    renderCard({
      'GET /tasks': (url) => tasks([started ? projectTask('t1', {}, startedPart) : projectTask('t1')])(url, undefined),
      'POST /activities/t1/start': () => {
        started = true
        return { status: 200, body: projectTask('t1', {}, startedPart) }
      },
    })
    await dragCard(await screen.findByTestId('project-task-t1'), 1)

    await waitFor(() => expect(posts()).toEqual(['/activities/t1/start']))
    expect(await screen.findByText('Task started.')).toBeTruthy()
    await waitFor(() => expect(lane('in_progress')).toEqual(['project-task-t1']))
  })

  it('In progress → Open stops it', async () => {
    renderCard({
      'GET /tasks': tasks([projectTask('t1', {}, startedPart)]),
      'POST /activities/t1/stop': () => ({ status: 200, body: projectTask('t1') }),
    })
    await dragCard(await screen.findByTestId('project-task-t1'), -1)
    await waitFor(() => expect(posts()).toEqual(['/activities/t1/stop']))
  })

  it('Open → Done completes it', async () => {
    renderCard({
      'GET /tasks': tasks([projectTask('t1')]),
      'POST /activities/t1/complete': () => ({ status: 200, body: projectTask('t1', {}, donePart) }),
    })
    await dragCard(await screen.findByTestId('project-task-t1'), 2)
    await waitFor(() => expect(posts()).toEqual(['/activities/t1/complete']))
    expect(await screen.findByText('Task marked done.')).toBeTruthy()
  })

  it('Done → Open reopens it; Done → In progress is not a move: that lane refuses the card and is skipped', async () => {
    renderCard({
      'GET /tasks': tasks([], [projectTask('d1', {}, donePart)]),
      'POST /activities/d1/reopen': () => ({ status: 200, body: projectTask('d1') }),
    })
    const card = await screen.findByTestId('project-task-d1')
    card.focus()
    fireEvent.keyDown(card, { code: 'Space', key: ' ' })
    await waitFor(() =>
      expect(screen.getByTestId('project-tasks-lane-in_progress').getAttribute('data-drop')).toBe('refuses'),
    )
    fireEvent.keyDown(card, { code: 'Escape', key: 'Escape' })
    expect(posts()).toEqual([])

    await dragCard(screen.getByTestId('project-task-d1'), -1)
    await waitFor(() => expect(posts()).toEqual(['/activities/d1/reopen']))
  })

  it('a blocked card, or one the person may not complete, cannot be picked up', async () => {
    renderCard({
      'GET /tasks': tasks([
        projectTask('wait', {}, { blocked: true, blockedBy: [{ id: 'x', subject: 'Draft', completed: false }] }),
        projectTask('ro', { may: { edit: false, delete: false, complete: false } }),
      ]),
    })
    await dragCard(await screen.findByTestId('project-task-wait'), 1)
    // Space on a card that cannot be dragged opens it instead.
    expect(await screen.findByTestId('task-drawer')).toBeTruthy()
    fireEvent.click(screen.getByTestId('task-drawer-close'))
    await dragCard(screen.getByTestId('project-task-ro'), 2)
    expect(posts()).toEqual([])
  })

  it('a refused move is shown above the board and, when the flags were stale, the lists are read again', async () => {
    let reads = 0
    renderCard({
      'GET /tasks': (url) => {
        if (url.searchParams.get('status') === 'open') reads += 1
        return tasks([projectTask('t1')])(url, undefined)
      },
      'POST /activities/t1/complete': () =>
        problem(409, 'task_blocked', { blockers: [{ id: 'a', subject: 'Draft the spec' }] }),
    })
    await dragCard(await screen.findByTestId('project-task-t1'), 2)

    const banner = await screen.findByTestId('project-tasks-move-error')
    expect(banner.textContent).toContain('The task was not moved')
    expect(banner.textContent).toContain('Waiting on Draft the spec. Finish those first.')
    expect(
      banner.compareDocumentPosition(screen.getByTestId('project-tasks-board')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await waitFor(() => expect(reads).toBe(2))
    fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('project-tasks-move-error')).toBeNull()
  })
})
