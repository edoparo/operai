import { createContext, useContext } from 'react'
import type { Catalog, Entity, LetterheadList } from '../lib/types'

/**
 * What `LetterheadsShell` loads once and hands to the page: the catalog and the list of both entities
 * (design F1). A page outside the shell has no value and `useLetterheads` throws.
 */
export interface LetterheadsContextValue {
  catalog: Catalog
  letterheads: LetterheadList
  /**
   * Loads `GET /v1/letterheads` again, behind the page (no loading state: the page stays as it is), so that
   * `activeVersion` and `canManage` are not stale after a write (T24). `known` is what the person just did,
   * applied at once, so the header is right even if the request fails. Absent outside the shell.
   */
  refresh?: (known?: { entity: Entity; activeVersion: number }) => Promise<void>
}

export const LetterheadsContext = createContext<LetterheadsContextValue | null>(null)

export function useLetterheads(): LetterheadsContextValue {
  const value = useContext(LetterheadsContext)
  if (value === null) throw new Error('useLetterheads must be used inside LetterheadsShell')
  return value
}
