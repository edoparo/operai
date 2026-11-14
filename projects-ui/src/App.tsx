import 'shell/tokens.css'
import { RouterProvider } from '@tanstack/react-router'
import ProjectsShell from './components/ProjectsShell'
import { createAppRouter } from './router'

// The exposed remote MUST NOT import its own index.css: the shell owns the one
// Tailwind sheet of the suite (ADR 20260709-suite-frontend-module-federation addendum, ADR 20261031-one-styling-dialect-token-utilities). Only the
// standalone bootstrap (main.tsx) imports index.css.

/**
 * App — projects-ui's gated tool root, exposed via Module Federation as `./App`
 * (vite.config.ts) and mounted by the shell at the access-gated `/projects/*`
 * (specs/20261103-projects). An inner TanStack Router rebased to `/projects`, with
 * `ProjectsShell` as its root layout; no auth guard and no chrome (the shell
 * owns both).
 */
const router = createAppRouter('/projects', ProjectsShell)

export default function App() {
  return <RouterProvider router={router} />
}
