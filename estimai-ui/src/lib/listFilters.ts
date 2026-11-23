/**
 * The estimates list's filters (specs/20261108-estimate-list-oversight): "Whose" (mine | all),
 * "Status" (open | closed) and, since 2026-11-23 (US-4), "Owner" (`me` or an owner's display
 * name; absent = everyone). They live in the route's search params, with the
 * defaults omitted from the URL, and are mirrored to sessionStorage so a return
 * to /estimates without params restores the last choice (AC-2.6).
 *
 * Every sessionStorage access is wrapped: a private window or blocked site data
 * must leave the list working with the defaults.
 */

export type Whose = 'mine' | 'all'
export type StatusFilter = 'open' | 'closed'

/** The URL form: a default value is absent. */
export type ListSearch = { whose?: 'all'; status?: 'closed'; owner?: string }

/**
 * `owner` is an owner key (`OWNER_ME` or the owner's display name, see ownerFilter.ts), `null` for
 * everyone. The API never sends an owner's id (specs/20260807-estimate-sharing "Display identity"),
 * so the owner filter matches on what the row shows and is applied to the loaded list.
 */
export type ListFilters = { whose: Whose; status: StatusFilter; owner: string | null }

export const DEFAULT_FILTERS: ListFilters = { whose: 'mine', status: 'open', owner: null }

/** A longer owner value is not a name a row can show: it is dropped. */
const MAX_OWNER_LENGTH = 200

const validOwner = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_OWNER_LENGTH ? value : null

export const FILTERS_STORAGE_KEY = 'estimai.list.filters'

/** TanStack `validateSearch`: unknown or default values fall away. */
export const validateListSearch = (search: Record<string, unknown>): ListSearch => ({
  ...(search.whose === 'all' ? { whose: 'all' as const } : {}),
  ...(search.status === 'closed' ? { status: 'closed' as const } : {}),
  ...(validOwner(search.owner) !== null ? { owner: search.owner as string } : {}),
})

export const filtersFromSearch = (search: ListSearch): ListFilters => ({
  whose: search.whose === 'all' ? 'all' : 'mine',
  status: search.status === 'closed' ? 'closed' : 'open',
  owner: validOwner(search.owner),
})

export const searchFromFilters = (filters: ListFilters): ListSearch => ({
  ...(filters.whose === 'all' ? { whose: 'all' as const } : {}),
  ...(filters.status === 'closed' ? { status: 'closed' as const } : {}),
  ...(filters.owner !== null ? { owner: filters.owner } : {}),
})

export const readStoredFilters = (): ListFilters | null => {
  try {
    const raw = sessionStorage.getItem(FILTERS_STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return filtersFromSearch(validateListSearch(parsed as Record<string, unknown>))
  } catch {
    return null
  }
}

export const writeStoredFilters = (filters: ListFilters): void => {
  try {
    sessionStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(searchFromFilters(filters)))
  } catch {
    // Storage unavailable: the URL still carries the choice.
  }
}

/**
 * The search to restore when /estimates is entered with no params: the stored
 * choice if it differs from the defaults, otherwise `null` (nothing to do).
 */
export const restoredSearch = (search: ListSearch): ListSearch | null => {
  if (search.whose !== undefined || search.status !== undefined || search.owner !== undefined) return null
  const stored = readStoredFilters()
  if (!stored) return null
  const restored = searchFromFilters(stored)
  return Object.keys(restored).length > 0 ? restored : null
}
