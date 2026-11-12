import { useState } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from './router'

// IMPORTANT (specs/003-suite-shell; docs/adr/0006 Remote CSS strategy): the
// exposed remote MUST NOT import its own `index.css` here. The shell owns the
// single Tailwind sheet for the whole suite — its Tailwind `@source`-scans
// estimai-ui/src (shell/src/index.css) and generates estimai's utility classes
// from the shared `@theme` (shell/src/styles/tokens.css). Importing estimai's
// own compiled Tailwind here would put a SECOND full Tailwind sheet on the
// shell's page; the two sheets' `@layer utilities` merge by DOM order, so the
// later sheet's plain utilities clobber the earlier sheet's variant utilities
// (`sm:*`/`hover:*`/`focus:*`) — the double-header / broken-responsive bug.
// The standalone bootstrap (main.tsx) DOES import index.css: outside the shell
// there is no shell sheet, so it's estimai's only source of Tailwind + tokens.

// T12 (specs/003-suite-shell/tasks.md): root component exposed via Module
// Federation as `./App` (see vite.config.ts's `exposes`). This is what the
// shell's `/estimai/*` catch-all route (T9) mounts. The inner TanStack
// Router is rebased to basepath '/estimai' so estimai-ui's own internal
// navigation (list ↔ editor ↔ share) resolves correctly once mounted under
// that prefix — per the plan's federation contract:
//
//   estimai-ui (remote)
//     exposes:  ./App   # root component; inner TanStack Router with
//                        # basepath '/estimai'; no auth guard, no chrome
//
// T13 (specs/003-suite-shell/tasks.md, AC-2.3): the router's own `_authed`
// guard is gone — the shell's guard (shell/src/router.tsx, T9) already
// resolves the session before this component is ever mounted (see
// src/router.tsx's file-level doc for the full rationale).
//
// T14 (specs/003-suite-shell/tasks.md, AC-4.2): the suite-level chrome
// (logo/About, avatar menu + sign-out, theme toggle) has been removed from
// estimai-ui's own components — the shell now owns it exclusively. Only
// tool-scoped chrome (project name, save-status, "My Estimates") remains.

// The router is built per mount, not once at module scope: the shell unmounts the
// remote when the user leaves it and mounts it again on return, and a router
// instance that has already been mounted does not reload on a second mount
// (@tanstack/react-router >= 1.170.46), so it would show the route it last had
// instead of the URL the user returned to.
export default function App() {
  const [router] = useState(() => createAppRouter('/estimai'))
  return <RouterProvider router={router} />
}
