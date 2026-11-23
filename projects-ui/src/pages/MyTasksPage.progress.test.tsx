/**
 * @vitest-environment jsdom
 *
 * MyTasksPage — a task in progress (specs/20261110-activities US-10): the "In progress" filter,
 * Start / Stop where the row's own `may.complete` says so, on project and pre-sales tasks alike.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider } from '@tanstack/react-router'
import ProjectsShell from '../components/ProjectsShell'
import { createAppRouter } from '../router'
import { fakeApi, personRef, projectTask as baseTask, scope } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'

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

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 25 })
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

describe('My tasks — in progress', () => {
  it('Start on an open task and Stop on one in progress, only where may.complete', async () => {
    await renderPage({
      'GET /tasks': () => ({
        status: 200,
        body: page([
          projectTask('p1'),
          projectTask('p2', {}, startedPart),
          projectTask('p3', { may: { edit: false, delete: false, complete: false } }),
        ]),
      }),
      'POST /activities/p1/start': () => ({ status: 200, body: projectTask('p1', {}, startedPart) }),
      'POST /activities/p2/stop': () => ({ status: 200, body: projectTask('p2') }),
    })
    const p1 = await screen.findByTestId('my-task-p1')
    const p2 = screen.getByTestId('my-task-p2')
    expect(within(p2).getByText('In progress')).toBeTruthy()
    expect(within(screen.getByTestId('my-task-p3')).queryByRole('button', { name: /Start|Stop/ })).toBeNull()
    await userEvent.click(within(p1).getByRole('button', { name: 'Start' }))
    await userEvent.click(within(p2).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(posts()).toEqual(['/activities/p1/start', '/activities/p2/stop']))
  })

  it('a blocked task’s Start is aria-disabled and calls nothing', async () => {
    await renderPage({
      'GET /tasks': () => ({
        status: 200,
        body: page([
          projectTask('p4', {}, { blocked: true, blockedBy: [{ id: 'x', subject: 'Draft', completed: false }] }),
        ]),
      }),
    })
    const start = within(await screen.findByTestId('my-task-p4')).getByRole('button', { name: 'Start' })
    expect(start.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(start)
    expect(posts()).toEqual([])
  })

  it('the In progress filter asks for status=in_progress', async () => {
    await renderPage({ 'GET /tasks': () => ({ status: 200, body: page([]) }) })
    await userEvent.click(screen.getByRole('tab', { name: 'In progress' }))
    await waitFor(() =>
      expect(apiFetch.mock.calls.some(([url]) => String(url).includes('status=in_progress'))).toBe(true),
    )
    expect(await screen.findByText('Nothing in progress')).toBeTruthy()
  })

  it('a task from an older server, without status, renders as open with Start', async () => {
    await renderPage({ 'GET /tasks': () => ({ status: 200, body: page([projectTask('p5')]) }) })
    const row = await screen.findByTestId('my-task-p5')
    expect(within(row).getByText('Open')).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Start' })).toBeTruthy()
  })
})
