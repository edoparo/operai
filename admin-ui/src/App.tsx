import 'shell/tokens.css'
import { RouterProvider } from '@tanstack/react-router'
import { DisposableRouterHost } from '@operai/ui'
import { createAppRouter } from './router'

// IMPORTANT (mirrors estimai-ui/src/App.tsx's T12/specs/003-suite-shell doc
// exactly, same underlying reason): the exposed remote MUST NOT import its
// own `index.css` here. The shell owns the single Tailwind sheet for the
// whole suite; importing admin-ui's own compiled Tailwind here would put a
// SECOND full Tailwind sheet on the shell's page (the double-header /
// broken-responsive bug — see index.css's own doc comment). The standalone
// bootstrap (main.tsx) DOES import index.css: outside the shell there is no
// shell sheet, so it's admin-ui's only source of Tailwind + tokens.

/**
 * App — admin-ui's root component, exposed via Module Federation as `./App`
 * (see vite.config.ts's `exposes`) — what the shell's future `/admin/*`
 * catch-all route (per plan.md's shell-wiring list, a later task of this
 * feature) mounts.
 *
 * T14 (specs/004-auth-roles-permissions/tasks.md): replaces T13's static
 * placeholder with admin-ui's own inner TanStack Router (src/router.tsx),
 * rebased to basepath `/admin` — same federation contract estimai-ui's
 * `./App` (specs/003-suite-shell, T12/T13) already established:
 *
 *   admin-ui (remote)
 *     exposes:  ./App   # root component; inner TanStack Router with
 *                        # basepath '/admin'; no auth guard, no chrome
 *
 * Landing on `/admin` (or any admin path) renders AdminShell's section nav
 * (Roles/Departments/Users/Audit — src/components/SectionNav.tsx) + the
 * active section's placeholder page via `<Outlet/>` (src/components/
 * AdminShell.tsx). The real Roles/Departments/Users/Audit screens are
 * T17–T21; this task ships only the router + nav shell they mount into.
 *
 * Design-system consistency: imports `shell/tokens.css` as a side-effect
 * (federated CSS module) so the shared Operai fonts + palette CSS custom
 * properties are present regardless of whether this component runs inside
 * the shell (which already loads the same tokens globally — a harmless
 * duplicate `<style>` injection) or standalone (src/main.tsx, dev/test
 * bootstrap — where it's the ONLY source of the palette).
 * Colours and fonts are Tailwind token utilities (`text-soft`, `bg-ink-mid`,
 * `font-disp`, …), the suite's one styling dialect (ADR-0051): the shell's
 * single Tailwind sheet scans this source with the shared `@theme`, and the
 * standalone build's index.css imports the same tokens. Never inline
 * `var(--…)` styles; lint rejects them.
 */

// The router is built per mount, not once at module scope: the shell unmounts the
// remote when the user leaves it and mounts it again on return, and a router
// instance that has already been mounted does not reload on a second mount
// (@tanstack/react-router >= 1.170.46), so it would show the route it last had
// instead of the URL the user returned to.
// It is also destroyed on unmount: a router's browser history wraps window.history and adds window
// listeners that only `history.destroy()` removes, so one per mount would pile up (specs/029 security L5).
export default function App() {
  return (
    <DisposableRouterHost create={() => createAppRouter('/admin')}>
      {(router) => <RouterProvider router={router} />}
    </DisposableRouterHost>
  )
}
