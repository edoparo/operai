import 'shell/tokens.css'
import { RouterProvider } from '@tanstack/react-router'
import { useDisposableRouter } from '@operai/ui'
import ProjectsShell from './components/ProjectsShell'
import { createAppRouter } from './router'

// The exposed remote MUST NOT import its own index.css: the shell owns the one
// Tailwind sheet of the suite (ADR-0006 addendum, ADR-0051). Only the
// standalone bootstrap (main.tsx) imports index.css.

/**
 * App — projects-ui's gated tool root, exposed via Module Federation as `./App`
 * (vite.config.ts) and mounted by the shell at the access-gated `/projects/*`
 * (specs/025-projects). An inner TanStack Router rebased to `/projects`, with
 * `ProjectsShell` as its root layout; no auth guard and no chrome (the shell
 * owns both).
 */

// The router is built per mount, not once at module scope: the shell unmounts the
// remote when the user leaves it and mounts it again on return, and a router
// instance that has already been mounted does not reload on a second mount
// (@tanstack/react-router >= 1.170.46), so it would show the route it last had
// instead of the URL the user returned to.
// It is also destroyed on unmount: a router's browser history wraps window.history and adds window
// listeners that only `history.destroy()` removes, so one per mount would pile up (specs/029 security L5).
export default function App() {
  const router = useDisposableRouter(() => createAppRouter('/projects', ProjectsShell))
  return router ? <RouterProvider router={router} /> : null
}
