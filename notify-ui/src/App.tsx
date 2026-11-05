import 'shell/tokens.css'
import { useState, useSyncExternalStore } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter, type AppRouter } from './router'

// IMPORTANT (mirrors admin-ui/src/App.tsx's and estimai-ui/src/App.tsx's
// documented reason exactly): the exposed remote MUST NOT import its own
// `index.css` here. The shell owns the single Tailwind sheet for the whole
// suite; importing notify-ui's own compiled Tailwind here would put a SECOND
// full Tailwind sheet on the shell's page (the double-header / broken-
// responsive bug — see index.css's own doc comment, ADR-0006 addendum). The
// standalone bootstrap (main.tsx) DOES import index.css: outside the shell
// there is no shell sheet, so it's notify-ui's only source of Tailwind +
// tokens.

const BASEPATH = '/notify'

/**
 * The router of one mount (specs/022 AC-6.1, D52). A router created once at module
 * load outlives every unmount: its browser history keeps listening to the whole
 * window, so it routes the other modules' addresses too and renders that stale match
 * when the shell mounts the module again. So the router is made when the module
 * mounts and its history destroyed (listeners and `pushState` patch included) when
 * it unmounts.
 *
 * It also ignores the browser's address while that address is not the module's own:
 * between the shell moving the URL to another module and unmounting this one (the
 * other module is still loading) nothing here routes it, so no page, and no request,
 * comes from an address that is not ours.
 */
function createOwnRouter(): AppRouter {
  const router = createAppRouter(BASEPATH)
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
 * App — notify-ui's root component, exposed via Module Federation as `./App`
 * (see vite.config.ts's `exposes`) — what the shell's `/notify/*` always-
 * available catch-all route (T13, a later task of this feature) mounts.
 *
 * T14 (specs/005-notification-center/tasks.md): scaffold-only. Gives
 * notify-ui its own inner TanStack Router (src/router.tsx) rebased to
 * basepath `/notify` — same federation contract every other remote already
 * established (admin-ui's `./App`, T13/T14 of specs/004-auth-roles-
 * permissions):
 *
 *   notify-ui (remote)
 *     exposes:  ./App   # root component; inner TanStack Router with
 *                        # basepath '/notify'; no auth guard, no chrome
 *
 * Landing on `/notify` renders NotificationCenterPage — a placeholder for
 * now (this task ships only the router + page shell it mounts into; the
 * real notification list/empty/loading/error states and the "mark all as
 * read" control are T15, plan.md "Architecture → notify-ui" / design.md
 * "Notification center page").
 *
 * No auth guard here either — same rationale as every other remote's inner
 * router (estimai-ui/admin-ui/refund-ui, ADR-0006): the shell's own
 * `_authed` guard already runs before notify-ui is ever mounted, and per
 * plan.md/ADR-0007 `/notify` is deliberately NOT an app-access-gated route
 * (every signed-in user has notifications) — so there is no per-tool
 * `access` guard to add here either, unlike admin-ui.
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
export default function App() {
  const [mount] = useState(ownRouterMount)
  const router = useSyncExternalStore(mount.subscribe, mount.getRouter)
  return router ? <RouterProvider router={router} /> : null
}
