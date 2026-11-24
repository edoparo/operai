/**
 * SidebarCollapsedProvider — provides the shared sidebar-collapse state
 * (see sidebarCollapsed.ts for the context + `useSidebarCollapsed` reader).
 *
 * Kept in its own file so it is the module's ONLY export (a component),
 * satisfying `react-refresh/only-export-components`. Rendered once by
 * ShellLayout around the rail + content; the Sidebar's toggle (a descendant)
 * and ShellLayout's rail-width both read the state via `useSidebarCollapsed`.
 *
 * Wide viewport: the stored choice (localStorage) decides, and the toggle flips and stores it. Narrow viewport (below
 * 640 px, A11Y-F1): the rail is icons-only whatever was stored, and the toggle opens the expanded rail as an overlay panel
 * that is never stored.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  NARROW_VIEWPORT_QUERY,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  SidebarCollapsedContext,
  readNarrowViewport,
  readStoredCollapsed,
} from './sidebarCollapsed'

export function SidebarCollapsedProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<boolean>(readStoredCollapsed)
  const [narrow, setNarrow] = useState<boolean>(readNarrowViewport)
  const [overlayOpen, setOverlayOpen] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(NARROW_VIEWPORT_QUERY)
    const onChange = () => {
      setNarrow(query.matches)
      setOverlayOpen(false)
    }
    query.addEventListener?.('change', onChange)
    return () => query.removeEventListener?.('change', onChange)
  }, [])

  const toggle = useCallback(() => {
    if (narrow) {
      setOverlayOpen((open) => !open)
      return
    }
    setStored((prev) => {
      const next = !prev
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next))
      } catch {
        // Storage unavailable (privacy mode, disabled storage) — non-fatal;
        // the choice just won't persist across reloads.
      }
      return next
    })
  }, [narrow])

  const closeOverlay = useCallback(() => setOverlayOpen(false), [])

  const collapsed = narrow ? !overlayOpen : stored
  const overlay = narrow && overlayOpen
  return (
    <SidebarCollapsedContext.Provider value={{ collapsed, toggle, narrow, overlay, closeOverlay }}>{children}</SidebarCollapsedContext.Provider>
  )
}
