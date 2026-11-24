/**
 * @vitest-environment jsdom
 *
 * ReceiptCodeDialog (T19, specs/20261124-receipt-numbers-from-the-register, design S3, RC-4 to RC-7, plan DS-3;
 * AC-4.1 to AC-4.6): one field, a-z upper-cased as typed and nothing else, no `maxLength`, the shape checked before any
 * request, Save disabled while empty or equal to the saved code, 422 and 409 as field errors with local text (never
 * the server's `detail`), 404, 403 and network as dialog errors. The API is mocked: the backend is built elsewhere.
 * The Italian axe pass is in `ReceiptCodeDialog.italian.test.tsx` (the language is resolved once per module graph).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expectNoAxeViolations } from '../../test-support/axe'

vi.mock('../../lib/receiptCodesApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/receiptCodesApi')>()
  return { ...original, putCode: vi.fn() }
})

import * as api from '../../lib/receiptCodesApi'
import type { ReceiptCodeEmployee } from '../../lib/receiptCodesApi'
import { ApiError } from '../../lib/refundApi'
import ReceiptCodeDialog from './ReceiptCodeDialog'

const employee = (overrides: Partial<ReceiptCodeEmployee> = {}): ReceiptCodeEmployee => ({
  userId: 'u1',
  name: 'Luca Conti',
  email: 'luca.conti@welld.ch',
  initials: 'LC',
  code: null,
  prefix: 'LC',
  prefixSource: 'initials',
  lastNumber: 'LC26/012',
  changedAt: null,
  changedByEmail: null,
  sharesPrefix: false,
  ...overrides,
})

const problem = (status: number, code?: string) =>
  new ApiError({ type: 't', title: 'x', status, code, detail: 'English server text that must never show' })

const setup = (current: ReceiptCodeEmployee = employee()) => {
  const onSaved = vi.fn()
  const onCancel = vi.fn()
  render(<ReceiptCodeDialog employee={current} onSaved={onSaved} onCancel={onCancel} />)
  return { onSaved, onCancel }
}

const field = () => screen.getByTestId('receipt-code-field') as HTMLInputElement
const save = () => screen.getByTestId('receipt-code-submit') as HTMLButtonElement
const type = (value: string) => fireEvent.change(field(), { target: { value } })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ReceiptCodeDialog', () => {
  it('is titled with the employee, and says what a code does with the initials in it (AC-4.4, AC-4.6)', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Receipt code — Luca Conti' })).not.toBeNull()
    expect(
      screen.getByText(
        'New numbers use this code instead of the initials (LC). The sequence continues. Numbers already issued do not change.',
      ),
    ).not.toBeNull()
  })

  it('falls back to the email when the employee has no name', () => {
    setup(employee({ name: null }))
    expect(screen.getByRole('dialog', { name: 'Receipt code — luca.conti@welld.ch' })).not.toBeNull()
  })

  it('has one field with the hint, no maxLength, no Clear and the typing hints', () => {
    setup()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    expect(field().getAttribute('maxlength')).toBeNull()
    expect(field().getAttribute('autocomplete')).toBe('off')
    expect(field().getAttribute('autocapitalize')).toBe('characters')
    expect(field().getAttribute('spellcheck')).toBe('false')
    expect(field().getAttribute('aria-required')).toBe('true')
    expect(screen.getByText('Two or three letters, A to Z.')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /clear/i })).toBeNull()
  })

  it('starts on the saved code, empty for an employee without one', () => {
    cleanup()
    setup(employee({ code: 'LCX', prefix: 'LCX', prefixSource: 'code' }))
    expect(field().value).toBe('LCX')
    cleanup()
    setup()
    expect(field().value).toBe('')
  })

  it('upper-cases a-z as typed, and leaves ß and À as typed (RC-5)', () => {
    setup()
    type('lcx')
    expect(field().value).toBe('LCX')
    type('ß')
    expect(field().value).toBe('ß')
    type('àb')
    expect(field().value).toBe('àB')
    type('À')
    expect(field().value).toBe('À')
  })

  it('shows a pasted ABCD in full instead of cutting it to ABC (RC-5)', () => {
    setup()
    type('abcd')
    expect(field().value).toBe('ABCD')
  })

  describe('Save', () => {
    it('is disabled while the field is empty, and while it equals the saved code', () => {
      setup(employee({ code: 'LCX', prefix: 'LCX', prefixSource: 'code' }))
      expect(save().disabled).toBe(true)
      type('')
      expect(save().disabled).toBe(true)
      type('lcx')
      expect(save().disabled).toBe(true)
      type(' lcx ')
      expect(save().disabled).toBe(true)
      type('lcy')
      expect(save().disabled).toBe(false)
    })

    it('an empty field never clears: Enter on it sends nothing (RC-6)', () => {
      setup(employee({ code: 'LCX', prefix: 'LCX', prefixSource: 'code' }))
      type('')
      fireEvent.submit(field().closest('form') as HTMLFormElement)
      expect(api.putCode).not.toHaveBeenCalled()
    })
  })

  describe('a code of the wrong shape (AC-4.2): no request, a field error, focus on the field', () => {
    it.each(['A', 'ABCD', 'A1', 'ÀB', 'A B', 'ß', '12'])('%s', async (bad) => {
      setup()
      type(bad)
      fireEvent.click(save())
      await waitFor(() =>
        expect(screen.getByTestId('receipt-code-field-error').textContent).toBe(
          'A code is two or three letters, A to Z.',
        ),
      )
      expect(api.putCode).not.toHaveBeenCalled()
      expect(document.activeElement).toBe(field())
      expect(field().getAttribute('aria-invalid')).toBe('true')
    })

    it('typing clears the error', () => {
      setup()
      type('A')
      fireEvent.click(save())
      expect(screen.getByTestId('receipt-code-field-error')).not.toBeNull()
      type('AB')
      expect(screen.queryByTestId('receipt-code-field-error')).toBeNull()
    })

    it('says so on blur for a non-empty bad value, and not for an empty one', () => {
      setup()
      fireEvent.blur(field())
      expect(screen.queryByTestId('receipt-code-field-error')).toBeNull()
      type('A1')
      fireEvent.blur(field())
      expect(screen.getByTestId('receipt-code-field-error')).not.toBeNull()
    })
  })

  describe('saving', () => {
    it('sends the trimmed, capitalised code to the employee and hands the row to the caller (AC-4.1)', async () => {
      const row = employee({ code: 'LCX', prefix: 'LCX', prefixSource: 'code' })
      vi.mocked(api.putCode).mockResolvedValueOnce(row)
      const { onSaved } = setup()
      type(' lcx ')
      fireEvent.click(save())
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith(row))
      expect(api.putCode).toHaveBeenCalledWith('u1', 'LCX')
    })

    it('accepts two letters', async () => {
      vi.mocked(api.putCode).mockResolvedValueOnce(employee({ code: 'LX' }))
      const { onSaved } = setup()
      type('lx')
      fireEvent.click(save())
      await waitFor(() => expect(onSaved).toHaveBeenCalled())
      expect(api.putCode).toHaveBeenCalledWith('u1', 'LX')
    })

    it('is busy while the request is out: the label says so and the field is disabled', async () => {
      let resolve: (row: ReceiptCodeEmployee) => void = () => undefined
      vi.mocked(api.putCode).mockReturnValueOnce(new Promise((r) => (resolve = r)))
      setup()
      type('lcx')
      fireEvent.click(save())
      await waitFor(() => expect(save().textContent).toContain('Saving…'))
      expect(field().matches(':disabled')).toBe(true)
      resolve(employee({ code: 'LCX' }))
    })

    it('422: the field error in local text, never the server detail; focus returns to the field', async () => {
      vi.mocked(api.putCode).mockRejectedValueOnce(problem(422, 'receipt_code_invalid'))
      const { onSaved } = setup()
      type('lcx')
      fireEvent.click(save())
      await waitFor(() =>
        expect(screen.getByTestId('receipt-code-field-error').textContent).toBe(
          'A code is two or three letters, A to Z.',
        ),
      )
      expect(screen.queryByText(/English server text/)).toBeNull()
      expect(document.activeElement).toBe(field())
      expect(onSaved).not.toHaveBeenCalled()
    })

    it('409: "already in use" naming nobody, the value kept and selected, focus on the field (AC-4.3, RC-7)', async () => {
      vi.mocked(api.putCode).mockRejectedValueOnce(problem(409, 'receipt_code_in_use'))
      const { onSaved } = setup()
      type('lcx')
      fireEvent.click(save())
      await waitFor(() =>
        expect(screen.getByTestId('receipt-code-field-error').textContent).toBe(
          'This code is already in use. Choose another.',
        ),
      )
      expect(screen.queryByText(/English server text/)).toBeNull()
      expect(field().value).toBe('LCX')
      expect(document.activeElement).toBe(field())
      expect(field().selectionStart).toBe(0)
      expect(field().selectionEnd).toBe(3)
      expect(onSaved).not.toHaveBeenCalled()
      // Overtyping clears the error and Save is available again.
      type('lcy')
      expect(screen.queryByTestId('receipt-code-field-error')).toBeNull()
      expect(save().disabled).toBe(false)
    })

    it('404: a dialog error, no field error, Save stays disabled; Cancel closes', async () => {
      vi.mocked(api.putCode).mockRejectedValueOnce(problem(404, 'employee_not_found'))
      const { onCancel } = setup()
      type('lcx')
      fireEvent.click(save())
      await waitFor(() =>
        expect(screen.getByTestId('receipt-code-error').textContent).toBe(
          'This employee is no longer listed. Close this window to refresh the list.',
        ),
      )
      expect(screen.queryByTestId('receipt-code-field-error')).toBeNull()
      expect(save().disabled).toBe(true)
      fireEvent.click(screen.getByTestId('receipt-code-cancel'))
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('403: a dialog error, the value kept', async () => {
      vi.mocked(api.putCode).mockRejectedValueOnce(problem(403, 'forbidden'))
      setup()
      type('lcx')
      fireEvent.click(save())
      await waitFor(() =>
        expect(screen.getByTestId('receipt-code-error').textContent).toBe("You don't have permission to do this."),
      )
      expect(screen.queryByTestId('receipt-code-field-error')).toBeNull()
      expect(field().value).toBe('LCX')
    })

    it.each([
      ['a network failure', new TypeError('Failed to fetch')],
      ['a 500', problem(500)],
    ])('%s: "Could not save. Try again.", the value kept and Save available', async (_name, failure) => {
      vi.mocked(api.putCode).mockRejectedValueOnce(failure)
      setup()
      type('lcx')
      fireEvent.click(save())
      await waitFor(() =>
        expect(screen.getByTestId('receipt-code-error').textContent).toBe('Could not save. Try again.'),
      )
      expect(field().value).toBe('LCX')
      expect(save().disabled).toBe(false)
    })

    it('Cancel closes without a request', () => {
      const { onCancel } = setup()
      fireEvent.click(screen.getByTestId('receipt-code-cancel'))
      expect(onCancel).toHaveBeenCalledTimes(1)
      expect(api.putCode).not.toHaveBeenCalled()
    })
  })
})

describe('ReceiptCodeDialog: accessibility (axe, English)', () => {
  it('has no violations: empty, valid, shape error, 422, 409, busy and a dialog error', async () => {
    setup()
    await expectNoAxeViolations()

    type('lcx')
    await expectNoAxeViolations()

    type('A')
    fireEvent.click(save())
    await expectNoAxeViolations()

    type('lcx')
    vi.mocked(api.putCode).mockRejectedValueOnce(problem(422, 'receipt_code_invalid'))
    fireEvent.click(save())
    await waitFor(() => expect(screen.getByTestId('receipt-code-field-error')).not.toBeNull())
    await expectNoAxeViolations()

    type('lcy')
    vi.mocked(api.putCode).mockRejectedValueOnce(problem(409, 'receipt_code_in_use'))
    fireEvent.click(save())
    await waitFor(() => expect(screen.getByTestId('receipt-code-field-error').textContent).toContain('in use'))
    await expectNoAxeViolations()

    type('lcz')
    vi.mocked(api.putCode).mockReturnValueOnce(new Promise(() => undefined))
    fireEvent.click(save())
    await waitFor(() => expect(field().matches(':disabled')).toBe(true))
    await expectNoAxeViolations()
  })

  it('has no violations with a dialog error (403)', async () => {
    vi.mocked(api.putCode).mockRejectedValueOnce(problem(403, 'forbidden'))
    setup()
    type('lcx')
    fireEvent.click(save())
    await waitFor(() => expect(screen.getByTestId('receipt-code-error')).not.toBeNull())
    await expectNoAxeViolations()
  })
})
