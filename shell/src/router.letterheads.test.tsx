/**
 * @vitest-environment jsdom
 *
 * Tests for the `/letterheads/$` tool route (specs/20261116-letterhead-service, T20, AC-8.1): the
 * Letterheads module appears in the suite only for holders of `letterheads:access`
 * (ADR 20260713-authz-hand-rolled-rbac-abac-epoch-claims posture), the same gate the other tools sit behind.
 *
 * Mirrors router.inventory.test.tsx: real RouterProvider, `window.history`
 * navigation, federated remotes mocked via `vi.mock`, `./router` re-imported fresh
 * per test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'

const { getSession, usePermissions, ensurePermissions, revalidatePermissions, apiFetch } = vi.hoisted(() => ({
  getSession: vi.fn(),
  usePermissions: vi.fn(),
  ensurePermissions: vi.fn(),
  revalidatePermissions: vi.fn(),
  apiFetch: vi.fn(),
}))

vi.mock('./lib/session', () => ({
  getSession,
  useSession: vi.fn(() => ({
    data: { user: { id: 'u1', email: 'consultant@welld.ch', name: 'Consultant' } },
  })),
  signOut: vi.fn(),
  usePermissions,
  ensurePermissions,
  revalidatePermissions,
  getCachedSession: vi.fn(() => null),
  getCachedPermissions: vi.fn(() => null),
  apiFetch,
  onSignOut: vi.fn(),
  getAuthBaseUrl: vi.fn(() => 'http://auth.test'),
}))

vi.mock('estimai/App', () => ({ default: () => <div data-testid="estimai-app">EstimAI mounted</div> }))
vi.mock('refund/App', () => ({ default: () => <div data-testid="refund-app">Refund mounted</div> }))
vi.mock('admin/App', () => ({ default: () => <div data-testid="admin-app">Admin mounted</div> }))
vi.mock('notify/App', () => ({ default: () => <div data-testid="notify-app">Notify mounted</div> }))
vi.mock('inventory/App', () => ({ default: () => <div data-testid="inventory-app">Inventory mounted</div> }))
vi.mock('crm/App', () => ({ default: () => <div data-testid="crm-app">CRM mounted</div> }))
vi.mock('projects/App', () => ({ default: () => <div data-testid="projects-app">Projects mounted</div> }))
vi.mock('letterheads/App', () => ({
  default: () => <div data-testid="letterheads-app">Letterheads mounted</div>,
}))

const permissionsWith = (apps: string[]) => ({
  epoch: 0,
  apps,
  roles: [],
  departments: [],
  permissions: [],
})

function grantApps(apps: string[]) {
  usePermissions.mockReturnValue(permissionsWith(apps))
  ensurePermissions.mockResolvedValue(permissionsWith(apps))
  revalidatePermissions.mockResolvedValue(permissionsWith(apps))
}

async function renderShellAt(path: string) {
  window.history.pushState(null, '', path)
  const mod = await import('./router?t=' + Date.now())
  const utils = render(<RouterProvider router={mod.router} />)
  return { router: mod.router, ...utils }
}

beforeEach(() => {
  vi.stubEnv('VITE_AUTH_URL', 'http://auth.test')
  getSession.mockResolvedValue({
    data: { user: { id: 'u1', email: 'consultant@welld.ch', name: 'Consultant' }, session: {} },
  })
  apiFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
  window.history.pushState(null, '', '/')
  localStorage.clear()
})

describe('/letterheads/$ — the access-gated tool route (AC-8.1)', () => {
  it('mounts letterheads/App for a caller granted letterheads, and records it as the last tool', async () => {
    grantApps(['letterheads'])

    const { router } = await renderShellAt('/letterheads')

    expect(await screen.findByTestId('letterheads-app')).not.toBeNull()
    expect(router.state.location.pathname).toBe('/letterheads')
    expect(localStorage.getItem('operai_last_tool')).toBe('letterheads')
  })

  it('mounts letterheads/App for a deep link below /letterheads (the entity and view are search params)', async () => {
    grantApps(['letterheads'])

    await renderShellAt('/letterheads/anything/below?entity=welld_ch&view=history')

    expect(await screen.findByTestId('letterheads-app')).not.toBeNull()
  })

  it('refuses a caller with NO grants at the route: /no-access, no Letterheads sidebar entry, nothing mounted', async () => {
    grantApps([])

    const { router } = await renderShellAt('/letterheads')

    expect(await screen.findByRole('heading', { name: 'No apps available yet' })).not.toBeNull()
    expect(router.state.location.pathname).toBe('/no-access')
    expect(screen.queryByTestId('letterheads-app')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Letterheads' })).toBeNull()
    expect(localStorage.getItem('operai_last_tool')).toBeNull()
  })

  it('refuses a caller granted another tool: sent to that tool, never to Letterheads', async () => {
    grantApps(['crm'])

    const { router } = await renderShellAt('/letterheads')

    expect(await screen.findByTestId('crm-app')).not.toBeNull()
    expect(router.state.location.pathname).toBe('/crm')
    expect(screen.queryByTestId('letterheads-app')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Letterheads' })).toBeNull()
  })

  it('does not let projects:access stand in for letterheads:access', async () => {
    grantApps(['projects'])

    const { router } = await renderShellAt('/letterheads')

    expect(await screen.findByTestId('projects-app')).not.toBeNull()
    expect(router.state.location.pathname).toBe('/projects')
    expect(screen.queryByTestId('letterheads-app')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Letterheads' })).toBeNull()
  })

  it('shows the Letterheads sidebar link only to a caller granted letterheads', async () => {
    grantApps(['estimai', 'letterheads'])
    await renderShellAt('/estimai')
    await screen.findByTestId('estimai-app')

    expect(screen.getByRole('link', { name: 'Letterheads' }).getAttribute('href')).toBe('/letterheads')
  })

  it('does not show the Letterheads sidebar link to a caller without it', async () => {
    grantApps(['estimai', 'projects'])
    await renderShellAt('/estimai')
    await screen.findByTestId('estimai-app')

    expect(screen.queryByRole('link', { name: 'Letterheads' })).toBeNull()
  })
})
