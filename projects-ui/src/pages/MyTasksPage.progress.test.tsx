/**
 * @vitest-environment jsdom
 *
 * MyTasksPage — a task in progress (specs/20261110-activities US-10): the In progress lane, Start / Stop in the
 * drawer where the task's own `may.complete` says so, on project and pre-sales tasks alike, and dragging a card,
 * which is the same write.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider } from '@tanstack/react-router'
import ProjectsShell from '../components/ProjectsShell'
import { createAppRouter } from '../router'
import { fakeApi, personRef, projectTask as baseTask, scope } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'
import { stubLayoutForBoard } from '@operai/ui/board'
import { dragCard, laneCards, openCard } from '../test-support/taskBoard'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  usePermissions: () => ({ epoch: 0, apps: [], roles: [], departments: [], permissions: [] }),
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada', name: 'Ada Lovelace' } } }),
}))

/** Due far ahead, so the row reads Open or In progress, never Overdue. */
const projectTask = (id: string, over: Record<string, unknown> = {}, task: Record<string, unknown> = {}) =>
  baseTask(id, over, { dueDate: '2099-01-01', ...task })

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 100 })
const tasks =
  (open: unknown[], finished: unknown[] = []): FakeHandler =>
  (url) => ({ status: 200, body: page(url.searchParams.get('status') === 'done' ? finished : open) })
const ada = personRef('u-ada', 'Ada Lovelace')
const startedPart = { status: 'in_progress', startedAt: '2026-11-23T08:00:00.000Z', startedBy: ada }

const renderPage = async (routes: Record<string, FakeHandler>) => {
  apiFetch.mockImplementation(fakeApi({ 'GET /scope': () => ({ status: 200, body: scope() }), ...routes }))
  window.history.pushState(null, '', '/tasks')
  render(<RouterProvider router={createAppRouter(undefined, ProjectsShell)} />)
  await screen.findByRole('heading', { level: 2, name: 'My tasks' })
}
const posts = () =>
  apiFetch.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    .map(([input]) => new URL(String(input)).pathname)

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

describe('My tasks — in progress', () => {
  it('Start on an open task and Stop on one in progress, only where may.complete', async () => {
    await renderPage({
      'GET /tasks': tasks([
        projectTask('p1'),
        projectTask('p2', {}, startedPart),
        projectTask('p3', { may: { edit: false, delete: false, complete: false } }),
      ]),
      'POST /activities/p1/start': () => ({ status: 200, body: projectTask('p1', {}, startedPart) }),
      'POST /activities/p2/stop': () => ({ status: 200, body: projectTask('p2') }),
    })
    await screen.findByTestId('my-task-p1')
    expect(laneCards('my-tasks', 'in_progress', 'my-task')).toEqual(['my-task-p2'])
    let drawer = await openCard('my-task', 'p3')
    expect(drawer.queryByRole('button', { name: /Start|Stop/ })).toBeNull()
    fireEvent.click(drawer.getByTestId('task-drawer-close'))
    drawer = await openCard('my-task', 'p1')
    await userEvent.click(drawer.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(posts()).toEqual(['/activities/p1/start']))
    fireEvent.click(drawer.getByTestId('task-drawer-close'))
    drawer = await openCard('my-task', 'p2')
    expect(drawer.getByText('In progress', { selector: '.badge, .badge *' })).toBeTruthy()
    await userEvent.click(drawer.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(posts()).toEqual(['/activities/p1/start', '/activities/p2/stop']))
  })

  it('a blocked task’s Start is aria-disabled and calls nothing', async () => {
    await renderPage({
      'GET /tasks': tasks([
        projectTask('p4', {}, { blocked: true, blockedBy: [{ id: 'x', subject: 'Draft', completed: false }] }),
      ]),
    })
    const start = (await openCard('my-task', 'p4')).getByRole('button', { name: 'Start' })
    expect(start.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(start)
    expect(posts()).toEqual([])
  })

  it('an empty In progress lane says so', async () => {
    await renderPage({ 'GET /tasks': tasks([]) })
    expect(await screen.findByText('No tasks in progress.')).toBeTruthy()
  })

  it('a task from an older server, without status, sits in Open with Start', async () => {
    await renderPage({ 'GET /tasks': tasks([projectTask('p5')]) })
    await screen.findByTestId('my-task-p5')
    expect(laneCards('my-tasks', 'open', 'my-task')).toEqual(['my-task-p5'])
    const drawer = await openCard('my-task', 'p5')
    expect(drawer.getByText('Open', { selector: '.badge, .badge *' })).toBeTruthy()
    expect(drawer.getByRole('button', { name: 'Start' })).toBeTruthy()
  })

  it('dragging a pre-sales card to Done completes it, the same write as Mark done', async () => {
    await renderPage({
      'GET /tasks': tasks([
        projectTask('s1', { kind: 'pre_sales', project: null, company: { id: 'c9', name: 'Globex AG' }, deal: null }),
      ]),
      'POST /activities/s1/complete': () => ({ status: 200, body: projectTask('s1') }),
    })
    await dragCard(await screen.findByTestId('my-task-s1'), 2)
    await waitFor(() => expect(posts()).toEqual(['/activities/s1/complete']))
    expect(await screen.findByText('Task marked done.')).toBeTruthy()
  })
})
