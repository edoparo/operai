/**
 * @vitest-environment jsdom
 *
 * Component tests for UsersSubNav (T10, specs/006-user-invitations).
 *
 * Mirrors SectionNav.test.tsx's technique exactly (real minimal TanStack
 * Router harness — the whole point of "aria-current on the active view"
 * is that it comes from the actual current route via `<Link>`'s own
 * active-match mechanism, so a mocked router tests nothing real).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import UsersSubNav from './UsersSubNav'

afterEach(() => {
  cleanup()
  window.history.pushState(null, '', '/')
})

async function renderNavAt(path: string) {
  window.history.pushState(null, '', path)

  const rootRoute = createRootRoute({
    component: () => (
      <>
        <UsersSubNav />
        <Outlet />
      </>
    ),
  })
  const usersRoute = createRoute({ getParentRoute: () => rootRoute, path: '/users', component: () => <p>active</p> })
  const invitationsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/users/invitations',
    component: () => <p>invitations</p>,
  })
  const accessRequestsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/users/access-requests',
    component: () => <p>access requests</p>,
  })
  const routeTree = rootRoute.addChildren([usersRoute, invitationsRoute, accessRequestsRoute])
  const router = createRouter({ routeTree })
  const utils = render(<RouterProvider router={router} />)
  await screen.findByRole('link', { name: 'Active users' })
  return utils
}

describe('UsersSubNav structure', () => {
  it('renders a real nav landmark labelled "Users section views"', async () => {
    await renderNavAt('/users')

    expect(screen.getByRole('navigation', { name: 'Users section views' })).not.toBeNull()
  })

  it('renders the three views, in order, as real links', async () => {
    await renderNavAt('/users')

    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['Active users', 'Invitations', 'Access requests'])
    links.forEach((link) => expect(link.tagName).toBe('A'))
  })
})

describe('UsersSubNav test ids', () => {
  it('gives every view its own explicit test id (no duplicates)', async () => {
    await renderNavAt('/users')

    expect(screen.getByRole('link', { name: 'Active users' }).getAttribute('data-testid')).toBe('users-subnav-active')
    expect(screen.getByRole('link', { name: 'Invitations' }).getAttribute('data-testid')).toBe(
      'users-subnav-invitations',
    )
    expect(screen.getByRole('link', { name: 'Access requests' }).getAttribute('data-testid')).toBe(
      'users-subnav-access-requests',
    )
  })
})

describe('UsersSubNav active state (aria-current)', () => {
  it('marks "Active users" current on /users, not "Invitations"', async () => {
    await renderNavAt('/users')

    expect(screen.getByRole('link', { name: 'Active users' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Invitations' }).getAttribute('aria-current')).toBeNull()
  })

  it('marks "Invitations" current on /users/invitations, not "Active users" (exact-match guard)', async () => {
    await renderNavAt('/users/invitations')

    expect(screen.getByRole('link', { name: 'Invitations' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Active users' }).getAttribute('aria-current')).toBeNull()
  })

  it('marks only "Access requests" current on /users/access-requests', async () => {
    await renderNavAt('/users/access-requests')

    expect(screen.getByRole('link', { name: 'Access requests' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Active users' }).getAttribute('aria-current')).toBeNull()
    expect(screen.getByRole('link', { name: 'Invitations' }).getAttribute('aria-current')).toBeNull()
  })
})
