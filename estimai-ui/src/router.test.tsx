/**
 * @vitest-environment jsdom
 *
 * Router structure tests for estimai-ui (T13, specs/003-suite-shell/tasks.md).
 *
 * Before T13, this file unit-tested the router's own pathless `_authed`
 * guard — a real session check that threw a full-page redirect to the
 * hosted sign-in page when no session was present (AC-1.1, spec 002). T13
 * REMOVES that guard entirely (AC-2.3): estimai-ui now runs as a federated
 * remote inside the shell (T12), and the shell's OWN `_authed` guard
 * (shell/src/router.tsx, T9) already guarantees a session before this
 * router's routes are ever reached — a second, independent sign-in redirect
 * here would violate AC-2.3 ("the tool ... does not perform its own
 * independent sign-in redirect").
 *
 * The guard-redirect coverage itself was not dropped, only relocated: it
 * lives in shell/src/router.test.tsx now, testing the identical
 * beforeLoad/redirect contract this file used to test, now owned by the
 * shell (which resolves the session via the same shared `shell/session`
 * module estimai-ui's own src/lib/authClient.ts delegates to — see
 * src/lib/authClient.test.ts for that delegation's coverage).
 *
 * What THIS file asserts is T13's own done-when: the remote's router has NO
 * `_authed` route, and its app routes (/, /estimates,
 * /estimates/$estimateId, /share) are mounted directly off the root with no
 * guarding beforeLoad — proven both structurally (route tree shape) and
 * behaviorally (visiting a guarded path with NO session/auth mocked at all
 * never redirects to sign-in).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import * as estimatesApi from './lib/estimatesApi'
import { FILTERS_STORAGE_KEY } from './lib/listFilters'

// Only `get` is replaced (the estimate route's loader); the list keeps going
// through the unmocked apiFetch stub, which rejects, as in the tests above.
vi.mock('./lib/estimatesApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/estimatesApi')>()
  return { ...original, get: vi.fn() }
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal shape of a TanStack Router route object needed for these assertions. */
interface RouteTreeNode {
  id: string
  fullPath?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Imports the router module fresh (cache-busted) so each test builds its own route tree. */
const importRouter = () => import('./router?t=' + Date.now())

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubEnv('VITE_AUTH_URL', 'http://auth.test')
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
  window.history.pushState(null, '', '/')
  sessionStorage.clear()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('router has no _authed guard (T13, AC-2.3)', () => {
  it('mounts the app routes directly off the root — no `_authed` layout route in the tree', async () => {
    const { createAppRouter } = await importRouter()
    const routeTree = createAppRouter().routeTree as unknown as { children?: RouteTreeNode[] }

    const childIds = (routeTree.children ?? []).map((child) => child.id)

    expect(childIds).not.toContain('_authed')
  })

  it('exposes the same three app routes as direct children of root, none of them guarded', async () => {
    const { createAppRouter } = await importRouter()
    const routeTree = createAppRouter().routeTree as unknown as { children?: RouteTreeNode[] }

    const childPaths = (routeTree.children ?? [])
      .map((child) => child.fullPath)
      .filter((path): path is string => path !== undefined)
      .sort()

    // `/share` was the fourth until 2026-08-09, when the anonymous link-share
    // was removed (specs/013 US-8 amendment). Asserting its ABSENCE matters:
    // that route rendered estimate content with no session at all.
    expect(childPaths).toEqual(['/', '/estimates', '/estimates/$estimateId'].sort())
    expect(childPaths).not.toContain('/share')
    // Exactly these three — no extra `_authed` (or any other) wrapper route.
    expect(routeTree.children).toHaveLength(3)
  })
})

describe('no independent sign-in redirect (T13, AC-2.3)', () => {
  it('visiting /estimates/... with no session/auth mocked at all never redirects to sign-in', async () => {
    // Deliberately do NOT mock ./lib/authClient or ./lib/api — proving the
    // route resolves with NO session check in the path at all, not merely
    // that a mocked session check passes.
    window.history.pushState(null, '', '/estimates')
    const { createAppRouter } = await importRouter()
    const router = createAppRouter()

    render(<RouterProvider router={router} />)

    // EstimatesPage mounts and announces its own loading state directly —
    // proof the route's component rendered without any sign-in redirect
    // happening first. (This used to ride on `/share`, which no longer
    // exists; `/estimates` makes the same point on a real app route.)
    await screen.findByText(/loading your estimates/i)

    expect(window.location.pathname).toBe('/estimates')
    expect(window.location.href).not.toContain('/sign-in')
  })
})

describe('the list restores its filters (specs/024 AC-2.6)', () => {
  it('entering /estimates without params restores the last choice of the session, by replace', async () => {
    sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({ whose: 'all', status: 'closed' }))
    window.history.pushState(null, '', '/estimates')
    const { createAppRouter } = await importRouter()
    const router = createAppRouter()

    render(<RouterProvider router={router} />)

    await waitFor(() => expect(router.state.location.search).toEqual({ whose: 'all', status: 'closed' }))
  })

  it('leaves an explicit URL alone: a stored choice never overrides it', async () => {
    sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({ whose: 'all' }))
    window.history.pushState(null, '', '/estimates?status=closed')
    const { createAppRouter } = await importRouter()
    const router = createAppRouter()

    render(<RouterProvider router={router} />)
    await screen.findByText(/loading your estimates/i)

    expect(router.state.location.search).toEqual({ status: 'closed' })
  })
})

describe('/estimates/$estimateId loader failures (specs/024 AC-1.7)', () => {
  it('redirects to the list on 404 — no relationship, or the permission was withdrawn (AC-1.6)', async () => {
    vi.mocked(estimatesApi.get).mockRejectedValue(
      new estimatesApi.ApiError({ type: 't', title: 'Not found', status: 404 }),
    )
    window.history.pushState(null, '', '/estimates/gone')
    const { createAppRouter } = await importRouter()
    const router = createAppRouter()

    render(<RouterProvider router={router} />)

    await waitFor(() => expect(router.state.location.pathname).toBe('/estimates'))
    expect(screen.queryByTestId('estimate-route-error')).toBeNull()
  })

  it('shows an error panel with Retry on 503 authz_unavailable instead of redirecting, and Retry loads again', async () => {
    vi.mocked(estimatesApi.get).mockRejectedValue(
      new estimatesApi.ApiError({ type: 't', title: 'Unavailable', status: 503, code: 'authz_unavailable' }),
    )
    window.history.pushState(null, '', '/estimates/someone-elses')
    const { createAppRouter } = await importRouter()
    const router = createAppRouter()

    render(<RouterProvider router={router} />)

    const panel = await screen.findByTestId('estimate-route-error')
    expect(panel.getAttribute('role')).toBe('alert')
    expect(panel.textContent).toContain('authorization service is unavailable')
    expect(router.state.location.pathname).toBe('/estimates/someone-elses')
    // A way back to the list.
    expect(screen.getByRole('link', { name: /back to estimates/i }).getAttribute('href')).toBe('/estimates')

    const calls = vi.mocked(estimatesApi.get).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }))
    await waitFor(() => expect(vi.mocked(estimatesApi.get).mock.calls.length).toBeGreaterThan(calls))
  })

  it('shows the generic error panel on any other failure (network, 500)', async () => {
    vi.mocked(estimatesApi.get).mockRejectedValue(new Error('offline'))
    window.history.pushState(null, '', '/estimates/x')
    const { createAppRouter } = await importRouter()
    const router = createAppRouter()

    render(<RouterProvider router={router} />)

    const panel = await screen.findByTestId('estimate-route-error')
    expect(panel.textContent).not.toContain('authorization service')
  })
})
