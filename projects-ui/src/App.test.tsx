/**
 * @vitest-environment jsdom
 *
 * The exposed `./App` is unmounted when the user leaves Projects inside the
 * shell and mounted again when they return. A remount must load the route of
 * the URL it is mounted at, not show the route it last displayed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
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

// The router is released when its element leaves the document, which is reported a microtask later.
const removed = () => Promise.resolve()

describe('projects-ui — the browser history of the router is released on unmount', () => {
  // Every router builds a browser history that wraps window.history.pushState/replaceState and adds
  // popstate/beforeunload listeners; only history.destroy() undoes that (specs/029 security L5).
  const footprint = () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const live = (type: string) =>
      add.mock.calls.filter((c) => c[0] === type).length - remove.mock.calls.filter((c) => c[0] === type).length
    return {
      listeners: () => [live('popstate'), live('beforeunload')],
      restore: () => {
        add.mockRestore()
        remove.mockRestore()
      },
    }
  }

  it('App: window listeners and the pushState/replaceState wrapper chain do not grow with the number of mounts', async () => {
    const { default: App } = await import('./App')
    window.scrollTo = () => undefined
    const { pushState, replaceState } = window.history
    const seen = footprint()
    try {
      window.history.pushState(null, '', '/projects')
      for (let i = 0; i < 5; i++) {
        const mounted = render(<App />)
        expect(await screen.findByTestId('projects-page')).not.toBeNull()
        mounted.unmount()
        await removed()
      }
      expect(seen.listeners()).toEqual([0, 0])
      expect(window.history.pushState).toBe(pushState)
      expect(window.history.replaceState).toBe(replaceState)
    } finally {
      seen.restore()
    }
  })

  it('under React.StrictMode, App: window listeners and the pushState/replaceState wrapper chain do not grow with the number of mounts', async () => {
    const { default: App } = await import('./App')
    window.scrollTo = () => undefined
    const { pushState, replaceState } = window.history
    const seen = footprint()
    try {
      window.history.pushState(null, '', '/projects')
      for (let i = 0; i < 5; i++) {
        const mounted = render(
          <StrictMode>
            <App />
          </StrictMode>,
        )
        expect(await screen.findByTestId('projects-page')).not.toBeNull()
        mounted.unmount()
        await removed()
      }
      expect(seen.listeners()).toEqual([0, 0])
      expect(window.history.pushState).toBe(pushState)
      expect(window.history.replaceState).toBe(replaceState)
    } finally {
      seen.restore()
    }
  })
})
