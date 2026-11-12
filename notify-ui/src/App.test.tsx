/**
 * @vitest-environment jsdom
 *
 * Component tests for App.tsx — notify-ui's exposed `./App` (T14,
 * specs/005-notification-center/tasks.md). Mirrors
 * admin-ui/src/App.test.tsx's split: this file proves the EXACT exposed
 * component — with its hardcoded `/notify` basepath — mounts and resolves
 * under that prefix; src/router.test.tsx separately covers the router's
 * structure using the basepath-less factory.
 *
 * `shell/tokens.css` is a side-effect-only import — vitest.config.ts's
 * `resolve.alias` points the bare specifier at a real (empty) local stub so
 * Vite's import-analysis is satisfied; nothing to assert on for it here.
 *
 * T15 (specs/005-notification-center/tasks.md) mocks `./lib/notificationsApi`
 * — `NotificationCenterPage` now fetches `GET /notifications` on mount; a
 * never-resolving pending promise keeps this test's assertions (which only
 * ever check the heading, rendered synchronously before any fetch settles)
 * from also having to deal with a real, unmocked network call escaping into
 * the test run (see NotificationCenterPage.test.tsx for the actual
 * list/empty/loading/error/was-unread coverage).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('./lib/notificationsApi', () => ({
  listNotifications: vi.fn(() => new Promise(() => {})),
  markAllRead: vi.fn(() => new Promise(() => {})),
}))

const { default: App } = await import('./App')

afterEach(() => {
  cleanup()
  window.history.pushState(null, '', '/')
})

describe('App (notify-ui, mounted under /notify)', () => {
  it('landing on /notify renders the notification center page shell', async () => {
    window.history.pushState(null, '', '/notify')

    render(<App />)

    const heading = await screen.findByTestId('notify-center-heading')
    expect(heading.textContent).toBe('Inbox')
    // The tool frame's title (ToolLayout) is the page's one h1.
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Notifications')
    expect(window.location.pathname).toBe('/notify')
  })

  it('an unmatched path under /notify renders the not-found fallback', async () => {
    window.history.pushState(null, '', '/notify/whatever')

    render(<App />)

    expect(await screen.findByTestId('notify-not-found-page')).not.toBeNull()
  })
})

describe('App (notify-ui) — remount inside the shell', () => {
  it('a remounted App reloads the route of the URL it is mounted at, not the one it last showed', async () => {
    window.history.pushState(null, '', '/notify')
    const first = render(<App />)
    expect(await screen.findByTestId('notify-center-heading')).not.toBeNull()
    first.unmount()

    window.history.pushState(null, '', '/notify/whatever')
    render(<App />)

    expect(await screen.findByTestId('notify-not-found-page')).not.toBeNull()
    expect(screen.queryByTestId('notify-center-heading')).toBeNull()
  })
})

// The router is released when its element leaves the document, which is reported a microtask later.
const removed = () => Promise.resolve()

describe('notify-ui — the browser history of the router is released on unmount', () => {
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
      window.history.pushState(null, '', '/notify')
      for (let i = 0; i < 5; i++) {
        const mounted = render(<App />)
        expect(await screen.findByTestId('notify-center-heading')).not.toBeNull()
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
      window.history.pushState(null, '', '/notify')
      for (let i = 0; i < 5; i++) {
        const mounted = render(
          <StrictMode>
            <App />
          </StrictMode>,
        )
        expect(await screen.findByTestId('notify-center-heading')).not.toBeNull()
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
