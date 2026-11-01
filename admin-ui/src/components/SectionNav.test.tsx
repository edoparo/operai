/**
 * @vitest-environment jsdom
 *
 * Component tests for SectionNav (T14, specs/004-auth-roles-permissions/tasks.md;
 * T11, specs/009-mileage-rate — the proactive `rate:read` gate).
 *
 * Uses a real, minimal TanStack Router harness (mirrors
 * shell/src/components/Sidebar.test.tsx's own technique exactly, same
 * rationale: the whole point of "aria-current on the active section" is
 * that it comes from the ACTUAL current route via `<Link>`'s own
 * active-match mechanism, so a mocked router would test nothing real).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import SectionNav from './SectionNav'

// ---------------------------------------------------------------------------
// Module mock — `shell/session`'s usePermissions() (INC-32): SectionNav reads
// the caller's effective permissions from the shell to decide whether the
// "Refund" entry appears (design.md F7). `beforeEach` defaults to the shell's
// EMPTY_PERMISSIONS (no grants) so the structural tests see the four links;
// the "Refund" gate block below overrides it per test.
// ---------------------------------------------------------------------------

vi.mock('shell/session', async (importOriginal) => {
  const original = await importOriginal<typeof import('shell/session')>()
  return { ...original, usePermissions: vi.fn() }
})

const NO_GRANTS = { epoch: 0, apps: [], roles: [], departments: [], permissions: [] }

const grant = (permissions: { resource: string; action: string; conditions?: unknown }[]) => ({
  epoch: 1,
  apps: ['admin'],
  roles: ['admin'],
  departments: [],
  permissions,
})

beforeEach(async () => {
  const session = await import('shell/session')
  vi.mocked(session.usePermissions).mockReturnValue(NO_GRANTS)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

/** Builds a tiny router — SectionNav + Outlet at root, one leaf route per section. */
async function renderNavAt(path: string) {
  window.history.pushState(null, '', path)

  const rootRoute = createRootRoute({
    component: () => (
      <>
        <SectionNav />
        <Outlet />
      </>
    ),
  })
  const rolesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/roles', component: () => <p>roles</p> })
  const departmentsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/departments',
    component: () => <p>departments</p>,
  })
  const usersRoute = createRoute({ getParentRoute: () => rootRoute, path: '/users', component: () => <p>users</p> })
  const auditRoute = createRoute({ getParentRoute: () => rootRoute, path: '/audit', component: () => <p>audit</p> })
  const ratesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/rates', component: () => <p>rates</p> })
  const routeTree = rootRoute.addChildren([rolesRoute, departmentsRoute, usersRoute, auditRoute, ratesRoute])
  const router = createRouter({ routeTree })
  const utils = render(<RouterProvider router={router} />)
  await screen.findByRole('link', { name: 'Roles' })
  return utils
}

describe('SectionNav structure', () => {
  it('renders a real nav landmark labelled "Admin sections"', async () => {
    await renderNavAt('/roles')

    expect(screen.getByRole('navigation', { name: 'Admin sections' })).not.toBeNull()
  })

  it('renders the four sections, in IA order, as real links (not buttons/divs)', async () => {
    await renderNavAt('/roles')

    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Roles', 'Departments', 'Users', 'Audit'])
    links.forEach((link) => expect(link.tagName).toBe('A'))
  })
})

describe('SectionNav active state (aria-current)', () => {
  it('marks Roles active with aria-current="page" when on /roles, no other section active', async () => {
    await renderNavAt('/roles')

    expect(screen.getByRole('link', { name: 'Roles' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Departments' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: 'Users' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: 'Audit' }).getAttribute('aria-current')).toBeNull()
  })

  it('marks Audit active with aria-current="page" when on /audit', async () => {
    await renderNavAt('/audit')

    expect(screen.getByRole('link', { name: 'Audit' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Roles' }).getAttribute('aria-current')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Mileage Rates gate (T11, specs/009-mileage-rate, design.md F7 — the first
// capability-driven proactive UI hide in this app)
// ---------------------------------------------------------------------------

describe('SectionNav "Refund" gate (T11, specs/009-mileage-rate)', () => {
  it('hides "Refund" by default (no grant resolved yet / resolved with no rate:read)', async () => {
    await renderNavAt('/roles')

    expect(screen.queryByRole('link', { name: 'Refund' })).toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(4)
  })

  it('inserts "Refund" when the shell permissions include rate:read, with Audit anchored last', async () => {
    const session = await import('shell/session')
    vi.mocked(session.usePermissions).mockReturnValue(grant([{ resource: 'rate', action: 'read', conditions: null }]))

    await renderNavAt('/roles')

    const link = await screen.findByRole('link', { name: 'Refund' })
    expect(link.tagName).toBe('A')
    // Refund joins the left group (after Users); Audit stays anchored to the far right.
    expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Roles',
      'Departments',
      'Users',
      'Refund',
      'Audit',
    ])
  })

  it('marks "Refund" active with aria-current="page" when on /rates', async () => {
    const session = await import('shell/session')
    vi.mocked(session.usePermissions).mockReturnValue(grant([{ resource: 'rate', action: 'read', conditions: null }]))

    await renderNavAt('/rates')

    const link = await screen.findByRole('link', { name: 'Refund' })
    expect(link.getAttribute('aria-current')).toBe('page')
  })

  it('stays hidden when the permissions grant an unrelated permission but not rate:read', async () => {
    const session = await import('shell/session')
    vi.mocked(session.usePermissions).mockReturnValue(grant([{ resource: 'role', action: 'edit', conditions: null }]))

    await renderNavAt('/roles')

    expect(screen.queryByRole('link', { name: 'Refund' })).toBeNull()
  })

  it('fails closed (stays hidden) on the shell EMPTY_PERMISSIONS — its result for any /authz/me failure', async () => {
    await renderNavAt('/roles')

    await waitFor(() => {
      expect(screen.getAllByRole('link')).toHaveLength(4)
    })
    expect(screen.queryByRole('link', { name: 'Refund' })).toBeNull()
  })

  it('reads permissions only through shell/session — no fetch of its own (INC-32)', async () => {
    const session = await import('shell/session')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await renderNavAt('/roles')

    expect(vi.mocked(session.usePermissions)).toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
