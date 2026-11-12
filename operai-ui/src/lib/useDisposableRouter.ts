import { useState, useSyncExternalStore } from 'react'

/**
 * What a router must have for this hook: a history that can be torn down. TanStack's `Router`
 * satisfies it structurally, so the library takes no router dependency (ADR-0050).
 */
export interface DisposableRouter {
  history: { destroy: () => void }
}

// A router's browser history wraps `window.history.pushState`/`replaceState` and adds `popstate` and
// `beforeunload` listeners; only `history.destroy()` undoes that, and it does it by writing back the
// functions it captured when it was created. So teardown must be last-in-first-out: destroying a history
// that is not the outermost wrapper would also drop every wrapper created after it (including the
// shell's own router when a remote built it first, or another remote mounted at the same time).
interface Held {
  /** The wrappers this history installed — still the outermost ones while nothing was created after it. */
  push: History['pushState']
  replace: History['replaceState']
  destroy: () => void
}

const isOutermost = (held: Held) =>
  window.history.pushState === held.push && window.history.replaceState === held.replace

// Released while another history was still wrapped over it; destroyed as soon as that one lets go.
let waiting: Held[] = []

function release(held: Held) {
  if (!isOutermost(held)) {
    waiting.push(held)
    return
  }
  held.destroy()
  // Letting go of the outermost wrapper may uncover one that was released earlier.
  const uncovered = waiting.find(isOutermost)
  if (uncovered) {
    waiting = waiting.filter((h) => h !== uncovered)
    release(uncovered)
  }
}

/**
 * A router that lives exactly as long as the component using it: created when it mounts, its history
 * destroyed when it unmounts. Returns `null` until the mount has happened (the first render, and server
 * renders) — render `null` until it arrives; the router follows in the same commit's synchronous re-render.
 *
 * Why not `useState(() => create())`: nothing ever calls `history.destroy()` for it, so every leave-and-
 * return to a remote leaked a router, two window listeners and one more `pushState` wrapper (specs/029,
 * security L5). Why not destroy in an effect cleanup around that state: React StrictMode runs the cleanup
 * and then the effect again on the same instance, which would leave a live router with a dead history.
 * Creating on subscribe (React's mount/unmount hook for an external resource, run again by StrictMode)
 * gives each run its own router, and the matching unsubscribe only ever destroys its own.
 *
 * `create` is read once, on the first render, and must build the router synchronously.
 */
export function useDisposableRouter<R extends DisposableRouter>(create: () => R): R | null {
  const [store] = useState(() => {
    let router: R | null = null
    return {
      subscribe: (notify: () => void) => {
        const before = window.history.pushState
        const created = create()
        const held: Held = {
          push: window.history.pushState,
          replace: window.history.replaceState,
          destroy: () => created.history.destroy(),
        }
        // A history that wrapped nothing (an injected memory history) has no order to respect.
        const wrapped = held.push !== before
        router = created
        notify()
        return () => {
          router = null
          if (wrapped) release(held)
          else held.destroy()
        }
      },
      get: () => router,
    }
  })
  return useSyncExternalStore(store.subscribe, store.get, () => null)
}
