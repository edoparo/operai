/**
 * The tools a person pinned to the top of the Sidebar (2026-11-25), remembered in this browser like the rail's collapse
 * and the Settings group (best effort: a blocked or absent localStorage means nothing is pinned, and a pin still works
 * until the page reloads). Only known tool ids are kept: a stored value is never trusted as-is.
 */
import { isToolId, type ToolId } from '../lib/tools'

export const PINNED_TOOLS_STORAGE_KEY = 'operai_sidebar_pinned'

export function readPinnedTools(): ToolId[] {
  try {
    const raw = localStorage.getItem(PINNED_TOOLS_STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? [...new Set(parsed.filter(isToolId))] : []
  } catch {
    return []
  }
}

export function writePinnedTools(ids: readonly ToolId[]): void {
  try {
    localStorage.setItem(PINNED_TOOLS_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Storage unavailable (private mode, blocked): the pin holds for this page only.
  }
}

/**
 * The order of the Sidebar's main list: pinned tools first, then the others, each part in alphabetical order of the
 * label the person reads (their language), case and accents ignored.
 */
export function orderTools<T extends { id: ToolId; label: string }>(tools: readonly T[], pinned: readonly ToolId[]): T[] {
  const byLabel = (a: T, b: T) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  return [
    ...tools.filter((tool) => pinned.includes(tool.id)).sort(byLabel),
    ...tools.filter((tool) => !pinned.includes(tool.id)).sort(byLabel),
  ]
}
