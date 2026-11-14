/**
 * @vitest-environment jsdom
 *
 * Component tests for EstimatesPage — T8, specs/20260606-estimate-persistence.
 *
 * Covers:
 *   (A) Loading: estimatesApi.list is pending → the loading SkeletonRows is visible.
 *   (B) Loaded: estimatesApi.list resolves with 2 items → both rows render with
 *       name and a formatted updatedAt; the actual item names appear (the
 *       assertion would fail if the list did not render).
 *   (C) Empty: estimatesApi.list resolves [] → empty state renders, no error
 *       surface and no the loading SkeletonRows visible (AC-2.3).
 *   (D) Error: estimatesApi.list rejects → an error surface renders and the
 *       component does not crash.
 *   (E) Chrome dedup (specs/20260709-suite-shell, T14, AC-4.2): the page no longer
 *       renders its own logo image or UserMenu — those are shell-owned now —
 *       but keeps its tool-scoped "Import JSON" and "New estimate" actions.
 *   (F) Shared row (specs/20260807-estimate-sharing, T23, AC-2.1/AC-2.2/AC-10.4):
 *       a shared row is distinguishable from an owned row by testid (never by
 *       CSS class), carries an `AccessLevelBadge` + the owner's identity via
 *       `formatIdentity`, and has no owner-only Delete action.
 *   (G) Orphaned / unresolved owner identity (T23, AC-10.4/AC-10.5): a
 *       `deleted` owner renders "Former wellD member", an `unknown` owner the
 *       neutral placeholder — never blank, never a raw id, never an error —
 *       and Delete stays absent on the orphaned row.
 *   (H) Empty-state gating (T23, AC-2.3): the empty state keys off the
 *       COMBINED owned+shared list length, so a user with only shared
 *       estimates never sees "Ready to estimate your first project?".
 *
 * Strategy:
 *   • estimatesApi is mocked at the module level so tests control what list()
 *     resolves/rejects to.
 *   • useNavigate from @tanstack/react-router is mocked to a vi.fn().
 *   • waitFor is used to await the async useEffect that calls estimatesApi.list.
 *   • Non-vacuous: every assertion is tied to a specific text/testid that would
 *     not appear if the code path did not execute.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor, cleanup, within, fireEvent, act } from '@testing-library/react'
import EstimatesPage from './EstimatesPage'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { navigateSuite } from 'shell/session'
import { FILTERS_STORAGE_KEY } from '../lib/listFilters'
import type { EstimateListItem } from '../lib/estimatesApi'
import { formatDate } from '@operai/ui'
import { strings } from '../strings'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports of the modules under test.
// ---------------------------------------------------------------------------

vi.mock('../lib/estimatesApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/estimatesApi')>()
  return {
    ...original,
    list: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  }
})

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...original,
    useNavigate: vi.fn(() => vi.fn()),
    useSearch: vi.fn(() => ({})),
    // A row's name is a router <Link> (INC-14); no RouterProvider here.
    Link: ({ children, className, tabIndex }: { children: ReactNode; className?: string; tabIndex?: number }) => (
      <a href="#" className={className} tabIndex={tabIndex}>
        {children}
      </a>
    ),
  }
})

// The caller's permissions (UX gating only): a test says what it grants.
const perms = vi.hoisted(() => ({
  value: {
    epoch: 0,
    apps: [] as string[],
    roles: [] as string[],
    departments: [] as string[],
    permissions: [] as { resource: string; action: string }[],
  },
}))

vi.mock('shell/session', async (importOriginal) => {
  const original = await importOriginal<typeof import('shell/session')>()
  return { ...original, usePermissions: () => perms.value, navigateSuite: vi.fn() }
})

vi.mock('../lib/api', () => ({
  clearJwtCache: vi.fn(),
  apiFetch: vi.fn(),
}))

// Import estimatesApi AFTER vi.mock so we get the mocked version.
import * as estimatesApi from '../lib/estimatesApi'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const itemA: EstimateListItem = {
  id: 'est-alpha',
  name: 'Alpha Project',
  author: 'Consultant A',
  updatedAt: '2026-07-01T10:00:00.000Z',
  access: 'owner',
  owner: null,
  closedAt: null,
  crmDealId: null,
}

const itemB: EstimateListItem = {
  id: 'est-beta',
  name: 'Beta Initiative',
  author: 'Consultant B',
  updatedAt: '2026-06-28T14:30:00.000Z',
  access: 'owner',
  owner: null,
  closedAt: null,
  crmDealId: null,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a promise that never resolves — used to keep list() in the
 * "pending" (loading) state for test (A).
 */
function pendingPromise<T>(): Promise<T> {
  return new Promise(() => {})
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let navigateMock = vi.fn()

/** The caller holds these permissions and their grants have resolved. */
const grant = (...pairs: [string, string][]) => {
  perms.value = {
    epoch: 1,
    apps: ['estimai'],
    roles: [],
    departments: [],
    permissions: pairs.map(([resource, action]) => ({ resource, action })),
  }
}

beforeEach(() => {
  navigateMock = vi.fn()
  vi.mocked(useNavigate).mockReturnValue(navigateMock as never)
  vi.mocked(useSearch).mockReturnValue({} as never)
  perms.value = { epoch: 0, apps: [], roles: [], departments: [], permissions: [] }
  sessionStorage.clear()
  vi.stubEnv('VITE_API_URL', 'http://api.test')
  vi.stubEnv('VITE_AUTH_URL', 'http://auth.test')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  cleanup()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EstimatesPage', () => {
  // (A) Loading state
  describe('(A) loading — list() is pending', () => {
    it('renders the loading SkeletonRows while estimatesApi.list is in-flight', () => {
      vi.mocked(estimatesApi.list).mockReturnValue(pendingPromise())

      render(<EstimatesPage />)

      // the loading SkeletonRows renders with data-testid="skeleton-list-rows"
      const skeleton = screen.getByTestId('skeleton-list-rows')
      expect(skeleton).toBeDefined()

      // No estimate rows or error banners should be present yet
      expect(screen.queryByRole('alert')).toBeNull()
      // "Ready to estimate" only appears in the empty state — must not appear
      expect(screen.queryByText(strings.estimatesList.empty.mineOpen.heading)).toBeNull()
    })
  })

  // (B) Loaded with items
  describe('(B) loaded — list() resolves with 2 items', () => {
    it('renders both estimate names and their formatted updatedAt dates (AC-2.1)', async () => {
      vi.mocked(estimatesApi.list).mockResolvedValue([itemA, itemB])

      render(<EstimatesPage />)

      // Both names must appear — the assertion would fail if the list didn't render
      await waitFor(() => {
        expect(screen.getByText('Alpha Project')).toBeDefined()
      })
      expect(screen.getByText('Beta Initiative')).toBeDefined()

      // Skeleton must be gone once loaded
      expect(screen.queryByTestId('skeleton-list-rows')).toBeNull()

      // updatedAt strings — formatted by the library's formatDate (INC-26):
      // the suite's numeric dd.mm.yyyy, the same in both languages.
      const dateCells = screen.getAllByText(/2026/)
      expect(dateCells.length).toBeGreaterThanOrEqual(2)
      expect(screen.getByText(new RegExp(formatDate(itemA.updatedAt).replace(/\./g, '\\.')))).toBeDefined()
      expect(formatDate(itemA.updatedAt)).toMatch(/^\d{2}\.\d{2}\.2026$/)

      // No error surface
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  // (C) Empty state
  describe('(C) empty — list() resolves with []', () => {
    it('renders the Mine + Open empty state with its way forward and no error surface (AC-2.3)', async () => {
      vi.mocked(estimatesApi.list).mockResolvedValue([])

      render(<EstimatesPage />)

      await waitFor(() => {
        expect(screen.getByText(strings.estimatesList.empty.mineOpen.heading)).toBeDefined()
      })

      expect(screen.queryByTestId('skeleton-list-rows')).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()

      // The panel carries New estimate / Load example; the header's is hidden there.
      const panel = screen.getByTestId('estimates-empty')
      expect(within(panel).getByRole('button', { name: /^New estimate$/i })).toBeDefined()
      expect(within(panel).getByRole('button', { name: /Load example/i })).toBeDefined()
      expect(screen.getAllByRole('button', { name: /^New estimate$/i })).toHaveLength(1)
    })
  })

  // (D) Error state
  describe('(D) error — list() rejects', () => {
    it('renders an error surface and does not crash', async () => {
      vi.mocked(estimatesApi.list).mockRejectedValue(new Error('Network failure'))

      render(<EstimatesPage />)

      // Wait for the error surface to appear
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeDefined()
      })

      // Error message must contain the human-readable copy
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain('Could not load your estimates.')

      // A retry button must be present
      const retryBtn = screen.getByRole('button', { name: /Retry/i })
      expect(retryBtn).toBeDefined()

      // No skeleton, no empty state
      expect(screen.queryByTestId('skeleton-list-rows')).toBeNull()
      expect(screen.queryByText(strings.estimatesList.empty.mineOpen.heading)).toBeNull()
    })
  })

  // (E) Chrome dedup (specs/20260709-suite-shell, T14, AC-4.2)
  describe('(E) chrome dedup — suite-level controls are shell-owned, not duplicated here', () => {
    it('does not render its own logo image or UserMenu, but keeps Import JSON / New estimate', async () => {
      vi.mocked(estimatesApi.list).mockResolvedValue([itemA, itemB])

      render(<EstimatesPage />)

      await waitFor(() => {
        expect(screen.getByText('Alpha Project')).toBeDefined()
      })

      // Suite-level controls (now shell-owned) must be GONE from this page.
      expect(screen.queryByAltText('EstimAI')).toBeNull()
      expect(screen.queryByRole('img')).toBeNull()
      // UserMenu renders its avatar as an aria-haspopup="menu" trigger — none
      // should be present since the page no longer mounts a UserMenu.
      expect(screen.queryByRole('button', { name: /account|sign out/i })).toBeNull()

      // Tool-scoped controls remain.
      expect(screen.getByRole('button', { name: /Import JSON/i })).toBeDefined()
      expect(screen.getByRole('button', { name: /^New estimate$/i })).toBeDefined()
    })
  })

  // (F) Shared row — distinguishable by testid, badge + identity, no Delete
  // (specs/20260807-estimate-sharing, T23, AC-2.1 / AC-2.2 / AC-10.4)
  describe('(F) shared row — testid-distinguishable, AccessLevelBadge + owner identity, no Delete', () => {
    it('renders owned and shared rows with distinct testids, an AccessLevelBadge and formatIdentity owner text on the shared row, and Delete only on the owned row', async () => {
      const sharedItem: EstimateListItem = {
        id: 'est-shared',
        name: 'Shared Project',
        author: '',
        updatedAt: '2026-07-05T09:00:00.000Z',
        access: 'editor',
        owner: { status: 'active', name: 'Marco Rossi' },
        closedAt: null,
        crmDealId: null,
      }
      vi.mocked(estimatesApi.list).mockResolvedValue([itemA, sharedItem])

      render(<EstimatesPage />)

      await waitFor(() => {
        expect(screen.getByText('Alpha Project')).toBeDefined()
      })
      expect(screen.getByText('Shared Project')).toBeDefined()

      // Distinguishable by testid (role/testid), never by CSS class alone —
      // a class-based assertion would still pass against an invisible change.
      const ownedRow = screen.getByTestId('estimate-row-owned')
      const sharedRow = screen.getByTestId('estimate-row-shared')

      // AccessLevelBadge — its presence IS the "shared" indicator (design.md S6) —
      // appears only on the shared row.
      const badge = within(sharedRow).getByTestId('access-level-badge')
      expect(badge.textContent).toContain(strings.sharing.dialog.levelEditor)
      expect(within(ownedRow).queryByTestId('access-level-badge')).toBeNull()

      // Owner identity via formatIdentity — not the free-text author field.
      expect(within(sharedRow).getByText(/Marco Rossi/)).toBeDefined()

      // Owner-only Delete "×" is present on the owned row, absent on the shared row.
      expect(within(ownedRow).getByRole('button', { name: /Delete/i })).toBeDefined()
      expect(within(sharedRow).queryByRole('button', { name: /Delete/i })).toBeNull()
    })
  })

  // (G) Orphaned / unresolved owner identity — never blank, never a raw id,
  // never an error (specs/20260807-estimate-sharing, T23, AC-10.4 / AC-10.5)
  describe('(G) orphaned / unresolved owner identity', () => {
    it('renders "Former wellD member" for a deleted owner and keeps Delete absent (orphaned row, AC-10.4)', async () => {
      const orphanedItem: EstimateListItem = {
        id: 'est-orphaned',
        name: 'Orphaned Project',
        author: '',
        updatedAt: '2026-07-06T09:00:00.000Z',
        access: 'viewer',
        owner: { status: 'deleted', name: null },
        closedAt: null,
        crmDealId: null,
      }
      vi.mocked(estimatesApi.list).mockResolvedValue([orphanedItem])

      render(<EstimatesPage />)

      await waitFor(() => {
        expect(screen.getByText('Orphaned Project')).toBeDefined()
      })

      const row = screen.getByTestId('estimate-row-shared')
      expect(within(row).getByText(strings.sharing.identity.deleted)).toBeDefined()

      // Never the raw id/cuid standing in for a name.
      expect(within(row).queryByText('est-orphaned')).toBeNull()

      // Orphaning changes nothing about this row's controls — Delete was
      // already absent because it isn't the viewer's own estimate.
      expect(within(row).queryByRole('button', { name: /Delete/i })).toBeNull()
    })

    it('renders the neutral placeholder for an unknown owner — never blank, never a raw id, never an error', async () => {
      const unknownOwnerItem: EstimateListItem = {
        id: 'est-unknown-owner',
        name: 'Unknown Owner Project',
        author: '',
        updatedAt: '2026-07-07T09:00:00.000Z',
        access: 'viewer',
        owner: { status: 'unknown', name: null },
        closedAt: null,
        crmDealId: null,
      }
      vi.mocked(estimatesApi.list).mockResolvedValue([unknownOwnerItem])

      render(<EstimatesPage />)

      await waitFor(() => {
        expect(screen.getByText('Unknown Owner Project')).toBeDefined()
      })

      const row = screen.getByTestId('estimate-row-shared')
      expect(within(row).getByText(strings.sharing.identity.unknown)).toBeDefined()
      expect(within(row).queryByText('est-unknown-owner')).toBeNull()
    })
  })

  // (H) Empty-state gating keys off the COMBINED owned+shared list length
  // (specs/20260807-estimate-sharing, T23, AC-2.3)
  describe('(H) empty-state gating — combined owned+shared length, not owned-only', () => {
    it('does NOT render the empty state when the user has only a shared estimate', async () => {
      const sharedOnlyItem: EstimateListItem = {
        id: 'est-shared-only',
        name: 'Shared Only Project',
        author: '',
        updatedAt: '2026-07-08T09:00:00.000Z',
        access: 'viewer',
        owner: { status: 'active', name: 'Giulia Bianchi' },
        closedAt: null,
        crmDealId: null,
      }
      vi.mocked(estimatesApi.list).mockResolvedValue([sharedOnlyItem])

      render(<EstimatesPage />)

      await waitFor(() => {
        expect(screen.getByText('Shared Only Project')).toBeDefined()
      })

      expect(screen.queryByText(strings.estimatesList.empty.mineOpen.heading)).toBeNull()
      expect(screen.queryByTestId('estimate-row-owned')).toBeNull()
      expect(screen.getByTestId('estimate-row-shared')).toBeDefined()
    })
  })

  // (I) Page-action failures are Banners, never window.alert() (INC-18)
  describe('(I) action failures — a Banner on the page, never window.alert()', () => {
    it('a failed "New estimate" shows a warning Banner whose Retry calls create again', async () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      vi.mocked(estimatesApi.list).mockResolvedValue([itemA])
      vi.mocked(estimatesApi.create).mockRejectedValue(new Error('offline'))

      render(<EstimatesPage />)
      await waitFor(() => expect(screen.getByText('Alpha Project')).toBeDefined())

      fireEvent.click(screen.getByRole('button', { name: /^New estimate$/i }))

      const banner = await screen.findByTestId('estimates-action-error')
      expect(banner.getAttribute('role')).toBe('alert')
      expect(banner.className).toContain('banner-warning')
      expect(banner.textContent).toContain(strings.estimatesList.createFailed)
      expect(alertSpy).not.toHaveBeenCalled()

      fireEvent.click(screen.getByTestId('estimates-action-retry'))
      await waitFor(() => expect(estimatesApi.create).toHaveBeenCalledTimes(2))
      alertSpy.mockRestore()
    })

    it('a failed "Load example" shows a warning Banner whose Retry loads the example again', async () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      vi.mocked(estimatesApi.list).mockResolvedValue([])
      vi.mocked(estimatesApi.create).mockRejectedValue(new Error('offline'))

      render(<EstimatesPage />)
      fireEvent.click(await screen.findByRole('button', { name: /Load example/i }))

      const banner = await screen.findByTestId('estimates-action-error')
      expect(banner.className).toContain('banner-warning')
      expect(banner.textContent).toContain(strings.estimatesList.exampleFailed)
      expect(alertSpy).not.toHaveBeenCalled()

      fireEvent.click(screen.getByTestId('estimates-action-retry'))
      await waitFor(() => expect(estimatesApi.create).toHaveBeenCalledTimes(2))
      // Same template both times — Retry repeats the action the person took.
      expect(vi.mocked(estimatesApi.create).mock.calls[1][0].name).toBe(
        vi.mocked(estimatesApi.create).mock.calls[0][0].name,
      )
      alertSpy.mockRestore()
    })

    it('an unreadable import file shows a danger Banner with the parse error and no Retry', async () => {
      const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
      vi.mocked(estimatesApi.list).mockResolvedValue([itemA])

      const { container } = render(<EstimatesPage />)
      await waitFor(() => expect(screen.getByText('Alpha Project')).toBeDefined())

      const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['not json'], 'broken.json', { type: 'application/json' })
      fireEvent.change(fileInput, { target: { files: [file] } })

      const banner = await screen.findByTestId('estimates-action-error')
      expect(banner.getAttribute('role')).toBe('alert')
      expect(banner.className).toContain('banner-danger')
      expect(banner.textContent).toContain('Invalid JSON file.')
      expect(screen.queryByTestId('estimates-action-retry')).toBeNull()
      expect(estimatesApi.create).not.toHaveBeenCalled()
      expect(alertSpy).not.toHaveBeenCalled()

      // Dismissible.
      fireEvent.click(within(banner).getByRole('button', { name: strings.estimatesList.dismiss }))
      expect(screen.queryByTestId('estimates-action-error')).toBeNull()
      alertSpy.mockRestore()
    })
  })

  // (J) A delete confirms where it happened (INC-19)
  describe('(J) delete success — a compact success Banner above the list', () => {
    it('shows "Estimate deleted." as role="status" after a confirmed delete, then dismisses itself', async () => {
      vi.mocked(estimatesApi.list).mockResolvedValueOnce([itemA, itemB]).mockResolvedValue([itemB])
      vi.mocked(estimatesApi.remove).mockResolvedValue(undefined)

      render(<EstimatesPage />)
      await waitFor(() => expect(screen.getByText('Alpha Project')).toBeDefined())
      expect(screen.queryByTestId('estimates-deleted-notice')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: /Delete "Alpha Project"/ }))
      vi.useFakeTimers({ shouldAdvanceTime: true })
      await act(async () => {
        fireEvent.click(screen.getByTestId('confirm-delete-confirm'))
      })

      const notice = await screen.findByTestId('estimates-deleted-notice')
      expect(notice.getAttribute('role')).toBe('status')
      expect(notice.textContent).toContain(strings.estimatesList.deleted)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(screen.queryByTestId('estimates-deleted-notice')).toBeNull()
      vi.useRealTimers()
    })
  })

  describe('closed estimates', () => {
    it('shows a "Closed" status badge only on a closed row', async () => {
      vi.mocked(estimatesApi.list).mockResolvedValue([
        { ...itemA, closedAt: '2026-11-05T10:00:00.000Z' },
        itemB,
      ])

      render(<EstimatesPage />)

      await waitFor(() => {
        expect(screen.getByText('Alpha Project')).toBeDefined()
      })
      const badges = screen.getAllByTestId('estimate-closed-badge')
      expect(badges).toHaveLength(1)
      expect(badges[0]!.textContent).toContain(strings.lifecycle.statusClosed)
      expect(badges[0]!.closest('[data-testid="estimate-row-owned"]')?.textContent).toContain('Alpha Project')
    })
  })

  // -------------------------------------------------------------------------
  // specs/20261108-estimate-list-oversight — filters, oversight rows, deal badge
  // -------------------------------------------------------------------------

  const stranger: EstimateListItem = {
    id: 'est-stranger',
    name: 'Stranger Project',
    author: 'Someone Else',
    updatedAt: '2026-07-09T09:00:00.000Z',
    access: 'oversight',
    owner: { status: 'active', name: 'Luca Verdi' },
    closedAt: null,
    crmDealId: null,
  }

  describe('(K) Whose / Status filters — AC-1.1, AC-1.2, AC-2.1', () => {
    it('lists Mine + Open by default, always sending an explicit Whose and Status', async () => {
      vi.mocked(estimatesApi.list).mockResolvedValue([itemA])
      render(<EstimatesPage />)
      await screen.findByText('Alpha Project')

      expect(estimatesApi.list).toHaveBeenCalledWith({ whose: 'mine', status: 'open' })
    })

    it('shows the Whose control (Mine selected, All offered) only with (estimate, read-all)', async () => {
      grant(['estimate', 'read-all'])
      vi.mocked(estimatesApi.list).mockResolvedValue([itemA])
      render(<EstimatesPage />)
      await screen.findByText('Alpha Project')

      const whose = screen.getByLabelText(strings.estimatesList.filters.whose) as HTMLSelectElement
      expect(whose.value).toBe('mine')
      expect([...whose.options].map((o) => o.value)).toEqual(['mine', 'all'])
      expect(screen.getByLabelText(strings.estimatesList.filters.status)).toBeDefined()
    })

    it('does not render the Whose control without the permission, only Status (absent, not disabled)', async () => {
      grant(['estimate', 'view'])
      vi.mocked(estimatesApi.list).mockResolvedValue([itemA])
      render(<EstimatesPage />)
      await screen.findByText('Alpha Project')

      expect(screen.queryByLabelText(strings.estimatesList.filters.whose)).toBeNull()
      const status = screen.getByLabelText(strings.estimatesList.filters.status) as HTMLSelectElement
      expect([...status.options].map((o) => o.value)).toEqual(['open', 'closed'])
    })

    it('combines both filters from the search params in the query (All + Closed) and retitles the page', async () => {
      grant(['estimate', 'read-all'])
      vi.mocked(useSearch).mockReturnValue({ whose: 'all', status: 'closed' } as never)
      vi.mocked(estimatesApi.list).mockResolvedValue([stranger])
      render(<EstimatesPage />)
      await screen.findByText('Stranger Project')

      expect(estimatesApi.list).toHaveBeenCalledWith({ whose: 'all', status: 'closed' })
      expect(screen.getByRole('heading', { level: 2, name: strings.estimatesList.headingAll })).toBeDefined()
    })

    it('writes a change to the search params (defaults omitted, replace) and to sessionStorage', async () => {
      grant(['estimate', 'read-all'])
      vi.mocked(estimatesApi.list).mockResolvedValue([itemA])
      render(<EstimatesPage />)
      await screen.findByText('Alpha Project')

      fireEvent.change(screen.getByLabelText(strings.estimatesList.filters.whose), { target: { value: 'all' } })
      expect(navigateMock).toHaveBeenLastCalledWith({ to: '/estimates', search: { whose: 'all' }, replace: true })
      expect(JSON.parse(sessionStorage.getItem(FILTERS_STORAGE_KEY) ?? 'null')).toEqual({ whose: 'all' })

      fireEvent.change(screen.getByLabelText(strings.estimatesList.filters.status), { target: { value: 'closed' } })
      expect(navigateMock).toHaveBeenLastCalledWith({ to: '/estimates', search: { status: 'closed' }, replace: true })

      // Back to the defaults: nothing in the URL, nothing to restore.
      fireEvent.change(screen.getByLabelText(strings.estimatesList.filters.status), { target: { value: 'open' } })
      expect(navigateMock).toHaveBeenLastCalledWith({ to: '/estimates', search: {}, replace: true })
      expect(JSON.parse(sessionStorage.getItem(FILTERS_STORAGE_KEY) ?? 'null')).toEqual({})
    })

    it('drops whose=all once permissions have resolved without the permission (AC-1.2), and never lists it', async () => {
      grant(['estimate', 'view'])
      vi.mocked(useSearch).mockReturnValue({ whose: 'all' } as never)
      vi.mocked(estimatesApi.list).mockResolvedValue([itemA])
      render(<EstimatesPage />)
      await screen.findByText('Alpha Project')

      expect(navigateMock).toHaveBeenCalledWith({ to: '/estimates', search: {}, replace: true })
      expect(estimatesApi.list).not.toHaveBeenCalledWith({ whose: 'all', status: 'open' })
    })

    it('waits for permissions before listing a whose=all it cannot yet judge', async () => {
      vi.mocked(useSearch).mockReturnValue({ whose: 'all' } as never)
      vi.mocked(estimatesApi.list).mockResolvedValue([])
      render(<EstimatesPage />)

      // Only the import offer's unfiltered account list runs; the page's own list is held back.
      await waitFor(() => expect(estimatesApi.list).toHaveBeenCalledWith())
      expect(estimatesApi.list).not.toHaveBeenCalledWith(expect.objectContaining({ whose: expect.anything() }))
      expect(navigateMock).not.toHaveBeenCalled()
      expect(screen.getByTestId('skeleton-list-rows')).toBeDefined()
    })

    it('shows the denied panel on 403 oversight_required, and "Show my estimates" returns to Mine (AC-1.6)', async () => {
      grant(['estimate', 'read-all'])
      vi.mocked(useSearch).mockReturnValue({ whose: 'all' } as never)
      vi.mocked(estimatesApi.list).mockImplementation(async (query) => {
        if (query?.whose === 'all') {
          throw new estimatesApi.ApiError({ type: 't', title: 'Forbidden', status: 403, code: 'oversight_required' })
        }
        return []
      })
      render(<EstimatesPage />)

      const panel = await screen.findByTestId('estimates-denied')
      expect(panel.getAttribute('role')).toBe('alert')
      expect(panel.textContent).toContain(strings.estimatesList.denied.title)
      // The filter row stays so the user can always change course.
      expect(screen.getByTestId('estimate-filters')).toBeDefined()

      fireEvent.click(within(panel).getByRole('button', { name: strings.estimatesList.denied.action }))
      expect(navigateMock).toHaveBeenCalledWith({ to: '/estimates', search: {}, replace: true })
    })

    it('shows the authorization-unavailable banner on 503 authz_unavailable, and Retry lists again (AC-1.7)', async () => {
      grant(['estimate', 'read-all'])
      vi.mocked(useSearch).mockReturnValue({ whose: 'all' } as never)
      vi.mocked(estimatesApi.list).mockImplementation(async (query) => {
        if (query?.whose === 'all') {
          throw new estimatesApi.ApiError({ type: 't', title: 'Unavailable', status: 503, code: 'authz_unavailable' })
        }
        return []
      })
      render(<EstimatesPage />)

      const banner = await screen.findByTestId('estimates-authz-unavailable')
      expect(banner.textContent).toContain(strings.estimatesList.authzUnavailableTitle)
      expect(banner.textContent).toContain(strings.estimatesList.authzUnavailableBody)

      const before = vi.mocked(estimatesApi.list).mock.calls.filter(([q]) => q?.whose === 'all').length
      fireEvent.click(within(banner).getByRole('button', { name: strings.estimatesList.retry }))
      await waitFor(() =>
        expect(vi.mocked(estimatesApi.list).mock.calls.filter(([q]) => q?.whose === 'all').length).toBe(before + 1),
      )
    })

    it('names the filters in the empty state, with no onboarding claim (Mine + Closed, All + Open)', async () => {
      grant(['estimate', 'read-all'])
      vi.mocked(useSearch).mockReturnValue({ status: 'closed' } as never)
      vi.mocked(estimatesApi.list).mockResolvedValue([])
      const { unmount } = render(<EstimatesPage />)
      await screen.findByText(strings.estimatesList.empty.mineClosed.heading)
      expect(screen.queryByRole('button', { name: /Load example/i })).toBeNull()
      // The header keeps its New estimate here: the panel has none.
      expect(screen.getByRole('button', { name: /^New estimate$/i })).toBeDefined()
      unmount()

      vi.mocked(useSearch).mockReturnValue({ whose: 'all' } as never)
      render(<EstimatesPage />)
      await screen.findByText(strings.estimatesList.empty.allOpen.body)
    })

    it('announces the scope and count of a loaded list', async () => {
      grant(['estimate', 'read-all'])
      vi.mocked(useSearch).mockReturnValue({ whose: 'all', status: 'closed' } as never)
      vi.mocked(estimatesApi.list).mockResolvedValue([stranger])
      render(<EstimatesPage />)
      await screen.findByText('Stranger Project')

      expect(screen.getByText(strings.estimatesList.loadedContext('all', 'closed', 1))).toBeDefined()
    })

    it('feeds the import offer the UNFILTERED account list, so a closed estimate is never re-offered', async () => {
      vi.mocked(useSearch).mockReturnValue({ status: 'open' } as never)
      vi.mocked(estimatesApi.list).mockResolvedValue([])
      render(<EstimatesPage />)
      await waitFor(() => expect(estimatesApi.list).toHaveBeenCalledWith())

      // The call the import offer relies on carries neither Whose nor Status.
      const unfiltered = vi.mocked(estimatesApi.list).mock.calls.filter(([q]) => q === undefined)
      expect(unfiltered.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('(L) oversight and deal rows — AC-1.3, AC-3.1, AC-3.2', () => {
    it('renders an oversight row with the Oversight badge, the owner identity and no Delete', async () => {
      grant(['estimate', 'read-all'])
      vi.mocked(useSearch).mockReturnValue({ whose: 'all' } as never)
      vi.mocked(estimatesApi.list).mockResolvedValue([itemA, stranger])
      render(<EstimatesPage />)
      await screen.findByText('Stranger Project')

      const row = screen.getByTestId('estimate-row-oversight')
      expect(within(row).getByTestId('access-level-badge').textContent).toBe(strings.sharing.dialog.levelOversight)
      expect(within(row).getByText(/Luca Verdi/)).toBeDefined()
      expect(within(row).queryByRole('button', { name: /Delete/i })).toBeNull()
      expect(within(row).getByRole('button', { name: strings.estimatesList.open })).toBeDefined()
    })

    it('shows "You" instead of the author on the caller’s own rows in All, and the author in Mine', async () => {
      grant(['estimate', 'read-all'])
      vi.mocked(useSearch).mockReturnValue({ whose: 'all' } as never)
      vi.mocked(estimatesApi.list).mockResolvedValue([itemA])
      const { unmount } = render(<EstimatesPage />)
      await screen.findByText('Alpha Project')
      const own = screen.getByTestId('estimate-row-owned')
      expect(own.textContent).toContain(`${strings.estimatesList.you}${strings.estimatesList.metaSeparator}`)
      expect(own.textContent).not.toContain('Consultant A')
      unmount()

      vi.mocked(useSearch).mockReturnValue({} as never)
      render(<EstimatesPage />)
      await screen.findByText('Alpha Project')
      expect(screen.getByTestId('estimate-row-owned').textContent).toContain('Consultant A')
    })

    it('shows the Deal badge on a linked row — in any combination — and none on an unlinked one', async () => {
      vi.mocked(useSearch).mockReturnValue({ status: 'closed' } as never)
      vi.mocked(estimatesApi.list).mockResolvedValue([
        { ...itemA, crmDealId: 'deal-1', closedAt: '2026-11-05T10:00:00.000Z' },
        itemB,
      ])
      render(<EstimatesPage />)
      await screen.findByText('Alpha Project')

      const rows = screen.getAllByTestId('estimate-row-owned')
      expect(within(rows[0]!).getAllByTestId('deal-badge')).toHaveLength(1)
      expect(within(rows[0]!).getByTestId('estimate-closed-badge')).toBeDefined()
      expect(within(rows[1]!).queryByTestId('deal-badge')).toBeNull()
    })

    it('makes the Deal badge a link to the deal only with (crm, access); a plain badge otherwise', async () => {
      vi.mocked(estimatesApi.list).mockResolvedValue([{ ...itemA, crmDealId: 'deal-1' }])
      const { unmount } = render(<EstimatesPage />)
      await screen.findByText('Alpha Project')
      expect(screen.queryByTestId('deal-badge-link')).toBeNull()
      expect(screen.getByTestId('deal-badge')).toBeDefined()
      unmount()

      grant(['crm', 'access'])
      render(<EstimatesPage />)
      await screen.findByText('Alpha Project')
      const link = screen.getByTestId('deal-badge-link')
      expect(link.getAttribute('href')).toBe('/crm/deals/deal-1')
      fireEvent.click(link)
      expect(navigateSuite).toHaveBeenCalledWith('/crm/deals/deal-1')
    })
  })
})
