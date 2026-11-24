/**
 * @vitest-environment jsdom
 *
 * Settings, whole page, in Italian (T21, specs/20261124-receipt-numbers-from-the-register): axe on the Receipt codes
 * view as the only view and as the third, through the real route tree. The language is resolved ONCE when the
 * strings module is first evaluated, so `<html lang="it">` is set in `vi.hoisted` (the pattern of
 * `MyRequestsPage.italian.test.tsx`).
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  document.documentElement.lang = 'it'
})

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import { expectNoAxeViolations } from '../../test-support/axe'

vi.mock('../../lib/ratesApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/ratesApi')>()
  return { ...original, listRates: vi.fn(), addRate: vi.fn() }
})

vi.mock('../../lib/settingsApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/settingsApi')>()
  return { ...original, getSetting: vi.fn(), putSetting: vi.fn() }
})

vi.mock('../../lib/accountingApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/accountingApi')>()
  return { ...original, getExpenseTypeDefaults: vi.fn() }
})

vi.mock('../../lib/receiptCodesApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/receiptCodesApi')>()
  return { ...original, listReceiptCodes: vi.fn(), putCode: vi.fn(), getCodeHistory: vi.fn() }
})

vi.mock('shell/session', async (importOriginal) => {
  const original = await importOriginal<typeof import('shell/session')>()
  return { ...original, usePermissions: vi.fn() }
})

import * as session from 'shell/session'
import * as ratesApi from '../../lib/ratesApi'
import * as settingsApi from '../../lib/settingsApi'
import * as accountingApi from '../../lib/accountingApi'
import * as receiptCodesApi from '../../lib/receiptCodesApi'
import { catalogs, strings } from '../../strings'
import { createAppRouter } from '../../router'

type Permissions = ReturnType<typeof session.usePermissions>

const grant = (apps: string[], ...pairs: [string, string][]): Permissions => ({
  epoch: 1,
  apps,
  roles: [],
  departments: [],
  permissions: pairs.map(([resource, action]) => ({ resource, action, conditions: null })),
})

const RECEIPT_ONLY = grant(['refund'], ['receipt-code', 'manage'])
const EVERYTHING = grant(
  ['refund', 'accounting'],
  ['rate', 'read'],
  ['rate', 'manage'],
  ['settings', 'read'],
  ['settings', 'manage'],
  ['receipt-code', 'manage'],
)

beforeEach(() => {
  vi.mocked(ratesApi.listRates).mockResolvedValue({ entities: [] })
  vi.mocked(settingsApi.getSetting).mockResolvedValue({
    key: 'accounting-distribution-email',
    value: null,
    configured: false,
    updatedAt: null,
    updatedByEmail: null,
    history: [],
  })
  vi.mocked(accountingApi.getExpenseTypeDefaults).mockResolvedValue({
    entity: 'welld_ch',
    accounting: 'available',
    types: [],
  })
  vi.mocked(receiptCodesApi.listReceiptCodes).mockResolvedValue([
    {
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
      sharesPrefix: true,
    },
  ])
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.history.pushState(null, '', '/')
})

afterAll(() => {
  document.documentElement.lang = ''
})

const openSettings = async (search = '') => {
  window.history.pushState(null, '', `/settings${search}`)
  render(<RouterProvider router={createAppRouter()} />)
  await screen.findByTestId('refund-settings-page')
}

describe('Settings page, Receipt codes (it)', () => {
  it('one view: no tab list, the Italian description, no violations', async () => {
    expect(strings).toBe(catalogs.it)
    vi.mocked(session.usePermissions).mockReturnValue(RECEIPT_ONLY)
    await openSettings()
    await screen.findByTestId('receipt-codes-table')
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByText('I codici con cui iniziano i numeri di ricevuta di ogni dipendente.')).not.toBeNull()
    await expectNoAxeViolations()
  })

  it('three views: the tab "Codici ricevuta", opened from the URL and from the tab list, no violations', async () => {
    vi.mocked(session.usePermissions).mockReturnValue(EVERYTHING)
    await openSettings('?section=receipt-codes')
    await screen.findByTestId('receipt-codes-table')
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Generale',
      'Classificazione predefinita',
      'Codici ricevuta',
    ])
    await expectNoAxeViolations()

    fireEvent.click(screen.getByRole('tab', { name: 'Generale' }))
    await screen.findByTestId('refund-settings-view-general')
    await expectNoAxeViolations()
    fireEvent.click(screen.getByRole('tab', { name: 'Codici ricevuta' }))
    await screen.findByTestId('receipt-codes-table')
    await expectNoAxeViolations()
  })
})
