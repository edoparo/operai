/**
 * @vitest-environment jsdom
 *
 * The exposed `./App` is unmounted when the user leaves Projects inside the
 * shell and mounted again when they return. A remount must load the route of
 * the URL it is mounted at, not show the route it last displayed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { fakeApi, page, scope } from './test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
  usePermissions: () => ({ epoch: 0, apps: ['projects'], roles: [], departments: [], permissions: [] }),
}))

const { default: App } = await import('./App')

beforeEach(() => {
  window.scrollTo = () => undefined
  apiFetch.mockImplementation(
    fakeApi({
      'GET /scope': () => ({ status: 200, body: scope() }),
      'GET /projects': () => ({ status: 200, body: page([]) }),
      'GET /project-managers': () => ({ status: 200, body: { items: [] } }),
    }),
  )
})

afterEach(() => {
  cleanup()
  window.history.pushState(null, '', '/')
})

describe('App (projects-ui) — remount inside the shell', () => {
  it('a remounted App reloads the route of the URL it is mounted at, not the one it last showed', async () => {
    window.history.pushState(null, '', '/projects')
    const first = render(<App />)
    expect(await screen.findByTestId('projects-page')).not.toBeNull()
    first.unmount()

    window.history.pushState(null, '', '/projects/ck9x2/nope')
    render(<App />)

    expect(await screen.findByTestId('projects-not-found')).not.toBeNull()
    expect(screen.queryByTestId('projects-page')).toBeNull()
  })
})
