/**
 * @vitest-environment jsdom
 *
 * The three exposed React entries (specs/021-meetings, design.md § Conventions › Frame):
 * `./App` (ToolLayout "Meetings" + TabNav; Erase only for `meeting:erase` holders),
 * `./MyMeetings` (ToolLayout "My meetings", no TabNav) and `./HostMeetings` (a Card, no frame).
 */
import { StrictMode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const permissions = vi.hoisted(() => ({
  value: {
    epoch: 0,
    apps: ['meetings'],
    roles: [],
    departments: [],
    permissions: [] as { resource: string; action: string }[],
  },
}))

vi.mock('shell/session', () => ({
  apiFetch: vi.fn(),
  getMeetingsApiBaseUrl: vi.fn(() => 'http://meetings-api.test'),
  getAuthBaseUrl: vi.fn(() => 'http://auth.test'),
  navigateSuite: vi.fn(),
  registerNavigationBlocker: vi.fn(() => () => undefined),
  usePermissions: vi.fn(() => permissions.value),
}))

beforeEach(() => {
  // jsdom does not implement scrolling; the router's scroll restoration calls it on navigation.
  window.scrollTo = () => undefined
  permissions.value = { epoch: 0, apps: ['meetings'], roles: [], departments: [], permissions: [] }
})

afterEach(() => {
  cleanup()
  window.history.pushState(null, '', '/')
})

describe('App (./App, gated)', () => {
  it('mounts MeetingsShell under /meetings: the h1, the section tabs and the routed page', async () => {
    window.history.pushState(null, '', '/meetings')
    const { default: App } = await import('./App')

    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Meetings' })).not.toBeNull()
    expect(screen.getByRole('navigation', { name: 'Meetings sections' })).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Templates' }).getAttribute('href')).toBe('/meetings/templates')
    expect(await screen.findByTestId('meetings-list-page')).not.toBeNull()
  })

  it('hides the Erase tab from a caller without meeting:erase (a UI hint; the server decides)', async () => {
    window.history.pushState(null, '', '/meetings')
    const { default: App } = await import('./App')

    render(<App />)
    await screen.findByTestId('meetings-list-page')

    expect(screen.queryByRole('link', { name: 'Erase' })).toBeNull()
  })

  it('shows the Erase tab to a meeting:erase holder', async () => {
    permissions.value = { ...permissions.value, permissions: [{ resource: 'meeting', action: 'erase' }] }
    window.history.pushState(null, '', '/meetings')
    const { default: App } = await import('./App')

    render(<App />)

    expect((await screen.findByRole('link', { name: 'Erase' })).getAttribute('href')).toBe('/meetings/erase')
  })
})

describe('remount inside the shell', () => {
  it('a remounted ./App reloads the route of the URL it is mounted at, not the one it last showed', async () => {
    const { default: App } = await import('./App')
    window.history.pushState(null, '', '/meetings')
    const first = render(<App />)
    expect(await screen.findByTestId('meetings-list-page')).not.toBeNull()
    first.unmount()

    window.history.pushState(null, '', '/meetings/nope/nothing')
    render(<App />)

    expect(await screen.findByTestId('meetings-not-found')).not.toBeNull()
    expect(screen.queryByTestId('meetings-list-page')).toBeNull()
  })

  it('a remounted ./MyMeetings reloads the route of the URL it is mounted at, not the one it last showed', async () => {
    const { default: MyMeetings } = await import('./MyMeetings')
    window.history.pushState(null, '', '/my-meetings')
    const first = render(<MyMeetings />)
    expect(await screen.findByTestId('meetings-list-page')).not.toBeNull()
    first.unmount()

    window.history.pushState(null, '', '/my-meetings/nope/nothing')
    render(<MyMeetings />)

    expect(await screen.findByTestId('meetings-not-found')).not.toBeNull()
    expect(screen.queryByTestId('meetings-list-page')).toBeNull()
  })
})

describe('MyMeetings (./MyMeetings, ungated)', () => {
  it('mounts under /my-meetings with the "My meetings" h1 and NO section tabs', async () => {
    window.history.pushState(null, '', '/my-meetings')
    const { default: MyMeetings } = await import('./MyMeetings')

    render(<MyMeetings />)

    expect(await screen.findByRole('heading', { level: 1, name: 'My meetings' })).not.toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(await screen.findByTestId('meetings-list-page')).not.toBeNull()
  })
})

describe('HostMeetings (./HostMeetings)', () => {
  it('renders a titled card with no frame of its own (no h1, no navigation)', async () => {
    const { default: HostMeetings } = await import('./host/HostMeetings')

    render(<HostMeetings hostApp="crm" entityType="deal" entityId="d1" />)

    expect(await screen.findByRole('heading', { level: 3, name: 'Meetings' })).not.toBeNull()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
  })
})

describe('meetings-ui — the browser history of the router is released on unmount', () => {
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
      window.history.pushState(null, '', '/meetings')
      for (let i = 0; i < 5; i++) {
        const mounted = render(<App />)
        expect(await screen.findByTestId('meetings-list-page')).not.toBeNull()
        mounted.unmount()
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
      window.history.pushState(null, '', '/meetings')
      for (let i = 0; i < 5; i++) {
        const mounted = render(
          <StrictMode>
            <App />
          </StrictMode>,
        )
        expect(await screen.findByTestId('meetings-list-page')).not.toBeNull()
        mounted.unmount()
      }
      expect(seen.listeners()).toEqual([0, 0])
      expect(window.history.pushState).toBe(pushState)
      expect(window.history.replaceState).toBe(replaceState)
    } finally {
      seen.restore()
    }
  })

  it('MyMeetings: window listeners and the pushState/replaceState wrapper chain do not grow with the number of mounts', async () => {
    const { default: MyMeetings } = await import('./MyMeetings')
    window.scrollTo = () => undefined
    const { pushState, replaceState } = window.history
    const seen = footprint()
    try {
      window.history.pushState(null, '', '/my-meetings')
      for (let i = 0; i < 5; i++) {
        const mounted = render(<MyMeetings />)
        expect(await screen.findByTestId('meetings-list-page')).not.toBeNull()
        mounted.unmount()
      }
      expect(seen.listeners()).toEqual([0, 0])
      expect(window.history.pushState).toBe(pushState)
      expect(window.history.replaceState).toBe(replaceState)
    } finally {
      seen.restore()
    }
  })

  it('under React.StrictMode, MyMeetings: window listeners and the pushState/replaceState wrapper chain do not grow with the number of mounts', async () => {
    const { default: MyMeetings } = await import('./MyMeetings')
    window.scrollTo = () => undefined
    const { pushState, replaceState } = window.history
    const seen = footprint()
    try {
      window.history.pushState(null, '', '/my-meetings')
      for (let i = 0; i < 5; i++) {
        const mounted = render(
          <StrictMode>
            <MyMeetings />
          </StrictMode>,
        )
        expect(await screen.findByTestId('meetings-list-page')).not.toBeNull()
        mounted.unmount()
      }
      expect(seen.listeners()).toEqual([0, 0])
      expect(window.history.pushState).toBe(pushState)
      expect(window.history.replaceState).toBe(replaceState)
    } finally {
      seen.restore()
    }
  })
})
