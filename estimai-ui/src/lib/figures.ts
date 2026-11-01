import { formatNumber } from '@operai/ui'
import type { Locale } from '@operai/ui'

/**
 * EstimAI's figures for display (INC-27). Days, FTE, months and the AI cost
 * are floats in the estimate model — never integer minor units — so they go
 * through the library's `formatNumber` (locale-aware decimal separator and
 * grouping), never `formatMoney`. Every figure shown is rounded (AGENTS.md
 * § Frontend): these helpers fix the number of decimals the UI has always
 * shown. `locale` is only passed by the exports, which are English documents.
 */

/** One decimal, always shown: 12.0, 3.5 (was `.toFixed(1)`). */
export const oneDecimal = (value: number, locale?: Locale): string =>
  formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }, locale)

/** Up to `max` decimals, trailing zeros dropped: 12, 3.25. */
export const decimal = (value: number, max = 2, locale?: Locale): string =>
  formatNumber(value, { maximumFractionDigits: max }, locale)

/** A whole number: 42, 1,234. */
export const whole = (value: number, locale?: Locale): string =>
  formatNumber(value, { maximumFractionDigits: 0 }, locale)

/** A 0–1 fraction as a whole percentage: 0.3 → 30%. */
export const percent = (fraction: number, locale?: Locale): string =>
  formatNumber(fraction, { style: 'percent', maximumFractionDigits: 0 }, locale)
