/**
 * The Sidebar's Settings group remembers whether it was left open (best effort: a blocked or absent localStorage
 * just means it starts closed). Kept beside sidebarCollapsed.ts, which persists the rail's collapse the same way.
 */
export const SETTINGS_OPEN_STORAGE_KEY = 'operai_sidebar_settings_open'

export function readSettingsOpen(): boolean {
  try {
    return localStorage.getItem(SETTINGS_OPEN_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeSettingsOpen(open: boolean): void {
  try {
    localStorage.setItem(SETTINGS_OPEN_STORAGE_KEY, String(open))
  } catch {
    // Storage unavailable (private mode, blocked): the group still works, it just forgets.
  }
}
