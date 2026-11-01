/**
 * money — display and input helpers for amounts (T25, specs/015-hardware-
 * inventory; INC-27). Amounts are integer minor units (cents) end to end —
 * inventory-api never puts a float amount on the wire.
 *
 * Display is the suite's formatter: `formatMoney(cents, currency)` from
 * @operai/ui (`EUR 1,299.00` / `1.299,00 EUR`, following the resolved
 * language), re-exported here so pages keep one import. Parsing is
 * @operai/ui's `parseDecimal`, exact on the decimal string.
 */

import { formatNumber, parseDecimal } from '@operai/ui'

export { formatMoney } from '@operai/ui'

/**
 * The text an amount field starts with when it edits an existing amount
 * (`1299.00` / `1299,00`): the language's decimal mark, no thousands
 * separator, so it reads naturally and `amountToCents` parses it back exactly.
 */
export const centsToInput = (cents: number): string =>
  formatNumber(cents / 100, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })

/**
 * Parses what a user types into a money field (`45.50`, `45,5`, `1299`) into
 * integer cents, or `null` when it is not a valid non-negative amount with at
 * most two decimals — callers treat `null` as "not a valid amount yet", never
 * as 0. Exact decimal-string arithmetic (no float step); a third decimal is
 * refused, never rounded.
 */
export const amountToCents = (raw: string): number | null => parseDecimal(raw, 2)
