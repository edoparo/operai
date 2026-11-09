import { useEffect, useState } from 'react'
import { formatRelative } from '@operai/ui'
import { strings } from '../strings'

/** How often the header's "Saved … ago" is recomputed. */
export const SAVED_AGO_TICK_MS = 15_000

/**
 * The header badge's steady-state label: "Saved just now" for the first
 * minute, then "Saved 5 minutes ago" / "Saved yesterday" (library
 * formatRelative). `null` when nothing was ever stored.
 */
export function savedAgoLabel(lastSavedAt: string | null, now: Date): string | null {
  if (!lastSavedAt) return null
  const t = strings.editor
  // A clock older than the save (the tick has not caught up yet) is "just now" too.
  if (now.getTime() - new Date(lastSavedAt).getTime() < 60_000) return t.savedJustNow
  return t.savedAgo(formatRelative(lastSavedAt, now))
}

/** `savedAgoLabel` kept current while the editor is open. */
export function useSavedAgo(lastSavedAt: string | null): string | null {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!lastSavedAt) return
    const id = setInterval(() => setNow(new Date()), SAVED_AGO_TICK_MS)
    return () => clearInterval(id)
  }, [lastSavedAt])
  return savedAgoLabel(lastSavedAt, now)
}
