import 'shell/tokens.css'
import { useState, useSyncExternalStore } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import ProjectsShell from './components/ProjectsShell'
import { createAppRouter, type AppRouter } from './router'

// The exposed remote MUST NOT import its own index.css: the shell owns the one
// Tailwind sheet of the suite (ADR-0006 addendum, ADR-0051). Only the
// standalone bootstrap (main.tsx) imports index.css.

const BASEPATH = '/projects'

/**
 * The router of one mount (specs/022 AC-6.1, D52). A router created once at module
 * load outlives every unmount: its browser history keeps listening to the whole
 * window, so it would match another module's address (`/admin` is `/$id`, a project
 * named "admin") and render that match when the shell mounts the module again.
 * So the router is made when the module mounts and its history destroyed (listeners
 * and `pushState` patch included) when it unmounts.
 *
 * It also ignores the browser's address while that address is not the module's own:
 * between the shell moving the URL to another module and unmounting this one (the
 * other module is still loading) nothing here routes it, so no page, and no request,
 * comes from an address that is not ours.
 */
function createOwnRouter(): AppRouter {
  const router = createAppRouter(BASEPATH, ProjectsShell)
  const subscribe = router.history.subscribe
  router.history.subscribe = (listener) =>
    subscribe((event) => {
      const path = event.location.pathname.toLowerCase()
      if (path === BASEPATH || path.startsWith(`${BASEPATH}/`)) listener(event)
    })
  return router
}

/**
 * The router as an external store whose subscription is the mount: React subscribes
 * after it commits and unsubscribes when it unmounts, and strict mode's mount,
 * unmount, mount leaves exactly one router with its history listening.
 */
function ownRouterMount() {
  let router: AppRouter | null = null
  return {
    subscribe: (onChange: () => void) => {
      router = createOwnRouter()
      onChange()
      return () => {
        router?.history.destroy()
        router = null
      }
    },
    getRouter: () => router,
  }
}

/**
 * App — projects-ui's gated tool root, exposed via Module Federation as `./App`
 * (vite.config.ts) and mounted by the shell at the access-gated `/projects/*`
 * (specs/021-projects). An inner TanStack Router rebased to `/projects`, with
 * `ProjectsShell` as its root layout; no auth guard and no chrome (the shell
 * owns both).
 */
export default function App() {
  const [mount] = useState(ownRouterMount)
  const router = useSyncExternalStore(mount.subscribe, mount.getRouter)
  return router ? <RouterProvider router={router} /> : null
}
