import { ApiError } from './api'
import { strings } from '../strings'

/** The message to show for a failed request: the Problem `detail`, else a generic line. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail ?? strings.common.unknownError
  return strings.common.networkError
}

export const statusOf = (error: unknown): number | null => (error instanceof ApiError ? error.status : null)

/** The Problem `code` of a failed request, or null. */
export const codeOf = (error: unknown): string | null => (error instanceof ApiError ? (error.code ?? null) : null)

/**
 * A refusal that names a field: a 400 `validation_failed` or a 422, carrying a
 * `field` extension member (dotted for nested ones, e.g. `terms.sla.highDays`).
 * An empty `field` is a problem with the body as a whole, not with one input.
 */
export function fieldErrorOf(error: unknown): { field: string; message: string } | null {
  if (!(error instanceof ApiError) || (error.status !== 400 && error.status !== 422)) return null
  const field = error.extras['field']
  return typeof field === 'string' && field !== ''
    ? { field, message: error.detail ?? strings.common.validation.fixErrors }
    : null
}

/** The ids a 422 `not_project_user` refuses (a PM or team member without access, AC-1.6). */
export function userIdsOf(error: unknown): string[] {
  if (!(error instanceof ApiError)) return []
  const ids = error.extras['userIds']
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

/**
 * The refusals of taking a deal (`POST /queue/{dealId}/project` and `/attach`) that
 * the UI words itself, each with its own message under `strings.queue.take.errors`
 * (AC-1.5). The server's `detail` is the fallback for any other failure.
 */
export const TAKE_REFUSALS = [
  'deal_not_found',
  'deal_not_won',
  'deal_taken',
  'out_of_scope',
  'not_project_user',
  'contracts_not_allowed',
  'project_not_open',
  'company_mismatch',
  'estimated_man_days_from_estimate',
  'crm_unavailable',
  'estimai_unavailable',
  'estimai_unconfigured',
] as const
export type TakeRefusal = (typeof TAKE_REFUSALS)[number]

/** The refusal of a take that has its own message, or null. */
export function takeRefusalOf(error: unknown): TakeRefusal | null {
  const code = codeOf(error)
  return TAKE_REFUSALS.find((known) => known === code) ?? null
}
