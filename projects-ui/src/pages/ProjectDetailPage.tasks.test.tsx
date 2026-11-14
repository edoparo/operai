/**
 * @vitest-environment jsdom
 *
 * ProjectDetailPage × Tasks card (specs/20261110-activities AC-3.1, AC-3.4, AC-3.5, AC-3.8): the
 * card sits between Team and Contracts, loads on its own (its failure never
 * takes the page down), every reader sees it, only a manager of an open project
 * can add, and a task added through the dialog shows up. Rendered through the
 * app's real router against a fake projects-api + activities-api.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from '../router'
import { fakeApi, problem, projectDetail, projectTask, scope } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'
import { scopeRoot } from '../test-support/scopeRoot'
import type { Project, Scope } from '../lib/types'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada', name: 'Ada Lovelace' } } }),
}))

const MANAGER = scope({ manage: ['welld_ch'] })
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 25 })

const renderProject = async (
  project: Project,
  routes: Record<string, FakeHandler> = {},
  callerScope: Scope = MANAGER,
) => {
  apiFetch.mockImplementation(
    fakeApi({
      [`GET /projects/${project.id}`]: () => ({ status: 200, body: project }),
      'GET /authz/users/directory': () => ({ status: 200, body: { users: [] } }),
      'GET /tasks': () => ({ status: 200, body: page([]) }),
      ...routes,
    }),
  )
  window.history.pushState(null, '', `/${project.id}`)
  render(<RouterProvider router={createAppRouter(undefined, scopeRoot(callerScope))} />)
  await screen.findByTestId('project-detail-page')
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

describe('the Tasks card on the project page', () => {
  it('sits between the Team and the Contracts', async () => {
    await renderProject(projectDetail())
    const team = await screen.findByRole('heading', { name: 'Team' })
    const tasks = await screen.findByRole('heading', { name: 'Tasks' })
    const contracts = await screen.findByRole('heading', { name: 'Contracts' })
    expect(team.compareDocumentPosition(tasks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tasks.compareDocumentPosition(contracts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tasks.tagName).toBe('H3')
  })

  it('asks the activities service for this project’s tasks, not projects-api', async () => {
    await renderProject(projectDetail())
    await screen.findByText('No open tasks')
    const task = apiFetch.mock.calls.map(([input]) => new URL(String(input))).find((url) => url.pathname === '/tasks')!
    expect(task.origin).toBe('http://activities-api.test')
    expect(task.searchParams.get('projectId')).toBe('p1')
  })

  it('a reader who cannot manage sees the tasks (AC-3.5) and has no Add task', async () => {
    await renderProject(
      projectDetail(),
      {
        'GET /tasks': () => ({
          status: 200,
          body: page([projectTask('t1', { may: { edit: false, delete: false, complete: false } })]),
        }),
      },
      scope(),
    )
    const row = await screen.findByTestId('project-task-t1')
    expect(within(row).queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull()
  })

  it('does not take the page down when it fails: details and contracts stay, the card says what happened', async () => {
    await renderProject(projectDetail(), { 'GET /tasks': () => problem(503, 'host_unavailable') })
    expect((await screen.findByTestId('project-tasks-error')).textContent).toContain('Tasks cannot be shown right now')
    expect(screen.getByTestId('project-facts')).toBeTruthy()
    expect(screen.getByTestId('project-contracts')).toBeTruthy()
  })

  it('a project still loading its tasks shows the rest of the page already', async () => {
    await renderProject(projectDetail(), { 'GET /tasks': () => new Promise(() => undefined) })
    expect(screen.getByTestId('project-facts')).toBeTruthy()
    expect(screen.getAllByText('Loading tasks…').length).toBeGreaterThan(0)
  })

  it('a manager adds a task through the dialog; the list reloads and confirms', async () => {
    let created = false
    await renderProject(projectDetail(), {
      'GET /tasks': () => ({ status: 200, body: page(created ? [projectTask('new', { subject: 'Send offer' })] : []) }),
      'POST /activities': () => {
        created = true
        return { status: 201, body: projectTask('new', { subject: 'Send offer' }) }
      },
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Add task' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Title', { exact: false }), { target: { value: 'Send offer' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add task' }))

    expect(await screen.findByText('Task added.')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByTestId('project-task-new')).toBeTruthy()
  })

  it('no Add task on a cancelled project, even for a manager', async () => {
    await renderProject(projectDetail({ state: 'cancelled' }))
    await screen.findByText('No open tasks')
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull()
  })
})
