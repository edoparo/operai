/**
 * @vitest-environment jsdom
 *
 * ReceiptCodesSettingsView (T21, specs/20261124-receipt-numbers-from-the-register, design RC-1; AC-4.9): the view is
 * the receipt codes card and nothing else, and it fetches the list on mount. It has no capability check of its own:
 * the page decides whether it exists (SettingsPage.test.tsx), and a 403 that arrives anyway is the card's
 * `PermissionDenied`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../lib/receiptCodesApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/receiptCodesApi')>()
  return { ...original, listReceiptCodes: vi.fn(), putCode: vi.fn(), getCodeHistory: vi.fn() }
})

import * as api from '../../lib/receiptCodesApi'
import { ApiError } from '../../lib/refundApi'
import ReceiptCodesSettingsView from './ReceiptCodesSettingsView'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ReceiptCodesSettingsView', () => {
  it('shows the receipt codes card and fetches the list once', async () => {
    vi.mocked(api.listReceiptCodes).mockResolvedValue([])
    render(<ReceiptCodesSettingsView />)
    expect(screen.getByTestId('refund-settings-receipt-codes')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Receipt codes' })).not.toBeNull()
    await screen.findByTestId('receipt-codes-empty')
    expect(api.listReceiptCodes).toHaveBeenCalledTimes(1)
  })

  it('a 403 is PermissionDenied in place of the card, never a blank view (RC-3)', async () => {
    vi.mocked(api.listReceiptCodes).mockRejectedValue(
      new ApiError({ type: 't', title: 'Forbidden', status: 403, code: 'forbidden' }),
    )
    render(<ReceiptCodesSettingsView />)
    expect(await screen.findByTestId('permission-denied')).not.toBeNull()
    expect(screen.queryByTestId('receipt-codes-card')).toBeNull()
  })
})
