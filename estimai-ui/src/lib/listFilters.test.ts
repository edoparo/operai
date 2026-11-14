/**
 * @vitest-environment jsdom
 *
 * The list filters' URL and sessionStorage rules (specs/20261108-estimate-list-oversight AC-2.6).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FILTERS,
  FILTERS_STORAGE_KEY,
  filtersFromSearch,
  readStoredFilters,
  restoredSearch,
  searchFromFilters,
  validateListSearch,
  writeStoredFilters,
} from './listFilters'

afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('search params', () => {
  it('keeps only the non-default, known values', () => {
    expect(validateListSearch({ whose: 'all', status: 'closed' })).toEqual({ whose: 'all', status: 'closed' })
    expect(validateListSearch({ whose: 'mine', status: 'open' })).toEqual({})
    expect(validateListSearch({ whose: 'everyone', status: 7, other: 'x' })).toEqual({})
  })

  it('maps to filters and back, omitting the defaults', () => {
    expect(filtersFromSearch({})).toEqual(DEFAULT_FILTERS)
    expect(filtersFromSearch({ whose: 'all' })).toEqual({ whose: 'all', status: 'open' })
    expect(searchFromFilters({ whose: 'mine', status: 'closed' })).toEqual({ status: 'closed' })
    expect(searchFromFilters(DEFAULT_FILTERS)).toEqual({})
  })
})

describe('sessionStorage mirror', () => {
  it('round-trips the last choice', () => {
    writeStoredFilters({ whose: 'all', status: 'closed' })
    expect(readStoredFilters()).toEqual({ whose: 'all', status: 'closed' })
  })

  it('restores the stored choice only when /estimates is entered without params', () => {
    writeStoredFilters({ whose: 'all', status: 'open' })
    expect(restoredSearch({})).toEqual({ whose: 'all' })
    expect(restoredSearch({ status: 'closed' })).toBeNull()
    expect(restoredSearch({ whose: 'all' })).toBeNull()
  })

  it('has nothing to restore for the defaults or an empty store', () => {
    expect(restoredSearch({})).toBeNull()
    writeStoredFilters(DEFAULT_FILTERS)
    expect(restoredSearch({})).toBeNull()
  })

  it('ignores a corrupt stored value', () => {
    sessionStorage.setItem(FILTERS_STORAGE_KEY, '{nope')
    expect(readStoredFilters()).toBeNull()
    sessionStorage.setItem(FILTERS_STORAGE_KEY, '"all"')
    expect(readStoredFilters()).toBeNull()
  })

  it('degrades silently when storage throws (private window, blocked site data)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => writeStoredFilters({ whose: 'all', status: 'closed' })).not.toThrow()
    expect(readStoredFilters()).toBeNull()
    expect(restoredSearch({})).toBeNull()
  })
})
