/**
 * @vitest-environment jsdom
 *
 * TasksCard — a task in progress (specs/20261110-activities US-10): Start on an open task, Stop on
 * one in progress, the "In progress" filter, a blocked task's Start, and an older server's rows
 * without `status`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeApi, personRef, projectDetail, projectTask as baseTask } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada', name: 'Ada Lovelace' } } }),
}))

import TasksCard from './TasksCard'

/** Due far ahead, so the row reads Open or In progress, never Overdue. */
const projectTask = (id: string, over: Record<string, unknown> = {}, task: Record<string, unknown> = {}) =>
  baseTask(id, over, { dueDate: '2099-01-01', ...task })

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 25 })
const ada = personRef('u-ada', 'Ada Lovelace')

const renderCard = (routes: Record<string, FakeHandler>) => {
  apiFetch.mockImplementation(fakeApi(routes))
  render(<TasksCard project={projectDetail()} canManage currentUserId="u-ada" />)
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

describe('TasksCard — in progress', () => {
  it('Start on an open task calls start', async () => {
    renderCard({
      'GET /tasks': () => ({ status: 200, body: page([projectTask('t1', {}, { status: 'open' })]) }),
      'POST /activities/t1/start': () => ({
        status: 200,
        body: projectTask('t1', {}, { status: 'in_progress', startedAt: '2026-11-23T08:00:00.000Z', startedBy: ada }),
      }),
    })
    const row = await screen.findByTestId('project-task-t1')
    await userEvent.click(within(row).getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(posts()).toContain('/activities/t1/start'))
  })

  it('an in-progress task is badged with who and since when, and has Stop', async () => {
    renderCard({
      'GET /tasks': () => ({
        status: 200,
        body: page([
          projectTask('t2', {}, { status: 'in_progress', startedAt: '2026-11-23T08:00:00.000Z', startedBy: ada }),
        ]),
      }),
      'POST /activities/t2/stop': () => ({ status: 200, body: projectTask('t2', {}, { status: 'open' }) }),
    })
    const row = await screen.findByTestId('project-task-t2')
    expect(within(row).getByText('In progress')).toBeTruthy()
    expect(row.textContent).toContain('In progress since 23.11.2026')
    expect(within(row).queryByRole('button', { name: 'Start' })).toBeNull()
    await userEvent.click(within(row).getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(posts()).toContain('/activities/t2/stop'))
  })

  it('a blocked task’s Start is aria-disabled and calls nothing', async () => {
    renderCard({
      'GET /tasks': () => ({
        status: 200,
        body: page([
          projectTask('t3', {}, { blocked: true, blockedBy: [{ id: 't1', subject: 'Draft', completed: false }] }),
        ]),
      }),
    })
    const row = await screen.findByTestId('project-task-t3')
    const start = within(row).getByRole('button', { name: 'Start' })
    expect(start.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(start)
    expect(posts()).toEqual([])
  })

  it('no Start without may.complete', async () => {
    renderCard({
      'GET /tasks': () => ({
        status: 200,
        body: page([projectTask('t4', { may: { edit: false, delete: false, complete: false } })]),
      }),
    })
    const row = await screen.findByTestId('project-task-t4')
    expect(within(row).queryByRole('button', { name: 'Start' })).toBeNull()
  })

  it('the In progress filter asks for status=in_progress', async () => {
    renderCard({ 'GET /tasks': () => ({ status: 200, body: page([]) }) })
    await screen.findByText('No open tasks')
    await userEvent.click(screen.getByRole('tab', { name: 'In progress' }))
    await waitFor(() =>
      expect(apiFetch.mock.calls.some(([url]) => String(url).includes('status=in_progress'))).toBe(true),
    )
    expect(await screen.findByText('No tasks in progress')).toBeTruthy()
  })

  it('an older server’s task without status still renders as open, and a done one as done', async () => {
    renderCard({
      'GET /tasks': () => ({
        status: 200,
        body: page([
          projectTask('t5'),
          projectTask('t6', {}, { completedAt: '2026-11-20T08:00:00.000Z', completedBy: ada }),
        ]),
      }),
    })
    const open = await screen.findByTestId('project-task-t5')
    expect(within(open).getByRole('button', { name: 'Start' })).toBeTruthy()
    const done = screen.getByTestId('project-task-t6')
    expect(within(done).getByText('Done')).toBeTruthy()
    expect(within(done).queryByRole('button', { name: 'Start' })).toBeNull()
  })
})
