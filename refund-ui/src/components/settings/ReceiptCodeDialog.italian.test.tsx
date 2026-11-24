/**
 * @vitest-environment jsdom
 *
 * ReceiptCodeDialog in Italian (T19, specs/20261124-receipt-numbers-from-the-register): the same states as the English
 * axe pass, with the Italian catalog. The language is resolved ONCE when the strings module is first evaluated, so
 * `<html lang="it">` is set in `vi.hoisted`, before any import (the pattern of `MyRequestsPage.italian.test.tsx`).
 */

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  document.documentElement.lang = 'it'
})

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expectNoAxeViolations } from '../../test-support/axe'

vi.mock('../../lib/receiptCodesApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/receiptCodesApi')>()
  return { ...original, putCode: vi.fn() }
})

import * as api from '../../lib/receiptCodesApi'
import type { ReceiptCodeEmployee } from '../../lib/receiptCodesApi'
import { ApiError } from '../../lib/refundApi'
import { catalogs, strings } from '../../strings'
import ReceiptCodeDialog from './ReceiptCodeDialog'

const employee: ReceiptCodeEmployee = {
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
}

const problem = (status: number, code: string) => new ApiError({ type: 't', title: 'x', status, code })
const field = () => screen.getByTestId('receipt-code-field') as HTMLInputElement
const save = () => screen.getByTestId('receipt-code-submit') as HTMLButtonElement
const type = (value: string) => fireEvent.change(field(), { target: { value } })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

afterAll(() => {
  document.documentElement.lang = ''
})

describe('ReceiptCodeDialog (it)', () => {
  it('renders the Italian catalog', () => {
    expect(strings).toBe(catalogs.it)
    render(<ReceiptCodeDialog employee={employee} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Codice ricevuta — Luca Conti' })).not.toBeNull()
    expect(screen.getByText('Due o tre lettere, da A a Z.')).not.toBeNull()
  })

  it('has no axe violations: empty, valid, shape error, 422, 409, busy and a dialog error', async () => {
    render(<ReceiptCodeDialog employee={employee} onSaved={vi.fn()} onCancel={vi.fn()} />)
    await expectNoAxeViolations()

    type('lcx')
    await expectNoAxeViolations()

    type('A')
    fireEvent.click(save())
    expect(screen.getByTestId('receipt-code-field-error').textContent).toBe(
      'Un codice è di due o tre lettere, da A a Z.',
    )
    await expectNoAxeViolations()

    type('lcx')
    vi.mocked(api.putCode).mockRejectedValueOnce(problem(422, 'receipt_code_invalid'))
    fireEvent.click(save())
    await waitFor(() => expect(screen.getByTestId('receipt-code-field-error')).not.toBeNull())
    await expectNoAxeViolations()

    type('lcy')
    vi.mocked(api.putCode).mockRejectedValueOnce(problem(409, 'receipt_code_in_use'))
    fireEvent.click(save())
    await waitFor(() =>
      expect(screen.getByTestId('receipt-code-field-error').textContent).toBe(
        'Questo codice è già in uso. Sceglierne un altro.',
      ),
    )
    await expectNoAxeViolations()

    type('lcz')
    vi.mocked(api.putCode).mockReturnValueOnce(new Promise(() => undefined))
    fireEvent.click(save())
    await waitFor(() => expect(field().matches(':disabled')).toBe(true))
    await expectNoAxeViolations()
  })

  it('has no axe violations with a dialog error', async () => {
    vi.mocked(api.putCode).mockRejectedValueOnce(problem(403, 'forbidden'))
    render(<ReceiptCodeDialog employee={employee} onSaved={vi.fn()} onCancel={vi.fn()} />)
    type('lcx')
    fireEvent.click(save())
    await waitFor(() => expect(screen.getByTestId('receipt-code-error')).not.toBeNull())
    await expectNoAxeViolations()
  })
})
