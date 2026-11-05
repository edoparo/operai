import 'shell/tokens.css'
import { useState, useSyncExternalStore } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import InventoryShell from './components/InventoryShell'
import { createAppRouter, type AppRouter } from './router'

// IMPORTANT (same reason as refund-ui/src/App.tsx): the exposed remote MUST NOT
// import its own `index.css` here. The shell owns the single Tailwind sheet for
// the whole suite; a second compiled sheet on the shell's page causes the
// double-header / broken-responsive bug. Only the standalone bootstrap
// (main.tsx) imports index.css.

const BASEPATH = '/inventory'

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
  const router = createAppRouter(BASEPATH, InventoryShell)
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
 *
 * React also runs a subscription's cleanup and setup again on a component that stays
 * mounted: strict mode does it when the shell shows the module again after hiding it
 * behind its pending fallback. That swaps the router with no render in between, so the
 * snapshot carries a `key` that changes with the router: a swapped router gets a fresh
 * `RouterProvider`, because a provider already mounted never loads a router it was
 * not mounted with (TanStack Router's `Transitioner`, in development) and the module
 * would come back blank.
 */
function ownRouterMount() {
  let current: { router: AppRouter; key: number } | null = null
  let generation = 0
  return {
    subscribe: (onChange: () => void) => {
      current = { router: createOwnRouter(), key: ++generation }
      onChange()
      return () => {
        current?.router.history.destroy()
        current = null
      }
    },
    getCurrent: () => current,
  }
}

/**
 * App — inventory-ui's gated tool root, exposed via Module Federation as
 * `./App` (vite.config.ts `exposes`) and mounted by the shell at the
 * access-gated `/inventory/*` (ADR-0006, ADR-0045). It owns an inner TanStack
 * Router rebased to `/inventory`; no auth guard and no chrome (the shell owns
 * both). `InventoryShell` (T28) is the router's root layout: heading, capability
 * tabs and the scope states.
 *
 * Imports `shell/tokens.css` as a side effect so the shared Operai fonts and
 * palette custom properties are present inside the shell and standalone alike;
 * components consume them as plain `var(--…)` values (see refund-ui/src/App.tsx
 * for why Tailwind palette utilities are not used for them).
 */
export default function App() {
  const [mount] = useState(ownRouterMount)
  const own = useSyncExternalStore(mount.subscribe, mount.getCurrent)
  return own ? <RouterProvider key={own.key} router={own.router} /> : null
}
