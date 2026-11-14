/**
 * lineDraft — the shared "in-progress expense line form" shape and its
 * validation/conversion helpers, used by both `ExpenseLineComposer` (a new,
 * not-yet-persisted line) and `ExpenseLineRow` (an existing persisted line
 * being edited in place) — T16, specs/20260716-refund-service/tasks.md.
 *
 * A draft's fields are always plain strings (what an `<input>`/`<select>`
 * actually holds), never the typed wire values `POST/PUT
 * /requests/:id/lines[/:lineId]` expect — `lineDraftToPayload` is the one
 * place that conversion happens, so the two call sites (composer/row) never
 * duplicate it. Money is entered as major units (e.g. "45.50") and converted
 * to integer cents here — `amountToCents` returns `null` for anything that
 * isn't a valid non-negative number, which both `isLineDraftComplete` and
 * every caller treat as "not yet valid," never as "0".
 *
 * `km` is deliberately kept as a *string* field on the draft — its numeric
 * meaning is `ExpenseType`-conditional (required & `>0` only for
 * `travel_km`, plan.md "## API contracts": "km required and > 0 iff
 * type==travel_km, rejected if present for any other type") — carrying the
 * type-driven presence/validity logic here means `ExpenseLineComposer`/
 * `ExpenseLineRow` don't each reimplement the branch.
 *
 * `currency` (post-close change, specs/20260716-refund-service): a separately-stored,
 * independently-selectable field — no longer derived from `entity` — with
 * its own no-default select (same "explicit, deliberate choice" pattern as
 * `entity`/`type`, AC-1.2). Any entity/currency pair is valid; this module
 * never cross-validates the two.
 */

import type { ExpenseType } from './expenseTypes'
import { requiresKm } from './expenseTypes'
import type { Entity } from '../components/EntityBadge'
import type { Currency } from './money'
import type { LinePayload, RefundLine } from './requestsApi'
import { todayIsoDate } from './dates'
import { parseDecimal } from '@operai/ui'

export type LineDraftValue = {
  date: string
  type: ExpenseType | ''
  motivo: string
  /** Major-unit amount as typed, e.g. "45.50" — never cents. */
  amount: string
  entity: Entity | ''
  /** Independent of `entity` — no default, any entity/currency pair is valid. */
  currency: Currency | ''
  /** Only meaningful when `type` requires km (`requiresKm`) — ignored otherwise. */
  km: string
}

/** A fresh draft for `ExpenseLineComposer` — no default type/entity/currency (AC-1.2: "no default … an explicit, deliberate choice"). */
export const emptyLineDraft = (): LineDraftValue => ({
  date: todayIsoDate(),
  type: '',
  motivo: '',
  amount: '',
  entity: '',
  currency: '',
  km: '',
})

/** Converts a persisted `RefundLine` into an editable draft for `ExpenseLineRow`. */
export const lineToDraft = (line: RefundLine): LineDraftValue => ({
  date: line.date,
  type: line.type,
  motivo: line.motivo,
  amount: centsToAmountInput(line.requestedAmountCents),
  entity: line.entity,
  currency: line.currency,
  km: line.km !== null ? String(line.km) : '',
})

/**
 * Parses a major-unit amount string (e.g. "45.50" or "45,50") into integer
 * cents. Delegates to @operai/ui's `parseDecimal` (INC-17): exact string
 * parsing, a comma or a dot, at most two decimals — never `Math.round(n * 100)`
 * (ADR 20260720-mileage-rate-money-precision-integer-micros: round exactly once, at compute time; an amount typed with a third
 * decimal is refused, not silently rounded). Returns `null` for empty, negative,
 * exponent or otherwise malformed input — callers must treat `null` as "not a
 * valid amount yet," never coerce it to `0`.
 */
export const amountToCents = (raw: string): number | null => parseDecimal(raw, 2)

/** The inverse of `amountToCents`, for pre-filling an existing line's amount field. */
export const centsToAmountInput = (cents: number): string => (cents / 100).toFixed(2)

/**
 * True once every field required for the draft's *current* type is present
 * and valid (AC-1.2) — `km` is only checked when `requiresKm(type)`, and its
 * absence/invalidity never blocks a draft of any other type.
 *
 * specs/20260720-mileage-rate amendment (design.md F1 "Add/Done enable
 * condition"): for `travel_km`, "complete" becomes date + type + motivo +
 * entity + `km > 0` — amount/currency are DROPPED from this check (they no
 * longer exist as fields for this type, AC-1.1). `rateInEffect` is
 * deliberately NOT part of completeness either — a line with no rate
 * configured yet is still a valid, saveable draft (AC-2.2's blocked state is
 * a submission-time gate, not a save-time one).
 */
export const isLineDraftComplete = (draft: LineDraftValue): boolean => lineDraftInvalidFields(draft).length === 0

/** A draft's editable fields, in the order the composer and the row render them. */
export type LineDraftField = 'date' | 'type' | 'motivo' | 'amount' | 'entity' | 'currency' | 'km'

/**
 * The fields of `draft` that are missing or invalid for its *current* type, in
 * render order (INC-16: per-field errors, focus the first invalid one). The
 * same rules `isLineDraftComplete` has always applied — `km > 0` only for
 * `travel_km`, amount/currency only for every other type — so a draft is
 * complete exactly when this is empty.
 */
export const lineDraftInvalidFields = (draft: LineDraftValue): LineDraftField[] => {
  const invalid: LineDraftField[] = []
  if (!draft.date) invalid.push('date')
  if (!draft.type) invalid.push('type')
  if (draft.motivo.trim() === '') invalid.push('motivo')
  const km = draft.type !== '' && requiresKm(draft.type)
  if (!km && amountToCents(draft.amount) === null) invalid.push('amount')
  if (!draft.entity) invalid.push('entity')
  if (!km && !draft.currency) invalid.push('currency')
  if (km) {
    const n = Number(draft.km)
    if (draft.km.trim() === '' || !Number.isFinite(n) || n <= 0) invalid.push('km')
  }
  return invalid
}

/** True while nothing but the pre-filled date has been entered — the only state in which "Add line" is disabled (INC-16). */
export const isLineDraftBlank = (draft: LineDraftValue): boolean =>
  draft.type === '' &&
  draft.motivo === '' &&
  draft.amount === '' &&
  draft.entity === '' &&
  draft.currency === '' &&
  draft.km === ''

/**
 * Converts a complete draft into the wire payload `POST/PUT
 * /requests/:id/lines[/:lineId]` expects. Only call once
 * `isLineDraftComplete(draft)` is true — an incomplete draft's payload would
 * carry a `0`/`NaN` in place of a required field.
 *
 * specs/20260720-mileage-rate amendment (AC-1.1/AC-1.6, plan.md "## API
 * contracts"): for `travel_km`, `requestedAmountCents`/`currency` are
 * server-derived and OMITTED from the payload entirely — never a
 * client-guessed `0`/entity guess sent as if it were authoritative. Every
 * other type is unchanged: both fields are always included.
 */
export const lineDraftToPayload = (draft: LineDraftValue): LinePayload => {
  const type = draft.type as ExpenseType
  const payload: LinePayload = {
    date: draft.date,
    type,
    motivo: draft.motivo.trim(),
    entity: draft.entity as Entity,
  }
  if (requiresKm(type)) {
    payload.km = Number(draft.km)
  } else {
    payload.requestedAmountCents = amountToCents(draft.amount) ?? 0
    payload.currency = draft.currency as Currency
  }
  return payload
}
