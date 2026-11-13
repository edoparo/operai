/**
 * Client-side checks for a new mileage-rate entry — shared by the add dialog
 * (blur) and the Settings page (submit). refund-api stays the source of truth
 * (its 422s map onto the same fields).
 */
import { parseDecimal } from '@operai/ui'
import { strings } from '../strings'

/** The rate's field error, or null when it parses to a positive amount of micros (≤ 6 decimals, ADR-0025). */
export const validateRate = (rate: string): string | null => {
  const micros = parseDecimal(rate, 6)
  return micros === null || micros <= 0 ? strings.settings.rateError : null
}

/** The valid-from field error, or null for an ISO `YYYY-MM-DD` date. */
export const validateValidFrom = (validFrom: string): string | null =>
  /^\d{4}-\d{2}-\d{2}$/.test(validFrom) ? null : strings.settings.validFromError
