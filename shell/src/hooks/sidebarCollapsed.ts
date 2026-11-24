/**
 * sidebarCollapsed — shared collapse state for the shell's tool-navigation rail
 * (the context + reader hook; the Provider lives in SidebarCollapsedProvider.tsx).
 *
 * The rail (Sidebar.tsx) collapses to an icons-only width via a toggle in its
 * always-visible bottom section; ShellLayout reads the SAME state to size the
 * rail (`w-56` ↔ `w-16`). One source of truth (this context) keeps the width
 * and the item rendering in lockstep on toggle — not two independent `useState`.
 *
 * Split from the Provider so this module exports no component and the Provider
 * module exports only a component — satisfying `react-refresh/only-export-components`
 * (same convention as Header.tsx vs router.tsx). Persistence key mirrors
 * useTheme's `operai-theme` localStorage pattern.
 */
import { createContext, useContext } from 'react'

export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'operai_sidebar_collapsed'

/** Reads the persisted collapse choice; false (expanded) when unset/unavailable. */
export function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Below 640 px the rail cannot keep its expanded width without squeezing the tool's content to a column a few words wide
 * (WCAG 1.4.10 reflow at 320 px, A11Y-F1, 2026-11-24). On a viewport this narrow the rail is the icons-only width
 * whatever the stored choice, and the toggle opens the expanded rail as a panel OVER the content (`overlay`), never
 * beside it; the panel is not persisted and closes on Escape, a click outside it, a navigation, or a widening viewport.
 */
export const NARROW_VIEWPORT_QUERY = '(max-width: 639.98px)'

/** Whether the viewport is narrow now; false where `matchMedia` does not exist (jsdom, very old browsers). */
export function readNarrowViewport(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_VIEWPORT_QUERY).matches
  } catch {
    return false
  }
}

export interface SidebarCollapsedValue {
  /** The rail shows icons only. */
  collapsed: boolean
  /** Wide viewport: collapse or expand (persisted). Narrow viewport: open or close the overlay panel (not persisted). */
  toggle: () => void
  /** The viewport is narrow (below 640 px). */
  narrow: boolean
  /** The expanded rail is open as a panel over the content (narrow viewport only). */
  overlay: boolean
  /** Closes the overlay panel; a no-op when none is open. */
  closeOverlay: () => void
}

const NON_COLLAPSED_DEFAULT: SidebarCollapsedValue = { collapsed: false, toggle: () => {}, narrow: false, overlay: false, closeOverlay: () => {} }

export const SidebarCollapsedContext = createContext<SidebarCollapsedValue | null>(null)

/**
 * Reads the shared sidebar-collapse state. Without a provider (isolated
 * component tests) returns a non-collapsed, no-op default rather than throwing.
 */
export function useSidebarCollapsed(): SidebarCollapsedValue {
  return useContext(SidebarCollapsedContext) ?? NON_COLLAPSED_DEFAULT
}
