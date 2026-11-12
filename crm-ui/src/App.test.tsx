/**
 * @vitest-environment jsdom
 *
 * The exposed `./App` is unmounted when the user leaves the CRM inside the
 * shell and mounted again when they return. A remount must load the route of
 * the URL it is mounted at, not show the route it last displayed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { fakeApi, page } from './test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
  usePermissions: () => ({ epoch: 0, apps: ['crm'], roles: [], departments: [], permissions: [] }),
}))

const { default: App } = await import('./App')

beforeEach(() => {
  window.scrollTo = () => undefined
  apiFetch.mockImplementation(
    fakeApi({
      'GET /scope': () => ({ status: 200, body: { deal: [], canErase: false } }),
      'GET /tasks': () => ({ status: 200, body: page([]) }),
      'GET /tasks/assignees': () => ({ status: 200, body: { items: [] } }),
    }),
  )
})

afterEach(() => {
  cleanup()
  window.history.pushState(null, '', '/')
})

describe('App (crm-ui) — remount inside the shell', () => {
  it('a remounted App reloads the route of the URL it is mounted at, not the one it last showed', async () => {
    window.history.pushState(null, '', '/crm/tasks')
    const first = render(<App />)
    expect(await screen.findByTestId('crm-tasks-page')).not.toBeNull()
    first.unmount()

    window.history.pushState(null, '', '/crm/nope/nothing')
    render(<App />)

    expect(await screen.findByTestId('crm-not-found')).not.toBeNull()
    expect(screen.queryByTestId('crm-tasks-page')).toBeNull()
  })
})
