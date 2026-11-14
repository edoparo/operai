/**
 * BatchSubtotalsPanel — one card per **currency** present in a batch/candidate
 * set's `subtotals[]`, never a blended total and never a synthesized
 * zero-value card for an absent currency (T10, specs/20260719-refund-monthly-
 * processing/tasks.md; design.md Component inventory: "SubtotalsPanel is NOT
 * reusable as-is: its Subtotal type mandates requestedCents, but every
 * batch/candidate subtotal on the wire is {currency, approvedCents} only …
 * A lighter one-figure-per-currency card, reusing CurrencyBadge+formatMoney").
 *
 * Unlike `SubtotalsPanel` (007), there is no requested/approved pair here — a
 * batch can only ever contain already-`approved` requests, so "requested"
 * isn't a meaningful second figure at this level. Each card shows exactly one
 * figure: the currency's approved total.
 *
 * Presentational: all data arrives via props; no fetching, no formatting
 * decisions beyond `formatMoney`/`CurrencyBadge` (design.md Accessibility:
 * "never a bare number a screen reader could misread as unitless").
 */

import { strings } from '../strings'
import { formatMoney } from '../lib/money'
import type { BatchSubtotal } from '../lib/batchesApi'
import CurrencyBadge from './CurrencyBadge'

export type BatchSubtotalsPanelProps = {
  subtotals: readonly BatchSubtotal[]
}

export default function BatchSubtotalsPanel({ subtotals }: BatchSubtotalsPanelProps) {
  const t = strings.components.batchSubtotalsPanel

  if (subtotals.length === 0) return null

  // Figure groups only, no border of their own (INC-33): the caller's `Card`
  // is the section (an employee group, the batch summary, the preview total).
  return (
    <div
      data-testid="batch-subtotals-panel"
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}
    >
      {subtotals.map((s) => (
        <div key={s.currency} data-testid={`batch-subtotals-panel-card-${s.currency}`} className="flex flex-col gap-2">
          <CurrencyBadge currency={s.currency} />
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-soft">{t.totalLabel}</dt>
              <dd className="font-mono tabular-nums text-grn-text">{formatMoney(s.approvedCents, s.currency)}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  )
}
