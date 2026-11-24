/**
 * @vitest-environment jsdom
 *
 * ReceiptCodesCard in Italian (T20, specs/20261124-receipt-numbers-from-the-register): the same states as the English
 * axe pass with the Italian catalog, and the DS-8 note and badge in Italian. The language is resolved ONCE when the
 * strings module is first evaluated, so `<html lang="it">` is set in `vi.hoisted` (the pattern of
 * `MyRequestsPage.italian.test.tsx`).
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  document.documentElement.lang = 'it'
})

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expectNoAxeViolations } from '../../test-support/axe'

vi.mock('../../lib/receiptCodesApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/receiptCodesApi')>()
  return { ...original, listReceiptCodes: vi.fn(), putCode: vi.fn(), getCodeHistory: vi.fn() }
})

import * as api from '../../lib/receiptCodesApi'
import type { ReceiptCodeEmployee } from '../../lib/receiptCodesApi'
import { ApiError } from '../../lib/refundApi'
import { catalogs, strings } from '../../strings'
import ReceiptCodesCard from './ReceiptCodesCard'

const base: ReceiptCodeEmployee = {
  userId: 'u-x',
  name: null,
  email: 'x@welld.ch',
  initials: 'XX',
  code: null,
  prefix: 'XX',
  prefixSource: 'initials',
  lastNumber: null,
  changedAt: null,
  changedByEmail: null,
  sharesPrefix: false,
}
const ANNA: ReceiptCodeEmployee = {
  ...base,
  userId: 'u-anna',
  name: 'Anna Rossi',
  email: 'anna.rossi@welld.ch',
  initials: 'AR',
  code: 'ARO',
  prefix: 'ARO',
  prefixSource: 'code',
  lastNumber: 'AR26/039',
  changedAt: '2026-11-24T09:30:00.000Z',
  changedByEmail: 'acc@welld.ch',
}
const LUCA: ReceiptCodeEmployee = {
  ...base,
  userId: 'u-luca',
  name: 'Luca Conti',
  email: 'luca.conti@welld.ch',
  initials: 'LC',
  prefix: 'LC',
  lastNumber: 'LC26/012',
  sharesPrefix: true,
}
const PAOLO: ReceiptCodeEmployee = {
  ...base,
  userId: 'u-paolo',
  name: 'Paolo Neri',
  email: 'paolo.neri@welld.ch',
  initials: 'PN',
  code: 'LC',
  prefix: 'LC',
  prefixSource: 'code',
  sharesPrefix: true,
}

const problem = (status: number, code?: string) => new ApiError({ type: 't', title: 'x', status, code })

beforeEach(() => {
  vi.mocked(api.listReceiptCodes).mockResolvedValue([ANNA, LUCA, PAOLO])
  vi.mocked(api.getCodeHistory).mockResolvedValue([
    {
      codeBefore: 'AR',
      codeAfter: 'ARO',
      changedBy: { userId: 'u-acc', email: 'acc@welld.ch' },
      changedAt: '2026-11-25T08:00:00.000Z',
    },
  ])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

afterAll(() => {
  document.documentElement.lang = ''
})

const renderCard = async () => {
  render(<ReceiptCodesCard />)
  await screen.findByTestId('receipt-codes-table')
}

describe('ReceiptCodesCard (it)', () => {
  it('renders the Italian catalog: the columns, the badge, the DS-8 note and the button names', async () => {
    expect(strings).toBe(catalogs.it)
    await renderCard()
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Dipendente',
      'Codice',
      'Prefisso in uso',
      'Ultimo numero',
      'Ultima modifica',
      'Stato',
      'Azioni',
    ])
    expect(screen.getAllByText('Prefisso condiviso')).toHaveLength(2)
    expect(screen.getByRole('note', { name: 'Dipendenti con prefisso condiviso' }).textContent).toBe(
      '2 dipendenti condividono il prefisso con un altro dipendente.',
    )
    expect(screen.getByTestId('receipt-code-edit-u-luca').getAttribute('aria-label')).toBe(
      'Imposta un codice ricevuta per Luca Conti',
    )
    expect(screen.getByTestId('receipt-code-clear-u-anna').getAttribute('aria-label')).toBe(
      'Rimuovi il codice ricevuta di Anna Rossi',
    )
  })

  it('has no axe violations: loading, error, 403, empty and loaded', async () => {
    vi.mocked(api.listReceiptCodes).mockReturnValueOnce(new Promise(() => undefined))
    const loading = render(<ReceiptCodesCard />)
    await expectNoAxeViolations()
    loading.unmount()

    vi.mocked(api.listReceiptCodes).mockRejectedValueOnce(problem(500))
    const failed = render(<ReceiptCodesCard />)
    await screen.findByText('Impossibile caricare i codici ricevuta.')
    await expectNoAxeViolations()
    failed.unmount()

    vi.mocked(api.listReceiptCodes).mockRejectedValueOnce(problem(403, 'forbidden'))
    const denied = render(<ReceiptCodesCard />)
    await screen.findByTestId('permission-denied')
    await expectNoAxeViolations()
    denied.unmount()

    vi.mocked(api.listReceiptCodes).mockResolvedValueOnce([])
    const empty = render(<ReceiptCodesCard />)
    await screen.findByTestId('receipt-codes-empty')
    await expectNoAxeViolations()
    empty.unmount()

    await renderCard()
    await expectNoAxeViolations()
  })

  it('has no axe violations with the dialog, the confirmation, the success banner and the drawer open', async () => {
    vi.mocked(api.putCode).mockResolvedValueOnce({ ...ANNA, code: null, prefix: 'AR', prefixSource: 'initials' })
    await renderCard()
    fireEvent.click(screen.getByTestId('receipt-code-edit-u-luca'))
    await expectNoAxeViolations()
    fireEvent.click(screen.getByTestId('receipt-code-cancel'))

    fireEvent.click(screen.getByTestId('receipt-code-clear-u-anna'))
    await expectNoAxeViolations()
    fireEvent.click(screen.getByTestId('receipt-code-clear-confirm'))
    await waitFor(() =>
      expect(screen.getByTestId('receipt-codes-success').textContent).toBe(
        'Codice ricevuta di Anna Rossi rimosso. I nuovi numeri usano AR.',
      ),
    )
    await expectNoAxeViolations()

    fireEvent.click(screen.getByTestId('receipt-code-history-u-luca'))
    await within(screen.getByRole('dialog')).findByRole('table')
    await expectNoAxeViolations()
  })

  it('has no axe violations with the drawer loading and in error', async () => {
    vi.mocked(api.getCodeHistory).mockRejectedValueOnce(problem(500))
    await renderCard()
    fireEvent.click(screen.getByTestId('receipt-code-history-u-anna'))
    await screen.findByText('Impossibile caricare la cronologia.')
    await expectNoAxeViolations()
  })
})
