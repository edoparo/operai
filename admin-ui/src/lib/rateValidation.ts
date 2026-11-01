/**
 * Client-side checks for a new mileage-rate entry (Modal ADM-M1) — shared by
 * the modal (blur) and MileageRatesPage (submit). refund-api stays the source
 * of truth (its 422s map onto the same fields).
 */
import { parseDecimal } from '@operai/ui'
import { strings } from '../strings'

export const RATE_ERROR = strings.rates.rateError
export const VALID_FROM_ERROR = strings.rates.validFromError

/** The rate's field error, or null when it parses to a positive amount of micros (≤ 6 decimals). */
export const validateRate = (rate: string): string | null => {
  const micros = parseDecimal(rate, 6)
  return micros === null || micros <= 0 ? RATE_ERROR : null
}

/** The valid-from field error, or null for an ISO `YYYY-MM-DD` date. */
export const validateValidFrom = (validFrom: string): string | null =>
  /^\d{4}-\d{2}-\d{2}$/.test(validFrom) ? null : VALID_FROM_ERROR
