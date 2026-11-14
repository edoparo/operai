import { ApiError } from './api'
import { strings } from '../strings'

/** The Problem `code`s with which activities-api says it cannot answer at all (specs/20261110-activities AC-1.5). */
export type ActivitiesUnavailable = 'host_unavailable' | 'maintenance'

/**
 * Which "activities unavailable" state a failure is, or null. It reads the Problem `code`, never the
 * status: a bare 503 is still the authorization outage (ADR 20260716-refund-api-authorization-enforcing-resource-server) and keeps its own wording.
 */
export function activitiesUnavailableOf(error: unknown): ActivitiesUnavailable | null {
  if (!(error instanceof ApiError)) return null
  return error.code === 'host_unavailable' || error.code === 'maintenance' ? error.code : null
}

/** The message to show for a failed request: the Problem `detail`, else a generic line. */
export function errorMessage(error: unknown): string {
  const unavailable = activitiesUnavailableOf(error)
  if (unavailable) return strings.activities.unavailable[unavailable].save
  if (error instanceof ApiError) return error.detail ?? strings.common.unknownError
  return strings.common.networkError
}

export const statusOf = (error: unknown): number | null => (error instanceof ApiError ? error.status : null)

/** A 422 that names a field (`field` extension member): that field's server message. */
export function fieldErrorOf(error: unknown): { field: string; message: string } | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null
  const field = error.extras['field']
  return typeof field === 'string' && field !== ''
    ? { field, message: error.detail ?? strings.common.validation.fixErrors }
    : null
}

/** The Problem `code` of a failed request, or null. */
export const codeOf = (error: unknown): string | null => (error instanceof ApiError ? (error.code ?? null) : null)
