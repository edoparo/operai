/**
 * @vitest-environment jsdom
 *
 * settingsApi — the accounting distribution email setting (specs/011), called
 * from the Settings tab. `apiFetch` is mocked; refund-api's base URL is the
 * app's own env.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('shell/session', () => ({ apiFetch: vi.fn() }))

import { apiFetch } from 'shell/session'
import { ACCOUNTING_DISTRIBUTION_EMAIL_KEY, getSetting, putSetting } from './settingsApi'
import { ApiError } from './refundApi'

const REFUND_API_URL = 'http://refund-api.test'
const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const setting = {
  key: ACCOUNTING_DISTRIBUTION_EMAIL_KEY,
  value: 'accounting@welld.ch',
  configured: true,
  updatedAt: '2026-07-20T09:12:00.000Z',
  updatedByEmail: 'admin@welld.ch',
  history: [],
}

beforeEach(() => vi.stubEnv('VITE_REFUND_API_URL', REFUND_API_URL))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('settingsApi', () => {
  it('getSetting GETs /settings/{key}', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(jsonResponse(200, setting))
    await expect(getSetting(ACCOUNTING_DISTRIBUTION_EMAIL_KEY)).resolves.toEqual(setting)
    expect(String(vi.mocked(apiFetch).mock.calls[0]?.[0])).toBe(
      `${REFUND_API_URL}/settings/accounting-distribution-email`,
    )
  })

  it('putSetting PUTs the value, null to clear', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(jsonResponse(200, { ...setting, value: null, configured: false }))
    await putSetting(ACCOUNTING_DISTRIBUTION_EMAIL_KEY, null)
    const [, init] = vi.mocked(apiFetch).mock.calls[0]!
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(String(init?.body))).toEqual({ value: null })
  })

  it('a 422 becomes an ApiError carrying the detail', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(
      jsonResponse(422, { type: 'about:blank', title: 'Unprocessable', status: 422, detail: 'Not an email.' }),
    )
    const error = await putSetting(ACCOUNTING_DISTRIBUTION_EMAIL_KEY, 'nope').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).detail).toBe('Not an email.')
  })
})
