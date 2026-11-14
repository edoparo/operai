import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
import { ToolLayout } from '@operai/ui'
import NotificationCenterPage from './pages/NotificationCenterPage'
import NotFoundPage from './pages/NotFoundPage'
import { strings } from './strings'

// ---------------------------------------------------------------------------
// createAppRouter — factory, not a module-scope singleton (T14,
// specs/20260713-notification-center/tasks.md — "give notify-ui its inner
// TanStack Router (basepath `/notify`)"). Mirrors estimai-ui/src/router.tsx's
// T12 (specs/20260709-suite-shell) and admin-ui/src/router.tsx's T14
// (specs/20260713-auth-roles-permissions) factories exactly, same shape:
//
//   - Standalone (dev/test bootstrap, src/main.tsx): createAppRouter() with
//     no basepath — routes resolve at the document root.
//   - As a federated remote (src/App.tsx, exposed as `./App`, per
//     vite.config.ts): the shell mounts notify-ui under `/notify/*`, so
//     createAppRouter('/notify') rebases the SAME route definitions under
//     that prefix.
//
// The route tree is built fresh inside the factory (not at module scope) so
// two router instances — one per basepath — never share mutable route-tree
// state, same reasoning as every other remote's router.
//
// No `_authed` (or `access`) guard here — same rationale as every other
// remote's inner router (estimai-ui/admin-ui/refund-ui, ADR 20260709-suite-frontend-module-federation): the
// shell's own `_authed` guard already runs before notify-ui is ever mounted.
// Unlike admin-ui, there is also no per-tool `access` guard to add later —
// plan.md/ADR 20260713-authz-hand-rolled-rbac-abac-epoch-claims deliberately keep `/notify` reachable by any signed-in
// user (every user has notifications), not gated behind app access.
//
// Unlike admin-ui (four sections) or estimai-ui (list/editor/share), the
// notification center is a single, flat screen (design.md "Notification
// center page" — "a simple root ... but with no sub-navigation, this is a
// single, flat screen, not a sectioned tool"). So there is exactly one real
// route (the index) plus the router-wide not-found fallback for any other
// path — no sibling section/detail routes to add.
//
// T14 ships only this router + NotificationCenterPage as an empty/placeholder
// page shell (this task's explicit scope — "empty/placeholder notification-
// center page is fine; the real page is T15"). T15 replaces the placeholder
// body with the actual list/empty/loading/error states and the "mark all as
// read" control (plan.md "Architecture → notify-ui" / design.md).
// ---------------------------------------------------------------------------

export function createAppRouter(basepath?: string) {
  // The tool frame (INC-12): ToolLayout's title is the page's one h1; each
  // page (center, not-found) starts with its own h2.
  const rootRoute = createRootRoute({
    component: () => (
      <ToolLayout title={strings.toolTitle} testId="notify-tool-layout">
        <Outlet />
      </ToolLayout>
    ),
  })

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: NotificationCenterPage,
  })

  const routeTree = rootRoute.addChildren([indexRoute])

  // `defaultNotFoundComponent` is the router-wide fallback for any path that
  // doesn't match the index route above (TanStack Router's own "not-found
  // route" mechanism — no explicit catch-all/splat route needed for this) —
  // mirrors admin-ui/src/router.tsx's identical use.
  return createRouter({ routeTree, basepath, defaultNotFoundComponent: NotFoundPage })
}

export type AppRouter = ReturnType<typeof createAppRouter>

// TypeScript registration
declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}
