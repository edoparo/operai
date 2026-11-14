/**
 * @vitest-environment jsdom
 *
 * Component tests for refund-ui's SettingsPage — moved from admin-ui's
 * MileageRatesPage on 2026-11-13 (ADR 20260720-mileage-rate-model-snapshot-admin-ui-composition amendment; specs/20260720-mileage-rate/tasks.md T11, refs AC-4.1, AC-4.2, AC-4.3, AC-4.5,
 * AC-4.6, AC-5.3).
 *
 * Covers:
 *   (A) Loading: ratesApi.listRates is pending → SkeletonListRows visible.
 *   (B) Populated: renders both entities' tables (Rate/Valid from/Added
 *       by/Added on/Status columns), the `inEffectToday` row carries
 *       RateInEffectBadge, a non-in-effect row does not.
 *   (C) Empty (per entity): "No rate configured yet for …" + a repeated
 *       "Add rate entry" when rate:manage is granted.
 *   (D) Error: listRates rejects (non-403) → ErrorBanner + Retry re-fetches.
 *   (E) Forbidden: listRates rejects with 403 → PermissionDenied with a
 *       section-specific message, no "Add rate entry" anywhere.
 *   (F) rate:manage gating: no "Add rate entry" button anywhere when
 *       usePermissions() doesn't grant it, even though the tables render.
 *   (G) Add (M1): "Add rate entry" → fill rate/validFrom → submit →
 *       ratesApi.addRate called with the right body → list reloads → focus
 *       returns to the trigger button.
 *   (H) Add 422: addRate rejects 422 → field-level error surfaced (rate vs.
 *       date routing), modal stays open.
 *   (I) Client-side pre-check: a non-positive rate or empty date blocks
 *       submit without calling addRate at all.
 *
 * Strategy mirrors RolesPage.test.tsx: mock `../lib/ratesApi` and
 * `../lib/settingsApi` at the module level (keeping the real `ApiError`/types
 * via importOriginal); capabilities come from a mocked `shell/session`
 * `usePermissions()` (INC-32, as in SectionNav.test.tsx).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SettingsPage from './SettingsPage'
import type { RatesResult } from '../lib/ratesApi'
import type { SettingResult } from '../lib/settingsApi'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before importing the mocked modules.
// ---------------------------------------------------------------------------

vi.mock('../lib/ratesApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/ratesApi')>()
  return { ...original, listRates: vi.fn(), addRate: vi.fn() }
})

vi.mock('shell/session', async (importOriginal) => {
  const original = await importOriginal<typeof import('shell/session')>()
  return { ...original, usePermissions: vi.fn() }
})

vi.mock('../lib/settingsApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/settingsApi')>()
  return { ...original, getSetting: vi.fn(), putSetting: vi.fn() }
})

import * as ratesApi from '../lib/ratesApi'
import { ApiError as RatesApiError } from '../lib/refundApi'
import * as session from 'shell/session'
import * as settingsApi from '../lib/settingsApi'
import { ApiError as SettingsApiError } from '../lib/refundApi'
import { ACCOUNTING_DISTRIBUTION_EMAIL_KEY } from '../lib/settingsApi'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type Permissions = ReturnType<typeof session.usePermissions>

// The shell's EMPTY_PERMISSIONS — what usePermissions() yields before
// /authz/me resolves or when it fails.
const NO_GRANTS: Permissions = { epoch: 0, apps: [], roles: [], departments: [], permissions: [] }

const managePermissions: Permissions = {
  epoch: 1,
  apps: ['refund'],
  roles: ['admin'],
  departments: [],
  permissions: [
    { resource: 'rate', action: 'read', conditions: null },
    { resource: 'rate', action: 'manage', conditions: null },
  ],
}

const readOnlyPermissions: Permissions = {
  epoch: 1,
  apps: ['refund'],
  roles: [],
  departments: [],
  permissions: [{ resource: 'rate', action: 'read', conditions: null }],
}

// T6, specs/20260722-refund-settings — grants BOTH settings:read and
// settings:manage (mirrors ADR 20260722-settings-catalog-permission-config-not-rate's seed: the two are granted together to
// admin/refund-admin), used for the accounting-distribution-email panel's
// happy-path tests.
const settingsManagePermissions: Permissions = {
  epoch: 1,
  apps: ['refund'],
  roles: ['admin'],
  departments: [],
  permissions: [
    { resource: 'rate', action: 'read', conditions: null },
    { resource: 'rate', action: 'manage', conditions: null },
    { resource: 'settings', action: 'read', conditions: null },
    { resource: 'settings', action: 'manage', conditions: null },
  ],
}

// settings:read WITHOUT settings:manage — the panel is shown read-only.
const settingsReadOnlyPermissions: Permissions = {
  epoch: 1,
  apps: ['refund'],
  roles: [],
  departments: [],
  permissions: [
    { resource: 'rate', action: 'read', conditions: null },
    { resource: 'settings', action: 'read', conditions: null },
  ],
}

const configuredSetting: SettingResult = {
  key: ACCOUNTING_DISTRIBUTION_EMAIL_KEY,
  value: 'accounting@welld.ch',
  configured: true,
  updatedAt: '2026-07-20T09:12:00.000Z',
  updatedByEmail: 'admin@welld.ch',
  history: [{ value: 'accounting@welld.ch', changedAt: '2026-07-20T09:12:00.000Z', changedByEmail: 'admin@welld.ch' }],
}

const notConfiguredSetting: SettingResult = {
  key: ACCOUNTING_DISTRIBUTION_EMAIL_KEY,
  value: null,
  configured: false,
  updatedAt: null,
  updatedByEmail: null,
  history: [],
}

const populatedResult: RatesResult = {
  entities: [
    {
      entity: 'welld_ch',
      currency: 'CHF',
      currentEntryId: 'clr_current',
      entries: [
        {
          id: 'clr_old',
          ratePerKmMicros: 650000,
          ratePerKm: '0.65',
          validFrom: '2025-01-01',
          createdAt: '2025-01-01T09:00:00.000Z',
          createdByEmail: 'past-admin@welld.ch',
          inEffectToday: false,
        },
        {
          id: 'clr_current',
          ratePerKmMicros: 700000,
          ratePerKm: '0.70',
          validFrom: '2026-01-01',
          createdAt: '2026-01-01T09:00:00.000Z',
          createdByEmail: 'admin@welld.ch',
          inEffectToday: true,
        },
      ],
    },
    { entity: 'welld_it', currency: 'EUR', currentEntryId: null, entries: [] },
  ],
}

/** Returns a promise that never resolves — keeps a fetch "pending" (loading). */
function pendingPromise<T>(): Promise<T> {
  return new Promise(() => {})
}

beforeEach(() => {
  vi.mocked(session.usePermissions).mockReturnValue(managePermissions)
})

afterEach(() => {
  vi.clearAllMocks()
  cleanup()
})

// ---------------------------------------------------------------------------
// (A) Loading
// ---------------------------------------------------------------------------

describe('SettingsPage — loading', () => {
  it('renders SkeletonListRows under each entity heading while listRates is in-flight', () => {
    vi.mocked(session.usePermissions).mockReturnValue(settingsManagePermissions)
    vi.mocked(ratesApi.listRates).mockReturnValue(pendingPromise())
    vi.mocked(settingsApi.getSetting).mockReturnValue(pendingPromise())

    render(<SettingsPage />)

    // 2 for the rate entities + 1 for the accounting-distribution-email panel
    // (T6, specs/20260722-refund-settings) — with settings:read held it also starts
    // 'loading' on the very first synchronous render, before its getSetting()
    // call resolves.
    expect(screen.getAllByTestId('skeleton-list-rows')).toHaveLength(3)
    expect(screen.getByText('Mileage rates · WellD CH')).not.toBeNull()
    expect(screen.getByText('Mileage rates · WellD Italia')).not.toBeNull()
    expect(screen.queryByTestId('rates-table-welld_ch')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// (B) Populated
// ---------------------------------------------------------------------------

describe('SettingsPage — populated', () => {
  it('renders both entities, in-effect badge on the current row only', async () => {
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('rates-table-welld_ch')).not.toBeNull()
    })

    const rows = screen.getAllByTestId(/^rate-row-/)
    expect(rows).toHaveLength(2)

    const currentRow = screen.getByTestId('rate-row-clr_current')
    expect(currentRow.textContent).toContain('CHF 0.70/km')
    expect(currentRow.querySelector('[data-testid="rate-in-effect-badge"]')).not.toBeNull()
    // INC-26: valid-from is the library's numeric date, the calendar day never shifted by the time zone.
    expect(currentRow.textContent).toContain('01.01.2026')

    const oldRow = screen.getByTestId('rate-row-clr_old')
    expect(oldRow.textContent).toContain('CHF 0.65/km')
    expect(oldRow.querySelector('[data-testid="rate-in-effect-badge"]')).toBeNull()

    // No Actions column anywhere (AC-4.7 — append-only, no edit/delete).
    const table = screen.getByTestId('rates-table-welld_ch')
    expect(table.textContent).not.toContain('Edit')
    expect(table.textContent).not.toContain('Delete')
  })

  it('formats the rate from its integer micros with the locale number formatter (INC-27)', async () => {
    vi.mocked(ratesApi.listRates).mockResolvedValue({
      ...populatedResult,
      entities: [
        {
          entity: 'welld_ch',
          currency: 'CHF',
          currentEntryId: 'clr_precise',
          entries: [
            {
              id: 'clr_precise',
              ratePerKmMicros: 725500,
              // The decimal string is ignored for display: the micros are the source of truth.
              ratePerKm: 'ignored',
              validFrom: '2026-01-01',
              createdAt: '2026-01-01T09:00:00.000Z',
              createdByEmail: 'admin@welld.ch',
              inEffectToday: true,
            },
          ],
        },
        { entity: 'welld_it', currency: 'EUR', currentEntryId: null, entries: [] },
      ],
    })

    render(<SettingsPage />)

    const row = await screen.findByTestId('rate-row-clr_precise')
    expect(row.textContent).toContain('CHF 0.7255/km')
  })

  it('renders "No rate configured yet for WellD Italia." for the empty entity', async () => {
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('rates-empty-welld_it')).not.toBeNull()
    })
    expect(screen.getByText('No rate configured yet for WellD Italia.')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// (D) Error
// ---------------------------------------------------------------------------

describe('SettingsPage — error', () => {
  it('renders an ErrorBanner and retries on click', async () => {
    vi.mocked(ratesApi.listRates)
      .mockRejectedValueOnce(
        new RatesApiError({ type: 'about:blank', title: 'Internal Server Error', status: 500, detail: 'Boom.' }),
      )
      .mockResolvedValueOnce(populatedResult)

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).not.toBeNull()
    })
    expect(screen.getByRole('alert').textContent).toContain('Boom.')

    fireEvent.click(screen.getByTestId('error-banner-retry'))

    await waitFor(() => {
      expect(screen.getByTestId('rates-table-welld_ch')).not.toBeNull()
    })
    expect(ratesApi.listRates).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// (E) Forbidden
// ---------------------------------------------------------------------------

describe('SettingsPage — forbidden (AC-4.6)', () => {
  it('renders PermissionDenied with a section-specific message on a 403, no add affordance', async () => {
    vi.mocked(ratesApi.listRates).mockRejectedValue(
      new RatesApiError({ type: 'about:blank', title: 'Forbidden', status: 403, detail: 'Missing rate:read' }),
    )

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('permission-denied')).not.toBeNull()
    })
    expect(screen.getByTestId('permission-denied').textContent).toContain(
      "You don't have permission to view mileage rates.",
    )
    expect(screen.queryByTestId('rates-table-welld_ch')).toBeNull()
    expect(screen.queryByText('Add rate entry')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// (F) rate:manage gating
// ---------------------------------------------------------------------------

describe('SettingsPage — rate:manage gating', () => {
  it('renders the tables but no "Add rate entry" button anywhere without rate:manage', async () => {
    vi.mocked(session.usePermissions).mockReturnValue(readOnlyPermissions)
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('rates-table-welld_ch')).not.toBeNull()
    })
    expect(screen.queryByText('Add rate entry')).toBeNull()
    expect(screen.queryByTestId('add-rate-button-welld_ch')).toBeNull()
  })

  it('hides "Add rate entry" on the shell EMPTY_PERMISSIONS — its result for any /authz/me failure (fails closed — hidden, not crashed)', async () => {
    vi.mocked(session.usePermissions).mockReturnValue(NO_GRANTS)
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('rates-table-welld_ch')).not.toBeNull()
    })
    expect(screen.queryByText('Add rate entry')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// (G)/(H)/(I) Add rate entry flow
// ---------------------------------------------------------------------------

describe('SettingsPage — add rate entry (Modal ADM-M1)', () => {
  it('opens the modal for the clicked entity, submits via ratesApi.addRate, reloads the list, and returns focus to the trigger', async () => {
    vi.mocked(ratesApi.listRates).mockResolvedValueOnce(populatedResult).mockResolvedValueOnce(populatedResult)
    vi.mocked(ratesApi.addRate).mockResolvedValue({
      id: 'clr_new',
      ratePerKmMicros: 720000,
      ratePerKm: '0.72',
      validFrom: '2026-08-01',
      createdAt: '2026-08-01T00:00:00.000Z',
      createdByEmail: 'admin@welld.ch',
      inEffectToday: false,
    })

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('rates-table-welld_ch')).not.toBeNull()
    })

    const trigger = screen.getByTestId('add-rate-button-welld_ch')
    fireEvent.click(trigger)

    expect(screen.getByTestId('add-rate-modal-welld_ch')).not.toBeNull()
    expect(screen.getByText('Add rate entry — WellD CH')).not.toBeNull()

    fireEvent.change(screen.getByTestId('add-rate-value'), { target: { value: '0.72' } })
    fireEvent.change(screen.getByTestId('add-rate-valid-from'), { target: { value: '2026-08-01' } })
    fireEvent.click(screen.getByTestId('add-rate-submit'))

    await waitFor(() => {
      expect(ratesApi.addRate).toHaveBeenCalledWith({
        entity: 'welld_ch',
        ratePerKm: '0.72',
        validFrom: '2026-08-01',
      })
    })

    await waitFor(() => {
      expect(screen.queryByTestId('add-rate-modal-welld_ch')).toBeNull()
    })
    expect(ratesApi.listRates).toHaveBeenCalledTimes(2)
    expect(document.activeElement).toBe(trigger)
    // INC-19: the entity's section confirms the new entry (a polite status, focus untouched).
    await waitFor(() => {
      expect(screen.getByTestId('rates-success-welld_ch').textContent).toBe('Rate entry added for WellD CH')
    })
    expect(screen.getByTestId('rates-success-welld_ch-banner').getAttribute('role')).toBe('status')
  })

  it('cancelling the modal (Escape) does not call addRate', async () => {
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('rates-table-welld_ch')).not.toBeNull()
    })

    fireEvent.click(screen.getByTestId('add-rate-button-welld_ch'))
    expect(screen.getByTestId('add-rate-modal-welld_ch')).not.toBeNull()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByTestId('add-rate-modal-welld_ch')).toBeNull()
    expect(ratesApi.addRate).not.toHaveBeenCalled()
  })

  it('a 422 on a non-positive-value message routes to the Rate field error, modal stays open (AC-4.5)', async () => {
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)
    vi.mocked(ratesApi.addRate).mockRejectedValue(
      new RatesApiError({
        type: 'about:blank',
        title: 'Unprocessable Entity',
        status: 422,
        detail: 'ratePerKm must be greater than 0',
      }),
    )

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('rates-table-welld_ch')).not.toBeNull()
    })

    fireEvent.click(screen.getByTestId('add-rate-button-welld_ch'))
    fireEvent.change(screen.getByTestId('add-rate-value'), { target: { value: '0.72' } })
    fireEvent.change(screen.getByTestId('add-rate-valid-from'), { target: { value: '2026-08-01' } })
    fireEvent.click(screen.getByTestId('add-rate-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('add-rate-value-error')).not.toBeNull()
    })
    expect(screen.getByTestId('add-rate-value-error').textContent).toBe('ratePerKm must be greater than 0')
    expect(screen.queryByTestId('add-rate-valid-from-error')).toBeNull()
    // Modal stays open — nothing persisted.
    expect(screen.getByTestId('add-rate-modal-welld_ch')).not.toBeNull()
  })

  it('a 422 on a date-shaped message routes to the Valid-from field error (AC-4.5)', async () => {
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)
    vi.mocked(ratesApi.addRate).mockRejectedValue(
      new RatesApiError({
        type: 'about:blank',
        title: 'Unprocessable Entity',
        status: 422,
        detail: 'validFrom must be a valid date',
      }),
    )

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('rates-table-welld_ch')).not.toBeNull()
    })

    fireEvent.click(screen.getByTestId('add-rate-button-welld_ch'))
    fireEvent.change(screen.getByTestId('add-rate-value'), { target: { value: '0.72' } })
    fireEvent.change(screen.getByTestId('add-rate-valid-from'), { target: { value: '2026-08-01' } })
    fireEvent.click(screen.getByTestId('add-rate-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('add-rate-valid-from-error')).not.toBeNull()
    })
    expect(screen.getByTestId('add-rate-valid-from-error').textContent).toBe('validFrom must be a valid date')
    expect(screen.queryByTestId('add-rate-value-error')).toBeNull()
  })

  it('a non-positive rate value is caught client-side without ever calling addRate', async () => {
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('rates-table-welld_ch')).not.toBeNull()
    })

    fireEvent.click(screen.getByTestId('add-rate-button-welld_ch'))
    fireEvent.change(screen.getByTestId('add-rate-value'), { target: { value: '0' } })
    fireEvent.change(screen.getByTestId('add-rate-valid-from'), { target: { value: '2026-08-01' } })
    fireEvent.click(screen.getByTestId('add-rate-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('add-rate-value-error')).not.toBeNull()
    })
    expect(screen.getByTestId('add-rate-value-error').textContent).toBe('Enter a rate greater than 0.')
    expect(ratesApi.addRate).not.toHaveBeenCalled()
    // INC-16: the error describes and marks the field, and a failed submit focuses it.
    const rateInput = screen.getByTestId('add-rate-value')
    expect(rateInput.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(rateInput)
  })

  it('the rate is a text MoneyInput: a comma decimal is accepted and sent as a dot decimal (INC-17)', async () => {
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)
    vi.mocked(ratesApi.addRate).mockResolvedValue({
      id: 'clr_new',
      ratePerKmMicros: 720000,
      ratePerKm: '0.72',
      validFrom: '2026-08-01',
      createdAt: '2026-07-20T10:00:00.000Z',
      createdByEmail: 'me@welld.ch',
      inEffectToday: false,
    })

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('rates-table-welld_ch')).not.toBeNull()
    })

    fireEvent.click(screen.getByTestId('add-rate-button-welld_ch'))
    const rateInput = screen.getByTestId('add-rate-value')
    expect(rateInput.getAttribute('type')).toBe('text')
    expect(rateInput.getAttribute('inputmode')).toBe('decimal')
    expect(screen.getByTestId('add-rate-valid-from').getAttribute('type')).toBe('date')

    fireEvent.change(rateInput, { target: { value: '0,72' } })
    fireEvent.change(screen.getByTestId('add-rate-valid-from'), { target: { value: '2026-08-01' } })
    fireEvent.click(screen.getByTestId('add-rate-submit'))

    await waitFor(() => {
      expect(ratesApi.addRate).toHaveBeenCalledWith({ entity: 'welld_ch', ratePerKm: '0.72', validFrom: '2026-08-01' })
    })
  })

  it('more decimals than the rate precision (6) is an error on blur, never rounded', async () => {
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('rates-table-welld_ch')).not.toBeNull()
    })

    fireEvent.click(screen.getByTestId('add-rate-button-welld_ch'))
    const rateInput = screen.getByTestId('add-rate-value')
    fireEvent.change(rateInput, { target: { value: '0.1234567' } })
    fireEvent.blur(rateInput)

    expect(screen.getByTestId('add-rate-value-error').textContent).toBe('Enter a rate greater than 0.')
    expect(rateInput.getAttribute('aria-invalid')).toBe('true')

    // Typing again clears the blur error.
    fireEvent.change(rateInput, { target: { value: '0.123456' } })
    expect(screen.queryByTestId('add-rate-value-error')).toBeNull()
    expect(ratesApi.addRate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Accounting distribution email panel (T6, specs/20260722-refund-settings/tasks.md,
// refs AC-1.1, AC-3.2, AC-5.3).
// ---------------------------------------------------------------------------

describe('SettingsPage — accounting distribution email panel', () => {
  it('renders the current configured value and its history (AC-1.1, AC-5.3)', async () => {
    vi.mocked(session.usePermissions).mockReturnValue(settingsManagePermissions)
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)
    vi.mocked(settingsApi.getSetting).mockResolvedValue(configuredSetting)

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('accounting-email-panel')).not.toBeNull()
    })
    expect(screen.getByTestId('accounting-email-current-value').textContent).toBe('accounting@welld.ch')

    const history = screen.getByTestId('accounting-email-history')
    expect(history.textContent).toContain('accounting@welld.ch')
    expect(history.textContent).toContain('admin@welld.ch')
  })

  it('renders a clear "not configured" state when the setting has never been set (AC-1.1)', async () => {
    vi.mocked(session.usePermissions).mockReturnValue(settingsManagePermissions)
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)
    vi.mocked(settingsApi.getSetting).mockResolvedValue(notConfiguredSetting)

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('accounting-email-current-value')).not.toBeNull()
    })
    expect(screen.getByTestId('accounting-email-current-value').textContent).toBe('Not configured')
    expect(screen.queryByTestId('accounting-email-history')).toBeNull()
    expect(screen.getByText('No changes recorded yet.')).not.toBeNull()
  })

  it('saves a valid email via settingsApi.putSetting and updates the shown value (AC-1.2)', async () => {
    vi.mocked(session.usePermissions).mockReturnValue(settingsManagePermissions)
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)
    vi.mocked(settingsApi.getSetting).mockResolvedValue(notConfiguredSetting)
    vi.mocked(settingsApi.putSetting).mockResolvedValue({
      ...configuredSetting,
      value: 'new-accounting@welld.ch',
      history: [
        ...notConfiguredSetting.history,
        { value: 'new-accounting@welld.ch', changedAt: '2026-07-22T10:00:00.000Z', changedByEmail: 'me@welld.ch' },
      ],
    })

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('accounting-email-input')).not.toBeNull()
    })

    fireEvent.change(screen.getByTestId('accounting-email-input'), {
      target: { value: 'new-accounting@welld.ch' },
    })
    fireEvent.click(screen.getByTestId('accounting-email-save'))

    await waitFor(() => {
      expect(settingsApi.putSetting).toHaveBeenCalledWith(ACCOUNTING_DISTRIBUTION_EMAIL_KEY, 'new-accounting@welld.ch')
    })
    await waitFor(() => {
      expect(screen.getByTestId('accounting-email-current-value').textContent).toBe('new-accounting@welld.ch')
    })
    // INC-19: the save is confirmed beside the form.
    expect(screen.getByTestId('accounting-email-success').textContent).toBe('Accounting distribution email saved')
  })

  it('a 422 on save shows the inline error and leaves the shown value unchanged (AC-1.3)', async () => {
    vi.mocked(session.usePermissions).mockReturnValue(settingsManagePermissions)
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)
    vi.mocked(settingsApi.getSetting).mockResolvedValue(configuredSetting)
    vi.mocked(settingsApi.putSetting).mockRejectedValue(
      new SettingsApiError({
        type: 'about:blank',
        title: 'Unprocessable Entity',
        status: 422,
        detail: 'value must be a well-formed email address',
      }),
    )

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('accounting-email-input')).not.toBeNull()
    })

    fireEvent.change(screen.getByTestId('accounting-email-input'), { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByTestId('accounting-email-save'))

    await waitFor(() => {
      expect(screen.getByTestId('accounting-email-error')).not.toBeNull()
    })
    expect(screen.getByTestId('accounting-email-error').textContent).toBe('value must be a well-formed email address')
    // INC-16/20: a red field error on the input, which gets focus back.
    const emailInput = screen.getByTestId('accounting-email-input')
    expect(emailInput.getAttribute('aria-invalid')).toBe('true')
    await waitFor(() => {
      expect(document.activeElement).toBe(emailInput)
    })
    expect(screen.queryByTestId('accounting-email-success')).toBeNull()
    // The shown current value is untouched — nothing was persisted.
    expect(screen.getByTestId('accounting-email-current-value').textContent).toBe('accounting@welld.ch')
  })

  it('clears the setting via the Clear action (AC-1.4)', async () => {
    vi.mocked(session.usePermissions).mockReturnValue(settingsManagePermissions)
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)
    vi.mocked(settingsApi.getSetting).mockResolvedValue(configuredSetting)
    vi.mocked(settingsApi.putSetting).mockResolvedValue(notConfiguredSetting)

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('accounting-email-clear')).not.toBeNull()
    })

    fireEvent.click(screen.getByTestId('accounting-email-clear'))

    await waitFor(() => {
      expect(settingsApi.putSetting).toHaveBeenCalledWith(ACCOUNTING_DISTRIBUTION_EMAIL_KEY, null)
    })
    await waitFor(() => {
      expect(screen.getByTestId('accounting-email-current-value').textContent).toBe('Not configured')
    })
    expect(screen.getByTestId('accounting-email-success').textContent).toBe('Accounting distribution email cleared')
  })

  it('is hidden entirely when usePermissions() lacks settings:read (AC-3.2)', async () => {
    vi.mocked(session.usePermissions).mockReturnValue(managePermissions)
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('rates-table-welld_ch')).not.toBeNull()
    })
    expect(screen.queryByTestId('accounting-email-panel')).toBeNull()
    expect(settingsApi.getSetting).not.toHaveBeenCalled()
  })

  it('is hidden entirely on the shell EMPTY_PERMISSIONS — its result for any /authz/me failure (fails closed)', async () => {
    vi.mocked(session.usePermissions).mockReturnValue(NO_GRANTS)
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('rates-table-welld_ch')).not.toBeNull()
    })
    expect(screen.queryByTestId('accounting-email-panel')).toBeNull()
    expect(settingsApi.getSetting).not.toHaveBeenCalled()
  })

  it('is hidden when GET /settings/:key answers 403 despite settings:read (reactive path, AC-3.2)', async () => {
    vi.mocked(session.usePermissions).mockReturnValue(settingsManagePermissions)
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)
    vi.mocked(settingsApi.getSetting).mockRejectedValue(
      new SettingsApiError({ type: 'about:blank', title: 'Forbidden', status: 403, detail: 'Missing settings:read' }),
    )

    render(<SettingsPage />)

    // Shown (loading) while the capability says yes, then removed on the 403.
    expect(screen.getByTestId('accounting-email-panel')).not.toBeNull()
    await waitFor(() => {
      expect(settingsApi.getSetting).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.queryByTestId('accounting-email-panel')).toBeNull()
    })
    expect(screen.getByTestId('rates-table-welld_ch')).not.toBeNull()
  })

  it('shows the value and history read-only, with no edit form, without settings:manage', async () => {
    vi.mocked(session.usePermissions).mockReturnValue(settingsReadOnlyPermissions)
    vi.mocked(ratesApi.listRates).mockResolvedValue(populatedResult)
    vi.mocked(settingsApi.getSetting).mockResolvedValue(configuredSetting)

    render(<SettingsPage />)

    await waitFor(() => {
      expect(screen.getByTestId('accounting-email-current-value').textContent).toBe('accounting@welld.ch')
    })
    expect(screen.getByTestId('accounting-email-history')).not.toBeNull()
    expect(screen.queryByTestId('accounting-email-input')).toBeNull()
    expect(screen.queryByTestId('accounting-email-save')).toBeNull()
    expect(screen.queryByTestId('accounting-email-clear')).toBeNull()
  })
})
