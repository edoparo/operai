/**
 * settingsApi — refund-api's refund-settings surface (specs/011-refund-settings,
 * ADR-0027/0028), for the Settings tab (moved here from admin-ui, 2026-11-13).
 * `settings:read` / `settings:manage` are enforced server-side on both read and
 * write; errors are refundApi's `ApiError` (403 without the grant, 404 for an
 * unknown key, 422 for a malformed email — nothing persisted).
 */
import { getJson, sendJson } from './refundApi'

/** The one registered setting key. */
export const ACCOUNTING_DISTRIBUTION_EMAIL_KEY = 'accounting-distribution-email'

/** One entry in a setting's chronological change history (AC-5.3). */
export type SettingHistoryEntry = {
  value: string | null
  changedAt: string
  changedByEmail: string
}

/** `GET` / `PUT /settings/:key`. */
export type SettingResult = {
  key: string
  value: string | null
  configured: boolean
  updatedAt: string | null
  updatedByEmail: string | null
  history: SettingHistoryEntry[]
}

export const getSetting = (key: string): Promise<SettingResult> =>
  getJson<SettingResult>(`/settings/${encodeURIComponent(key)}`)

/** `null` clears the setting (AC-1.4). */
export const putSetting = (key: string, value: string | null): Promise<SettingResult> =>
  sendJson<SettingResult>(`/settings/${encodeURIComponent(key)}`, 'PUT', { value })
