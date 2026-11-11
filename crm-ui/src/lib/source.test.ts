import { describe, expect, it } from 'vitest'
import { foldDetail, matchDetails } from './source'

const items = [{ value: 'Swiss Digital Day 2026' }, { value: 'Café Tech' }, { value: 'Digital Summit' }]

describe('source detail suggestions (specs/017 US-7)', () => {
  it('folds case, accents and spacing like crm-api', () => {
    expect(foldDetail('  Café   TECH ')).toBe('cafe tech')
  })

  it('offers every entry for an empty field, keeping the order of use', () => {
    expect(matchDetails(items, '')).toEqual(['Swiss Digital Day 2026', 'Café Tech', 'Digital Summit'])
  })

  it('matches anywhere in the text, ignoring case and accents', () => {
    expect(matchDetails(items, 'DIGITAL')).toEqual(['Swiss Digital Day 2026', 'Digital Summit'])
    expect(matchDetails(items, 'cafe')).toEqual(['Café Tech'])
  })

  it('offers nothing once the text is exactly an entry, but still offers it for another spelling', () => {
    expect(matchDetails(items, 'Café Tech')).toEqual([])
    expect(matchDetails(items, 'cafe tech')).toEqual(['Café Tech'])
  })
})
