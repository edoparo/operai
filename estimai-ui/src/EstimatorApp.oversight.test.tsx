/**
 * @vitest-environment jsdom
 *
 * Oversight mode of the estimate page (specs/20261108-estimate-list-oversight AC-1.4, AC-1.5, AC-2.4): an
 * admin who reaches an estimate only through `estimate:read-all` sees it in
 * full and can export it, but nothing is editable or closable, collaborators
 * are not offered, and merely opening it never dirties the document.
 *
 * Same mount recipe as EstimatorApp.viewerGating.test.tsx.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { Parameters, Release, Activity } from './types'
import type { EstimateAccess, EstimateIdentity } from './lib/estimatesApi'

// ---------------------------------------------------------------------------
// Module mocks — same recipe as EstimatorApp.test.tsx.
// ---------------------------------------------------------------------------

vi.mock('@tanstack/react-router', () => ({
  // Header's back-to-list control is a router <Link> (INC-13).
  Link: ({ to, className, children }: { to: string; className?: string; children: ReactNode }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ invalidate: vi.fn() }),
  Outlet: () => null,
  createRootRoute: vi.fn(),
  createRoute: vi.fn(),
  createRouter: vi.fn(),
  redirect: vi.fn(),
  isRedirect: vi.fn(),
  getRouteApi: vi.fn(() => ({
    useParams: vi.fn(() => ({})),
    useLoaderData: vi.fn(() => ({})),
  })),
}))

vi.mock('./lib/authClient', () => ({
  authClient: {
    // A signed-in admin: the author auto-fill would pick this name up on an editable estimate.
    useSession: vi.fn(() => ({ data: { user: { id: 'admin-1', name: 'Admin Person', email: 'admin@welld.ch' } } })),
    signOut: vi.fn(),
    getSession: vi.fn(),
  },
}))

vi.mock('./lib/pdfExport', () => ({ exportPdf: vi.fn() }))

vi.mock('@vercel/analytics/react', () => ({
  Analytics: () => null,
}))

vi.mock('@vercel/speed-insights/react', () => ({
  SpeedInsights: () => null,
}))

vi.mock('./lib/estimatesApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/estimatesApi')>()
  return {
    ...original,
    update: vi.fn(),
    create: vi.fn(),
  }
})

import * as estimatesApi from './lib/estimatesApi'
import { exportPdf } from './lib/pdfExport'
import { strings } from './strings'
import { EstimatorProvider } from './context/EstimatorContext'
import EstimatorApp from './EstimatorApp'

// ---------------------------------------------------------------------------
// Fixtures — non-empty acts/releases so ActivityTable (not TemplatePicker /
// the viewer empty state) renders on the activities tab in both modes.
// ---------------------------------------------------------------------------

const fixtureParams: Parameters = {
  parallelism: 0.7,
  sprintDays: 10,
  workingDaysMonth: 20,
  qaDeployDays: 0,
  qaTestDays: 0,
  pmDays: 0,
  aiCostCoef: 10,
  aiGain: 0.3,
}

const fixtureRelease: Release = { id: 'r1', name: 'v1.0', fte: 2 }

const fixtureActs: Activity[] = [
  {
    id: 'a1',
    num: '1',
    epic: 'Core',
    act: 'Setup',
    prof: 'Developer',
    o: 1,
    ml: 2,
    p: 4,
    risk: 0.1,
    notes: '',
    release: 'v1.0',
  },
  {
    id: 'a2',
    num: '2',
    epic: 'Core',
    act: 'Wiring',
    prof: 'Frontend Dev',
    o: 2,
    ml: 3,
    p: 5,
    risk: 0,
    notes: '',
    release: 'v1.0',
  },
]


const ownerIdentity: EstimateIdentity = { status: 'active', name: 'Luca Verdi' }

function renderEditor(access: EstimateAccess, extra: { closedAt?: string | null; author?: string } = {}) {
  return render(
    <EstimatorProvider
      estimateId="est-oversight-test"
      initialName="Oversight Test"
      initialAuthor={extra.author ?? ''}
      initialParams={fixtureParams}
      initialReleases={[fixtureRelease]}
      initialActs={fixtureActs}
      initialAccess={access}
      initialVersion={1}
      initialOwner={ownerIdentity}
      initialClosedAt={extra.closedAt ?? null}
    >
      <EstimatorApp />
    </EstimatorProvider>,
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(estimatesApi.update).mockResolvedValue({ version: 2, updatedAt: '2026-11-09T00:00:00.000Z' } as never)
  vi.stubEnv('VITE_API_URL', 'http://api.test')
  vi.stubEnv('VITE_AUTH_URL', 'http://auth.test')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  cleanup()
})

describe('oversight mode (AC-1.4)', () => {
  it('explains itself in a persistent banner naming the owner', () => {
    renderEditor('oversight')

    const banner = screen.getByTestId('estimate-oversight-banner')
    expect(banner.textContent).toContain(strings.lifecycle.oversightTitle)
    expect(banner.textContent).toContain('Luca Verdi')
  })

  it('is read-only: every text cell is readOnly (not disabled), no selects, no add or delete controls', () => {
    renderEditor('oversight')

    const controls = [...screen.queryAllByRole('textbox'), ...screen.queryAllByRole('spinbutton')] as HTMLInputElement[]
    expect(controls.length).toBeGreaterThan(0)
    for (const el of controls) {
      expect(el.readOnly).toBe(true)
      expect(el.disabled).toBe(false)
    }
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: /add activity/i })).toHaveLength(0)
    expect(screen.queryByTitle('Delete activity')).toBeNull()
  })

  it('offers neither the collaborators control nor close/reopen — and mounts no collaborators dialog', () => {
    renderEditor('oversight')

    expect(screen.queryByTestId('collaborators-button')).toBeNull()
    expect(screen.queryByTestId('collaborators-chip')).toBeNull()
    expect(screen.queryByTestId('close-estimate-button')).toBeNull()
    expect(screen.queryByTestId('reopen-estimate-button')).toBeNull()
  })

  it('keeps the exports (Client, PDF, Excel) and Help available', () => {
    renderEditor('oversight')

    for (const name of [/client/i, /pdf/i, /excel/i]) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false)
    }
    expect(screen.getByRole('button', { name: strings.editor.modelReference })).toBeDefined()
  })

  it('never fills the empty author from the admin’s session, never autosaves, and shows no save state', async () => {
    renderEditor('oversight', { author: '' })

    await vi.runAllTimersAsync()

    expect(vi.mocked(estimatesApi.update)).not.toHaveBeenCalled()
    expect(screen.queryByText(/Saving…|Saved/)).toBeNull()
    // The document the admin exports is still the stored one, not stamped with their name.
    fireEvent.click(screen.getByRole('button', { name: /pdf/i }))
    expect(vi.mocked(exportPdf)).toHaveBeenCalledWith(expect.objectContaining({ author: '' }))
  })

  it('on a closed estimate shows the closed banner in its viewer wording and still no Reopen (AC-2.4)', () => {
    renderEditor('oversight', { closedAt: '2026-11-05T10:00:00.000Z' })

    const closed = screen.getByTestId('estimate-closed-banner')
    expect(closed.textContent).toContain(strings.lifecycle.closedReadOnlyViewer)
    expect(screen.queryByTestId('reopen-estimate-button')).toBeNull()
    expect(screen.getByTestId('estimate-oversight-banner')).toBeDefined()
  })
})

describe('what oversight must not change (AC-1.5)', () => {
  it.each(['owner', 'editor'] as const)('%s keeps the editor, lifecycle control and autosave, with no oversight banner', async (access) => {
    renderEditor(access, { author: '' })

    expect(screen.queryByTestId('estimate-oversight-banner')).toBeNull()
    expect(screen.getByTestId('close-estimate-button')).toBeDefined()
    expect((screen.getByPlaceholderText('Project name…') as HTMLInputElement).readOnly).toBe(false)
    // An editable estimate still gets the session user as its missing author.
    await vi.runAllTimersAsync()
    expect(vi.mocked(estimatesApi.update)).toHaveBeenCalled()
  })

  it('a viewer no longer has their author filled locally either', async () => {
    renderEditor('viewer', { author: '' })
    await vi.runAllTimersAsync()
    expect(vi.mocked(estimatesApi.update)).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /pdf/i }))
    expect(vi.mocked(exportPdf)).toHaveBeenCalledWith(expect.objectContaining({ author: '' }))
  })
})
