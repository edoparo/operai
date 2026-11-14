/**
 * @vitest-environment jsdom
 *
 * TasksPage on activities-api (specs/20261110-activities): CRM tasks are read from activities-api, pre-sales only
 * (AC-1.1), and when it cannot answer (`host_unavailable`, `maintenance`) the list area says so with
 * Retry while the header, filter and tabs stay (AC-1.5) — words distinct from the authorization outage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from '../router'
import { fakeApi, page } from '../test-support/fakeApi'

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
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const assignees = { 'GET /tasks/assignees': () => ({ status: 200, body: { items: [] } }) }

describe('TasksPage — activities-api', () => {
  it('reads tasks and assignees from activities-api, pre-sales only', async () => {
    apiFetch.mockImplementation(fakeApi({ 'GET /tasks': () => ({ status: 200, body: page([]) }), ...assignees }))
    window.history.pushState(null, '', '/tasks')
    render(<RouterProvider router={createAppRouter()} />)
    await screen.findByText('Nothing to do')
    const urls = apiFetch.mock.calls.map(([input]) => new URL(String(input)))
    const taskCalls = urls.filter((url) => url.pathname.startsWith('/tasks'))
    expect(taskCalls.map((url) => url.pathname).sort()).toEqual(['/tasks', '/tasks/assignees'])
    for (const url of taskCalls) {
      expect(url.origin).toBe('http://activities-api.test')
      expect(url.searchParams.get('kind')).toBe('pre_sales')
    }
  })

  it.each([
    ['host_unavailable', 'Activities cannot be shown right now'],
    ['maintenance', 'Activities are paused for maintenance'],
  ])('%s: the list area shows its own state, the frame stays, Retry reloads', async (code, title) => {
    let loads = 0
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': () => {
          loads += 1
          return loads === 1
            ? { status: 503, body: { status: 503, title: 'Service Unavailable', code } }
            : { status: 200, body: page([]) }
        },
        ...assignees,
      }),
    )
    window.history.pushState(null, '', '/tasks')
    render(<RouterProvider router={createAppRouter()} />)

    const banner = await screen.findByTestId('crm-activities-unavailable')
    expect(within(banner).getByText(title)).not.toBeNull()
    expect(screen.queryByText('Authorization service unavailable')).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Tasks' })).not.toBeNull()
    expect(screen.getByLabelText('Assigned to')).not.toBeNull()
    expect(screen.getByRole('tab', { name: 'Open' })).not.toBeNull()

    fireEvent.click(screen.getByTestId('crm-activities-unavailable-retry'))
    expect(await screen.findByText('Nothing to do')).not.toBeNull()
    expect(loads).toBe(2)
  })

  it('a bare 503 stays the authorization outage', async () => {
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': () => ({ status: 503, body: { status: 503, title: 'Service Unavailable' } }),
        ...assignees,
      }),
    )
    window.history.pushState(null, '', '/tasks')
    render(<RouterProvider router={createAppRouter()} />)
    expect(await screen.findByText('Authorization service unavailable')).not.toBeNull()
    expect(screen.queryByTestId('crm-activities-unavailable')).toBeNull()
  })
})
