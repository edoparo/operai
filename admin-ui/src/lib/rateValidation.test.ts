/**
 * Client-side checks for a new mileage rate (INC-17): the rate is parsed
 * exactly into integer micros — the precision refund-api stores
 * (`ratePerKmMicros`, ADR-0025) — accepting a comma or a dot.
 */

import { describe, expect, it } from 'vitest'
import { parseDecimal } from '@operai/ui'
import { RATE_ERROR, VALID_FROM_ERROR, validateRate, validateValidFrom } from './rateValidation'

describe('validateRate', () => {
  it.each(['0.72', '0,72', '1', '0.000001', '0.123456', ' 0.7 '])('accepts %j', (rate) => {
    expect(validateRate(rate)).toBeNull()
  })

  it.each(['', '0', '0.0', '0,000000', '-0.5', 'abc', '0.1234567', '1.2.3', '1e3', '.5'])('rejects %j', (rate) => {
    expect(validateRate(rate)).toBe(RATE_ERROR)
  })

  it('parses into exact micros, never through a float', () => {
    expect(parseDecimal('0,72', 6)).toBe(720_000)
    expect(parseDecimal('1.15', 6)).toBe(1_150_000)
    expect(parseDecimal('0.000001', 6)).toBe(1)
  })
})

describe('validateValidFrom', () => {
  it('accepts an ISO date and rejects anything else', () => {
    expect(validateValidFrom('2026-08-01')).toBeNull()
    expect(validateValidFrom('')).toBe(VALID_FROM_ERROR)
    expect(validateValidFrom('01/08/2026')).toBe(VALID_FROM_ERROR)
  })
})
