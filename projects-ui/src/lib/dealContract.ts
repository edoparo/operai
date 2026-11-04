/**
 * The contract half of taking a deal (specs/022 AC-1.2, AC-1.4): the dates and the terms of the
 * project's type, as the form holds them and as `POST /queue/{dealId}/project` and `/attach`
 * take them. The checks are the ones of a contract entered by hand (`lib/contractTerms.ts`); the
 * server stays the authority.
 */
import { strings } from '../strings'
import { termsInputOf } from './contractTerms'
import type { TermsErrors, TermsForm } from './contractTerms'
import type { ContractTermsInput, DealContractInput, ProjectType } from './types'

export type DealContractForm = { startDate: string; endDate: string; terms: TermsForm }

/**
 * `estimateBacked`: the deal has an estimate, so a `fixed_price` contract takes its estimated
 * man-days from it (AC-3.1) and the request must not carry the member at all — the server refuses
 * it sent, even empty (`estimated_man_days_from_estimate`).
 */
export function dealContractOf(
  type: ProjectType,
  form: DealContractForm,
  { estimateBacked }: { estimateBacked: boolean },
): { input: DealContractInput; errors: TermsErrors } {
  const errors: TermsErrors = {}
  if (form.startDate === '') errors['startDate'] = strings.common.validation.required
  if (form.endDate !== '' && form.startDate !== '' && form.endDate < form.startDate) {
    errors['endDate'] = strings.contracts.errors.endBeforeStart
  }
  const checked = termsInputOf(type, form.terms)
  const terms = estimateBacked && type === 'fixed_price' ? withoutEstimatedManDays(checked.input) : checked.input
  return {
    input: { startDate: form.startDate, ...(form.endDate !== '' ? { endDate: form.endDate } : {}), terms },
    errors: { ...errors, ...checked.errors },
  }
}

/**
 * The terms of a contract the estimate backs, as a request may carry them: with no
 * `estimatedManDays` member at all. Used when a contract is made from a deal and when one
 * made from a deal is edited (`PATCH`): the server refuses the member either way (AC-3.1).
 */
export function withoutEstimatedManDays(terms: ContractTermsInput): ContractTermsInput {
  return Object.fromEntries(
    Object.entries(terms).filter(([member]) => member !== 'estimatedManDays'),
  ) as ContractTermsInput
}
