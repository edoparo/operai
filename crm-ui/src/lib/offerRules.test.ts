import { describe, expect, it } from 'vitest'
import {
  basisPointsOfText,
  centsOfText,
  checkOfferLines,
  checkSections,
  computeTotals,
  offerLineToWire,
  quantityOfText,
} from './offerRules'
import type { OfferLineDraft } from './offerRules'

const line = (overrides: Partial<OfferLineDraft>): OfferLineDraft => ({
  description: 'Line',
  kind: 'one_off',
  mode: 'fixed',
  amount: '100',
  quantity: '1',
  ...overrides,
})

describe('amount text', () => {
  it('converts decimal major units to integer cents exactly (no float)', () => {
    expect(centsOfText('1.15')).toBe(115)
    expect(centsOfText('9500.50')).toBe(950_050)
    expect(centsOfText('10,5')).toBe(1050)
    expect(centsOfText('1.005')).toBeNull()
    expect(centsOfText('')).toBeNull()
    expect(centsOfText('-1')).toBeNull()
  })

  it('percentages are basis points, 1 to 10 000', () => {
    expect(basisPointsOfText('12.5')).toBe(1250)
    expect(basisPointsOfText('100')).toBe(10_000)
    expect(basisPointsOfText('0')).toBeNull()
    expect(basisPointsOfText('100.01')).toBeNull()
  })

  it('a quantity is a whole number from 1 to 100 000', () => {
    expect(quantityOfText('3')).toBe(3)
    expect(quantityOfText('0')).toBeNull()
    expect(quantityOfText('1.5')).toBeNull()
    expect(quantityOfText('100001')).toBeNull()
  })
})

describe('computeTotals (the server’s rules)', () => {
  it('line = unit × quantity; the price is the one-off sum net of discounts; yearly is apart', () => {
    const totals = computeTotals([
      line({ amount: '1000', quantity: '10' }),
      line({ kind: 'yearly', amount: '1200' }),
      line({ kind: 'discount', amount: '500' }),
    ])
    expect(totals).toEqual({ oneOffCents: 950_000, yearlyCents: 120_000, discountsExceed: false })
  })

  it('a percentage discount is round half up of the one-off sum, once', () => {
    // 333.33 CHF = 33 333 cents × 12.5% = 4166.625 → 4167.
    const totals = computeTotals([line({ amount: '333.33' }), line({ kind: 'discount', mode: 'percent', amount: '12.5' })])
    expect(totals.oneOffCents).toBe(33_333 - 4_167)
    // Exactly half rounds up: 1 cent at 50% is 0.5 → 1.
    expect(computeTotals([line({ amount: '0.01' }), line({ kind: 'discount', mode: 'percent', amount: '50' })]).oneOffCents).toBe(0)
  })

  it('flags discounts above the one-off lines', () => {
    expect(computeTotals([line({ amount: '100' }), line({ kind: 'discount', amount: '100.01' })]).discountsExceed).toBe(true)
    expect(computeTotals([line({ amount: '100' }), line({ kind: 'discount', amount: '100' })]).discountsExceed).toBe(false)
  })

  it('does not overflow on the largest line the server accepts', () => {
    const totals = computeTotals([line({ amount: '100000000000', quantity: '100000' })])
    expect(totals.oneOffCents).toBe(10_000_000_000_000 * 100_000)
  })
})

describe('validation mirrors the server limits', () => {
  it('a percentage discount is sent as percentBp with quantity 1, a fixed one as unitCents', () => {
    expect(offerLineToWire(line({ kind: 'discount', mode: 'percent', amount: '10', quantity: '4' }))).toEqual({
      description: 'Line',
      kind: 'discount',
      percentBp: 1000,
      quantity: 1,
    })
    expect(offerLineToWire(line({ kind: 'discount', amount: '2.50', quantity: '2' }))).toEqual({
      description: 'Line',
      kind: 'discount',
      unitCents: 250,
      quantity: 2,
    })
  })

  it('needs one one-off line, 1 to 10 lines, and quantity 1 without the unit columns', () => {
    const columns = { position: true, unit: false }
    expect(checkOfferLines([line({ kind: 'yearly' })], columns).list).toBe('oneOff')
    expect(checkOfferLines([], columns).list).toBe('count')
    expect(checkOfferLines(Array.from({ length: 11 }, () => line({})), columns).list).toBe('count')
    expect(checkOfferLines([line({ quantity: '2' })], columns).items).toEqual(['quantityOne'])
    expect(checkOfferLines([line({ quantity: '2' })], { position: true, unit: true }).items).toEqual([null])
  })

  it('sections: 1 to 15, exactly one costs section, heading 1 to 120, body at most 20 000', () => {
    const s = (heading: string, costs = false, body = '') => ({ heading, body, costs })
    expect(checkSections([]).list).toBe('count')
    expect(checkSections(Array.from({ length: 16 }, (_, i) => s(`H${i}`, i === 0))).list).toBe('count')
    expect(checkSections([s('A'), s('B')]).list).toBe('costsSection')
    expect(checkSections([s('A', true), s('B', true)]).list).toBe('costsSection')
    expect(checkSections([s('A', true)]).list).toBeNull()
    expect(checkSections([s(' ', true), s('x'.repeat(121)), s('ok', false, 'x'.repeat(20_001))]).items).toEqual([
      'headingRequired',
      'headingTooLong',
      'bodyTooLong',
    ])
  })
})
