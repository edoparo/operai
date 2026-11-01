/**
 * @vitest-environment jsdom
 *
 * Accessibility pass for inventory-ui (T40, specs/015-hardware-inventory;
 * design.md § Accessibility; refs AC-4.1, AC-9.6). Two independent checks.
 *
 * 1. STRUCTURE. Every page and dialog is rendered with representative data in its
 *    main states and run through axe-core. jsdom has no layout engine and cannot
 *    compute rendered colours, so axe's `color-contrast` rule is DISABLED here —
 *    every other axe rule (WCAG A/AA and best practice) stays on. Contrast is
 *    covered by check 2, which does the arithmetic from the real tokens instead.
 *    Pages that sit in the tool layout are rendered inside the real
 *    `InventoryShell` (h1, nav landmark), itself inside a `<main>` as the host shell
 *    provides one around every remote (ADR-0006); `MyDevicesPage` and the dialogs
 *    get a bare `<main>` for the same reason.
 *
 * 2. CONTRAST. The six `AssetStatusBadge` variants and the "To verify" chip (on both
 *    pages that show it) must reach 4.5:1 for their label on their background, in the
 *    light and the dark theme, and the focus ring 3:1. Since INC-23 every badge is the
 *    library's `StatusBadge`: what it paints is read from the RENDERED element (its
 *    `.badge-<tone>` class) and resolved through the real `.badge*` rules and colour
 *    values in @operai/ui's `tokens.css` (read-only here), then the WCAG 2.x
 *    relative-luminance ratio is computed. Status is carried by label + icon + colour,
 *    never colour alone (asserted too).
 */

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import axe from 'axe-core'
import type { Permission } from 'shell/session'
import { ApiError } from './lib/api'
import type { AssetListItem, AssetStatus, AssetView, FiscalYearView, Ledger, Rule } from './lib/types'

const m = vi.hoisted(() => ({
  usePermissions: vi.fn(),
  getScope: vi.fn(),
  listAssets: vi.fn(),
  registerAssets: vi.fn(),
  getAsset: vi.fn(),
  updateAsset: vi.fn(),
  receiveAsset: vi.fn(),
  returnAsset: vi.fn(),
  startRepair: vi.fn(),
  finishRepair: vi.fn(),
  markLost: vi.fn(),
  markFound: vi.fn(),
  createAssignment: vi.fn(),
  cancelAssignment: vi.fn(),
  listDirectory: vi.fn(),
  getAssetHistory: vi.fn(),
  listRules: vi.fn(),
  createRule: vi.fn(),
  getFiscalYear: vi.fn(),
  listFiscalYears: vi.fn(),
  closeFiscalYear: vi.fn(),
  getMyDevices: vi.fn(),
  confirmAssignment: vi.fn(),
  declineAssignment: vi.fn(),
  disposeAsset: vi.fn(),
}))
vi.mock('shell/session', () => ({ usePermissions: m.usePermissions }))
vi.mock('./lib/scopeApi', () => ({ getScope: m.getScope }))
vi.mock('./lib/assetsApi', () => ({
  listAssets: m.listAssets,
  registerAssets: m.registerAssets,
  getAsset: m.getAsset,
  updateAsset: m.updateAsset,
  receiveAsset: m.receiveAsset,
  returnAsset: m.returnAsset,
  startRepair: m.startRepair,
  finishRepair: m.finishRepair,
  markLost: m.markLost,
  markFound: m.markFound,
}))
vi.mock('./lib/assignmentsApi', () => ({
  createAssignment: m.createAssignment,
  cancelAssignment: m.cancelAssignment,
}))
vi.mock('./lib/directoryApi', () => ({ listDirectory: m.listDirectory }))
vi.mock('./lib/historyApi', () => ({ getAssetHistory: m.getAssetHistory }))
vi.mock('./lib/rulesApi', () => ({ listRules: m.listRules, createRule: m.createRule }))
vi.mock('./lib/fiscalYearsApi', () => ({
  getFiscalYear: m.getFiscalYear,
  listFiscalYears: m.listFiscalYears,
  closeFiscalYear: m.closeFiscalYear,
}))
vi.mock('./lib/meApi', () => ({
  getMyDevices: m.getMyDevices,
  confirmAssignment: m.confirmAssignment,
  declineAssignment: m.declineAssignment,
}))
vi.mock('./lib/ledgerApi', () => ({ disposeAsset: m.disposeAsset }))

import AssetActions from './components/AssetActions'
import AssignDialog from './components/AssignDialog'
import AssetStatusBadge from './components/AssetStatusBadge'
import CloseYearDialog from './components/CloseYearDialog'
import DisposeDialog from './components/DisposeDialog'
import EditAssetDialog from './components/EditAssetDialog'
import InventoryShell from './components/InventoryShell'
import NewRuleDialog from './components/NewRuleDialog'
import AssetDetailPage from './pages/AssetDetailPage'
import AssetsPage from './pages/AssetsPage'
import FiscalYearDetailPage from './pages/FiscalYearDetailPage'
import FiscalYearsPage from './pages/FiscalYearsPage'
import MyDevicesPage from './pages/MyDevicesPage'
import RegisterAssetPage from './pages/RegisterAssetPage'
import RulesPage from './pages/RulesPage'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ASSETS: Permission = { resource: 'asset', action: 'manage' }
const LEDGER: Permission = { resource: 'ledger', action: 'manage' }

const ANNA = { id: 'u1', name: 'Anna Rossi', status: 'active' as const }

const LEDGER_VIEW: Ledger = {
  bookValueCents: 33272,
  rule: {
    id: 'r1',
    effectiveFrom: '2026-01-01',
    usefulLifeYears: 3,
    firstYearShare: 'full',
    lowValueThresholdCents: null,
    residualCents: 100,
  },
  schedule: [
    { year: 2026, depreciationCents: 33272, closingCents: 66543, closed: true },
    { year: 2027, depreciationCents: 33271, closingCents: 33272, closed: false },
    { year: 2028, depreciationCents: 33172, closingCents: 100, closed: false },
  ],
}

const asset = (over: Partial<AssetView> = {}): AssetView => ({
  id: 'a1',
  entity: 'welld_ch',
  currency: 'CHF',
  category: 'laptop',
  description: 'MacBook Pro 14',
  serialNumber: 'SN123',
  purchaseDate: '2026-09-25',
  purchasePriceCents: 99815,
  status: 'in_stock',
  holder: null,
  pendingAssignment: null,
  locationNote: 'Zurich office, shelf 3',
  supplier: 'Digitec',
  invoiceRef: 'INV-77',
  invoiceFile: null,
  toVerify: false,
  disposal: null,
  ...over,
})

const listItem = (over: Partial<AssetView> = {}): AssetListItem => ({ ...asset(over), ledger: undefined })

const RULE: Rule = {
  id: 'rule1',
  entity: 'welld_ch',
  effectiveFrom: '2021-01-01',
  usefulLifeYears: 4,
  firstYearShare: 'half',
  lowValueThresholdCents: 80000,
  residualCents: 150,
  createdBy: ANNA,
  createdAt: '2020-12-15T08:30:00Z',
}

const ROLL = {
  openingCents: 2168900,
  disposalsCents: 53000,
  purchasesCents: 1829589,
  depreciationCents: 2245831,
  closingCents: 1699658,
}

const yearView = (over: Partial<FiscalYearView> = {}): FiscalYearView => ({
  entity: 'welld_ch',
  year: 2026,
  currency: 'CHF',
  status: 'open',
  closedAt: null,
  rollForward: ROLL,
  assets: [
    {
      assetId: 'a1',
      purchaseDate: '2026-03-02',
      description: 'MacBook Pro 14',
      serialNumber: 'SN123',
      holder: ANNA,
      purchasePriceCents: 332390,
      openingCents: 0,
      purchaseCents: 332390,
      depreciationCents: 110796,
      disposalCents: 0,
      closingCents: 221594,
    },
    {
      assetId: 'a2',
      purchaseDate: '2024-05-10',
      description: 'Dell monitor',
      serialNumber: null,
      holder: null,
      purchasePriceCents: 45000,
      openingCents: 20000,
      purchaseCents: 0,
      depreciationCents: 15000,
      disposalCents: 5000,
      closingCents: 0,
    },
  ],
  ...over,
})

const asUser = (permissions: Permission[], scope = { asset: ['welld_ch'], ledger: ['welld_ch'] }) => {
  m.usePermissions.mockReturnValue({ epoch: 0, apps: ['inventory'], roles: [], departments: [], permissions })
  m.getScope.mockResolvedValue(scope)
}

beforeEach(() => {
  asUser([ASSETS, LEDGER])
  m.listAssets.mockResolvedValue({
    items: [
      listItem({ status: 'assigned', holder: ANNA, toVerify: true }),
      listItem({ id: 'a2', description: 'Dell U2723QE', status: 'ordered', serialNumber: null, invoiceRef: null }),
      listItem({ id: 'a3', description: 'iPhone 15', status: 'in_repair' }),
    ],
    nextCursor: 'next',
  })
  m.listDirectory.mockResolvedValue({
    users: [
      { id: 'u1', name: 'Anna Rossi', email: 'anna@welld.ch', entity: 'welld_ch' },
      { id: 'u2', name: 'Marco Bianchi', email: 'marco@welld.it', entity: 'welld_it' },
    ],
  })
  m.getAsset.mockResolvedValue(asset())
  m.getAssetHistory.mockResolvedValue({
    events: [
      { id: 'e1', action: 'registered', actor: ANNA, at: '2026-09-25T08:00:00Z', changes: [] },
      {
        id: 'e2',
        action: 'edited',
        actor: ANNA,
        at: '2026-09-26T09:30:00Z',
        changes: [{ field: 'locationNote', from: null, to: 'Zurich office, shelf 3' }],
      },
    ],
  })
  m.listRules.mockResolvedValue({ rules: [RULE], inForceId: 'rule1' })
  m.listFiscalYears.mockResolvedValue({
    years: [
      { year: 2025, status: 'closed', closedAt: '2026-01-20T09:00:00Z', closable: false },
      { year: 2026, status: 'open', closedAt: null, closable: true },
    ],
  })
  m.getFiscalYear.mockResolvedValue(yearView())
  m.getMyDevices.mockResolvedValue({
    devices: [
      {
        assetId: 'h1',
        description: 'Dell U2723QE',
        category: 'monitor',
        serialNumber: 'SN456',
        assignedAt: '2026-03-12T08:00:00Z',
      },
    ],
    pending: [
      {
        assetId: 'p1',
        assignmentId: 'as1',
        description: 'MacBook Pro 14',
        category: 'laptop',
        serialNumber: 'SN123',
        assignedAt: '2026-10-06T09:00:00Z',
      },
    ],
  })
  // jsdom does not implement scrolling; the router's scroll restoration calls it on every navigation.
  window.scrollTo = () => undefined
})

afterEach(() => {
  cleanup()
  window.history.pushState(null, '', '/')
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** axe `run` options: every rule on except `color-contrast` (jsdom cannot compute colours; see the file header). */
const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } }

type Violation = { rule: string; impact: string | null | undefined; help: string; targets: string[] }

const checkAxe = async (root: Element = document.body): Promise<Violation[]> => {
  const results = await axe.run(root, AXE_OPTIONS)
  return results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    help: violation.help,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }))
}

/** The page mounted inside the real tool layout (inside the host shell's `<main>`), at the route it lives on. */
const renderInShell = (path: string, routePath: string, page: () => React.ReactNode) => {
  const history = createMemoryHistory({ initialEntries: [path] })
  const rootRoute = createRootRoute({
    component: () => (
      <main>
        <InventoryShell />
      </main>
    ),
  })
  const stub = (p: string) => createRoute({ getParentRoute: () => rootRoute, path: p, component: () => <p>stub</p> })
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: routePath, component: page }),
    ...['/assets', '/assets/new', '/assets/$id', '/rules', '/years', '/years/$entity/$year']
      .filter((p) => p !== routePath)
      .map(stub),
  ])
  render(<RouterProvider router={createRouter({ routeTree, history })} />)
  return screen.findByRole('heading', { level: 1, name: 'Inventory' })
}

/** A component that needs the router context (links) but not the tool layout, inside a `<main>`. */
const renderInMain = (node: () => React.ReactNode) => {
  const history = createMemoryHistory({ initialEntries: ['/x'] })
  const rootRoute = createRootRoute({
    component: () => <main>{node()}</main>,
  })
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/x', component: () => null }),
    createRoute({ getParentRoute: () => rootRoute, path: '/assets/$id', component: () => null }),
  ])
  render(<RouterProvider router={createRouter({ routeTree, history })} />)
}

const noop = () => undefined

// ---------------------------------------------------------------------------
// 1. Structure: axe over every page and dialog
// ---------------------------------------------------------------------------

describe('axe — the harness itself', () => {
  it('reports a real violation (an unlabelled image) and ignores a clean tree, so a green run means something', async () => {
    const { container, rerender } = render(<img src="x.png" />)
    expect((await checkAxe(container)).map((v) => v.rule)).toContain('image-alt')
    rerender(<img src="x.png" alt="A laptop" />)
    expect(await checkAxe(container)).toEqual([])
  })
})

describe('axe — AssetsPage', () => {
  it('list with rows, the To verify chip, all badge variants shown and Load more', async () => {
    await renderInShell('/assets', '/assets', AssetsPage)
    await screen.findByRole('link', { name: 'MacBook Pro 14' })
    expect(await checkAxe()).toEqual([])
  })

  it('empty', async () => {
    m.listAssets.mockResolvedValue({ items: [], nextCursor: null })
    await renderInShell('/assets', '/assets', AssetsPage)
    await screen.findByTestId('assets-empty')
    expect(await checkAxe()).toEqual([])
  })

  it('error', async () => {
    m.listAssets.mockRejectedValue(new ApiError({ status: 500, title: 'Boom', detail: 'The server is down.' }))
    await renderInShell('/assets', '/assets', AssetsPage)
    await screen.findByTestId('error-banner')
    expect(await checkAxe()).toEqual([])
  })
})

describe('axe — RegisterAssetPage', () => {
  it('clean form', async () => {
    await renderInShell('/assets/new', '/assets/new', RegisterAssetPage)
    await screen.findByLabelText(/^Description/)
    expect(await checkAxe()).toEqual([])
  })

  it('with the validation summary and per-field errors', async () => {
    await renderInShell('/assets/new', '/assets/new', RegisterAssetPage)
    await screen.findByLabelText(/^Description/)
    fireEvent.click(screen.getByRole('button', { name: /^Register/ }))
    await screen.findByTestId('register-summary')
    expect(await checkAxe()).toEqual([])
  })
})

describe('axe — AssetDetailPage (real regions)', () => {
  const renderDetail = async (permissions: Permission[], over: Partial<AssetView> = {}) => {
    asUser(permissions)
    m.getAsset.mockResolvedValue(asset(over))
    await renderInShell('/assets/a1', '/assets/$id', AssetDetailPage)
    await screen.findByRole('heading', { level: 2, name: 'MacBook Pro 14' })
    await screen.findByTestId('history-timeline')
    await waitFor(() => expect(screen.queryByText('Loading history')).toBeNull())
  }

  it('manager only: actions, invoice and history, no ledger block', async () => {
    await renderDetail([ASSETS], { status: 'assigned', holder: ANNA })
    expect(await checkAxe()).toEqual([])
  })

  it('accountant only: ledger block and history, no action buttons', async () => {
    await renderDetail([LEDGER], { status: 'assigned', holder: ANNA, ledger: LEDGER_VIEW })
    expect(await checkAxe()).toEqual([])
  })

  it('both capabilities, with a pending assignment callout', async () => {
    await renderDetail([ASSETS, LEDGER], {
      pendingAssignment: { id: 'p1', assignee: ANNA, createdAt: '2026-10-04T08:00:00Z' },
      ledger: LEDGER_VIEW,
    })
    expect(await checkAxe()).toEqual([])
  })

  it('both capabilities, to-verify asset with the holder-deleted callout', async () => {
    await renderDetail([ASSETS, LEDGER], {
      status: 'assigned',
      toVerify: true,
      holder: { id: 'u1', name: 'Anna Rossi', status: 'deleted' },
      ledger: LEDGER_VIEW,
    })
    expect(await checkAxe()).toEqual([])
  })
})

describe('axe — RulesPage', () => {
  it('rules table with the in-force rule', async () => {
    asUser([LEDGER])
    await renderInShell('/rules', '/rules', RulesPage)
    await screen.findByRole('table', { name: /Depreciation rules/ })
    expect(await checkAxe()).toEqual([])
  })
})

describe('axe — FiscalYearsPage', () => {
  it('years table', async () => {
    asUser([LEDGER])
    await renderInShell('/years', '/years', FiscalYearsPage)
    await screen.findByTestId('fiscal-years-table-welld_ch')
    expect(await checkAxe()).toEqual([])
  })
})

describe('axe — FiscalYearDetailPage', () => {
  it('open year', async () => {
    asUser([LEDGER])
    await renderInShell('/years/welld_ch/2026', '/years/$entity/$year', FiscalYearDetailPage)
    await screen.findByRole('heading', { level: 2, name: /Fiscal year/ })
    await screen.findByText('Dell monitor')
    expect(await checkAxe()).toEqual([])
  })

  it('closed year', async () => {
    asUser([LEDGER])
    m.getFiscalYear.mockResolvedValue(yearView({ status: 'closed', closedAt: '2026-12-31T10:00:00Z' }))
    m.listFiscalYears.mockResolvedValue({
      years: [{ year: 2026, status: 'closed', closedAt: '2026-12-31T10:00:00Z', closable: false }],
    })
    await renderInShell('/years/welld_ch/2026', '/years/$entity/$year', FiscalYearDetailPage)
    await screen.findByRole('heading', { level: 2, name: /Fiscal year/ })
    await screen.findByText('Dell monitor')
    expect(await checkAxe()).toEqual([])
  })
})

describe('axe — MyDevicesPage (the ungated /devices screen)', () => {
  it('pending and held', async () => {
    render(
      <main>
        <MyDevicesPage />
      </main>,
    )
    await screen.findByRole('heading', { level: 2, name: 'Devices I hold (1)' })
    expect(await checkAxe()).toEqual([])
  })

  it('empty', async () => {
    m.getMyDevices.mockResolvedValue({ devices: [], pending: [] })
    render(
      <main>
        <MyDevicesPage />
      </main>,
    )
    await screen.findByTestId('devices-empty')
    expect(await checkAxe()).toEqual([])
  })

  it('error', async () => {
    m.getMyDevices.mockRejectedValue(new ApiError({ status: 500, title: 'Boom', detail: 'The server is down.' }))
    render(
      <main>
        <MyDevicesPage />
      </main>,
    )
    await screen.findByTestId('error-banner')
    expect(await checkAxe()).toEqual([])
  })

  it('decline confirm dialog', async () => {
    render(
      <main>
        <MyDevicesPage />
      </main>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /^Decline/ }))
    await screen.findByRole('alertdialog')
    expect(await checkAxe()).toEqual([])
  })
})

describe('axe — InventoryShell', () => {
  it('manager and accountant: every tab', async () => {
    await renderInShell('/assets', '/assets', () => <p>page</p>)
    expect(await checkAxe()).toEqual([])
  })

  it('accountant only', async () => {
    asUser([LEDGER])
    await renderInShell('/years', '/years', () => <p>page</p>)
    expect(await checkAxe()).toEqual([])
  })

  it('scope empty', async () => {
    asUser([ASSETS], { asset: [], ledger: [] })
    await renderInShell('/assets', '/assets', () => <p>page</p>)
    await screen.findByTestId('inventory-scope-empty')
    expect(await checkAxe()).toEqual([])
  })

  it('permission denied (deep link without the capability)', async () => {
    asUser([ASSETS])
    await renderInShell('/rules', '/rules', () => <p>page</p>)
    await screen.findByTestId('permission-denied')
    expect(await checkAxe()).toEqual([])
  })

  it('scope error', async () => {
    m.getScope.mockRejectedValue(new ApiError({ status: 503, title: 'Down' }))
    await renderInShell('/assets', '/assets', () => <p>page</p>)
    await screen.findByTestId('error-banner')
    expect(await checkAxe()).toEqual([])
  })
})

describe('axe — dialogs', () => {
  it('EditAssetDialog', async () => {
    renderInMain(() => (
      <EditAssetDialog
        asset={asset()}
        capabilities={{ canManageAssets: true, canManageLedger: true }}
        onSaved={noop}
        onCancel={noop}
        onConflict={noop}
      />
    ))
    await screen.findByRole('dialog')
    expect(await checkAxe()).toEqual([])
  })

  it('AssignDialog with the picker open', async () => {
    render(
      <main>
        <AssignDialog asset={asset()} onAssigned={noop} onCancel={noop} onConflict={noop} />
      </main>,
    )
    await screen.findByRole('dialog')
    const picker = screen.getByRole('combobox', { name: 'Holder' })
    fireEvent.focus(picker)
    await screen.findByRole('option', { name: /Anna Rossi/ })
    expect(await checkAxe()).toEqual([])
  })

  it('DisposeDialog', async () => {
    render(
      <main>
        <DisposeDialog
          asset={asset({ status: 'in_stock', ledger: LEDGER_VIEW })}
          onDisposed={noop}
          onCancel={noop}
          onConflict={noop}
        />
      </main>,
    )
    await screen.findByRole('alertdialog')
    expect(await checkAxe()).toEqual([])
  })

  it('NewRuleDialog', async () => {
    render(
      <main>
        <NewRuleDialog entity="welld_ch" inForceRule={RULE} onSaved={noop} onCancel={noop} />
      </main>,
    )
    await screen.findByRole('alertdialog')
    expect(await checkAxe()).toEqual([])
  })

  it('CloseYearDialog', async () => {
    render(
      <main>
        <CloseYearDialog
          entity="welld_ch"
          year={2026}
          currency="CHF"
          rollForward={ROLL}
          onClosed={noop}
          onStale={noop}
          onCancel={noop}
        />
      </main>,
    )
    await screen.findByRole('alertdialog')
    expect(await checkAxe()).toEqual([])
  })

  describe('confirm dialogs opened from AssetActions', () => {
    const open = async (over: Partial<AssetView>, button: string) => {
      render(
        <main>
          <AssetActions
            asset={asset(over)}
            capabilities={{ canManageAssets: true, canManageLedger: false }}
            onChanged={noop}
            announce={noop}
            focusHeading={noop}
          />
        </main>,
      )
      fireEvent.click(screen.getByRole('button', { name: button }))
      await screen.findByRole('alertdialog')
    }

    it('record return', async () => {
      await open({ status: 'assigned', holder: ANNA }, 'Record return')
      expect(await checkAxe()).toEqual([])
    })

    it('mark lost', async () => {
      await open({ status: 'in_stock' }, 'Mark lost')
      expect(await checkAxe()).toEqual([])
    })

    it('cancel assignment', async () => {
      await open(
        { status: 'in_stock', pendingAssignment: { id: 'p1', assignee: ANNA, createdAt: '2026-10-04T08:00:00Z' } },
        'Cancel assignment',
      )
      expect(await checkAxe()).toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------
// 2. Contrast, computed from the real tokens
// ---------------------------------------------------------------------------

type Theme = 'dark' | 'light'
type Rgb = [number, number, number]

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')
// The suite's tokens live in @operai/ui since ADR-0050 (shell/src/styles/tokens.css only @imports them).
const TOKENS_CSS = read('../../operai-ui/src/styles/tokens.css')
const INDEX_CSS = read('./index.css')

/** The declarations of the first rule whose selector line matches `selector`. */
const declarationsOf = (css: string, selector: RegExp): Record<string, string> => {
  const open = css.search(selector)
  if (open < 0) throw new Error(`selector ${selector} not found`)
  const start = css.indexOf('{', open)
  const end = css.indexOf('}', start)
  const out: Record<string, string> = {}
  for (const match of css.slice(start + 1, end).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[match[1]] = match[2].trim()
  return out
}

// Dark is the base `:root` palette; light is the explicit `[data-theme="light"]` override.
const PALETTE: Record<Theme, Record<string, string>> = {
  dark: declarationsOf(TOKENS_CSS, /^:root\s*\{/m),
  light: declarationsOf(TOKENS_CSS, /^\[data-theme=["']light["']\]\s*\{/m),
}

const resolveToken = (theme: Theme, value: string, depth = 0): string => {
  const reference = /^var\((--[\w-]+)\)$/.exec(value)
  if (reference === null) return value
  const next = PALETTE[theme][reference[1]]
  if (next === undefined || depth > 5) throw new Error(`cannot resolve ${value} in the ${theme} theme`)
  return resolveToken(theme, next, depth + 1)
}

const toRgb = (hex: string): Rgb => {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`not a #rrggbb colour: ${hex}`)
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
}

const token = (theme: Theme, name: string): Rgb => toRgb(resolveToken(theme, `var(${name})`))

const channel = (value: number) => {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** `color-mix(in srgb, fg <alpha>%, transparent)` (a `bg-x/<alpha>` utility) painted over an opaque `bg`. */
const over = (fg: Rgb, bg: Rgb, alpha: number): Rgb => fg.map((value, i) => value * alpha + bg[i] * (1 - alpha)) as Rgb

/** The tint the library badge paints behind its label: `color-mix(in srgb, var(--badge-tone) 10%, transparent)`. */
const TINT = 0.1
const LABEL_MIN = 4.5
const RING_MIN = 3

const STATUSES: readonly AssetStatus[] = ['ordered', 'in_stock', 'assigned', 'in_repair', 'lost', 'disposed']
const THEMES: readonly Theme[] = ['dark', 'light']

/** Page backgrounds a badge/chip sits on: list rows and the detail heading are `--ink`, a panel is `--ink-soft`. */
const SURFACES = ['--ink', '--ink-soft'] as const
type Surface = (typeof SURFACES)[number]

/** What one rendered badge or chip paints, as theme-token names: its label colour and its tint (none for `muted`). */
type Painted = { tone: string; label: string; tinted: boolean }

/** `var(--acc-text)` → `--acc-text`. */
const tokenName = (value: string | undefined, what: string): string => {
  const match = /^var\((--[\w-]+)\)$/.exec(value ?? '')
  if (match === null) throw new Error(`${what}: expected var(--token), got "${value}"`)
  return match[1]
}

/** The library's `.badge` rule: the neutral tone and label, which a `.badge-<tone>` rule overrides. */
const BADGE_BASE = declarationsOf(TOKENS_CSS, /^\s*\.badge\s*\{/m)

/**
 * What a rendered badge paints, read off the real DOM and the real tokens.css (INC-23: the
 * library `Badge` paints through its `.badge` / `.badge-<tone>` classes, which set
 * `--badge-tone` (the tint) and `--badge-text` (the label)). Also asserts the non-colour
 * signal: an aria-hidden icon beside the label.
 */
const paintedBy = (element: HTMLElement): Painted => {
  expect(element.classList.contains('badge')).toBe(true)
  expect(element.getAttribute('style')).toBeNull()
  const toneClass = Array.from(element.classList).find((name) => /^badge-[a-z]+$/.test(name))
  const own = toneClass ? declarationsOf(TOKENS_CSS, new RegExp(`^\\s*\\.${toneClass}\\s*\\{`, 'm')) : {}
  if (element.querySelector('[aria-hidden="true"] svg') === null) throw new Error('no icon')
  return {
    tone: tokenName(own['--badge-tone'] ?? BADGE_BASE['--badge-tone'], 'tone'),
    label: tokenName(own['--badge-text'] ?? BADGE_BASE['--badge-text'], 'label'),
    tinted: toneClass !== 'badge-muted',
  }
}

const paintedBadge = (status: AssetStatus): Painted => {
  const { unmount } = render(<AssetStatusBadge status={status} />)
  const painted = paintedBy(screen.getByTestId('asset-status-badge'))
  unmount()
  return painted
}

type ChipPage = 'AssetsPage' | 'AssetDetailPage'
const paintedChip = async (page: ChipPage): Promise<Painted> => {
  if (page === 'AssetsPage') {
    await renderInShell('/assets', '/assets', AssetsPage)
    const chips = await screen.findAllByTestId('to-verify-chip')
    const painted = paintedBy(chips[0])
    cleanup()
    return painted
  }
  asUser([ASSETS])
  m.getAsset.mockResolvedValue(asset({ status: 'assigned', toVerify: true, holder: ANNA }))
  await renderInShell('/assets/a1', '/assets/$id', AssetDetailPage)
  const painted = paintedBy(await screen.findByTestId('to-verify-chip'))
  cleanup()
  return painted
}

/** The background under the label: the 10% tint over the surface, or the bare surface for `muted`. */
const backgroundOn = (theme: Theme, painted: Painted, surface: Surface) =>
  painted.tinted ? over(token(theme, painted.tone), token(theme, surface), TINT) : token(theme, surface)
const labelRatio = (theme: Theme, painted: Painted, surface: Surface) =>
  contrast(token(theme, painted.label), backgroundOn(theme, painted, surface))

const round = (value: number) => Number(value.toFixed(2))

describe('contrast — label on its badge background (WCAG 1.4.3, >= 4.5:1), every badge variant and the To verify chip', () => {
  it('the library badge still paints a 10% tint of its tone (the TINT this test assumes)', () => {
    expect(TOKENS_CSS).toMatch(
      /\.badge\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--badge-tone\) 10%, transparent\)/,
    )
    expect(TOKENS_CSS).toMatch(/\.badge-muted\s*\{[^}]*background:\s*transparent/)
  })

  it('measured ratios (printed for the report)', async () => {
    const subjects: [string, Painted][] = [
      ...STATUSES.map((status): [string, Painted] => [status, paintedBadge(status)]),
      ['to-verify chip (AssetsPage)', await paintedChip('AssetsPage')],
      ['to-verify chip (AssetDetailPage)', await paintedChip('AssetDetailPage')],
    ]
    const table = subjects.flatMap(([subject, painted]) =>
      THEMES.map((theme) => ({
        subject,
        theme,
        label: painted.label,
        tone: painted.tinted ? painted.tone : '(no tint)',
        labelOnInk: round(labelRatio(theme, painted, '--ink')),
        labelOnInkSoft: round(labelRatio(theme, painted, '--ink-soft')),
      })),
    )
    console.table(table)
    expect(table).toHaveLength(16)
  })

  for (const status of STATUSES) {
    for (const theme of THEMES) {
      for (const surface of SURFACES) {
        it(`${status} in the ${theme} theme on ${surface} reaches ${LABEL_MIN}:1`, () => {
          expect(labelRatio(theme, paintedBadge(status), surface)).toBeGreaterThanOrEqual(LABEL_MIN)
        })
      }
    }
  }

  for (const page of ['AssetsPage', 'AssetDetailPage'] as const) {
    for (const theme of THEMES) {
      for (const surface of SURFACES) {
        it(`the To verify chip on ${page} in the ${theme} theme on ${surface} reaches ${LABEL_MIN}:1`, async () => {
          expect(labelRatio(theme, await paintedChip(page), surface)).toBeGreaterThanOrEqual(LABEL_MIN)
        })
      }
    }
  }

  it('is not satisfied by accident: the tone itself as text WOULD miss 4.5:1 somewhere (why labels use the *-text tokens)', () => {
    const asText = STATUSES.flatMap((status) =>
      THEMES.map((theme) => {
        const painted = paintedBadge(status)
        return contrast(token(theme, painted.tone), backgroundOn(theme, painted, '--ink'))
      }),
    )
    expect(Math.min(...asText)).toBeLessThan(LABEL_MIN)
  })
})

/*
 * WCAG 1.4.1 (use of colour): no badge carries its state by colour alone. Each status maps to one
 * meaning of the suite's dictionary (lib/statusMeanings), whose icon sits, aria-hidden, beside the
 * label; six statuses, six meanings, six icons.
 */
describe('non-colour signal — every badge variant carries its own icon beside its label', () => {
  it('six statuses render six different icons and six different labels', () => {
    const icons = new Set<string>()
    const labels = new Set<string>()
    for (const status of STATUSES) {
      const { unmount } = render(<AssetStatusBadge status={status} />)
      const badge = screen.getByTestId('asset-status-badge')
      icons.add(badge.querySelector('[aria-hidden="true"]')?.innerHTML ?? '')
      labels.add(badge.textContent ?? '')
      unmount()
    }
    expect(icons.size).toBe(6)
    expect(labels.size).toBe(6)
  })

  it('the To verify chip carries an icon too', async () => {
    const painted = await paintedChip('AssetDetailPage')
    expect(painted.tinted).toBe(true)
  })
})

describe('contrast — the focus ring (>= 3:1 against the surfaces it is drawn on)', () => {
  // The ring moved from inventory-ui's standalone index.css to the suite's
  // tokens (INC-04), so it exists inside the shell too.
  const ringToken = /--focus-ring\s*:\s*([^;]+);/.exec(TOKENS_CSS)?.[1].trim()
  const SURFACES = ['--ink', '--ink-soft', '--ink-mid'] as const

  it('tokens.css declares a --focus-ring token and a global :focus-visible outline that uses it', () => {
    expect(ringToken).toBeDefined()
    expect(TOKENS_CSS).toMatch(/:focus-visible[^{]*\{[^}]*outline:[^;}]*var\(--focus-ring\)/)
  })

  it('index.css (standalone only) does not define a ring of its own', () => {
    expect(INDEX_CSS).not.toMatch(/--focus-ring\s*:/)
    expect(INDEX_CSS).not.toMatch(/:focus-visible/)
  })

  it('measured ratios (printed for the report)', () => {
    const table = THEMES.flatMap((theme) =>
      SURFACES.map((surface) => ({
        theme,
        ring: resolveToken(theme, ringToken ?? ''),
        surface,
        ratio: Number(contrast(toRgb(resolveToken(theme, ringToken ?? '')), token(theme, surface)).toFixed(2)),
      })),
    )
    console.table(table)
    expect(table).toHaveLength(6)
  })

  for (const theme of THEMES) {
    for (const surface of SURFACES) {
      it(`${theme} theme: ring on ${surface} reaches ${RING_MIN}:1`, () => {
        const ring = toRgb(resolveToken(theme, ringToken ?? ''))
        expect(contrast(ring, token(theme, surface))).toBeGreaterThanOrEqual(RING_MIN)
      })
    }
  }

  it('the old ring-acc/50 the design flagged would not have passed (the reason for a dedicated token)', () => {
    for (const theme of THEMES) {
      const half = over(token(theme, '--acc'), token(theme, '--ink-soft'), 0.5)
      expect(contrast(half, token(theme, '--ink-soft'))).toBeLessThan(RING_MIN)
    }
  })
})

// ---------------------------------------------------------------------------
// 2b. The shared button classes (shell/tokens.css `.btn-*`; docs/design-system.md § Buttons)
// ---------------------------------------------------------------------------

describe('contrast — the shared button classes (label >= 4.5:1), computed from the real tokens.css', () => {
  /** A token that only the dark `:root` block declares (e.g. `--acc-solid`, "same value in both themes"). */
  const tok = (theme: Theme, name: string): Rgb => {
    const raw = PALETTE[theme][name] ?? PALETTE.dark[name]
    if (raw === undefined) throw new Error(`${name} is not declared in tokens.css`)
    return toRgb(resolveToken(theme, raw))
  }
  const WHITE: Rgb = [255, 255, 255]
  const SURFACES_BTN = ['--ink', '--ink-soft'] as const

  it('the stylesheet still declares the four variants this test measures', () => {
    for (const variant of ['btn-primary', 'btn-secondary', 'btn-ghost', 'btn-danger']) {
      expect(TOKENS_CSS).toMatch(new RegExp(`\\.${variant}\\s*\\{`))
    }
    expect(TOKENS_CSS).toMatch(/\.btn-primary\s*\{[^}]*background:\s*var\(--acc-solid\)/)
    expect(TOKENS_CSS).toMatch(/\.btn-danger\s*\{[^}]*color-mix\(in srgb, var\(--red\) 14%, transparent\)/)
  })

  for (const theme of THEMES) {
    it(`${theme} theme: primary (white on --acc-solid, and on its hover)`, () => {
      expect(contrast(WHITE, tok(theme, '--acc-solid'))).toBeGreaterThanOrEqual(LABEL_MIN)
      expect(contrast(WHITE, tok(theme, '--acc-solid-hi'))).toBeGreaterThanOrEqual(LABEL_MIN)
    })

    it(`${theme} theme: secondary (--text on --ink-mid)`, () => {
      expect(contrast(tok(theme, '--text'), tok(theme, '--ink-mid'))).toBeGreaterThanOrEqual(LABEL_MIN)
    })

    for (const surface of SURFACES_BTN) {
      it(`${theme} theme: ghost (--soft on ${surface}, and --text on --ink-mid when hovered)`, () => {
        expect(contrast(tok(theme, '--soft'), tok(theme, surface))).toBeGreaterThanOrEqual(LABEL_MIN)
        expect(contrast(tok(theme, '--text'), tok(theme, '--ink-mid'))).toBeGreaterThanOrEqual(LABEL_MIN)
      })

      it(`${theme} theme: danger (--text on the 14% / 24% --red tint over ${surface})`, () => {
        for (const alpha of [0.14, 0.24]) {
          const tint = over(tok(theme, '--red'), tok(theme, surface), alpha)
          expect(contrast(tok(theme, '--text'), tint)).toBeGreaterThanOrEqual(LABEL_MIN)
        }
      })
    }
  }
})
