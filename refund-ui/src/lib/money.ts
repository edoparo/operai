/**
 * money — refund-ui's money display (T14, specs/007; plan.md R7: one shared
 * cents → display formatter). INC-27: the formatting itself is the suite's
 * `formatMoney`/`formatAmount` from `@operai/ui` (Intl, the resolved locale:
 * `EUR 1,234.50` in English, `1234,50 EUR` in Italian); this module only
 * keeps refund's own contract on top of it — integer cents in, a RangeError
 * for anything else (money is not a place to guess) — and the two refund
 * compositions (`describeApprovedAmount`, `formatRatePerKm`).
 *
 * Input is always integer minor units: refund-api never puts a float amount on
 * the wire (ADR-0025). Parsing typed amounts is `parseDecimal`'s job
 * (`lineDraft.ts`), never this module's.
 */

import { formatAmount, formatMoney as formatMoneyIntl, formatNumber } from '@operai/ui'
import { strings } from '../strings'

export type Currency = 'EUR' | 'CHF' | 'USD' | 'GBP'

const assertCents = (name: string, cents: number) => {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`${name}: cents must be an integer, got ${cents}`)
  }
}

/**
 * An amount with its ISO currency code — never a bare, unitless number
 * (design.md Accessibility).
 */
export const formatMoney = (cents: number, currency: Currency): string => {
  assertCents('formatMoney', cents)
  return formatMoneyIntl(cents, currency)
}

/**
 * Minor units WITHOUT a currency — only for a value that sits beside one
 * already carrying its currency ("requested 180.00 · −26.00" under
 * "CHF 154.00"). Never for a standalone figure.
 */
export const formatMoneyAmount = (cents: number): string => {
  assertCents('formatMoneyAmount', cents)
  return formatAmount(cents)
}

/**
 * What a reviewer actually needs to read about one amount: the approved
 * figure, plus the requested one and the delta ONLY when accounting changed
 * something.
 *
 * The screens used to print "Requested X / Approved X" unconditionally at both
 * the line and the totals level — six numbers for three distinct values on a
 * typical request, every one of them a duplicate. The single fact a review
 * screen is scanned for is where a figure was cut, and that fact was buried in
 * a wall of identical pairs.
 *
 * This lives in `lib/` rather than in either component because the per-line
 * row and the per-currency totals card must never disagree about whether an
 * amount changed. Two independent comparisons would be two chances to drift.
 *
 * `approvedCents === null` means "no decision recorded for this line", which
 * refund-api treats as approving the requested amount in full — so it is an
 * UNCHANGED amount here, not an unknown one.
 */
export type ApprovedAmount =
  | { readonly changed: false; readonly approved: string }
  | {
      readonly changed: true
      readonly approved: string
      /** Bare, no currency — it sits inside the approved figure's parenthetical. */
      readonly requested: string
      /** Signed, bare — e.g. `−26,00` when accounting cut the amount. */
      readonly delta: string
    }

export const describeApprovedAmount = (
  requestedCents: number,
  approvedCents: number | null,
  currency: Currency,
): ApprovedAmount => {
  const approvedValue = approvedCents ?? requestedCents

  if (approvedValue === requestedCents) {
    return { changed: false, approved: formatMoney(approvedValue, currency) }
  }

  const diff = approvedValue - requestedCents
  // U+2212 MINUS, not a hyphen: this is a mathematical sign shown next to
  // figures, and the hyphen renders visibly shorter beside tabular digits.
  // A rise is signed too — accounting raising a figure is just as notable as
  // cutting one, and an unsigned delta would read as a cut by default.
  const sign = diff < 0 ? '\u2212' : '+'

  return {
    changed: true,
    approved: formatMoney(approvedValue, currency),
    requested: formatMoneyAmount(requestedCents),
    delta: `${sign}${formatMoneyAmount(Math.abs(diff))}`,
  }
}

/**
 * A per-km mileage rate, e.g. `CHF 0.70/km` (en) / `0,70 CHF/km` (it) — the
 * same currency placement as `formatMoney`, so the employee's live
 * `km × rate = amount` breakdown and accounting's "Rate applied" read alike
 * (specs/009). `ratePerKm` is refund-api's own decimal STRING ("0.70"); its
 * precision is kept (never rounded to two places), and the value is never
 * re-derived from micros here — that is `computeMileageAmountCents`'s job.
 */
export const formatRatePerKm = (ratePerKm: string, currency: Currency): string => {
  const decimals = ratePerKm.split('.')[1]?.length ?? 0
  const rate = formatNumber(Number(ratePerKm), {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: Math.max(2, decimals),
    maximumFractionDigits: Math.max(2, decimals),
  }).replace(/[\u00a0\u202f]/g, ' ')
  return strings.units.perKm(rate)
}
