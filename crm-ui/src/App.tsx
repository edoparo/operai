import 'shell/tokens.css'
import { RouterProvider } from '@tanstack/react-router'
import CrmShell from './components/CrmShell'
import { createAppRouter } from './router'

// The exposed remote MUST NOT import its own index.css: the shell owns the one
// Tailwind sheet of the suite (ADR-0006 addendum, ADR-0051). Only the
// standalone bootstrap (main.tsx) imports index.css.

/**
 * App — crm-ui's gated tool root, exposed via Module Federation as `./App`
 * (vite.config.ts) and mounted by the shell at the access-gated `/crm/*`
 * (specs/017-crm). An inner TanStack Router rebased to `/crm`, with
 * `CrmShell` as its root layout; no auth guard and no chrome (the shell owns
 * both).
 */
const router = createAppRouter('/crm', CrmShell)

export default function App() {
  return <RouterProvider router={router} />
}
