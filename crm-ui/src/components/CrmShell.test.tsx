/**
 * @vitest-environment jsdom
 *
 * CrmShell (specs/20261101-crm plan.md § UI): the tool frame stays on screen while
 * `GET /scope` loads, fails (warning banner; the 503 auth-unavailable variant;
 * 403 PermissionDenied) or succeeds (the routed page, with the scope handed
 * down through ScopeContext).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { useCrmCapabilities } from '../hooks/scopeContext'
import { fakeApi } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

import CrmShell from './CrmShell'

function ScopeProbe() {
  const { dealEntities, canErase } = useCrmCapabilities()
  return <p>{`scope ${dealEntities.join(',') || 'none'} erase ${canErase}`}</p>
}

const renderShell = async (scope: FakeHandler) => {
  apiFetch.mockImplementation(fakeApi({ 'GET /scope': scope }))
  window.history.pushState(null, '', '/companies')
  const rootRoute = createRootRoute({ component: CrmShell })
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/companies', component: ScopeProbe }),
    createRoute({ getParentRoute: () => rootRoute, path: '/contacts', component: () => null }),
    createRoute({ getParentRoute: () => rootRoute, path: '/pipeline', component: () => null }),
    createRoute({ getParentRoute: () => rootRoute, path: '/tasks', component: () => null }),
    createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: () => null }),
  ])
  render(<RouterProvider router={createRouter({ routeTree })} />)
  await screen.findByRole('heading', { level: 1, name: 'CRM' })
}

beforeEach(() => {
  window.scrollTo = () => undefined
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('CrmShell', () => {
  it('shows the tabs, the current one marked as the page, and Settings to a deal:manage holder', async () => {
    await renderShell(() => ({ status: 200, body: { deal: ['welld_ch'], canErase: false } }))
    const nav = screen.getByRole('navigation', { name: 'CRM sections' })
    const links = Array.from(nav.querySelectorAll('a'))
    expect(links.map((link) => link.textContent)).toEqual(['Companies', 'Contacts', 'Pipeline', 'Tasks', 'Settings'])
    expect(links[0]!.getAttribute('aria-current')).toBe('page')
  })

  it('hides the Settings tab from a caller who manages no deals', async () => {
    await renderShell(() => ({ status: 200, body: { deal: [], canErase: false } }))
    const nav = screen.getByRole('navigation', { name: 'CRM sections' })
    expect(Array.from(nav.querySelectorAll('a')).map((link) => link.textContent)).toEqual([
      'Companies',
      'Contacts',
      'Pipeline',
      'Tasks',
    ])
  })

  it('renders the page with the scope once GET /scope answers', async () => {
    await renderShell(() => ({ status: 200, body: { deal: ['welld_ch', 'welld_it'], canErase: true } }))
    expect(await screen.findByText('scope welld_ch,welld_it erase true')).not.toBeNull()
  })

  it('shows the loading state while the scope loads', async () => {
    await renderShell(() => new Promise(() => {}))
    expect(screen.getByTestId('crm-loading')).not.toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Loading the CRM…')
  })

  it('a 503 shows the authorization-unavailable banner, and Retry loads again', async () => {
    let calls = 0
    await renderShell(() => {
      calls += 1
      return calls === 1
        ? { status: 503, body: { status: 503, title: 'Service Unavailable', detail: 'auth down' } }
        : { status: 200, body: { deal: [], canErase: false } }
    })
    const banner = await screen.findByTestId('crm-load-error')
    expect(banner.textContent).toContain('Authorization service unavailable')
    fireEvent.click(screen.getByTestId('crm-load-error-retry'))
    expect(await screen.findByText('scope none erase false')).not.toBeNull()
  })

  it('a 403 replaces the page with PermissionDenied', async () => {
    await renderShell(() => ({ status: 403, body: { status: 403, title: 'Forbidden', detail: 'no' } }))
    expect(await screen.findByTestId('crm-permission-denied')).not.toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'CRM' })).not.toBeNull()
  })
})
