import { ApiError } from './api'
import { strings } from '../strings'

/** The message to show for a failed request: the Problem `detail`, else a generic line. */
export function errorMessage(error: unknown): string {
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
