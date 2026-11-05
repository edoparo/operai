/**
 * The terms of a request (specs/022 AC-1.2, AC-1.8, AC-5.3): the dates and the members of the
 * project's type, as the form holds them, built into the one `TermsInput` that a take
 * (`POST /queue/{dealId}/project`), a hand-made create (`POST /projects`) and the terms routes
 * carry — dates and members side by side, as `Terms` reads back. The checks are those of
 * `lib/terms.ts`; the server stays the authority. This is the one place that knows the request's shape.
 */
import { strings } from '../strings'
import { termsInputOf } from './terms'
import type { TermsErrors, TermsForm } from './terms'
import type { ProjectType, TermsInput } from './types'

export type TermsRequestForm = { startDate: string; endDate: string; terms: TermsForm }

/**
 * `estimateBacked`: the project comes from a deal with an estimate, so fixed-price terms take their
 * estimated man-days from it (AC-3.1) and the request must not carry the member at all — the
 * server refuses it sent, even empty (`estimated_man_days_from_estimate`).
 */
export function termsRequestOf(
  type: ProjectType,
  form: TermsRequestForm,
  { estimateBacked }: { estimateBacked: boolean },
): { input: TermsInput; errors: TermsErrors } {
  const errors: TermsErrors = {}
  if (form.startDate === '') errors['startDate'] = strings.common.validation.required
  if (form.endDate !== '' && form.startDate !== '' && form.endDate < form.startDate) {
    errors['endDate'] = strings.terms.errors.endBeforeStart
  }
  const checked = termsInputOf(type, form.terms)
  const members = estimateBacked && type === 'fixed_price' ? withoutEstimatedManDays(checked.input) : checked.input
  return {
    input: { startDate: form.startDate, ...(form.endDate !== '' ? { endDate: form.endDate } : {}), ...members },
    errors: { ...errors, ...checked.errors },
  }
}

/**
 * The members of terms the estimate backs, as a request may carry them: with no
 * `estimatedManDays` member at all. Used when terms are made from a deal and when terms
 * of a project made from a deal are edited (`PATCH`): the server refuses the member either way (AC-3.1).
 */
export function withoutEstimatedManDays<T extends object>(terms: T): Omit<T, 'estimatedManDays'> {
  return Object.fromEntries(Object.entries(terms).filter(([member]) => member !== 'estimatedManDays')) as Omit<
    T,
    'estimatedManDays'
  >
}

/**
 * Server `field`s as the forms key their errors: `startDate` / `endDate` are the dates, everything else is
 * a member of the terms, keyed `terms.<member>` (`terms.sla.highDays`). The server's own paths vary with the
 * route — `terms.deadline` in a take or a hand-made create, `deadline` on the terms routes — so any leading
 * `terms.` is dropped first.
 */
export function termsFieldKey(serverField: string): string {
  if (serverField === 'terms') return 'terms'
  const bare = serverField.replace(/^(?:terms\.)+/, '')
  return bare === 'startDate' || bare === 'endDate' || bare === '' ? bare : `terms.${bare}`
}
