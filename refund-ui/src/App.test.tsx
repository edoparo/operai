/**
 * @vitest-environment jsdom
 *
 * Component tests for App.tsx — refund-ui's exposed `./App` (T14,
 * specs/007-refund-service/tasks.md).
 *
 * The T15/specs/003 placeholder's tests (heading + coming-soon copy + shared-
 * session demonstration) are superseded: T14 replaces that static
 * placeholder with refund-ui's own inner TanStack Router (src/router.tsx),
 * rebased to basepath `/refund` (src/App.tsx's `createAppRouter('/refund')`).
 * This file proves the EXACT exposed component — with its hardcoded
 * `/refund` basepath — mounts and resolves under that prefix; src/router.test.tsx
 * separately covers the router's structure and per-route navigation using
 * the basepath-less factory (mirrors admin-ui's App.test.tsx/router.test.tsx
 * split).
 *
 * `shell/tokens.css` is a side-effect-only import — vitest.config.ts's
 * `resolve.alias` points the bare specifier at a real (empty) local stub so
 * Vite's import-analysis is satisfied; nothing to assert on for it here.
 * `shell/session` is mocked because `RefundShell`'s nav uses `<Link>`, which
 * needs no session data, but this remote's federation contract still routes
 * every import through the same stubbed specifiers as every other test file
 * in this package (see vitest.config.ts's `resolve.alias`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'

const { default: App } = await import('./App')

afterEach(() => {
  cleanup()
  window.history.pushState(null, '', '/')
})

describe('App (refund-ui, mounted under /refund)', () => {
  it('landing on /refund redirects to /refund/requests and renders the shell + My requests placeholder', async () => {
    window.history.pushState(null, '', '/refund')

    render(<App />)

    expect(await screen.findByTestId('refund-my-requests-page')).not.toBeNull()
    expect(window.location.pathname).toBe('/refund/requests')
    expect(screen.getByRole('heading', { name: /^refund$/i })).not.toBeNull()
  })

  it('nav links carry the /refund basepath in their href', async () => {
    window.history.pushState(null, '', '/refund')

    render(<App />)
    await screen.findByTestId('refund-my-requests-page')

    expect(screen.getByRole('link', { name: 'My requests' }).getAttribute('href')).toBe('/refund/requests')
    expect(screen.getByRole('link', { name: 'Review queue' }).getAttribute('href')).toBe('/refund/review')
  })

  it('deep-linking to /refund/review renders the review queue placeholder directly, not the redirect target', async () => {
    window.history.pushState(null, '', '/refund/review')

    render(<App />)

    expect(await screen.findByTestId('refund-review-queue-page')).not.toBeNull()
    expect(screen.queryByTestId('refund-my-requests-page')).toBeNull()
  })

  it('deep-linking to a request detail resolves the $id param under the /refund basepath', async () => {
    window.history.pushState(null, '', '/refund/requests/req-123')

    render(<App />)

    expect(await screen.findByTestId('refund-request-detail-page')).not.toBeNull()
    expect(screen.getByTestId('refund-request-detail-id').textContent).toBe('req-123')
  })

  it('an unmatched path renders the not-found fallback, with the nav still mounted', async () => {
    window.history.pushState(null, '', '/refund/nonexistent')

    render(<App />)

    expect(await screen.findByTestId('refund-not-found-page')).not.toBeNull()
    expect(screen.getByRole('navigation', { name: 'Refund navigation' })).not.toBeNull()
  })
})

describe('App (refund-ui) — remount inside the shell', () => {
  it('a remounted App reloads the route of the URL it is mounted at, not the one it last showed', async () => {
    window.history.pushState(null, '', '/refund/review')
    const first = render(<App />)
    expect(await screen.findByTestId('refund-review-queue-page')).not.toBeNull()
    first.unmount()

    window.history.pushState(null, '', '/refund/requests/req-9')
    render(<App />)

    expect(await screen.findByTestId('refund-request-detail-page')).not.toBeNull()
    expect(screen.queryByTestId('refund-review-queue-page')).toBeNull()
  })
})

describe('refund-ui — the browser history of the router is released on unmount', () => {
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
      window.history.pushState(null, '', '/refund/review')
      for (let i = 0; i < 5; i++) {
        const mounted = render(<App />)
        expect(await screen.findByTestId('refund-review-queue-page')).not.toBeNull()
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
      window.history.pushState(null, '', '/refund/review')
      for (let i = 0; i < 5; i++) {
        const mounted = render(
          <StrictMode>
            <App />
          </StrictMode>,
        )
        expect(await screen.findByTestId('refund-review-queue-page')).not.toBeNull()
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
