/**
 * @vitest-environment jsdom
 *
 * LetterheadsShell (design F1): the tool title stays on screen while `GET /v1/catalog` and
 * `GET /v1/letterheads` load, fail (warning banner; the 503 auth-unavailable variant; 403
 * PermissionDenied) or succeed (the routed page, with both answers handed down through
 * `useLetterheads`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { useLetterheads } from '../hooks/useLetterheads'
import { catalog, fakeApi, letterheadList, problem } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getLetterheadsApiBaseUrl: () => 'http://letterhead-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

import LetterheadsShell from './LetterheadsShell'

function Probe() {
  const { letterheads, catalog: loaded, refresh } = useLetterheads()
  return (
    <>
      <p>
        {`it ${letterheads.welld_it.activeVersion} ${letterheads.welld_it.canManage} ch ${letterheads.welld_ch.activeVersion} catalog ${Object.keys(loaded).length}`}
      </p>
      <button type="button" onClick={() => void refresh?.()}>
        refresh
      </button>
      <button type="button" onClick={() => void refresh?.({ entity: 'welld_it', activeVersion: 9 })}>
        refresh knowing
      </button>
    </>
  )
}

const renderShell = async (routes: Record<string, FakeHandler>) => {
  apiFetch.mockImplementation(fakeApi(routes))
  window.history.pushState(null, '', '/')
  const rootRoute = createRootRoute({ component: LetterheadsShell })
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/', component: Probe }),
  ])
  render(<RouterProvider router={createRouter({ routeTree })} />)
  await screen.findByRole('heading', { level: 1, name: 'Letterheads' })
}

const ok: Record<string, FakeHandler> = {
  'GET /v1/catalog': () => ({ status: 200, body: catalog() }),
  'GET /v1/letterheads': () => ({
    status: 200,
    body: letterheadList({ welld_it: { activeVersion: 3, canManage: true } }),
  }),
}

beforeEach(() => {
  window.scrollTo = () => undefined
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('LetterheadsShell', () => {
  it('hands the catalog and the list of both entities to the page once both answer', async () => {
    await renderShell(ok)
    expect(await screen.findByText('it 3 true ch null catalog 2')).not.toBeNull()
    const urls = apiFetch.mock.calls.map(([url]) => String(url)).sort()
    expect(urls).toEqual(['http://letterhead-api.test/v1/catalog', 'http://letterhead-api.test/v1/letterheads'])
  })

  it('keeps the title (h1) on screen and says it is loading until the answers arrive', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    await renderShell({
      ...ok,
      'GET /v1/letterheads': async () => {
        await gate
        return { status: 200, body: letterheadList() }
      },
    })
    expect(screen.getByTestId('letterheads-loading')).not.toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Loading letterheads…')
    release()
    expect(await screen.findByText('it null false ch null catalog 2')).not.toBeNull()
  })

  it('shows PermissionDenied on a 403, with no retry', async () => {
    await renderShell({ ...ok, 'GET /v1/catalog': () => problem(403, 'forbidden') })
    expect(await screen.findByTestId('letterheads-permission-denied')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Letterheads' })).not.toBeNull()
  })

  it('shows the authorization-unavailable banner with Retry on a 503, and loads again on Retry', async () => {
    let fail = true
    await renderShell({
      ...ok,
      'GET /v1/letterheads': () => (fail ? problem(503, 'authz_unavailable') : { status: 200, body: letterheadList() }),
    })
    const banner = await screen.findByTestId('letterheads-load-error')
    expect(banner.textContent).toContain('Authorization service unavailable')
    fail = false
    fireEvent.click(screen.getByTestId('letterheads-load-error-retry'))
    expect(await screen.findByText('it null false ch null catalog 2')).not.toBeNull()
  })

  it('shows the Problem detail in a warning banner for any other failure', async () => {
    await renderShell({ ...ok, 'GET /v1/catalog': () => problem(500, undefined, {}, 'The catalog is broken.') })
    const banner = await screen.findByTestId('letterheads-load-error')
    expect(banner.textContent).toContain('Could not load')
    expect(banner.textContent).toContain('The catalog is broken.')
  })

  it('words a network failure as such', async () => {
    apiFetch.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')))
    window.history.pushState(null, '', '/')
    const rootRoute = createRootRoute({ component: LetterheadsShell })
    const routeTree = rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: '/', component: Probe }),
    ])
    render(<RouterProvider router={createRouter({ routeTree })} />)
    const banner = await screen.findByTestId('letterheads-load-error')
    expect(banner.textContent).toContain('The server could not be reached')
  })

  it('refreshes the list behind the page (T24): no loading state, the answer replaces the old one', async () => {
    let version = 3
    await renderShell({
      ...ok,
      'GET /v1/letterheads': () => ({
        status: 200,
        body: letterheadList({ welld_it: { activeVersion: version, canManage: true } }),
      }),
    })
    await screen.findByText('it 3 true ch null catalog 2')
    version = 4
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    expect(screen.queryByTestId('letterheads-loading')).toBeNull()
    expect(await screen.findByText('it 4 true ch null catalog 2')).not.toBeNull()
    // The catalog is not asked for again.
    expect(apiFetch.mock.calls.filter(([url]) => String(url).endsWith('/v1/catalog'))).toHaveLength(1)
  })

  it('applies what the person just did at once, and keeps it when the refreshed list cannot be read', async () => {
    let fail = false
    await renderShell({
      ...ok,
      'GET /v1/letterheads': () =>
        fail
          ? problem(503, 'service_unavailable')
          : { status: 200, body: letterheadList({ welld_it: { activeVersion: 3, canManage: true } }) },
    })
    await screen.findByText('it 3 true ch null catalog 2')
    fail = true
    fireEvent.click(screen.getByRole('button', { name: 'refresh knowing' }))
    expect(await screen.findByText('it 9 true ch null catalog 2')).not.toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(screen.getByText('it 9 true ch null catalog 2')).not.toBeNull()
    expect(screen.queryByTestId('letterheads-load-error')).toBeNull()
  })

  it('lets the answer of the refresh have the last word over what the person did', async () => {
    await renderShell({
      ...ok,
      'GET /v1/letterheads': () => ({
        status: 200,
        body: letterheadList({ welld_it: { activeVersion: 3, canManage: false } }),
      }),
    })
    await screen.findByText('it 3 false ch null catalog 2')
    fireEvent.click(screen.getByRole('button', { name: 'refresh knowing' }))
    await waitFor(() =>
      expect(apiFetch.mock.calls.filter(([url]) => String(url).endsWith('/v1/letterheads'))).toHaveLength(2),
    )
    await waitFor(() => expect(screen.getByText('it 3 false ch null catalog 2')).not.toBeNull())
  })
})
