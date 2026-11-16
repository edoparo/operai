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

/**
 * crm-api refuses a NUL (U+0000) in free text with a 422 that names the field and carries no code of its own
 * (crm-api/src/lib/http.ts `NO_NUL_TEXT`; the template route says "Must not contain a NUL character"). The wording of
 * the server's message is therefore the only discriminator, and it is matched here and nowhere else. The body never
 * echoes the value, so nothing about the text itself is read.
 */
const NUL_REFUSAL_MARKER = 'NUL character'

const nulMessageOf = (error: ApiError): string | null => {
  const errors = error.extras['errors']
  const first: unknown = Array.isArray(errors) ? errors[0] : undefined
  const message =
    typeof first === 'object' && first !== null && 'message' in first ? (first as { message: unknown }).message : null
  return typeof message === 'string' ? message : (error.detail ?? null)
}

/** A 422 refusing a character that cannot be saved (a NUL) in a text the person typed or pasted. */
export function isNulRefusal(error: unknown): boolean {
  return error instanceof ApiError && error.status === 422 && (nulMessageOf(error) ?? '').includes(NUL_REFUSAL_MARKER)
}

/** The field the server named in such a refusal (`addressLines.1`, `source`), or null for any other failure. */
export function nulRefusedFieldOf(error: unknown): string | null {
  if (!isNulRefusal(error)) return null
  const field = (error as ApiError).extras['field']
  return typeof field === 'string' && field !== '' ? field : null
}

/**
 * The message to show for a failed request: the Problem `detail`, else a generic line. A refused character is the one
 * server message always rewritten as copy of our own: the server's line is English and carries an internal field key.
 */
export function errorMessage(error: unknown): string {
  const unavailable = activitiesUnavailableOf(error)
  if (unavailable) return strings.activities.unavailable[unavailable].save
  if (isNulRefusal(error)) return strings.common.validation.noNul
  if (error instanceof ApiError) return error.detail ?? strings.common.unknownError
  return strings.common.networkError
}

export const statusOf = (error: unknown): number | null => (error instanceof ApiError ? error.status : null)

/** A 422 that names a field (`field` extension member): that field's server message. */
export function fieldErrorOf(error: unknown): { field: string; message: string } | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null
  const field = error.extras['field']
  if (typeof field !== 'string' || field === '') return null
  return {
    field,
    message: isNulRefusal(error)
      ? strings.common.validation.noNul
      : (error.detail ?? strings.common.validation.fixErrors),
  }
}

/** The Problem `code` of a failed request, or null. */
export const codeOf = (error: unknown): string | null => (error instanceof ApiError ? (error.code ?? null) : null)
