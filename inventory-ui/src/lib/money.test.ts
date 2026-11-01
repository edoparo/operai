/**
 * Unit tests for the money helpers (T25, specs/015-hardware-inventory),
 * carried over from refund-ui/src/lib/money.test.ts (EUR and CHF only — the
 * only two currencies inventory-api carries) plus `amountToCents`, the
 * money-input parser ported from refund-ui's `lineDraft.ts` and tightened:
 * exact decimal-string arithmetic, no float step, no silent rounding of a
 * third decimal.
 */
import { describe, expect, it } from 'vitest'
import { amountToCents, centsToInput, formatMoney } from './money'

// Display is @operai/ui's formatter since INC-27 (its own tests cover the
// locales); these pin what inventory shows through it, in English (the test
// browser's language), and the integer-cents contract.
describe('formatMoney (the suite formatter, re-exported)', () => {
  it('shows the ISO code and two decimals, with grouping', () => {
    expect(formatMoney(10000, 'EUR')).toBe('EUR 100.00')
    expect(formatMoney(4550, 'CHF')).toBe('CHF 45.50')
    expect(formatMoney(129900000, 'EUR')).toBe('EUR 1,299,000.00')
  })

  it('pads single-digit cents (off-by-100 guard) and formats zero', () => {
    expect(formatMoney(5, 'EUR')).toBe('EUR 0.05')
    expect(formatMoney(0, 'CHF')).toBe('CHF 0.00')
  })

  it('signs a negative amount with a real minus sign', () => {
    expect(formatMoney(-2600, 'EUR')).toBe('−EUR 26.00')
  })

  it('follows Italian conventions in Italian', () => {
    expect(formatMoney(1234550, 'EUR', 'it')).toBe('12.345,50 EUR')
  })

  it('throws on a non-integer or non-finite cents value rather than mis-rendering an amount', () => {
    expect(() => formatMoney(45.5, 'EUR')).toThrow()
    expect(() => formatMoney(Number.NaN, 'EUR')).toThrow()
    expect(() => formatMoney(Number.POSITIVE_INFINITY, 'CHF')).toThrow()
  })
})

describe('centsToInput', () => {
  it('prefills an amount field with two decimals and no thousands separator, parseable back exactly', () => {
    expect(centsToInput(15400)).toBe('154.00')
    expect(centsToInput(129900000)).toBe('1299000.00')
    expect(amountToCents(centsToInput(129905))).toBe(129905)
  })
})

describe('amountToCents', () => {
  it('parses a major-unit string into integer cents', () => {
    expect(amountToCents('45.50')).toBe(4550)
    expect(amountToCents('0')).toBe(0)
    expect(amountToCents('1299')).toBe(129900)
  })

  it('accepts a comma decimal separator, the suite display convention', () => {
    expect(amountToCents('45,5')).toBe(4550)
    expect(amountToCents('0,05')).toBe(5)
  })

  it('trims surrounding whitespace', () => {
    expect(amountToCents('  12.30 ')).toBe(1230)
  })

  it('is exact where float multiplication is not (1.15 * 100 is 114.99999999999999)', () => {
    expect(amountToCents('1.15')).toBe(115)
    expect(amountToCents('8.2')).toBe(820)
  })

  it('returns null for empty input, never 0', () => {
    expect(amountToCents('')).toBeNull()
    expect(amountToCents('   ')).toBeNull()
  })

  it('returns null for negative, non-numeric or exponent input', () => {
    expect(amountToCents('-5')).toBeNull()
    expect(amountToCents('abc')).toBeNull()
    expect(amountToCents('1e3')).toBeNull()
    expect(amountToCents('1.2.3')).toBeNull()
    expect(amountToCents('12 CHF')).toBeNull()
  })

  it('returns null for a third decimal instead of rounding a price silently', () => {
    expect(amountToCents('1.005')).toBeNull()
  })

  it('returns null for an amount beyond the safe integer range', () => {
    expect(amountToCents('99999999999999999')).toBeNull()
  })
})
