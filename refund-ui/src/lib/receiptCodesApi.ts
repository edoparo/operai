/**
 * receiptCodesApi — typed operations against refund-api's receipt-code surface
 * (specs/20261124-receipt-numbers-from-the-register, plan.md § API contracts with DS-2 and DS-8; US-4).
 *
 *   GET /accounting/receipt-codes                       the employees known to Refund, one row each
 *   PUT /accounting/receipt-codes/{userId}              `{ code: "lcx" }` sets or changes, `{ code: null }` clears;
 *                                                       answers the same row as the list (200, also when unchanged)
 *   GET /accounting/receipt-codes/{userId}/history      the changes of one employee, newest first
 *
 * Every call needs `receipt-code:manage`, reading included (AC-4.9): a 403 is `forbidden`.
 *
 * Built on `getJson`/`sendJson` as `accountingApi.ts` is, against the documented contract while the backend is built
 * elsewhere: every test mocks `apiFetch`. The id that goes into a path is `encodeURIComponent`-ed.
 *
 * Errors are `ApiError`s whose `code` is the contract's stable discriminator (`receipt_code_invalid` 422,
 * `receipt_code_in_use` 409, `employee_not_found` 404, `forbidden` 403). A caller branches on `code`
 * (`receiptCodeErrorCode`), never on `detail`: the server's English text is not shown. The prefix, the initials and
 * `sharesPrefix` come from the server; nothing here derives them.
 */

import { ApiError, getJson, sendJson } from './refundApi'

/** One employee, as `GET /accounting/receipt-codes` lists them and as `PUT` answers (DS-2, DS-8). */
export type ReceiptCodeEmployee = {
  userId: string
  /** The newest request's owner name; null when there is none. */
  name: string | null
  email: string
  initials: string
  /** Two or three capitals A-Z, or null (the initials are used). */
  code: string | null
  /** What the next number uses: the code, else the initials. */
  prefix: string
  prefixSource: 'code' | 'initials'
  /** The highest numbered line, as issued (keeps the old prefix after a change), or null. */
  lastNumber: string | null
  /** DS-2: the newest change, a clear included; null when the employee has none. */
  changedAt: string | null
  changedByEmail: string | null
  /** DS-8: another employee's code, initials (with no code) or issued prefix equals this `prefix`. */
  sharesPrefix: boolean
}

/** One change of an employee's code, as the history route sends it (newest first). */
export type ReceiptCodeHistoryEntry = {
  codeBefore: string | null
  codeAfter: string | null
  changedBy: { userId: string; email: string }
  changedAt: string
}

/** The stable error codes of this surface. */
export type ReceiptCodeErrorCode = 'receipt_code_invalid' | 'receipt_code_in_use' | 'employee_not_found' | 'forbidden'

const KNOWN_CODES: readonly string[] = [
  'receipt_code_invalid',
  'receipt_code_in_use',
  'employee_not_found',
  'forbidden',
]

/** The contract's `code` of an error from this module, or null for anything else (a network failure, a 5xx). */
export const receiptCodeErrorCode = (error: unknown): ReceiptCodeErrorCode | null =>
  error instanceof ApiError && error.code !== undefined && KNOWN_CODES.includes(error.code)
    ? (error.code as ReceiptCodeErrorCode)
    : null

const base = '/accounting/receipt-codes'

/** `GET /accounting/receipt-codes` → the rows, in the server's order (name, then user id). */
export const listReceiptCodes = (): Promise<ReceiptCodeEmployee[]> =>
  getJson<{ employees: ReceiptCodeEmployee[] }>(base).then((body) => body.employees)

/**
 * `PUT /accounting/receipt-codes/{userId}`: `code` as typed (the server trims and upper-cases), or `null` to clear.
 * Answers the whole row. 422 `receipt_code_invalid`, 409 `receipt_code_in_use`, 404 `employee_not_found`, 403.
 */
export const putCode = (userId: string, code: string | null): Promise<ReceiptCodeEmployee> =>
  sendJson<ReceiptCodeEmployee>(`${base}/${encodeURIComponent(userId)}`, 'PUT', { code })

/** `GET /accounting/receipt-codes/{userId}/history` → the entries, newest first. */
export const getCodeHistory = (userId: string): Promise<ReceiptCodeHistoryEntry[]> =>
  getJson<{ entries: ReceiptCodeHistoryEntry[] }>(`${base}/${encodeURIComponent(userId)}/history`).then(
    (body) => body.entries,
  )
