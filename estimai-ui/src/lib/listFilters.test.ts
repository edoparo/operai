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
    expect(filtersFromSearch({ whose: 'all' })).toEqual({ whose: 'all', status: 'open', owner: null })
    expect(searchFromFilters({ whose: 'mine', status: 'closed', owner: null })).toEqual({ status: 'closed' })
    expect(searchFromFilters(DEFAULT_FILTERS)).toEqual({})
  })
})

describe('owner (US-4)', () => {
  it('keeps a non-empty owner, drops a blank, non-string or over-long one', () => {
    expect(validateListSearch({ owner: 'Anna Rossi' })).toEqual({ owner: 'Anna Rossi' })
    expect(validateListSearch({ owner: 'me' })).toEqual({ owner: 'me' })
    expect(validateListSearch({ owner: '  ' })).toEqual({})
    expect(validateListSearch({ owner: 3 })).toEqual({})
    expect(validateListSearch({ owner: 'x'.repeat(201) })).toEqual({})
  })

  it('round-trips through the URL and storage, and a chosen owner is not overridden by a restore', () => {
    const filters = { whose: 'all', status: 'open', owner: 'Anna Rossi' } as const
    expect(filtersFromSearch(searchFromFilters(filters))).toEqual(filters)
    writeStoredFilters(filters)
    expect(readStoredFilters()).toEqual(filters)
    expect(restoredSearch({})).toEqual({ whose: 'all', owner: 'Anna Rossi' })
    expect(restoredSearch({ owner: 'me' })).toBeNull()
  })
})

describe('sessionStorage mirror', () => {
  it('round-trips the last choice', () => {
    writeStoredFilters({ whose: 'all', status: 'closed', owner: null })
    expect(readStoredFilters()).toEqual({ whose: 'all', status: 'closed', owner: null })
  })

  it('restores the stored choice only when /estimates is entered without params', () => {
    writeStoredFilters({ whose: 'all', status: 'open', owner: null })
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
    expect(() => writeStoredFilters({ whose: 'all', status: 'closed', owner: null })).not.toThrow()
    expect(readStoredFilters()).toBeNull()
    expect(restoredSearch({})).toBeNull()
  })
})
