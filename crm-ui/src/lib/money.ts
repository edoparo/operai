import { formatMoney, formatNumber } from '@operai/ui'
import type { Currency, PipelineTotal } from './types'

/**
 * money — the app's one money-display helper (building-pages § 5). Amounts are
 * integer minor units from the API; nothing here computes a figure the API
 * owns except the single deal's weighted amount, with the same rule as the
 * server (D-9: round half up, once).
 */

export const dealAmount = (amountCents: number, currency: Currency): string => formatMoney(amountCents, currency)

/** `roundHalfUp(amount × probability / 100)` — the per-deal weighted amount (D-9). */
export function weightedCents(amountCents: number, probabilityPercent: number): number {
  return Math.floor((amountCents * probabilityPercent + 50) / 100)
}

/** Per-currency totals as display strings, CHF first; an empty list shows nothing. */
export function formatTotals(totals: readonly PipelineTotal[], pick: 'amountCents' | 'weightedCents'): string[] {
  return [...totals]
    .sort((a, b) => a.currency.localeCompare(b.currency))
    .map((total) => formatMoney(total[pick], total.currency))
}

/** Minor units back to the text an amount field holds (`4500050` → `45000.50`, `4500000` → `45000`), read back by `parseDecimal`. */
export function centsToInput(cents: number): string {
  const whole = Math.floor(cents / 100)
  const fraction = cents % 100
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`
}

/** A stage's win probability (0–100, from `GET /pipeline`) as a localised percentage. */
export const percent = (value: number): string => formatNumber(value / 100, { style: 'percent' })
