import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router'
import type { RouteComponent } from '@tanstack/react-router'
import MyTasksPage from './pages/MyTasksPage'
import NotFoundPage from './pages/NotFoundPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import ProjectsPage from './pages/ProjectsPage'
import QueuePage from './pages/QueuePage'

/**
 * projects-ui's inner router (specs/20261103-projects), basepath `/projects` — the
 * shell mounts this remote at its gated `/projects/$` route:
 *
 *   /projects        Projects list (T12)
 *   /projects/queue  To-start queue: won deals no project has taken (specs/20261103-projects-handoff)
 *   /projects/tasks  My tasks: project and pre-sales tasks together (specs/20261110-activities T19)
 *   /projects/$id    Project page: details, state, team, purchase order or terms (T13, T14, T30)
 *
 * The routes below are relative to the basepath. No auth guard and no chrome
 * (ADR 20260709-suite-frontend-module-federation). `Root` is the layout seam: App.tsx passes `ProjectsShell`; tests
 * may render a page under a bare `<Outlet/>`.
 */
export function createAppRouter(basepath?: string, Root: RouteComponent = Outlet) {
  const rootRoute = createRootRoute({ component: Root })

  const listRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: ProjectsPage })
  const queueRoute = createRoute({ getParentRoute: () => rootRoute, path: '/queue', component: QueuePage })
  const projectRoute = createRoute({ getParentRoute: () => rootRoute, path: '/$id', component: ProjectDetailPage })
  const tasksRoute = createRoute({ getParentRoute: () => rootRoute, path: '/tasks', component: MyTasksPage })

  const routeTree = rootRoute.addChildren([listRoute, queueRoute, tasksRoute, projectRoute])

  return createRouter({ routeTree, basepath, defaultNotFoundComponent: NotFoundPage })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter
  }
}
