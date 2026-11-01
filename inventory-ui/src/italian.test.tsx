/**
 * @vitest-environment jsdom
 *
 * The Italian wiring (INC-25): the language is resolved ONCE by @operai/ui
 * (`resolveLocale`, from `<html lang>` that the shell sets) when the strings
 * module is first imported, and every screen, badge and figure follows it.
 * The rest of the suite runs in English (the test browser's language); here
 * the module graph is re-imported with `<html lang="it">`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { MyDevicesResponse } from './lib/types'

const getMyDevices = vi.fn<() => Promise<MyDevicesResponse>>()
vi.mock('shell/session', () => ({ usePermissions: vi.fn() }))
vi.mock('./lib/scopeApi', () => ({ getScope: vi.fn() }))
vi.mock('./lib/meApi', () => ({ getMyDevices, confirmAssignment: vi.fn(), declineAssignment: vi.fn() }))

beforeAll(() => {
  document.documentElement.setAttribute('lang', 'it')
  vi.resetModules()
})

afterAll(() => {
  cleanup()
  document.documentElement.removeAttribute('lang')
  vi.resetModules()
})

describe('inventory-ui in Italian', () => {
  it('selects the Italian catalog', async () => {
    const { strings, it: italian } = await import('./strings')
    expect(strings).toBe(italian)
  })

  it('renders the My devices screen in Italian, with Italian-formatted dates', async () => {
    getMyDevices.mockResolvedValue({
      devices: [
        {
          assetId: 'h1',
          description: 'Dell U2723QE',
          category: 'monitor',
          serialNumber: 'SN456',
          assignedAt: '2026-03-12T08:00:00Z',
        },
      ],
      pending: [],
    })
    const { default: MyDevicesPage } = await import('./pages/MyDevicesPage')
    render(<MyDevicesPage />)

    expect(await screen.findByRole('heading', { level: 1, name: 'I miei dispositivi' })).not.toBeNull()
    const held = await screen.findByRole('heading', { level: 2, name: 'Dispositivi in uso (1)' })
    expect(within(held.closest('section')!).getByText(/assegnato il 12\.03\.2026/)).not.toBeNull()
    cleanup()
  })

  it('labels the asset status badge and formats money the Italian way', async () => {
    const { default: AssetStatusBadge } = await import('./components/AssetStatusBadge')
    const { formatMoney } = await import('./lib/money')
    render(<AssetStatusBadge status="in_stock" />)

    expect(screen.getByTestId('asset-status-badge').textContent).toBe('In magazzino')
    expect(formatMoney(1234550, 'CHF')).toBe('12.345,50 CHF')
    cleanup()
  })
})
