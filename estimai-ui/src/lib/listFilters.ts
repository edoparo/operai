/**
 * The estimates list's two filters (specs/20261108-estimate-list-oversight): "Whose" (mine | all) and
 * "Status" (open | closed). They live in the route's search params, with the
 * defaults omitted from the URL, and are mirrored to sessionStorage so a return
 * to /estimates without params restores the last choice (AC-2.6).
 *
 * Every sessionStorage access is wrapped: a private window or blocked site data
 * must leave the list working with the defaults.
 */

export type Whose = 'mine' | 'all'
export type StatusFilter = 'open' | 'closed'

/** The URL form: a default value is absent. */
export type ListSearch = { whose?: 'all'; status?: 'closed' }

export type ListFilters = { whose: Whose; status: StatusFilter }

export const DEFAULT_FILTERS: ListFilters = { whose: 'mine', status: 'open' }

export const FILTERS_STORAGE_KEY = 'estimai.list.filters'

/** TanStack `validateSearch`: unknown or default values fall away. */
export const validateListSearch = (search: Record<string, unknown>): ListSearch => ({
  ...(search.whose === 'all' ? { whose: 'all' as const } : {}),
  ...(search.status === 'closed' ? { status: 'closed' as const } : {}),
})

export const filtersFromSearch = (search: ListSearch): ListFilters => ({
  whose: search.whose === 'all' ? 'all' : 'mine',
  status: search.status === 'closed' ? 'closed' : 'open',
})

export const searchFromFilters = (filters: ListFilters): ListSearch => ({
  ...(filters.whose === 'all' ? { whose: 'all' as const } : {}),
  ...(filters.status === 'closed' ? { status: 'closed' as const } : {}),
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
  if (search.whose !== undefined || search.status !== undefined) return null
  const stored = readStoredFilters()
  if (!stored) return null
  const restored = searchFromFilters(stored)
  return Object.keys(restored).length > 0 ? restored : null
}
