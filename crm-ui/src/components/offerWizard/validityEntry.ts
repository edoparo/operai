import type { StepKey } from '../../lib/offerEngine/syntax'
import { LIMITS } from '../../lib/offerRules'

/** The server's own bounds for `validityDays` (crm-api `answersSchema.ts`): a whole number of days, 1 to 365. */
const { min: MIN_DAYS, max: MAX_DAYS } = LIMITS.validity

/**
 * What is typed in the validity field and is NOT a valid number of days. The answers cannot hold it (the server
 * refuses a `validityDays` outside 1 to 365 and the draft would stop saving), so the wizard keeps it above the step:
 * it survives a move to another step, shows on the field, and counts as an issue on the Preview step, which names
 * the field and blocks Generate until it is a valid number again (AC-3.5, AC-3.6; QE D14).
 */
export interface ValidityEntry {
  /** What the person typed, as typed. */
  text: string
  /** The issue's focus target: the template field bound to the validity, or `validityDays` for the Costs card's own input. */
  name: string
  /** The issue's label, plain text; the Costs card's own input says "Offer validity (days)". */
  label: string
  /** The step that holds the control, for the issue's jump and the step's count. */
  step: StepKey
  /** `empty` is a missing answer, the others an invalid one. */
  reason: 'empty' | 'not_integer' | 'days_out_of_range'
}

/** What a typed text means: a valid number of days, or the reason it is not one. */
export function readValidity(text: string): { days: number } | { reason: ValidityEntry['reason'] } {
  const typed = text.trim()
  if (typed === '') return { reason: 'empty' }
  if (!/^\d+$/.test(typed)) return { reason: 'not_integer' }
  const days = Number(typed)
  return days >= MIN_DAYS && days <= MAX_DAYS ? { days } : { reason: 'days_out_of_range' }
}
