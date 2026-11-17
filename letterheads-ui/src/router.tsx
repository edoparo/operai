import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
import type { RouteComponent } from '@tanstack/react-router'
import ConfiguratorPage from './pages/ConfiguratorPage'
import NotFoundPage from './pages/NotFoundPage'

/**
 * letterheads-ui's inner router (specs/20261116-letterhead-service), basepath `/letterheads` — the
 * shell mounts this remote at its gated `/letterheads/$` route:
 *
 *   /letterheads   the configurator (one page; the entity, the version and the view are search params, design S1)
 *
 * The routes below are relative to the basepath. Any other path is the not-found panel (design S11).
 * No auth guard and no chrome (ADR 20260709-suite-frontend-module-federation). `Root` is the layout seam: App.tsx passes
 * `LetterheadsShell`; tests may render a page under a bare `<Outlet/>`.
 */
export function createAppRouter(basepath?: string, Root: RouteComponent = Outlet) {
  const rootRoute = createRootRoute({ component: Root })

  const configuratorRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: ConfiguratorPage })

  const routeTree = rootRoute.addChildren([configuratorRoute])

  return createRouter({ routeTree, basepath, defaultNotFoundComponent: NotFoundPage })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}
