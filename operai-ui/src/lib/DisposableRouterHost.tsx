import { createElement, useCallback, useState, useSyncExternalStore, type ReactNode } from 'react'

/**
 * What a router must have for this component: a history that can be torn down. TanStack's `Router`
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

interface Life<R> {
  create: () => R
  router: R | null
  teardown: (() => void) | null
  /** Set once the component has left the page for good; nothing is created after it. */
  gone: boolean
}

function dispose<R extends DisposableRouter>(life: Life<R>) {
  life.gone = true
  const { teardown } = life
  life.router = null
  life.teardown = null
  teardown?.()
}

// ---- The unmount signal --------------------------------------------------------------------------------
// React cannot tell "left the page" from "hidden for a while": when the shell suspends above a remote (it
// does on every URL change inside it, redirects included) React hides the remote's tree, runs every effect
// cleanup in it, and shows it again with its state kept and the effects set up once more. A router torn
// down by a cleanup would come back as a different router that is never loaded, and a cleanup that was
// skipped by a hide never runs again if the tree is then deleted while still hidden. The DOM tells the
// truth in both cases: a hidden tree stays in the document, a deleted one leaves it. So the component
// renders one inert custom element and treats its removal from the document as the end of life. (A host
// mounted into a container that is not in the document never sees a removal; a browser history needs a
// real document anyway.)
const ANCHOR = 'operai-router-anchor'

interface AnchorElement extends HTMLElement {
  onRemoved?: () => void
}

if (typeof customElements !== 'undefined' && !customElements.get(ANCHOR)) {
  customElements.define(
    ANCHOR,
    class extends HTMLElement implements AnchorElement {
      onRemoved?: () => void
      disconnectedCallback() {
        // Moving a node is a disconnect followed by a connect; only one still detached a tick later is gone.
        queueMicrotask(() => {
          if (!this.isConnected) this.onRemoved?.()
        })
      }
    },
  )
}

export interface DisposableRouterHostProps<R extends DisposableRouter> {
  /** Builds the router synchronously; read once, on the first render. */
  create: () => R
  /** Renders the router, e.g. `(router) => <RouterProvider router={router} />`. */
  children: (router: R) => ReactNode
}

/**
 * Hosts a router that lives exactly as long as the component is on the page: created when it mounts, its
 * browser history destroyed when it is removed. Renders nothing until the router exists (the first render,
 * and server renders); the router follows in the same commit's synchronous re-render.
 *
 * Why not `useState(() => create())`: nothing ever calls `history.destroy()` for it, so every leave-and-
 * return to a remote leaked a router, two window listeners and one more `pushState` wrapper (specs/029,
 * security L5); and a router built during render leaks again whenever React throws that render away.
 * Why not destroy in an effect cleanup: StrictMode and a Suspense hide both run the cleanup and set the
 * effect up again on the same instance, so the router has to survive them (see "The unmount signal").
 * The router is created on subscribe (React's mount hook for an external resource) and only once, whatever
 * the number of times React subscribes again.
 */
export function DisposableRouterHost<R extends DisposableRouter>({ create, children }: DisposableRouterHostProps<R>) {
  const [store] = useState(() => {
    const life: Life<R> = { create, router: null, teardown: null, gone: false }
    return {
      life,
      subscribe: (notify: () => void) => {
        if (!life.router && !life.gone) {
          const before = window.history.pushState
          const created = life.create()
          const held: Held = {
            push: window.history.pushState,
            replace: window.history.replaceState,
            destroy: () => created.history.destroy(),
          }
          life.router = created
          // A history that wrapped nothing (an injected memory history) has no order to respect.
          life.teardown = held.push !== before ? () => release(held) : held.destroy
        }
        notify()
        return () => undefined
      },
      get: () => life.router,
    }
  })
  const router = useSyncExternalStore(store.subscribe, store.get, () => null)
  const anchor = useCallback(
    (el: AnchorElement | null) => {
      if (el) el.onRemoved = () => dispose(store.life)
    },
    [store],
  )
  return (
    <>
      {createElement(ANCHOR, { ref: anchor, hidden: true })}
      {router ? children(router) : null}
    </>
  )
}
