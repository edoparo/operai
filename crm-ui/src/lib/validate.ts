import { strings } from '../strings'

/**
 * Client-side checks mirroring crm-api's limits (plan.md § API contract). The
 * server stays the authority: its 422 names the field and is shown the same way.
 */
const v = () => strings.common.validation

export const required = (value: string): string | null => (value.trim() === '' ? v().required : null)

export const maxLength = (value: string, max: number): string | null =>
  value.trim().length > max ? v().tooLong(max) : null

export const email = (value: string): string | null =>
  value.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? null : v().email

const HTTP_URL = /^https?:\/\/\S+$/i

export const url = (value: string): string | null =>
  value.trim() === '' || HTTP_URL.test(value.trim()) ? null : v().url

/**
 * Whether a stored URL may become an `href`. crm-api already accepts only http(s); this is
 * defence in depth, so a `javascript:` value that ever reached the database renders as text.
 */
export const isHttpUrl = (value: string): boolean => HTTP_URL.test(value.trim())

export const country = (value: string): string | null =>
  value.trim() === '' || /^[A-Za-z]{2}$/.test(value.trim()) ? null : v().country

/** The first message of a list of checks, or null when all pass. */
export const first = (...checks: (string | null)[]): string | null => checks.find((check) => check !== null) ?? null

/** An optional text field on the wire: trimmed, `null` when empty (PATCH clears with null). */
export const optional = (value: string): string | null => (value.trim() === '' ? null : value.trim())

export type Errors<K extends string> = Partial<Record<K, string>>

export const hasErrors = (errors: Errors<string>): boolean => Object.values(errors).some(Boolean)
