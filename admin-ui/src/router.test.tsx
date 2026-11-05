/**
 * @vitest-environment jsdom
 *
 * Router structure + navigation tests for admin-ui's inner router (T14,
 * specs/004-auth-roles-permissions/tasks.md — "give admin-ui its inner
 * TanStack Router … done when: the four sections route client-side under
 * `/admin`"). Mirrors estimai-ui/src/router.test.tsx's technique (structural
 * assertions on the route tree + behavioral RouterProvider renders), using
 * the basepath-less `createAppRouter()` factory for these tests; App.test.tsx
 * separately covers the exposed remote's own hardcoded `/admin` basepath.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'

// SectionNav reads its "Refund" gate from shell/session's usePermissions()
// (INC-32); the stub defaults to no grants, the /rates test grants rate:read.
vi.mock('shell/session', async (importOriginal) => {
  const original = await importOriginal<typeof import('shell/session')>()
  return { ...original, usePermissions: vi.fn() }
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

/** Imports the router module fresh (cache-busted) so each test builds its own route tree/instance. */
const importRouter = () => import('./router?t=' + Date.now())

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  const session = await import('shell/session')
  vi.mocked(session.usePermissions).mockReturnValue({ epoch: 0, apps: [], roles: [], departments: [], permissions: [] })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.pushState(null, '', '/')
})

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe('router structure', () => {
  it('mounts the index redirect, the four section routes, and the detail routes (role editor, department detail, user detail) as direct children of root', async () => {
    const { createAppRouter } = await importRouter()
    const routeTree = createAppRouter().routeTree as unknown as { children?: RouteTreeNode[] }

    const childPaths = (routeTree.children ?? [])
      .map((child) => child.fullPath)
      .filter((path): path is string => path !== undefined)
      .sort()

    // Each detail screen ('/roles/$id' A2, '/departments/$id' B2, '/users/$id'
    // C2) is a sibling of its list route under the same root, not nested —
    // exactly like estimai-ui's '/estimates' + '/estimates/$estimateId' pair.
    // Combined centrally as T18/T19/T20 each added their own detail route.
    // '/rates' (Screen ADM-1, T11, specs/009-mileage-rate) is the same flat
    // shape — a fifth section route, sibling of the other four.
    expect(childPaths).toEqual(
      [
        '/',
        '/audit',
        '/departments',
        '/departments/$id',
        '/rates',
        '/roles',
        '/roles/$id',
        '/users',
        '/users/$id',
        '/users/access-requests',
        '/users/invitations',
      ].sort(),
    )
    expect(routeTree.children).toHaveLength(11)
  })

  it('has no `_authed` (or other guard) layout route in the tree — mirrors estimai-ui/T13, AC-2.3', async () => {
    const { createAppRouter } = await importRouter()
    const routeTree = createAppRouter().routeTree as unknown as { children?: RouteTreeNode[] }

    const childIds = (routeTree.children ?? []).map((child) => child.id)

    expect(childIds).not.toContain('_authed')
  })
})

// ---------------------------------------------------------------------------
// Navigation — the four sections route client-side (this task's done-when)
// ---------------------------------------------------------------------------

describe('the four sections route client-side', () => {
  it.each([
    ['/roles', 'admin-roles-page', 'Roles'],
    ['/departments', 'admin-departments-page', 'Departments'],
    ['/users', 'admin-users-page', 'Users'],
    ['/audit', 'admin-audit-page', 'Audit'],
  ] as const)('visiting %s renders its section (%s) and marks its nav link active', async (path, testId, label) => {
    window.history.pushState(null, '', path)
    const { createAppRouter } = await importRouter()
    const router = createAppRouter()

    render(<RouterProvider router={router} />)

    expect(await screen.findByTestId(testId)).not.toBeNull()

    // Scoped to the "Admin sections" landmark specifically — the Users
    // section (T10, specs/006-user-invitations) additionally renders its own
    // UsersSubNav ("Active users"/"Invitations") landmark, which must not be
    // confused with SectionNav's four top-level links here.
    const sectionNav = screen.getByRole('navigation', { name: 'Admin sections' })
    const activeLink = within(sectionNav).getByRole('link', { name: label })
    expect(activeLink.getAttribute('aria-current')).toBe('page')

    // The other three sections' links are present but not active.
    const allLinks = within(sectionNav).getAllByRole('link')
    const inactiveLinks = allLinks.filter((link) => link !== activeLink)
    expect(inactiveLinks).toHaveLength(3)
    inactiveLinks.forEach((link) => expect(link.getAttribute('aria-current')).toBeNull())
  })

  it('visiting /users/invitations renders Screen U2 (InvitationsPage), not the /users/$id detail route (static-vs-dynamic-segment precedence, design.md Screen U2)', async () => {
    window.history.pushState(null, '', '/users/invitations')
    const { createAppRouter } = await importRouter()
    const router = createAppRouter()

    render(<RouterProvider router={router} />)

    expect(await screen.findByTestId('admin-invitations-page')).not.toBeNull()
    expect(screen.queryByTestId('admin-user-detail-page')).toBeNull()
  })

  it('visiting /users/access-requests renders the Access requests page, not the /users/$id detail route (specs/023, AC-3.1)', async () => {
    window.history.pushState(null, '', '/users/access-requests')
    const { createAppRouter } = await importRouter()
    const router = createAppRouter()

    render(<RouterProvider router={router} />)

    expect(await screen.findByTestId('admin-access-requests-page')).not.toBeNull()
    expect(screen.queryByTestId('admin-user-detail-page')).toBeNull()
  })

  it('root ("/") redirects to /roles', async () => {
    window.history.pushState(null, '', '/')
    const { createAppRouter } = await importRouter()
    const router = createAppRouter()

    render(<RouterProvider router={router} />)

    await screen.findByTestId('admin-roles-page')
    expect(window.location.pathname).toBe('/roles')
  })

  it('an unmatched path renders the not-found fallback, with the section nav still mounted', async () => {
    window.history.pushState(null, '', '/nonexistent')
    const { createAppRouter } = await importRouter()
    const router = createAppRouter()

    render(<RouterProvider router={router} />)

    expect(await screen.findByTestId('admin-not-found-page')).not.toBeNull()
    // Chrome (nav) is not replaced by the not-found fallback.
    expect(screen.getByRole('navigation', { name: 'Admin sections' })).not.toBeNull()
    expect(screen.getAllByRole('link')).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// /rates — Screen ADM-1 (T11, specs/009-mileage-rate). A separate describe
// block (not folded into the it.each table above) because reaching it with
// its nav link ACTIVE requires `usePermissions()` to hold `rate:read` —
// every other test above relies on the `beforeEach` default (no grants,
// Refund stays hidden); this test overrides that default locally.
// ---------------------------------------------------------------------------

describe('/rates section (T11, specs/009-mileage-rate)', () => {
  it('with rate:read granted, visiting /rates renders MileageRatesPage and activates the "Refund" nav link', async () => {
    const grants = {
      epoch: 1,
      apps: ['admin'],
      roles: ['admin'],
      departments: [],
      permissions: [
        { resource: 'rate', action: 'read', conditions: null },
        { resource: 'rate', action: 'manage', conditions: null },
      ],
    }
    const session = await import('shell/session')
    vi.mocked(session.usePermissions).mockReturnValue(grants)

    window.history.pushState(null, '', '/rates')
    const { createAppRouter } = await importRouter()
    const router = createAppRouter()

    render(<RouterProvider router={router} />)

    expect(await screen.findByTestId('admin-rates-page')).not.toBeNull()

    const sectionNav = screen.getByRole('navigation', { name: 'Admin sections' })
    const activeLink = await within(sectionNav).findByRole('link', { name: 'Refund' })
    expect(activeLink.getAttribute('aria-current')).toBe('page')
  })
})
