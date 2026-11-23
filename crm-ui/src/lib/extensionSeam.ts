/**
 * extensionSeam — crm-ui's one way into the shell's `shell/extensions` seam (ADR 20261104-host-extension-federated-panel-through-the-shell), shared by
 * every component that embeds another tool's widget (the Meetings card, Record hours).
 *
 * - `useExtensionSeam` imports the seam ONCE for the life of the page and shares the outcome: a list mounts one widget
 *   per row and they must not repeat the import (specs/20261116-record-hours-in-place plan R1). A failed import is kept
 *   too: the browser caches it, so a retry would only fail again; the caller's fallback is the whole offer.
 * - The boundary that goes with it is `components/ExtensionContain`.
 */
import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'

export type HostExtensionComponent = typeof import('shell/extensions').HostExtension

export type Seam = { status: 'loading' } | { status: 'ready'; HostExtension: HostExtensionComponent } | { status: 'failed' }

const LOADING: Seam = { status: 'loading' }

let loaded: Seam | null = null
let loading: Promise<Seam> | null = null

function loadSeam(): Promise<Seam> {
  loading ??= import('shell/extensions')
    .then(
      (module): Seam => {
        try {
          // Reading the export is inside the try: a module namespace can throw on access.
          const HostExtension = (module as { HostExtension?: ComponentType<never> }).HostExtension
          return typeof HostExtension === 'function'
            ? { status: 'ready', HostExtension: HostExtension as unknown as HostExtensionComponent }
            : { status: 'failed' }
        } catch {
          return { status: 'failed' }
        }
      },
      (): Seam => ({ status: 'failed' }),
    )
    .then((seam) => {
      loaded = seam
      return seam
    })
  return loading
}

export function useExtensionSeam(): Seam {
  const [seam, setSeam] = useState<Seam>(loaded ?? LOADING)
  useEffect(() => {
    if (loaded !== null) return
    let live = true
    void loadSeam().then((next) => {
      if (live) setSeam(next)
    })
    return () => {
      live = false
    }
  }, [])
  return seam
}

/** Forgets the outcome (tests, whose mock of `shell/extensions` changes between cases; never needed by a page). */
export const resetExtensionSeam = (): void => {
  loaded = null
  loading = null
}
