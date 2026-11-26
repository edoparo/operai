/**
 * @vitest-environment jsdom
 *
 * MyTasksPage (specs/20261110-activities US-7, AC-7.2 – AC-7.5): the caller's project tasks and pre-sales tasks as
 * the same board as a project's, each lane in the one order the server sent, a Pre-sales badge on every CRM card,
 * done / not done in a task's drawer only where its own `may.complete` says so, "Open in CRM" built from the company
 * id, and the notice when the CRM could not be reached. Rendered through the app's real router and ProjectsShell
 * against a fake activities-api.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import ProjectsShell from '../components/ProjectsShell'
import { createAppRouter } from '../router'
import { fakeApi, personRef, problem, projectTask, scope } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'
import { laneCards, openCard } from '../test-support/taskBoard'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  usePermissions: () => ({ epoch: 0, apps: [], roles: [], departments: [], permissions: [] }),
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada', name: 'Ada Lovelace' } } }),
}))

const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 100,
  ...extra,
})

/** `GET /tasks` answering `open` and `done` separately, as activities-api does. */
const tasks =
  (open: unknown[], finished: unknown[] = [], extra: Record<string, unknown> = {}): FakeHandler =>
  (url) => ({ status: 200, body: page(url.searchParams.get('status') === 'done' ? finished : open, extra) })

/** A pre-sales task as `GET /tasks?kind=all` returns it: a CRM company, no project. */
const preSalesTask = (id: string, over: Record<string, unknown> = {}, task: Record<string, unknown> = {}) =>
  projectTask(
    id,
    {
      kind: 'pre_sales',
      subject: `Pre-sales ${id}`,
      project: null,
      company: { id: 'c9', name: 'Globex AG' },
      deal: { id: 'd1', title: 'Website' },
      ...over,
    },
    task,
  )

const renderPage = async (routes: Record<string, FakeHandler>) => {
  apiFetch.mockImplementation(fakeApi({ 'GET /scope': () => ({ status: 200, body: scope() }), ...routes }))
  window.history.pushState(null, '', '/tasks')
  render(<RouterProvider router={createAppRouter(undefined, ProjectsShell)} />)
  await screen.findByRole('heading', { level: 2, name: 'My tasks' })
}

const taskReads = () =>
  apiFetch.mock.calls.map(([input]) => new URL(String(input))).filter((url) => url.pathname === '/tasks')

const posts = () =>
  apiFetch.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
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

describe('navigation', () => {
  it('adds Projects and My tasks tabs to the tool frame; My tasks is current at /tasks', async () => {
    await renderPage({ 'GET /tasks': tasks([]) })
    const nav = screen.getByRole('navigation', { name: 'Projects sections' })
    expect(within(nav).getByRole('link', { name: 'Projects' }).getAttribute('aria-current')).toBeNull()
    expect(within(nav).getByRole('link', { name: 'My tasks' }).getAttribute('aria-current')).toBe('page')
  })
})

describe('the mixed board', () => {
  it('asks for the caller’s open and recently done tasks of both kinds, keeps the server order, pre-sales badged', async () => {
    await renderPage({ 'GET /tasks': tasks([projectTask('p1'), preSalesTask('s1'), projectTask('p2')]) })

    await screen.findByTestId('my-task-p1')
    expect(screen.getByRole('region', { name: 'My tasks by status' })).toBeTruthy()
    expect(laneCards('my-tasks', 'open', 'my-task')).toEqual(['my-task-p1', 'my-task-s1', 'my-task-p2'])
    const [openRead, doneRead] = taskReads()
    expect(Object.fromEntries(openRead!.searchParams)).toEqual({
      kind: 'all',
      assignee: 'me',
      status: 'open',
      page: '1',
      pageSize: '100',
    })
    expect(doneRead!.searchParams.get('status')).toBe('done')
    expect(doneRead!.searchParams.get('completedSince')).not.toBeNull()
    expect(within(screen.getByTestId('my-task-s1')).getByText('Pre-sales')).toBeTruthy()
    expect(within(screen.getByTestId('my-task-p1')).queryByText('Pre-sales')).toBeNull()
  })

  it('a project card names its project; its drawer links to the project, built from the id', async () => {
    await renderPage({ 'GET /tasks': tasks([projectTask('p1')]) })
    expect((await screen.findByTestId('my-task-p1')).textContent).toContain('Intranet')
    const drawer = await openCard('my-task', 'p1')
    const link = drawer.getByRole('link', { name: 'Intranet' })
    expect(link.getAttribute('href')).toBe('/p1')
    expect(drawer.getByText(/Project:/).textContent).toContain('Project: Intranet')
  })

  it('a pre-sales card names its company and deal; its drawer opens the company in the CRM through a link named for the task (AC-7.3)', async () => {
    await renderPage({ 'GET /tasks': tasks([preSalesTask('s1')]) })
    expect((await screen.findByTestId('my-task-s1')).textContent).toContain('Globex AG · Website')
    const drawer = await openCard('my-task', 's1')
    expect(drawer.getByText('Company: Globex AG')).toBeTruthy()
    const link = drawer.getByRole('link', { name: 'Open in CRM: Pre-sales s1' })
    expect(link.getAttribute('href')).toBe('/crm/companies/c9')
  })

  it('a pre-sales task about a deal links straight to the deal in the CRM, built from the id', async () => {
    await renderPage({
      'GET /tasks': tasks([
        preSalesTask('t1'),
        preSalesTask('t2', { deal: { id: 'd/2', title: null } }),
        preSalesTask('t3', { deal: null }),
      ]),
    })
    let drawer = await openCard('my-task', 't1')
    const link = drawer.getByTestId('my-task-t1-deal')
    expect(link.textContent).toBe('Website')
    expect(link.getAttribute('href')).toBe('/crm/deals/d1')
    fireEvent.click(drawer.getByTestId('task-drawer-close'))
    drawer = await openCard('my-task', 't2')
    expect(drawer.getByTestId('my-task-t2-deal').getAttribute('href')).toBe('/crm/deals/d%2F2')
    expect(drawer.getByTestId('my-task-t2-deal').textContent).toBe('Unknown deal')
    fireEvent.click(drawer.getByTestId('task-drawer-close'))
    drawer = await openCard('my-task', 't3')
    expect(drawer.queryByTestId('my-task-t3-deal')).toBeNull()
  })

  it('no task has Edit or Delete here, whatever its may flags (AC-7.3)', async () => {
    await renderPage({ 'GET /tasks': tasks([preSalesTask('s1'), projectTask('p1')]) })
    let drawer = await openCard('my-task', 's1')
    expect(drawer.queryByRole('button', { name: /edit|delete/i })).toBeNull()
    expect(drawer.getByRole('button', { name: 'Mark done' })).toBeTruthy()
    fireEvent.click(drawer.getByTestId('task-drawer-close'))
    drawer = await openCard('my-task', 'p1')
    expect(drawer.queryByRole('button', { name: /edit|delete/i })).toBeNull()
  })

  it('a pre-sales task whose company name is gone still opens it by id and says the name is unknown', async () => {
    await renderPage({ 'GET /tasks': tasks([preSalesTask('s1', { company: { id: 'c9', name: null } })]) })
    const drawer = await openCard('my-task', 's1')
    expect(drawer.getByText('Company: Unknown company')).toBeTruthy()
    expect(drawer.getByRole('link', { name: /Open in CRM/ }).getAttribute('href')).toBe('/crm/companies/c9')
  })

  it('encodes the company id in the CRM link', async () => {
    await renderPage({ 'GET /tasks': tasks([preSalesTask('s1', { company: { id: 'a/b c', name: 'X' } })]) })
    const drawer = await openCard('my-task', 's1')
    expect(drawer.getByRole('link', { name: /Open in CRM/ }).getAttribute('href')).toBe('/crm/companies/a%2Fb%20c')
  })

  it('a pre-sales task with no company at all has no CRM link rather than a broken one', async () => {
    await renderPage({ 'GET /tasks': tasks([preSalesTask('s1', { company: null, deal: null })]) })
    const drawer = await openCard('my-task', 's1')
    // Ada is the assignee, so the drawer also carries Record hours' fallback link to My hours
    // (specs/20261116-record-hours-in-place): it is the CRM link that must not exist.
    expect(drawer.queryByTestId('my-task-s1-crm')).toBeNull()
    expect(drawer.queryAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('/crm'))).toEqual([])
  })
})

describe('done and not done', () => {
  it('offers the toggle only where the task’s own may.complete says so (participant-only tasks are read-only)', async () => {
    await renderPage({
      'GET /tasks': tasks([
        projectTask('p1'),
        projectTask('p2', { may: { edit: false, delete: false, complete: false } }),
        preSalesTask('s1', { may: { edit: true, delete: true, complete: false } }),
      ]),
    })
    let drawer = await openCard('my-task', 'p1')
    expect(drawer.getByRole('button', { name: 'Mark done' })).toBeTruthy()
    fireEvent.click(drawer.getByTestId('task-drawer-close'))
    drawer = await openCard('my-task', 'p2')
    expect(drawer.queryByRole('button', { name: /Mark/ })).toBeNull()
    fireEvent.click(drawer.getByTestId('task-drawer-close'))
    drawer = await openCard('my-task', 's1')
    expect(drawer.queryByRole('button', { name: /Mark/ })).toBeNull()
  })

  it('marks a pre-sales task done, confirms, and reads the lists again: the card moves to Done', async () => {
    let finished = false
    const doneTask = preSalesTask('s1', {}, { status: 'done', completedAt: '2026-11-11T09:00:00.000Z' })
    await renderPage({
      'GET /tasks': (url) => tasks(finished ? [] : [preSalesTask('s1')], finished ? [doneTask] : [])(url, undefined),
      'POST /activities/s1/complete': () => {
        finished = true
        return { status: 200, body: doneTask }
      },
    })
    const drawer = await openCard('my-task', 's1')
    fireEvent.click(drawer.getByRole('button', { name: 'Mark done' }))

    expect(await drawer.findByText('Task marked done.')).toBeTruthy()
    await waitFor(() => expect(laneCards('my-tasks', 'done', 'my-task')).toEqual(['my-task-s1']))
    expect(screen.getByText(/^Nothing on your list/)).toBeTruthy()
    expect(posts()[0]?.pathname).toBe('/activities/s1/complete')
  })

  it('reopens a done task from the Done lane', async () => {
    await renderPage({
      'GET /tasks': tasks(
        [],
        [
          preSalesTask(
            's2',
            {},
            { completedAt: '2026-11-05T10:00:00.000Z', completedBy: personRef('u-ada', 'Ada Lovelace') },
          ),
        ],
      ),
      'POST /activities/s2/reopen': () => ({ status: 200, body: preSalesTask('s2') }),
    })
    const drawer = await openCard('my-task', 's2')
    fireEvent.click(drawer.getByRole('button', { name: 'Mark not done' }))
    expect(await drawer.findByText('Task marked not done.')).toBeTruthy()
    expect(posts()[0]?.pathname).toBe('/activities/s2/reopen')
  })

  it('a refused toggle shows its reason in the drawer and reads the lists again for fresh flags', async () => {
    await renderPage({
      'GET /tasks': tasks([preSalesTask('s1')]),
      'POST /activities/s1/complete': () => problem(403, 'forbidden'),
    })
    const drawer = await openCard('my-task', 's1')
    fireEvent.click(drawer.getByRole('button', { name: 'Mark done' }))
    await waitFor(() => expect(taskReads().length).toBe(4))
    // The re-read keeps the drawer: the reason stays.
    expect(drawer.getByRole('alert').textContent).toBe('You can no longer change this task.')
  })
})

describe('the Done lane', () => {
  it('says so when nothing was done in the last 30 days', async () => {
    await renderPage({ 'GET /tasks': tasks([projectTask('p1')]) })
    await screen.findByTestId('my-task-p1')
    expect(
      within(screen.getByTestId('my-tasks-lane-done')).getByText('No tasks done in the last 30 days.'),
    ).toBeTruthy()
  })
})

describe('when the CRM cannot be reached (AC-7.5)', () => {
  it('still shows the project tasks and announces that pre-sales tasks could not be loaded, with Retry', async () => {
    await renderPage({ 'GET /tasks': tasks([projectTask('p1')], [], { unavailable: ['crm'] }) })
    expect(await screen.findByTestId('my-task-p1')).toBeTruthy()
    const banner = screen.getByTestId('my-tasks-unavailable')
    expect(banner.getAttribute('role')).toBe('status')
    expect(banner.textContent).toContain('Pre-sales tasks could not be loaded')
    fireEvent.click(within(banner).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(taskReads().length).toBe(4))
  })

  it('says nothing when the lists simply hold no pre-sales tasks (AC-7.4: a caller who cannot read the CRM)', async () => {
    await renderPage({ 'GET /tasks': tasks([projectTask('p1')]) })
    await screen.findByTestId('my-task-p1')
    expect(screen.queryByTestId('my-tasks-unavailable')).toBeNull()
  })

  it('shows the notice above the empty board when nothing else is left', async () => {
    await renderPage({ 'GET /tasks': tasks([], [], { unavailable: ['crm'] }) })
    expect(await screen.findByTestId('my-tasks-unavailable')).toBeTruthy()
    expect(screen.getByText(/^Nothing on your list/)).toBeTruthy()
  })
})

describe('states', () => {
  it('a failed load is a warning banner with Retry', async () => {
    let reads = 0
    await renderPage({
      'GET /tasks': (url) => {
        if (url.searchParams.get('status') === 'open') reads += 1
        return reads === 1 && url.searchParams.get('status') === 'open'
          ? problem(500, undefined, {}, 'Boom')
          : tasks([projectTask('p1')])(url, undefined)
      },
    })
    const banner = await screen.findByTestId('my-tasks-error')
    expect(banner.textContent).toContain('Boom')
    fireEvent.click(within(banner).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('my-task-p1')).toBeTruthy()
  })

  it('a 403 is the permission-denied panel', async () => {
    await renderPage({ 'GET /tasks': () => problem(403, 'forbidden') })
    expect(await screen.findByText('You do not have access to this')).toBeTruthy()
  })

  it('a 503 maintenance says tasks are paused', async () => {
    await renderPage({ 'GET /tasks': () => problem(503, 'maintenance') })
    expect(await screen.findByText('Tasks are paused')).toBeTruthy()
  })

  it('offers "Load more" past the first 100 open tasks', async () => {
    await renderPage({
      'GET /tasks': (url) =>
        url.searchParams.get('status') === 'done'
          ? { status: 200, body: page([]) }
          : { status: 200, body: { items: [projectTask('p1')], total: 140, page: 1, pageSize: 100 } },
    })
    await screen.findByTestId('my-task-p1')
    expect(within(screen.getByTestId('my-tasks-open-more')).getByRole('button', { name: 'Load more' })).toBeTruthy()
  })
})

describe('details visibility (specs/20261110-activities US-9)', () => {
  it('a pre-sales task whose details are hidden shows the restricted line and no description', async () => {
    await renderPage({
      'GET /tasks': tasks([
        preSalesTask('s1', { detailsVisibility: 'author', detailsHidden: true }, { description: null, files: [] }),
      ]),
    })
    const drawer = await openCard('my-task', 's1')
    expect(drawer.getByText('Details are restricted')).toBeTruthy()
    expect(screen.getByTestId('task-drawer').querySelector('[data-testid$="-description-text"]')).toBeNull()
  })

  it('a visible task shows no restricted line', async () => {
    await renderPage({ 'GET /tasks': tasks([preSalesTask('s1')]) })
    const drawer = await openCard('my-task', 's1')
    expect(drawer.queryByText('Details are restricted')).toBeNull()
  })
})
