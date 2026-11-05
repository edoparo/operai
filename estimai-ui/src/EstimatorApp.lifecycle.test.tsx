/**
 * @vitest-environment jsdom
 *
 * Close / reopen an estimate in the editor (the CRM's "estimate ready"
 * signal): who sees the action, the confirmation, closing only once
 * everything is saved, the read-only closed state with its banner, reopening,
 * and a save refused because someone else closed the estimate meanwhile.
 *
 * Same harness as EstimatorApp.conflict.test.tsx: the real EstimatorProvider +
 * EstimatorApp, the router/auth/analytics mocked, the API calls mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import type { Activity, Parameters, Release } from './types'
import type { EstimateAccess, EstimateFull, EstimateIdentity } from './lib/estimatesApi'

vi.mock('@tanstack/react-router', () => ({
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
    useSession: vi.fn(() => ({ data: null })),
    signOut: vi.fn(),
    getSession: vi.fn(),
  },
}))

vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }))
vi.mock('@vercel/speed-insights/react', () => ({ SpeedInsights: () => null }))

vi.mock('./lib/estimatesApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('./lib/estimatesApi')>()
  return {
    ...original,
    update: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    closeEstimate: vi.fn(),
    reopenEstimate: vi.fn(),
  }
})

import * as estimatesApi from './lib/estimatesApi'
import { EstimatorProvider, useEstimatorContext } from './context/EstimatorContext'
import EstimatorApp from './EstimatorApp'
import { strings } from './strings'
import { formatDate } from '@operai/ui'

const t = strings.lifecycle

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
    risk: 0,
    notes: '',
    release: 'v1.0',
  },
]

const CLOSED_AT = '2026-11-05T10:00:00.000Z'
const TINA: EstimateIdentity = { status: 'active', name: 'Tina Tech' }

const serverEstimate = (over: Partial<EstimateFull> = {}): EstimateFull => ({
  id: 'est-lifecycle',
  name: 'Lifecycle',
  author: 'Author',
  content: { params: fixtureParams, releases: [fixtureRelease], acts: fixtureActs },
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: CLOSED_AT,
  version: 4,
  access: 'owner',
  owner: null,
  closedAt: null,
  closedBy: null,
  ...over,
})

/** Exposes the context for assertions and a way to type into the document. */
function Probe() {
  const ctx = useEstimatorContext()
  return (
    <>
      <button data-testid="trigger-edit" onClick={() => ctx.setName('Edited Name')}>
        edit
      </button>
      <span data-testid="probe-version">{ctx.version}</span>
      <span data-testid="probe-can-edit">{String(ctx.canEdit)}</span>
      <span data-testid="probe-name">{ctx.name}</span>
    </>
  )
}

function renderEditor(
  opts: { access?: EstimateAccess; closedAt?: string | null; closedBy?: EstimateIdentity | null } = {},
) {
  return render(
    <EstimatorProvider
      estimateId="est-lifecycle"
      initialName="Lifecycle"
      initialAuthor="Author"
      initialParams={fixtureParams}
      initialReleases={[fixtureRelease]}
      initialActs={fixtureActs}
      initialAccess={opts.access ?? 'owner'}
      initialVersion={3}
      initialClosedAt={opts.closedAt ?? null}
      initialClosedBy={opts.closedBy ?? null}
    >
      <Probe />
      <EstimatorApp />
    </EstimatorProvider>,
  )
}

const closeButton = () => screen.queryByTestId('close-estimate-button') as HTMLButtonElement | null
const reopenButton = () => screen.queryByTestId('reopen-estimate-button') as HTMLButtonElement | null

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('VITE_API_URL', 'http://api.test')
  vi.stubEnv('VITE_AUTH_URL', 'http://auth.test')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  cleanup()
})

describe('who can close or reopen', () => {
  it('the owner and an editor see "Close estimate" while open', () => {
    renderEditor({ access: 'owner' })
    expect(closeButton()).not.toBeNull()
    expect(reopenButton()).toBeNull()
    cleanup()

    renderEditor({ access: 'editor' })
    expect(closeButton()).not.toBeNull()
  })

  it('a viewer sees neither action, open or closed', () => {
    renderEditor({ access: 'viewer' })
    expect(closeButton()).toBeNull()
    expect(reopenButton()).toBeNull()
    cleanup()

    renderEditor({ access: 'viewer', closedAt: CLOSED_AT, closedBy: TINA })
    expect(closeButton()).toBeNull()
    expect(reopenButton()).toBeNull()
  })
})

describe('closing', () => {
  it('asks for confirmation (read-only + CRM ready), then closes, adopts the new version and goes read-only', async () => {
    vi.mocked(estimatesApi.closeEstimate).mockResolvedValueOnce({
      estimate: serverEstimate({ version: 4, closedAt: CLOSED_AT, closedBy: TINA }),
      version: 4,
    })
    renderEditor()

    await act(async () => {
      closeButton()!.click()
    })
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(t.confirmTitle)).toBeDefined()
    expect(within(dialog).getByText(t.confirmBody)).toBeDefined()
    expect(estimatesApi.closeEstimate).not.toHaveBeenCalled()

    await act(async () => {
      within(dialog).getByRole('button', { name: t.confirmLabel }).click()
    })

    expect(estimatesApi.closeEstimate).toHaveBeenCalledWith('est-lifecycle', 3)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByTestId('probe-version').textContent).toBe('4')
    expect(screen.getByTestId('probe-can-edit').textContent).toBe('false')
    expect(screen.getByTestId('estimate-lifecycle-notice').textContent).toContain(t.closedConfirmation)
    const banner = screen.getByTestId('estimate-closed-banner')
    expect(banner.textContent).toContain(t.closedTitle)
    expect(banner.textContent).toContain(t.closedBy('Tina Tech', formatDate(CLOSED_AT)))
    expect(reopenButton()).not.toBeNull()
    expect(closeButton()).toBeNull()
  })

  it('is disabled while a change is waiting to be saved, and enabled once it is stored', async () => {
    let resolveSave: (e: EstimateFull) => void = () => {}
    vi.mocked(estimatesApi.update).mockImplementationOnce(
      () => new Promise<EstimateFull>((resolve) => (resolveSave = resolve)),
    )
    renderEditor()
    expect(closeButton()!.disabled).toBe(false)

    await act(async () => {
      screen.getByTestId('trigger-edit').click()
    })
    expect(closeButton()!.disabled).toBe(true)
    expect(closeButton()!.title).toBe(t.closeUnsavedTitle)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(estimatesApi.update).toHaveBeenCalledTimes(1)
    expect(closeButton()!.disabled).toBe(true) // save in flight

    await act(async () => {
      resolveSave(serverEstimate({ name: 'Edited Name', version: 4 }))
    })
    expect(closeButton()!.disabled).toBe(false)
  })

  it('a failed close keeps the dialog open with the error inline and the estimate editable', async () => {
    vi.mocked(estimatesApi.closeEstimate).mockRejectedValueOnce(
      new estimatesApi.ApiError({ type: 'x', title: 'Server Error', status: 500 }),
    )
    renderEditor()

    await act(async () => {
      closeButton()!.click()
    })
    await act(async () => {
      within(screen.getByRole('alertdialog')).getByRole('button', { name: t.confirmLabel }).click()
    })

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(t.actionFailed('500'))).toBeDefined()
    expect(screen.getByTestId('probe-can-edit').textContent).toBe('true')
  })

  it('already closed by someone else: reloads the estimate in place, read-only', async () => {
    vi.mocked(estimatesApi.closeEstimate).mockRejectedValueOnce(
      new estimatesApi.EstimateStateError({
        type: 'x',
        title: 'Conflict',
        status: 409,
        code: 'estimate_already_closed',
      }),
    )
    vi.mocked(estimatesApi.get).mockResolvedValueOnce(
      serverEstimate({ version: 4, closedAt: CLOSED_AT, closedBy: TINA }),
    )
    renderEditor()

    await act(async () => {
      closeButton()!.click()
    })
    await act(async () => {
      within(screen.getByRole('alertdialog')).getByRole('button', { name: t.confirmLabel }).click()
    })

    expect(estimatesApi.get).toHaveBeenCalledWith('est-lifecycle')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByTestId('estimate-closed-banner')).toBeDefined()
    expect(screen.getByTestId('probe-version').textContent).toBe('4')
  })
})

describe('a closed estimate', () => {
  it('is read-only for its owner, with a banner naming who closed it and when', () => {
    renderEditor({ closedAt: CLOSED_AT, closedBy: TINA })

    expect(screen.getByTestId('probe-can-edit').textContent).toBe('false')
    const banner = screen.getByTestId('estimate-closed-banner')
    expect(banner.getAttribute('role')).toBe('status')
    expect(banner.textContent).toContain(t.closedBy('Tina Tech', formatDate(CLOSED_AT)))
    expect(banner.textContent).toContain(t.closedReadOnly)
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[]
    expect(inputs.every((el) => el.readOnly)).toBe(true)
  })

  it('never autosaves', async () => {
    renderEditor({ closedAt: CLOSED_AT, closedBy: TINA })
    await act(async () => {
      screen.getByTestId('trigger-edit').click()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(estimatesApi.update).not.toHaveBeenCalled()
  })

  it('falls back to "Closed on" when the closer cannot be resolved', () => {
    renderEditor({ closedAt: CLOSED_AT, closedBy: { status: 'unknown', name: null } })
    expect(screen.getByTestId('estimate-closed-banner').textContent).toContain(t.closedOn(formatDate(CLOSED_AT)))
  })

  it('reopen makes it editable again, adopts the version, and does not autosave on its own', async () => {
    vi.mocked(estimatesApi.reopenEstimate).mockResolvedValueOnce({
      estimate: serverEstimate({ version: 4 }),
      version: 4,
    })
    renderEditor({ closedAt: CLOSED_AT, closedBy: TINA })

    await act(async () => {
      reopenButton()!.click()
    })

    expect(estimatesApi.reopenEstimate).toHaveBeenCalledWith('est-lifecycle', 3)
    expect(screen.getByTestId('probe-can-edit').textContent).toBe('true')
    expect(screen.getByTestId('probe-version').textContent).toBe('4')
    expect(screen.queryByTestId('estimate-closed-banner')).toBeNull()
    expect(screen.getByTestId('estimate-lifecycle-notice').textContent).toContain(t.reopenedConfirmation)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(estimatesApi.update).not.toHaveBeenCalled()

    // The next edit saves with the reopened version.
    vi.mocked(estimatesApi.update).mockResolvedValueOnce(serverEstimate({ name: 'Edited Name', version: 5 }))
    await act(async () => {
      screen.getByTestId('trigger-edit').click()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })
    expect(vi.mocked(estimatesApi.update).mock.calls[0]?.[2]).toBe(4)
  })
})

describe('a save refused because someone closed the estimate meanwhile', () => {
  it('reloads the saved version in place, read-only, with a clear message — not the conflict banner', async () => {
    vi.mocked(estimatesApi.update).mockRejectedValueOnce(
      new estimatesApi.EstimateStateError({ type: 'x', title: 'Conflict', status: 409, code: 'estimate_closed' }),
    )
    vi.mocked(estimatesApi.get).mockResolvedValueOnce(
      serverEstimate({ version: 4, closedAt: CLOSED_AT, closedBy: TINA }),
    )
    renderEditor()

    await act(async () => {
      screen.getByTestId('trigger-edit').click()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })

    expect(estimatesApi.get).toHaveBeenCalledWith('est-lifecycle')
    expect(screen.queryByTestId('conflict-banner')).toBeNull()
    expect(screen.getByTestId('probe-name').textContent).toBe('Lifecycle')
    expect(screen.getByTestId('probe-version').textContent).toBe('4')
    expect(screen.getByTestId('probe-can-edit').textContent).toBe('false')
    const banner = screen.getByTestId('estimate-closed-banner')
    expect(banner.getAttribute('role')).toBe('alert')
    expect(banner.textContent).toContain(t.closedMeanwhile)
    expect(banner.textContent).toContain(t.closedBy('Tina Tech', formatDate(CLOSED_AT)))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(estimatesApi.update).toHaveBeenCalledTimes(1)
  })

  it('a stale-version 409 keeps the existing conflict banner', async () => {
    vi.mocked(estimatesApi.update).mockRejectedValueOnce(
      new estimatesApi.ConflictError({
        type: 'x',
        title: 'Conflict',
        status: 409,
        code: 'estimate_version_conflict',
        currentVersion: 5,
      }),
    )
    renderEditor()

    await act(async () => {
      screen.getByTestId('trigger-edit').click()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600)
    })

    expect(screen.getByTestId('conflict-banner')).toBeDefined()
    expect(screen.queryByTestId('estimate-closed-banner')).toBeNull()
    expect(closeButton()!.disabled).toBe(true)
  })
})
