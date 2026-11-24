/**
 * @vitest-environment jsdom
 *
 * receiptCodesApi (T17, specs/20261124-receipt-numbers-from-the-register): every URL, method and body of
 * plan.md § API contracts (with DS-2 and DS-8), and each error code passed through as an `ApiError`.
 * `shell/session`'s `apiFetch` is mocked, as in the other API module tests: the backend is built elsewhere.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('shell/session', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from 'shell/session'
import { getCodeHistory, listReceiptCodes, putCode, receiptCodeErrorCode } from './receiptCodesApi'
import type { ReceiptCodeEmployee } from './receiptCodesApi'
import { ApiError } from './refundApi'

const BASE = 'http://refund-api.test'

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const lastCall = () => {
  const [url, init] = vi.mocked(apiFetch).mock.calls[0]
  return {
    url: String(url),
    method: init?.method ?? 'GET',
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  }
}

const ROW: ReceiptCodeEmployee = {
  userId: 'ck1',
  name: 'Anna Rossi',
  email: 'anna.rossi@welld.ch',
  initials: 'AR',
  code: 'ARO',
  prefix: 'ARO',
  prefixSource: 'code',
  lastNumber: 'AR26/039',
  changedAt: '2026-11-25T08:12:00.000Z',
  changedByEmail: 'acc@welld.ch',
  sharesPrefix: false,
}

beforeEach(() => {
  vi.stubEnv('VITE_REFUND_API_URL', BASE)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('listReceiptCodes', () => {
  it('GETs the list and returns the rows as sent, DS-2 and DS-8 members included', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(json(200, { employees: [ROW] }))
    await expect(listReceiptCodes()).resolves.toEqual([ROW])
    expect(lastCall()).toMatchObject({ url: `${BASE}/accounting/receipt-codes`, method: 'GET' })
  })
})

describe('putCode', () => {
  it('PUTs the code as typed to the encoded user id and returns the row', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(json(200, ROW))
    await expect(putCode('ck/1 x', 'lcx')).resolves.toEqual(ROW)
    expect(lastCall()).toEqual({
      url: `${BASE}/accounting/receipt-codes/ck%2F1%20x`,
      method: 'PUT',
      body: { code: 'lcx' },
    })
  })

  it('PUTs null to clear, and nothing else in the body', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(json(200, { ...ROW, code: null, prefix: 'AR', prefixSource: 'initials' }))
    await putCode('ck1', null)
    expect(lastCall().body).toEqual({ code: null })
  })
})

describe('getCodeHistory', () => {
  it('GETs the history of one employee and returns the entries newest first, as sent', async () => {
    const entries = [
      {
        codeBefore: 'LC',
        codeAfter: 'LCX',
        changedBy: { userId: 'u2', email: 'acc@welld.ch' },
        changedAt: '2026-11-25T08:12:00.000Z',
      },
      {
        codeBefore: null,
        codeAfter: 'LC',
        changedBy: { userId: 'u2', email: 'acc@welld.ch' },
        changedAt: '2026-11-24T08:00:00.000Z',
      },
    ]
    vi.mocked(apiFetch).mockResolvedValueOnce(json(200, { entries }))
    await expect(getCodeHistory('ck1')).resolves.toEqual(entries)
    expect(lastCall()).toMatchObject({ url: `${BASE}/accounting/receipt-codes/ck1/history`, method: 'GET' })
  })
})

describe('error codes', () => {
  it.each([
    ['put', 422, 'receipt_code_invalid'],
    ['put', 409, 'receipt_code_in_use'],
    ['put', 404, 'employee_not_found'],
    ['put', 403, 'forbidden'],
    ['list', 403, 'forbidden'],
    ['history', 404, 'employee_not_found'],
    ['history', 403, 'forbidden'],
  ] as const)('%s: %i %s comes through as an ApiError with that code', async (which, status, code) => {
    vi.mocked(apiFetch).mockResolvedValueOnce(json(status, { title: 'x', status, code, detail: 'English text' }))
    const call = which === 'put' ? putCode('ck1', 'LCX') : which === 'list' ? listReceiptCodes() : getCodeHistory('ck1')
    await expect(call).rejects.toMatchObject({ status, code })
    await call.catch((error: unknown) => expect(receiptCodeErrorCode(error)).toBe(code))
  })

  it('receiptCodeErrorCode is null for an error that is not one of the four, and for a non-ApiError', async () => {
    expect(
      receiptCodeErrorCode(new ApiError({ type: 't', title: 'x', status: 503, code: 'authz_unavailable' })),
    ).toBeNull()
    expect(receiptCodeErrorCode(new ApiError({ type: 't', title: 'x', status: 500 }))).toBeNull()
    expect(receiptCodeErrorCode(new TypeError('network'))).toBeNull()
  })
})
