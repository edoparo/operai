import 'shell/tokens.css'
import { useState } from 'react'
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

// The router is built per mount, not once at module scope: the shell unmounts the
// remote when the user leaves it and mounts it again on return, and a router
// instance that has already been mounted does not reload on a second mount
// (@tanstack/react-router >= 1.170.46), so it would show the route it last had
// instead of the URL the user returned to.
export default function App() {
  const [router] = useState(() => createAppRouter('/crm', CrmShell))
  return <RouterProvider router={router} />
}
