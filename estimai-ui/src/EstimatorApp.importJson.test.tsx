/**
 * @vitest-environment jsdom
 *
 * Import JSON inside an open estimate (2026-11-23): the file's parameters, releases and activities
 * replace the estimate's, its name and author are ignored, the change is autosaved like any edit;
 * replacing existing activities asks first; a bad file changes nothing; a reader has no Import.
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


const fileOf = (content: unknown) =>
  new File([typeof content === 'string' ? content : JSON.stringify(content)], 'other.json', { type: 'application/json' })

const imported = {
  name: 'Another estimate',
  author: 'Someone Else',
  params: { ...fixtureParams, aiGain: 0.5 },
  releases: [{ id: 'x1', name: 'Beta', fte: 3 }],
  acts: [{ ...fixtureActs[0]!, id: 'x-a', act: 'Imported activity', release: 'Beta' }],
}

const choose = async (content: unknown) => {
  fireEvent.change(screen.getByTestId('import-json-input'), { target: { files: [fileOf(content)] } })
  await vi.advanceTimersByTimeAsync(3_000)
}

describe('Import JSON inside an estimate', () => {
  it('asks before replacing existing activities, then replaces the content and keeps name and author', async () => {
    renderEditor('owner', { author: 'Ada' })
    await choose(imported)

    expect(screen.getByText(strings.editor.importReplaceBody(2))).toBeDefined()
    fireEvent.click(screen.getByTestId('import-replace-confirm'))
    await vi.advanceTimersByTimeAsync(0)

    expect(screen.queryByTestId('import-replace-confirm')).toBeNull()
    expect(screen.getByDisplayValue('Imported activity')).toBeDefined()
    expect(screen.queryByDisplayValue('Setup')).toBeNull()
    expect(screen.getByTestId('estimate-imported-notice')).toBeDefined()
    await vi.advanceTimersByTimeAsync(3_000)
    // Autosaved like any edit: the estimate's own name and author, the file's content.
    const [, body] = vi.mocked(estimatesApi.update).mock.calls.at(-1)!
    expect(body).toMatchObject({
      name: 'Oversight Test',
      author: 'Ada',
      content: { params: { aiGain: 0.5 }, releases: [{ name: 'Beta', fte: 3 }], acts: [{ act: 'Imported activity' }] },
    })
  })

  it('Cancel keeps the estimate as it was', async () => {
    renderEditor('owner', { author: 'Ada' })
    await choose(imported)
    fireEvent.click(screen.getByTestId('import-replace-cancel'))
    await vi.advanceTimersByTimeAsync(3_000)
    expect(screen.getByDisplayValue('Setup')).toBeDefined()
    expect(screen.queryByDisplayValue('Imported activity')).toBeNull()
  })

  it('a file that is not an estimate changes nothing and says why', async () => {
    renderEditor('owner', { author: 'Ada' })
    await choose('{nope')
    expect(screen.getByTestId('estimate-import-error').textContent).toContain(strings.estimatesList.importInvalidJson)
    await choose({ hello: 'world' })
    expect(screen.getByTestId('estimate-import-error').textContent).toContain(strings.estimatesList.importNotAnEstimate)
    expect(screen.queryByTestId('import-replace-confirm')).toBeNull()
    expect(screen.getByDisplayValue('Setup')).toBeDefined()
  })

  it('is offered to an editor, never to a viewer or in oversight', () => {
    renderEditor('editor')
    expect(screen.getByTestId('import-json-button')).toBeDefined()
    cleanup()
    for (const access of ['viewer', 'oversight'] as const) {
      renderEditor(access)
      expect(screen.queryByTestId('import-json-button')).toBeNull()
      cleanup()
    }
  })
})
