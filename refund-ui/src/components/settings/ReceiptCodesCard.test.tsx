/**
 * @vitest-environment jsdom
 *
 * ReceiptCodesCard (T20, specs/20261124-receipt-numbers-from-the-register, design S2, S3b, S4, S5, F1 to F5, RC-3,
 * RC-8, RC-10; plan DS-2 to DS-4 and DS-8; AC-4.1, AC-4.3, AC-4.6, AC-4.7, AC-4.8, AC-4.9, AC-4.11): the states, the
 * "Shares prefix" badge and count (with and without a code, naming nobody), Clear with its confirmation, Set/Change
 * replacing the row from the 200 body, the history fetched on open, and the focus rules. The API is mocked: the
 * backend is built elsewhere. The Italian pass is in `ReceiptCodesCard.italian.test.tsx`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { formatDate } from '@operai/ui'
import { expectNoAxeViolations } from '../../test-support/axe'

vi.mock('../../lib/receiptCodesApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/receiptCodesApi')>()
  return { ...original, listReceiptCodes: vi.fn(), putCode: vi.fn(), getCodeHistory: vi.fn() }
})

import * as api from '../../lib/receiptCodesApi'
import type { ReceiptCodeEmployee, ReceiptCodeHistoryEntry } from '../../lib/receiptCodesApi'
import { ApiError } from '../../lib/refundApi'
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

/** With a code, not shared. */
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
/** No code, shares its initials with someone. */
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
/** No name, no number, nothing shared. */
const MAIL: ReceiptCodeEmployee = {
  ...base,
  userId: 'u-mail',
  email: 'new.joiner@welld.ch',
  initials: 'NJ',
  prefix: 'NJ',
}
/** DS-8: a code equal to a codeless colleague's initials, flagged although it has a code. */
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

const ROWS = [ANNA, LUCA, MAIL, PAOLO]

const entry = (before: string | null, after: string | null, at: string): ReceiptCodeHistoryEntry => ({
  codeBefore: before,
  codeAfter: after,
  changedBy: { userId: 'u-acc', email: 'acc@welld.ch' },
  changedAt: at,
})
// Newest first, as the API sends them.
const HISTORY = [
  entry('ARO', null, '2026-11-26T08:00:00.000Z'),
  entry('AR', 'ARO', '2026-11-25T08:00:00.000Z'),
  entry(null, 'AR', '2026-11-24T08:00:00.000Z'),
]

const problem = (status: number, code?: string) =>
  new ApiError({ type: 't', title: 'x', status, code, detail: 'English server text that must never show' })

beforeEach(() => {
  vi.mocked(api.listReceiptCodes).mockResolvedValue(ROWS)
  vi.mocked(api.getCodeHistory).mockResolvedValue(HISTORY)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const renderCard = async () => {
  render(<ReceiptCodesCard />)
  await screen.findByTestId('receipt-codes-table')
}
const row = (userId: string) => screen.getByTestId(`receipt-code-row-${userId}`)
const button = (userId: string, kind: 'edit' | 'clear' | 'history') =>
  screen.getByTestId(`receipt-code-${kind}-${userId}`)
const rowHeader = (userId: string) => within(row(userId)).getByRole('rowheader')

describe('ReceiptCodesCard: states (S2)', () => {
  it('loading: one polite line and a skeleton', () => {
    vi.mocked(api.listReceiptCodes).mockReturnValue(new Promise(() => undefined))
    render(<ReceiptCodesCard />)
    expect(screen.getByText('Loading the receipt codes…').getAttribute('aria-live')).toBe('polite')
    expect(screen.getByTestId('skeleton-list-rows')).not.toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('error: the message with Retry, which loads again', async () => {
    vi.mocked(api.listReceiptCodes).mockRejectedValueOnce(problem(500))
    render(<ReceiptCodesCard />)
    expect(await screen.findByText('Could not load the receipt codes.')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByTestId('receipt-codes-table')
    expect(api.listReceiptCodes).toHaveBeenCalledTimes(2)
  })

  it('403: PermissionDenied in place of the card, not nothing (RC-3)', async () => {
    vi.mocked(api.listReceiptCodes).mockRejectedValueOnce(problem(403, 'forbidden'))
    render(<ReceiptCodesCard />)
    expect(await screen.findByTestId('permission-denied')).not.toBeNull()
    expect(screen.queryByTestId('receipt-codes-card')).toBeNull()
  })

  it('empty: a panel saying an employee appears after their first request, no table, no actions', async () => {
    vi.mocked(api.listReceiptCodes).mockResolvedValue([])
    render(<ReceiptCodesCard />)
    const panel = await screen.findByTestId('receipt-codes-empty')
    expect(within(panel).getByRole('heading', { level: 4, name: 'No employees yet' })).not.toBeNull()
    expect(within(panel).getByText('An employee appears here after their first request.')).not.toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('loaded: the title, the intro, the caption and the columns of S2', async () => {
    await renderCard()
    expect(screen.getByRole('heading', { name: 'Receipt codes' })).not.toBeNull()
    expect(
      screen.getByText('A code replaces the initials in new receipt numbers. Numbers already issued never change.'),
    ).not.toBeNull()
    expect(screen.getByRole('table', { name: 'Receipt codes by employee' })).not.toBeNull()
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Employee',
      'Code',
      'Prefix in use',
      'Last number',
      'Last changed',
      'Status',
      'Actions',
    ])
    expect(screen.getAllByTestId(/^receipt-code-row-/)).toHaveLength(ROWS.length)
  })
})

describe('ReceiptCodesCard: the rows (S2, DS-2)', () => {
  it('names the employee as the row header, the email under a name, the email alone without one', async () => {
    await renderCard()
    expect(rowHeader('u-anna').textContent).toBe('Anna Rossianna.rossi@welld.ch')
    expect(rowHeader('u-mail').textContent).toBe('new.joiner@welld.ch')
  })

  it('a code is shown as the code and the prefix; no code is "None" and the initials say where the prefix comes from', async () => {
    await renderCard()
    const withCode = row('u-anna')
    expect(within(withCode).getAllByText('ARO')).toHaveLength(2)
    expect(within(withCode).queryByText('from initials')).toBeNull()
    const without = row('u-luca')
    expect(within(without).getByText('None')).not.toBeNull()
    expect(within(without).getByText('LC')).not.toBeNull()
    expect(within(without).getByText('from initials')).not.toBeNull()
  })

  it('the last number is as issued, or "No number yet" as text', async () => {
    await renderCard()
    expect(within(row('u-anna')).getByText('AR26/039')).not.toBeNull()
    expect(within(row('u-mail')).getByText('No number yet')).not.toBeNull()
  })

  it('Last changed is the date and the email of the change, or "Not set yet" (DS-2)', async () => {
    await renderCard()
    expect(within(row('u-anna')).getByText(`acc@welld.ch · ${formatDate(ANNA.changedAt as string)}`)).not.toBeNull()
    expect(within(row('u-luca')).getByText('Not set yet')).not.toBeNull()
  })

  it('names every button after the employee; Clear only where a code is set', async () => {
    await renderCard()
    expect(button('u-anna', 'edit').getAttribute('aria-label')).toBe('Change the receipt code of Anna Rossi')
    expect(button('u-anna', 'edit').textContent).toBe('Change')
    expect(button('u-anna', 'clear').getAttribute('aria-label')).toBe('Clear the receipt code of Anna Rossi')
    expect(button('u-anna', 'history').getAttribute('aria-label')).toBe('Show the receipt code history of Anna Rossi')
    expect(button('u-luca', 'edit').getAttribute('aria-label')).toBe('Set code for Luca Conti')
    expect(button('u-luca', 'edit').textContent).toBe('Set code')
    expect(button('u-mail', 'edit').getAttribute('aria-label')).toBe('Set code for new.joiner@welld.ch')
    expect(screen.queryByTestId('receipt-code-clear-u-luca')).toBeNull()
    expect(screen.queryByTestId('receipt-code-clear-u-mail')).toBeNull()
    expect(screen.getAllByRole('button', { name: /^Clear the receipt code of/ })).toHaveLength(2) // Anna and Paolo
  })
})

describe('ReceiptCodesCard: "Shares prefix" (DS-8, AC-4.8, AC-4.11)', () => {
  it('flags every row whose sharesPrefix is true, with a code or without, and no other row', async () => {
    await renderCard()
    expect(within(row('u-luca')).getByText('Shares prefix')).not.toBeNull()
    expect(within(row('u-paolo')).getByText('Shares prefix')).not.toBeNull()
    expect(within(row('u-anna')).queryByText('Shares prefix')).toBeNull()
    expect(within(row('u-mail')).queryByText('Shares prefix')).toBeNull()
    expect(screen.getAllByText('Shares prefix')).toHaveLength(2)
  })

  it('the hidden hint fits the row: set a code when there is none, another code (or one for the colleague) when there is one', async () => {
    await renderCard()
    expect(within(row('u-luca')).getByText('Another employee uses the same letters. Set a code to tell the numbers apart.')).not.toBeNull()
    expect(
      within(row('u-paolo')).getByText('Another employee uses the same letters. Choose another code, or set a code for the colleague.'),
    ).not.toBeNull()
    expect(within(row('u-paolo')).queryByText(/Set a code to tell the numbers apart/)).toBeNull()
  })

  it('the note counts the flagged rows, with a code or without, and names nobody', async () => {
    await renderCard()
    const note = screen.getByRole('note', { name: 'Employees sharing a prefix' })
    expect(note.textContent).toBe('2 employees share a prefix with another employee.')
    for (const other of ['Anna', 'Luca', 'Paolo', 'Rossi', 'Conti', 'Neri', 'welld.ch']) {
      expect(note.textContent).not.toContain(other)
    }
  })

  it('says "1 employee shares" for one row, and shows no note for none', async () => {
    vi.mocked(api.listReceiptCodes).mockResolvedValue([ANNA, LUCA])
    await renderCard()
    expect(screen.getByTestId('receipt-codes-share-note').textContent).toBe(
      '1 employee shares a prefix with another employee.',
    )
    cleanup()
    vi.mocked(api.listReceiptCodes).mockResolvedValue([ANNA, MAIL])
    await renderCard()
    expect(screen.queryByTestId('receipt-codes-share-note')).toBeNull()
    expect(screen.queryByText('Shares prefix')).toBeNull()
  })

  it('describes the row’s Set code / Change button by the hint, so a keyboard user hears why', async () => {
    await renderCard()
    // A row with no code is told to set one; a row that has a code (u-paolo) to choose another or code the colleague.
    const expected: Record<string, string> = {
      'u-luca': 'Another employee uses the same letters. Set a code to tell the numbers apart.',
      'u-paolo': 'Another employee uses the same letters. Choose another code, or set a code for the colleague.',
    }
    for (const [id, hint] of Object.entries(expected)) {
      const describedBy = button(id, 'edit').getAttribute('aria-describedby') as string
      expect(document.getElementById(describedBy)?.textContent).toBe(hint)
    }
    expect(button('u-anna', 'edit').getAttribute('aria-describedby')).toBeNull()
  })
})

describe('ReceiptCodesCard: Set and Change (F2)', () => {
  it('Set code opens the dialog for that employee; saving replaces the row from the 200 body, says so, and returns focus to the button', async () => {
    const saved: ReceiptCodeEmployee = {
      ...LUCA,
      code: 'LCX',
      prefix: 'LCX',
      prefixSource: 'code',
      sharesPrefix: false,
    }
    vi.mocked(api.putCode).mockResolvedValueOnce(saved)
    await renderCard()
    const opener = button('u-luca', 'edit')
    fireEvent.click(opener)
    expect(screen.getByRole('dialog', { name: 'Receipt code — Luca Conti' })).not.toBeNull()
    fireEvent.change(screen.getByTestId('receipt-code-field'), { target: { value: 'lcx' } })
    fireEvent.click(screen.getByTestId('receipt-code-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.putCode).toHaveBeenCalledWith('u-luca', 'LCX')
    // The row is the server's, the count note follows it, and no second list request was made.
    expect(within(row('u-luca')).getAllByText('LCX')).toHaveLength(2)
    expect(within(row('u-luca')).queryByText('Shares prefix')).toBeNull()
    expect(screen.getByTestId('receipt-codes-share-note').textContent).toBe(
      '1 employee shares a prefix with another employee.',
    )
    expect(api.listReceiptCodes).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('receipt-codes-success').textContent).toBe('Receipt code for Luca Conti is now LCX.')
    // Same button, now "Change", and it has focus.
    expect(button('u-luca', 'edit')).toBe(opener)
    expect(opener.textContent).toBe('Change')
    expect(opener.getAttribute('aria-label')).toBe('Change the receipt code of Luca Conti')
    expect(document.activeElement).toBe(opener)
  })

  it('Change starts on the saved code; Cancel returns focus to the button, no request', async () => {
    await renderCard()
    const opener = button('u-anna', 'edit')
    fireEvent.click(opener)
    expect((screen.getByTestId('receipt-code-field') as HTMLInputElement).value).toBe('ARO')
    fireEvent.click(screen.getByTestId('receipt-code-cancel'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(api.putCode).not.toHaveBeenCalled()
  })

  it('a 409 keeps the dialog open with the field error; nothing changes in the row', async () => {
    vi.mocked(api.putCode).mockRejectedValueOnce(problem(409, 'receipt_code_in_use'))
    await renderCard()
    fireEvent.click(button('u-luca', 'edit'))
    fireEvent.change(screen.getByTestId('receipt-code-field'), { target: { value: 'ARO' } })
    fireEvent.click(screen.getByTestId('receipt-code-submit'))
    expect(await screen.findByText('This code is already in use. Choose another.')).not.toBeNull()
    expect(screen.getByRole('dialog')).not.toBeNull()
    expect(within(row('u-luca')).getByText('None')).not.toBeNull()
    expect(screen.queryByTestId('receipt-codes-success')).toBeNull()
  })

  it('a 404 in the dialog reloads the list when the dialog is closed', async () => {
    vi.mocked(api.putCode).mockRejectedValueOnce(problem(404, 'employee_not_found'))
    vi.mocked(api.listReceiptCodes).mockResolvedValueOnce(ROWS).mockResolvedValueOnce([ANNA, MAIL, PAOLO])
    await renderCard()
    fireEvent.click(button('u-luca', 'edit'))
    fireEvent.change(screen.getByTestId('receipt-code-field'), { target: { value: 'lcx' } })
    fireEvent.click(screen.getByTestId('receipt-code-submit'))
    await screen.findByText(/no longer listed/)
    expect(api.listReceiptCodes).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('receipt-code-cancel'))
    await waitFor(() => expect(screen.queryByTestId('receipt-code-row-u-luca')).toBeNull())
    expect(api.listReceiptCodes).toHaveBeenCalledTimes(2)
  })
})

describe('ReceiptCodesCard: Clear (F3, DS-3)', () => {
  const cleared: ReceiptCodeEmployee = { ...ANNA, code: null, prefix: 'AR', prefixSource: 'initials' }

  it('asks first, with the consequence and the initials; Cancel returns focus to Clear and sends nothing', async () => {
    await renderCard()
    const opener = button('u-anna', 'clear')
    fireEvent.click(opener)
    const dialog = screen.getByRole('alertdialog', { name: 'Clear the code of Anna Rossi' })
    expect(
      within(dialog).getByText(
        'New numbers will use the initials (AR) again. The sequence continues. Numbers already issued do not change.',
      ),
    ).not.toBeNull()
    fireEvent.click(screen.getByTestId('receipt-code-clear-cancel'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(api.putCode).not.toHaveBeenCalled()
  })

  it('confirming clears: the row shows the initials and "Set code", a banner says so, focus is on the row header', async () => {
    vi.mocked(api.putCode).mockResolvedValueOnce(cleared)
    await renderCard()
    fireEvent.click(button('u-anna', 'clear'))
    fireEvent.click(screen.getByTestId('receipt-code-clear-confirm'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(api.putCode).toHaveBeenCalledWith('u-anna', null)
    const cells = row('u-anna')
    expect(within(cells).getByText('None')).not.toBeNull()
    expect(within(cells).getByText('AR')).not.toBeNull()
    expect(within(cells).getByText('from initials')).not.toBeNull()
    expect(button('u-anna', 'edit').textContent).toBe('Set code')
    expect(screen.queryByTestId('receipt-code-clear-u-anna')).toBeNull()
    expect(screen.getByTestId('receipt-codes-success').textContent).toBe(
      'Receipt code for Anna Rossi cleared. New numbers use AR.',
    )
    expect(document.activeElement).toBe(rowHeader('u-anna'))
  })

  it.each([
    ['403', problem(403, 'forbidden'), "You don't have permission to do this."],
    [
      '404',
      problem(404, 'employee_not_found'),
      'This employee is no longer listed. Close this window to refresh the list.',
    ],
    ['a network failure', new TypeError('Failed to fetch'), 'Could not save. Try again.'],
  ])('%s: the error stays in the dialog, the row is unchanged', async (_name, failure, text) => {
    vi.mocked(api.putCode).mockRejectedValueOnce(failure)
    await renderCard()
    fireEvent.click(button('u-anna', 'clear'))
    fireEvent.click(screen.getByTestId('receipt-code-clear-confirm'))
    expect((await screen.findByTestId('receipt-code-clear-error')).textContent).toBe(text)
    expect(screen.getByRole('alertdialog')).not.toBeNull()
    expect(within(row('u-anna')).getAllByText('ARO')).toHaveLength(2)
  })

  it('a 404 reloads the list once the dialog is closed', async () => {
    vi.mocked(api.putCode).mockRejectedValueOnce(problem(404, 'employee_not_found'))
    await renderCard()
    fireEvent.click(button('u-anna', 'clear'))
    fireEvent.click(screen.getByTestId('receipt-code-clear-confirm'))
    await screen.findByTestId('receipt-code-clear-error')
    fireEvent.click(screen.getByTestId('receipt-code-clear-cancel'))
    await waitFor(() => expect(api.listReceiptCodes).toHaveBeenCalledTimes(2))
  })
})

describe('ReceiptCodesCard: History (F4, DS-4)', () => {
  it('opens the drawer at once with a loading line, then the changes newest first with "None" for no code (AC-4.7)', async () => {
    let resolve: (entries: ReceiptCodeHistoryEntry[]) => void = () => undefined
    vi.mocked(api.getCodeHistory).mockReturnValueOnce(new Promise((r) => (resolve = r)))
    await renderCard()
    fireEvent.click(button('u-anna', 'history'))
    const drawer = screen.getByRole('dialog', { name: 'History — Anna Rossi' })
    expect(within(drawer).getByText('Loading the history…')).not.toBeNull()
    await waitFor(() => expect(api.getCodeHistory).toHaveBeenCalledWith('u-anna'))
    resolve(HISTORY)
    const table = await within(drawer).findByRole('table')
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['When', 'By', 'Before', 'After'])
    const bodyRows = within(table).getAllByRole('row').slice(1)
    expect(
      bodyRows.map((r) =>
        within(r)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ),
    ).toEqual([
      ['acc@welld.ch', 'ARO', 'None'],
      ['acc@welld.ch', 'AR', 'ARO'],
      ['acc@welld.ch', 'None', 'AR'],
    ])
  })

  it('an error shows Retry inside the drawer, which loads again; closing returns focus to History', async () => {
    vi.mocked(api.getCodeHistory).mockRejectedValueOnce(problem(500))
    await renderCard()
    const opener = button('u-anna', 'history')
    fireEvent.click(opener)
    const drawer = screen.getByRole('dialog')
    expect(await within(drawer).findByText('Could not load the history.')).not.toBeNull()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Retry' }))
    await within(drawer).findByRole('table')
    expect(api.getCodeHistory).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Close the history' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('an employee with no change yet says so', async () => {
    vi.mocked(api.getCodeHistory).mockResolvedValueOnce([])
    await renderCard()
    fireEvent.click(button('u-luca', 'history'))
    expect(await screen.findByText('No changes recorded yet.')).not.toBeNull()
  })

  it('never shows the rows of the employee opened before', async () => {
    await renderCard()
    fireEvent.click(button('u-anna', 'history'))
    await within(screen.getByRole('dialog')).findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Close the history' }))
    vi.mocked(api.getCodeHistory).mockReturnValueOnce(new Promise(() => undefined))
    fireEvent.click(button('u-luca', 'history'))
    const drawer = screen.getByRole('dialog', { name: 'History — Luca Conti' })
    expect(within(drawer).getByText('Loading the history…')).not.toBeNull()
    expect(within(drawer).queryByRole('table')).toBeNull()
  })
})

describe('ReceiptCodesCard: accessibility (axe, English)', () => {
  it('has no violations: loading, error, 403, empty and loaded', async () => {
    vi.mocked(api.listReceiptCodes).mockReturnValueOnce(new Promise(() => undefined))
    const loading = render(<ReceiptCodesCard />)
    await expectNoAxeViolations()
    loading.unmount()

    vi.mocked(api.listReceiptCodes).mockRejectedValueOnce(problem(500))
    const failed = render(<ReceiptCodesCard />)
    await screen.findByText('Could not load the receipt codes.')
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

  it('has no violations with a code, without, shares prefix, a success banner, and each dialog and the drawer open', async () => {
    vi.mocked(api.putCode).mockResolvedValueOnce({ ...ANNA, code: null, prefix: 'AR', prefixSource: 'initials' })
    await renderCard()
    fireEvent.click(button('u-luca', 'edit'))
    await expectNoAxeViolations()
    fireEvent.click(screen.getByTestId('receipt-code-cancel'))

    fireEvent.click(button('u-anna', 'clear'))
    await expectNoAxeViolations()
    fireEvent.click(screen.getByTestId('receipt-code-clear-confirm'))
    await screen.findByTestId('receipt-codes-success')
    await expectNoAxeViolations()

    fireEvent.click(button('u-luca', 'history'))
    await within(screen.getByRole('dialog')).findByRole('table')
    await expectNoAxeViolations()
  })
})
