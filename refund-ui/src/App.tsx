import 'shell/tokens.css'
import { useState } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from './router'

// IMPORTANT (mirrors admin-ui/src/App.tsx's/estimai-ui/src/App.tsx's doc
// exactly, same underlying reason): the exposed remote MUST NOT import its
// own `index.css` here. The shell owns the single Tailwind sheet for the
// whole suite; importing refund-ui's own compiled Tailwind here would put a
// SECOND full Tailwind sheet on the shell's page (the double-header /
// broken-responsive bug — see index.css's own doc comment). The standalone
// bootstrap (main.tsx) DOES import index.css: outside the shell there is no
// shell sheet, so it's refund-ui's only source of Tailwind + tokens.

/**
 * App — refund-ui's root component, exposed via Module Federation as `./App`
 * (see vite.config.ts's `exposes`) — what the shell's `/refund/*` catch-all
 * route mounts.
 *
 * T14 (specs/007-refund-service/tasks.md): replaces the T15/specs/003
 * static placeholder with refund-ui's own inner TanStack Router
 * (src/router.tsx), rebased to basepath `/refund` — same federation contract
 * admin-ui's/estimai-ui's `./App` already establish:
 *
 *   refund-ui (remote)
 *     exposes:  ./App   # root component; inner TanStack Router with
 *                        # basepath '/refund'; no auth guard, no chrome
 *
 * Landing on `/refund` (or any refund path) renders `RefundShell`'s heading
 * + two-item nav (My requests / Review queue — src/components/RefundShell.tsx)
 * + the active route's placeholder page via `<Outlet/>`. The real screens
 * (composer, attachments, review/decide) are T15–T18; this task ships only
 * the router + shell they mount into.
 *
 * Demonstrates the shared session/design tokens exactly as the prior
 * placeholder did (ADR-0001/ADR-0006): imports `shell/tokens.css` as a
 * side-effect so the shared Operai fonts + palette CSS custom properties are
 * present regardless of whether this component runs inside the shell or
 * standalone (src/main.tsx).
 * Colours and fonts are Tailwind token utilities (`text-soft`, `bg-ink-mid`,
 * `font-disp`, …), the suite's one styling dialect (ADR-0051): the shell's
 * single Tailwind sheet scans this source with the shared `@theme`, and the
 * standalone build's index.css imports the same tokens. Never inline
 * `var(--…)` styles; lint rejects them.
 *
 * No explicit `useSession()`/"signed in as" demonstration here (unlike the
 * T15 placeholder) — `RefundShell` mirrors `AdminShell`'s posture exactly:
 * identity display is suite chrome the shell already owns (Header/UserMenu),
 * not something this remote's own root re-derives.
 */

// The router is built per mount, not once at module scope: the shell unmounts the
// remote when the user leaves it and mounts it again on return, and a router
// instance that has already been mounted does not reload on a second mount
// (@tanstack/react-router >= 1.170.46), so it would show the route it last had
// instead of the URL the user returned to.
export default function App() {
  const [router] = useState(() => createAppRouter('/refund'))
  return <RouterProvider router={router} />
}
