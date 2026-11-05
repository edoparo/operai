/**
 * @vitest-environment jsdom
 *
 * ProjectDetailPage (specs/021 AC-1.2 – AC-1.7, AC-4.4; specs/022 AC-2.3, AC-2.4, AC-3.2, AC-3.3, AC-5.2): the
 * details, the dates from the terms, the team and — by what the project has — a Purchase order card (a project
 * made from a deal: deal link, "no longer won" notice, estimate link, Bexio order id, its terms) or a Terms card
 * (a hand-made one, nothing of a PO); only the allowed state moves (Resume back to `stateBeforeHold`); no type
 * change; controls hidden without manage scope; the project manager and the team picked among module users;
 * and a stale write (409 `version_conflict`) asking the person to reload. Rendered through the app's real
 * router against a fake projects-api.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from '../router'
import { fakeApi, problem, projectDetail, purchaseOrderOf, scope, termsOf } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'
import { scopeRoot } from '../test-support/scopeRoot'
import type { Project, ProjectState, Scope } from '../lib/types'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada', name: 'Ada Lovelace' } } }),
}))

const BOB = { id: 'u-bob', name: 'Bob Builder', email: 'bob@welld.ch', entity: 'welld_ch' }
const BOB_PERSON = { id: 'u-bob', name: 'Bob Builder', deleted: false }
const CARA = { id: 'u-cara', name: 'Cara Coder', email: 'cara@welld.ch', entity: 'welld_ch' }
const MANAGER = scope({ manage: ['welld_ch'] })

const renderProject = async (
  project: Project,
  routes: Record<string, FakeHandler> = {},
  callerScope: Scope = MANAGER,
) => {
  apiFetch.mockImplementation(
    fakeApi({
      [`GET /projects/${project.id}`]: () => ({ status: 200, body: project }),
      'GET /tasks': () => ({ status: 200, body: { items: [], total: 0, page: 1, pageSize: 25 } }),
      'GET /authz/users/directory': () => ({ status: 200, body: { users: [BOB, CARA] } }),
      ...routes,
    }),
  )
  window.history.pushState(null, '', `/${project.id}`)
  render(<RouterProvider router={createAppRouter(undefined, scopeRoot(callerScope))} />)
  await screen.findByTestId('project-detail-page')
}

beforeEach(() => {
  window.scrollTo = () => undefined
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const writes = () =>
  apiFetch.mock.calls
    .filter(([, init]) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes((init as RequestInit | undefined)?.method ?? ''))
    .map(([input, init]) => ({
      method: (init as RequestInit).method!,
      path: new URL(String(input)).pathname,
      ifMatch: ((init as RequestInit).headers as Record<string, string>)['If-Match'],
      body: JSON.parse(String((init as RequestInit).body ?? 'null')) as unknown,
    }))

const actionLabels = () => {
  const actions = screen.queryByTestId('project-actions')
  return actions
    ? within(actions)
        .queryAllByRole('button')
        .map((button) => button.textContent)
    : []
}

const HAND_MADE_TERMS = termsOf('t_and_m', { positions: [{ profile: 'Senior developer', plannedManDays: 20 }] })
const PO_TERMS = termsOf('fixed_price', { deadline: '2026-12-01', estimatedManDays: 12.5, maxEffortManDays: 40 })

/** A project made from a won deal: a purchase order and the terms that come with it. */
const fromDeal = (over: Partial<Project> = {}): Project =>
  projectDetail({
    type: 'fixed_price',
    purchaseOrder: purchaseOrderOf({ estimate: { id: 'est-1' }, bexioOrderId: 'AB-100' }),
    terms: PO_TERMS,
    startDate: '2026-02-01',
    endDate: null,
    ...over,
  })

describe('the project page (AC-1.4, AC-1.5)', () => {
  it('shows the details, the dates from the terms, the team and the terms of a hand-made project', async () => {
    await renderProject(
      projectDetail({
        name: 'Intranet',
        state: 'active',
        company: { id: 'c1', name: 'Acme SA' },
        team: [BOB_PERSON, { id: 'u-gone', name: null, deleted: true }],
        terms: { ...HAND_MADE_TERMS, endDate: '2026-12-31' },
        startDate: '2026-02-01',
        endDate: '2026-12-31',
      }),
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Intranet' })).not.toBeNull()
    const facts = screen.getByTestId('project-facts')
    expect(facts.textContent).toContain('Time & material')
    expect(facts.textContent).toContain('wellD CH')
    expect(facts.textContent).toContain('Acme SA')
    expect(facts.textContent).toContain('Ada Lovelace (You)')
    expect(facts.textContent).toContain('01.02.2026')
    expect(facts.textContent).toContain('31.12.2026')
    const team = screen.getByTestId('project-team')
    expect(team.textContent).toContain('Bob Builder')
    expect(team.textContent).toContain('Deleted user')
    const terms = screen.getByTestId('project-terms')
    expect(within(terms).getByRole('heading', { level: 3, name: 'Terms' })).not.toBeNull()
    expect(terms.textContent).toContain('Senior developer')
    expect(screen.getByTestId('project-detail-back').getAttribute('href')).toBe('/')
  })

  it('shows "Open-ended" when the terms have no end, and no dates without terms', async () => {
    await renderProject(projectDetail({ terms: HAND_MADE_TERMS, startDate: '2026-02-01', endDate: null }))
    expect(screen.getByTestId('project-facts').textContent).toContain('Open-ended')
    cleanup()
    await renderProject(projectDetail())
    expect(screen.getByTestId('project-facts').textContent).not.toContain('Open-ended')
    expect(screen.getByTestId('project-terms').textContent).toContain('No terms yet')
  })

  it('a SaaS project has a company of its own like any client project (D40); an internal one has none and no terms', async () => {
    await renderProject(projectDetail({ type: 'saas', company: { id: 'c2', name: 'Beta AG' } }))
    expect(screen.getByTestId('project-facts').textContent).toContain('Beta AG')
    expect(screen.getByTestId('project-facts').textContent).not.toMatch(/clients?\b/)
    cleanup()
    await renderProject(projectDetail({ type: 'internal', company: null }))
    expect(screen.getByTestId('project-facts').textContent).toContain('Internal')
    expect(screen.getByTestId('project-terms').textContent).toContain('Internal projects have no terms')
  })

  it('an unknown project is "not found", with the way back to the list', async () => {
    apiFetch.mockImplementation(fakeApi({ 'GET /projects/zzz': () => problem(404, 'not_found') }))
    window.history.pushState(null, '', '/zzz')
    render(<RouterProvider router={createAppRouter(undefined, scopeRoot(MANAGER))} />)
    expect(await screen.findByTestId('project-not-found')).not.toBeNull()
    expect(screen.getByTestId('project-detail-back').getAttribute('href')).toBe('/')
  })

  it('a failed load shows the retry banner', async () => {
    let calls = 0
    apiFetch.mockImplementation(
      fakeApi({
        'GET /projects/p1': () => {
          calls += 1
          return calls === 1 ? problem(500, undefined, {}, 'boom') : { status: 200, body: projectDetail() }
        },
      }),
    )
    window.history.pushState(null, '', '/p1')
    render(<RouterProvider router={createAppRouter(undefined, scopeRoot(MANAGER))} />)
    expect((await screen.findByTestId('projects-load-error')).textContent).toContain('boom')
    fireEvent.click(screen.getByTestId('projects-load-error-retry'))
    expect(await screen.findByTestId('project-detail-page')).not.toBeNull()
  })
})

describe('state actions (AC-1.3)', () => {
  it.each<[ProjectState, ProjectState | null, string[]]>([
    ['planned', null, ['Start project', 'Put on hold', 'Cancel project']],
    ['active', null, ['Put on hold', 'Close project', 'Cancel project']],
    ['on_hold', 'active', ['Resume', 'Cancel project']],
    ['closed', null, ['Reopen']],
    ['cancelled', null, []],
  ])('a %s project offers only its allowed moves', async (state, stateBeforeHold, labels) => {
    await renderProject(projectDetail({ state, stateBeforeHold }))
    expect(actionLabels()).toEqual(labels)
  })

  it('moves a planned project to active with the version as If-Match, and shows the new state', async () => {
    await renderProject(projectDetail({ state: 'planned' }), {
      'POST /projects/p1/transitions': () => ({
        status: 200,
        body: projectDetail({ state: 'active', version: 4 }),
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start project' }))
    await waitFor(() => expect(actionLabels()).toEqual(['Put on hold', 'Close project', 'Cancel project']))
    expect(writes()).toEqual([
      { method: 'POST', path: '/projects/p1/transitions', ifMatch: '"3"', body: { to: 'active' } },
    ])
    expect((await screen.findByTestId('projects-saved')).textContent).toContain('The project is now Active.')
  })

  it.each<ProjectState>(['planned', 'active'])(
    '"Resume" returns an on-hold project to the state it left (%s)',
    async (before) => {
      await renderProject(projectDetail({ state: 'on_hold', stateBeforeHold: before }), {
        'POST /projects/p1/transitions': () => ({
          status: 200,
          body: projectDetail({ state: before, version: 4 }),
        }),
      })
      fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
      await waitFor(() => expect(writes().length).toBe(1))
      expect(writes()[0]!.body).toEqual({ to: before })
    },
  )

  it('cancelling asks first, says it is final, and only then moves the project', async () => {
    await renderProject(projectDetail({ state: 'active' }), {
      'POST /projects/p1/transitions': () => ({
        status: 200,
        body: projectDetail({ state: 'cancelled', version: 4 }),
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel project' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Cancel this project?' })
    expect(dialog.textContent).toContain('final')
    expect(writes()).toEqual([])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep project' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(writes()).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Cancel project' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByTestId('project-cancel-confirm'))
    await waitFor(() => expect(actionLabels()).toEqual([]))
    expect(writes()).toEqual([
      { method: 'POST', path: '/projects/p1/transitions', ifMatch: '"3"', body: { to: 'cancelled' } },
    ])
  })

  it('a refused move (409 invalid_transition) says so and changes nothing on the page', async () => {
    await renderProject(projectDetail({ state: 'planned' }), {
      'POST /projects/p1/transitions': () => problem(409, 'invalid_transition'),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start project' }))
    const banner = await screen.findByTestId('project-action-error')
    expect(banner.textContent).toContain('cannot move to that state')
    expect(actionLabels()).toEqual(['Start project', 'Put on hold', 'Cancel project'])
  })
})

describe('the type never changes (A30, D40)', () => {
  it.each(['t_and_m', 'fixed_price', 'maintenance', 'saas', 'internal'] as const)(
    'a %s project offers no control to change its type',
    async (type) => {
      await renderProject(projectDetail({ type, company: type === 'internal' ? null : { id: 'c1', name: 'Acme SA' } }))
      expect(screen.queryByRole('button', { name: /Make SaaS|Rendi SaaS|type/i })).toBeNull()
      expect(screen.queryByRole('alertdialog')).toBeNull()
    },
  )
})

describe('who may change the project (AC-4.4)', () => {
  const NO_CONTROLS = ['project-actions']

  it.each<[string, Scope]>([
    ['manages nothing', scope()],
    ['manages only the other entity', scope({ manage: ['welld_it'] })],
  ])('a caller who %s reads the project and gets no control', async (_name, callerScope) => {
    await renderProject(projectDetail({ state: 'planned', type: 'internal', company: null }), {}, callerScope)
    for (const id of NO_CONTROLS) expect(screen.queryByTestId(id)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit team' })).toBeNull()
    expect(screen.getByText('You can read this project but not change it.')).not.toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Intranet' })).not.toBeNull()
  })

  it('the controls are there for the entity the caller manages', async () => {
    await renderProject(projectDetail({ state: 'planned' }), {}, scope({ manage: ['welld_ch'] }))
    expect(actionLabels()).toContain('Start project')
    expect(screen.queryByText('You can read this project but not change it.')).toBeNull()
  })
})

describe('a stale write (AC-1.7)', () => {
  it('409 version_conflict asks the person to reload, and Reload reads the project again', async () => {
    let reads = 0
    await renderProject(projectDetail({ state: 'planned' }), {
      'GET /projects/p1': () => {
        reads += 1
        return { status: 200, body: projectDetail({ state: reads === 1 ? 'planned' : 'active', version: 3 + reads }) }
      },
      'POST /projects/p1/transitions': () => problem(409, 'version_conflict', { currentVersion: 4 }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start project' }))
    const banner = await screen.findByTestId('projects-stale-write')
    expect(banner.textContent).toContain('Reload')
    fireEvent.click(screen.getByTestId('projects-stale-write-reload'))
    await waitFor(() => expect(actionLabels()).toEqual(['Put on hold', 'Close project', 'Cancel project']))
    expect(screen.queryByTestId('projects-stale-write')).toBeNull()
    expect(reads).toBe(2)
  })

  it('428 (no precondition) is treated the same, and a stale cancel closes its dialog for the banner', async () => {
    await renderProject(projectDetail({ state: 'active' }), {
      'POST /projects/p1/transitions': () => problem(428, 'precondition_required'),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel project' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByTestId('project-cancel-confirm'))
    expect(await screen.findByTestId('projects-stale-write')).not.toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})

describe('editing the name and the project manager (AC-1.6, AC-1.7)', () => {
  const openEdit = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
    return screen.findByRole('dialog', { name: 'Edit project' })
  }

  it('starts from the current values and sends only what changed, with the version', async () => {
    await renderProject(projectDetail(), {
      'PATCH /projects/p1': () => ({ status: 200, body: projectDetail({ name: 'Intranet 2', version: 4 }) }),
    })
    const dialog = await openEdit()
    expect((within(dialog).getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Intranet')
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: ' Intranet 2 ' } })
    fireEvent.click(within(dialog).getByTestId('project-edit-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes()).toEqual([{ method: 'PATCH', path: '/projects/p1', ifMatch: '"3"', body: { name: 'Intranet 2' } }])
    expect(screen.getByRole('heading', { level: 2, name: 'Intranet 2' })).not.toBeNull()
  })

  it('picks the project manager among the people with access to the module (ADR-0055)', async () => {
    await renderProject(projectDetail(), {
      'PATCH /projects/p1': () => ({ status: 200, body: projectDetail({ projectManager: BOB_PERSON, version: 4 }) }),
    })
    const dialog = await openEdit()
    const picker = within(dialog).getByRole('combobox', { name: /Project manager/ })
    fireEvent.focus(picker)
    expect((await within(dialog).findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'Bob Builderbob@welld.ch',
      'Cara Codercara@welld.ch',
    ])
    const directory = apiFetch.mock.calls
      .map(([input]) => new URL(String(input)))
      .find((url) => url.pathname === '/authz/users/directory')!
    expect(directory.searchParams.get('appId')).toBe('projects')
    fireEvent.click(within(dialog).getByRole('option', { name: /Bob Builder/ }))
    fireEvent.click(within(dialog).getByTestId('project-edit-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes()[0]!.body).toEqual({ projectManagerId: 'u-bob' })
    expect(screen.getByTestId('project-facts').textContent).toContain('Bob Builder')
  })

  it('a name left empty is refused before any request', async () => {
    await renderProject(projectDetail())
    const dialog = await openEdit()
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: '  ' } })
    fireEvent.click(within(dialog).getByTestId('project-edit-submit'))
    expect(await within(dialog).findByText('This field is required.')).not.toBeNull()
    expect(writes()).toEqual([])
  })

  it('a project manager without access (422 not_project_user) is refused on that field, values kept', async () => {
    await renderProject(projectDetail(), {
      'PATCH /projects/p1': () => problem(422, 'not_project_user', { userIds: ['u-bob'] }),
    })
    const dialog = await openEdit()
    fireEvent.focus(within(dialog).getByRole('combobox', { name: /Project manager/ }))
    fireEvent.click(await within(dialog).findByRole('option', { name: /Bob Builder/ }))
    fireEvent.click(within(dialog).getByTestId('project-edit-submit'))
    expect(await within(dialog).findByText(/no access to Projects/)).not.toBeNull()
    expect(screen.getByRole('dialog')).not.toBeNull()
  })

  it('a stale save closes the dialog and shows the reload banner', async () => {
    await renderProject(projectDetail(), {
      'PATCH /projects/p1': () => problem(409, 'version_conflict', { currentVersion: 9 }),
    })
    const dialog = await openEdit()
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Renamed' } })
    fireEvent.click(within(dialog).getByTestId('project-edit-submit'))
    expect(await screen.findByTestId('projects-stale-write')).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('the team (AC-1.5, AC-1.6)', () => {
  const openTeam = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Edit team' }))
    return screen.findByRole('dialog', { name: 'Edit team' })
  }
  const addPerson = async (dialog: HTMLElement, name: RegExp) => {
    fireEvent.focus(within(dialog).getByRole('combobox', { name: /Add a team member/ }))
    fireEvent.click(await within(dialog).findByRole('option', { name }))
  }

  it('lists the members, and offers "Edit team" to a manager only', async () => {
    await renderProject(projectDetail({ team: [BOB_PERSON] }))
    expect(within(screen.getByTestId('project-team')).getByRole('button', { name: 'Edit team' })).not.toBeNull()
    cleanup()
    await renderProject(projectDetail({ team: [BOB_PERSON] }), {}, scope())
    expect(screen.queryByRole('button', { name: 'Edit team' })).toBeNull()
    expect(screen.getByTestId('project-team').textContent).toContain('Bob Builder')
  })

  it('adds a person picked among the module users and PUTs the whole team with the version', async () => {
    await renderProject(projectDetail({ team: [BOB_PERSON] }), {
      'PUT /projects/p1/team': () => ({
        status: 200,
        body: projectDetail({ team: [BOB_PERSON, { id: 'u-cara', name: 'Cara Coder', deleted: false }], version: 4 }),
      }),
    })
    const dialog = await openTeam()
    expect(within(dialog).getByRole('button', { name: 'Remove Bob Builder' })).not.toBeNull()
    fireEvent.focus(within(dialog).getByRole('combobox', { name: /Add a team member/ }))
    // The people already on the team are not offered again.
    expect((await within(dialog).findAllByRole('option')).map((option) => option.textContent)).toEqual([
      'Cara Codercara@welld.ch',
    ])
    fireEvent.click(within(dialog).getByRole('option', { name: /Cara Coder/ }))
    expect(within(dialog).getByRole('button', { name: 'Remove Cara Coder' })).not.toBeNull()
    expect((within(dialog).getByRole('combobox', { name: /Add a team member/ }) as HTMLInputElement).value).toBe('')
    fireEvent.click(within(dialog).getByTestId('project-team-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes()).toEqual([
      { method: 'PUT', path: '/projects/p1/team', ifMatch: '"3"', body: { memberIds: ['u-bob', 'u-cara'] } },
    ])
    expect(screen.getByTestId('project-team').textContent).toContain('Cara Coder')
  })

  it('removing the last member sends an empty team', async () => {
    await renderProject(projectDetail({ team: [BOB_PERSON] }), {
      'PUT /projects/p1/team': () => ({ status: 200, body: projectDetail({ team: [], version: 4 }) }),
    })
    const dialog = await openTeam()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove Bob Builder' }))
    expect(within(dialog).getByText('Nobody yet.')).not.toBeNull()
    fireEvent.click(within(dialog).getByTestId('project-team-submit'))
    await waitFor(() => expect(writes().length).toBe(1))
    expect(writes()[0]!.body).toEqual({ memberIds: [] })
    expect(await screen.findByText('No team members yet.')).not.toBeNull()
  })

  it('there is nothing to save until the team changes', async () => {
    await renderProject(projectDetail({ team: [BOB_PERSON] }))
    const dialog = await openTeam()
    expect((within(dialog).getByTestId('project-team-submit') as HTMLButtonElement).disabled).toBe(true)
  })

  it('names the people refused for lack of access (422 not_project_user), and keeps the dialog', async () => {
    await renderProject(projectDetail({ team: [] }), {
      'PUT /projects/p1/team': () => problem(422, 'not_project_user', { userIds: ['u-cara'] }),
    })
    const dialog = await openTeam()
    await addPerson(dialog, /Cara Coder/)
    fireEvent.click(within(dialog).getByTestId('project-team-submit'))
    expect((await within(dialog).findByTestId('project-team-error')).textContent).toContain('Cara Coder')
    expect(within(dialog).getByRole('button', { name: 'Remove Cara Coder' })).not.toBeNull()
  })

  it('says so when the user directory is down (503 identity_unavailable), nothing changed', async () => {
    await renderProject(projectDetail({ team: [] }), {
      'PUT /projects/p1/team': () => problem(503, 'identity_unavailable'),
    })
    const dialog = await openTeam()
    await addPerson(dialog, /Cara Coder/)
    fireEvent.click(within(dialog).getByTestId('project-team-submit'))
    expect((await within(dialog).findByTestId('project-team-error')).textContent).toContain('cannot be reached')
  })

  it('a stale save closes the dialog and shows the reload banner', async () => {
    await renderProject(projectDetail({ team: [] }), {
      'PUT /projects/p1/team': () => problem(409, 'version_conflict', { currentVersion: 9 }),
    })
    const dialog = await openTeam()
    await addPerson(dialog, /Cara Coder/)
    fireEvent.click(within(dialog).getByTestId('project-team-submit'))
    expect(await screen.findByTestId('projects-stale-write')).not.toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('refuses a team of more than 100 before any request', async () => {
    const team = Array.from({ length: 100 }, (_, index) => ({
      id: `u-${index}`,
      name: `Member ${index}`,
      deleted: false,
    }))
    await renderProject(projectDetail({ team }))
    const dialog = await openTeam()
    await addPerson(dialog, /Cara Coder/)
    fireEvent.click(within(dialog).getByTestId('project-team-submit'))
    expect((await within(dialog).findByTestId('project-team-error')).textContent).toContain('at most 100')
    expect(writes()).toEqual([])
  })
})

describe('the Terms card of a hand-made project (AC-5.2 – AC-5.4)', () => {
  const addButton = () => screen.queryByRole('button', { name: 'Add terms' })
  const withTerms = (over: Partial<Project> = {}) =>
    projectDetail({ terms: HAND_MADE_TERMS, startDate: '2026-02-01', endDate: null, ...over })

  it('shows the terms card and nothing of a purchase order (AC-5.2)', async () => {
    await renderProject(withTerms())
    expect(screen.getByTestId('project-terms')).not.toBeNull()
    expect(screen.queryByTestId('project-purchase-order')).toBeNull()
    expect(screen.queryByTestId('project-deal-not-won')).toBeNull()
    expect(document.body.textContent).not.toMatch(/purchase order|bexio|ops manager|referent|no longer won/i)
    expect(screen.queryByRole('link', { name: /estimate/i })).toBeNull()
  })

  it.each<ProjectState>(['planned', 'active', 'on_hold'])(
    '"Add terms" is offered on a %s project with none',
    async (state) => {
      await renderProject(projectDetail({ state }))
      expect(addButton()).not.toBeNull()
    },
  )

  it('"Add terms" is offered on a SaaS project, and not on an internal one', async () => {
    await renderProject(projectDetail({ type: 'saas' }))
    expect(addButton()).not.toBeNull()
    cleanup()
    await renderProject(projectDetail({ type: 'internal', company: null }))
    expect(addButton()).toBeNull()
  })

  it('a reader gets no button, no Edit and no end-date control', async () => {
    await renderProject(withTerms(), {}, scope())
    expect(addButton()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Set end date' })).toBeNull()
  })

  it('adds terms, then reads the project again so its card and dates are current', async () => {
    let reads = 0
    await renderProject(projectDetail({ type: 'fixed_price' }), {
      'GET /projects/p1': () => {
        reads += 1
        return {
          status: 200,
          body:
            reads === 1
              ? projectDetail({ type: 'fixed_price' })
              : projectDetail({
                  type: 'fixed_price',
                  terms: termsOf('fixed_price', {
                    deadline: '2026-12-01',
                    estimatedManDays: null,
                    maxEffortManDays: 40,
                  }),
                  startDate: '2026-02-01',
                }),
        }
      },
      'POST /projects/p1/terms': () => ({
        status: 201,
        body: termsOf('fixed_price', { deadline: '2026-12-01', estimatedManDays: null, maxEffortManDays: 40 }),
      }),
    })
    fireEvent.click(addButton()!)
    const dialog = await screen.findByRole('dialog', { name: 'Add terms' })
    fireEvent.change(within(dialog).getByLabelText(/^Start date/), { target: { value: '2026-02-01' } })
    fireEvent.change(within(dialog).getByLabelText(/^Deadline/), { target: { value: '2026-12-01' } })
    fireEvent.change(within(dialog).getByLabelText(/^Max effort/), { target: { value: '40' } })
    fireEvent.click(within(dialog).getByTestId('terms-form-submit'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(writes()).toEqual([
      {
        method: 'POST',
        path: '/projects/p1/terms',
        ifMatch: undefined,
        body: {
          startDate: '2026-02-01',
          terms: { deadline: '2026-12-01', estimatedManDays: null, maxEffortManDays: 40 },
        },
      },
    ])
    expect(await screen.findByTestId('terms-details')).not.toBeNull()
    expect(screen.getByTestId('project-facts').textContent).toContain('01.02.2026')
    expect((await screen.findByTestId('projects-saved')).textContent).toContain('Terms added.')
    expect(reads).toBe(2)
  })

  it('setting an end date reads the project again, so the end date of the project follows', async () => {
    let reads = 0
    await renderProject(withTerms(), {
      'GET /projects/p1': () => {
        reads += 1
        return {
          status: 200,
          body: withTerms(
            reads === 1 ? {} : { endDate: '2026-06-30', terms: { ...HAND_MADE_TERMS, endDate: '2026-06-30' } },
          ),
        }
      },
      'PATCH /projects/p1/terms': () => ({
        status: 200,
        body: { ...HAND_MADE_TERMS, endDate: '2026-06-30', version: 5 },
      }),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Set end date' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set the end date' })
    fireEvent.change(within(dialog).getByLabelText(/End date/), { target: { value: '2026-06-30' } })
    fireEvent.click(within(dialog).getByTestId('terms-end-submit'))
    await waitFor(() => expect(screen.getByTestId('project-facts').textContent).toContain('30.06.2026'))
    expect(reads).toBe(2)
  })

  it('a stale terms write shows the page’s reload banner, and Reload reads the project again', async () => {
    let reads = 0
    await renderProject(withTerms(), {
      'GET /projects/p1': () => {
        reads += 1
        return { status: 200, body: withTerms() }
      },
      'PATCH /projects/p1/terms': () => problem(409, 'version_conflict', { currentVersion: 9 }),
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Set end date' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set the end date' })
    fireEvent.change(within(dialog).getByLabelText(/End date/), { target: { value: '2026-06-30' } })
    fireEvent.click(within(dialog).getByTestId('terms-end-submit'))
    fireEvent.click(await screen.findByTestId('projects-stale-write-reload'))
    await waitFor(() => expect(reads).toBe(2))
  })
})

describe('the Purchase order card of a project made from a deal (AC-2.3, AC-2.4, AC-3.2, AC-3.3, AC-5.2)', () => {
  it('shows the PO card with the deal link, the estimate link, the Bexio order id and its terms — and no Terms card', async () => {
    await renderProject(fromDeal())
    const card = screen.getByTestId('project-purchase-order')
    expect(within(card).getByRole('heading', { level: 3, name: 'Purchase order' })).not.toBeNull()
    expect(within(card).getByRole('link', { name: 'Website relaunch' }).getAttribute('href')).toBe('/crm/deals/d1')
    expect(within(card).getByRole('link', { name: 'Open the estimate' }).getAttribute('href')).toBe(
      '/estimai/estimates/est-1',
    )
    expect(card.textContent).toContain('AB-100')
    expect(card.textContent).toContain('01.12.2026')
    expect(card.textContent).toContain('12.5 man-days')
    expect(screen.queryByTestId('project-terms')).toBeNull()
    expect(screen.getByTestId('project-facts').textContent).toContain('01.02.2026')
  })

  it('says on the page and on the card that the deal is no longer won, and changes nothing else (AC-2.3)', async () => {
    await renderProject(
      fromDeal({ purchaseOrder: purchaseOrderOf({ deal: { id: 'd1', title: 'Website relaunch', won: false } }) }),
    )
    const notice = screen.getByTestId('project-deal-not-won')
    expect(notice.textContent).toContain('The deal is no longer won')
    expect(notice.textContent).toContain('Website relaunch')
    expect(screen.getByTestId('purchase-order-deal-not-won')).not.toBeNull()
    // The project and its terms are as they were: the controls and the dates are untouched.
    expect(screen.getByTestId('project-facts').textContent).toContain('01.02.2026')
    expect(screen.getByRole('button', { name: 'Edit' })).not.toBeNull()
  })

  it('names the deal as unavailable in the page notice when the CRM could not name it', async () => {
    await renderProject(fromDeal({ purchaseOrder: purchaseOrderOf({ deal: { id: 'd1', title: null, won: false } }) }))
    expect(screen.getByTestId('project-deal-not-won').textContent).toContain('Deal title unavailable')
  })

  it.each([
    ['won again (AC-2.4)', true],
    ['not known, the CRM not answering', null],
  ])('shows no notice anywhere when the deal is %s', async (_name, won) => {
    await renderProject(
      fromDeal({
        purchaseOrder: purchaseOrderOf({ deal: { id: 'd1', title: won === null ? null : 'Website relaunch', won } }),
      }),
    )
    expect(screen.queryByTestId('project-deal-not-won')).toBeNull()
    expect(screen.queryByTestId('purchase-order-deal-not-won')).toBeNull()
    expect(document.body.textContent).not.toContain('no longer won')
  })

  it('shows no notice on a hand-made project', async () => {
    await renderProject(projectDetail({ terms: HAND_MADE_TERMS }))
    expect(screen.queryByTestId('project-deal-not-won')).toBeNull()
  })

  it('a Bexio save and a terms edit each read the project again; each sends its own record’s version', async () => {
    let reads = 0
    await renderProject(
      fromDeal({ purchaseOrder: purchaseOrderOf({ version: 7 }) }),
      {
        'GET /projects/p1': () => {
          reads += 1
          return { status: 200, body: fromDeal({ purchaseOrder: purchaseOrderOf({ version: 6 + reads }) }) }
        },
        'PUT /projects/p1/purchase-order/bexio-order': () => ({ status: 200, body: purchaseOrderOf({ version: 8 }) }),
        'PATCH /projects/p1/terms': () => ({ status: 200, body: { ...PO_TERMS, version: 5 } }),
      },
      scope({ manage: ['welld_ch'], bexio: true }),
    )
    fireEvent.change(screen.getByLabelText('Bexio order'), { target: { value: 'AB-200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(reads).toBe(2))
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit terms' })
    fireEvent.change(within(dialog).getByLabelText(/^Max effort/), { target: { value: '41' } })
    fireEvent.click(within(dialog).getByTestId('terms-form-submit'))
    await waitFor(() => expect(writes().length).toBe(2))
    expect(writes().map((write) => [write.path, write.ifMatch])).toEqual([
      ['/projects/p1/purchase-order/bexio-order', '"7"'],
      ['/projects/p1/terms', '"4"'],
    ])
  })

  it('offers no way to delete the terms of a project with a purchase order (D38)', async () => {
    await renderProject(fromDeal())
    const labels = screen.getAllByRole('button').map((button) => button.textContent)
    expect(labels.join(' | ')).not.toMatch(/delet|elimin|remove terms|detach|attach/i)
  })
})

describe('a project awaiting its project manager (D42, AC-4.5)', () => {
  const awaiting = () => fromDeal({ projectManager: null, awaitingProjectManager: true, state: 'planned' })

  it('says "Awaiting project manager" where the person would be, never a blank', async () => {
    await renderProject(awaiting())
    expect(screen.getByTestId('project-facts').textContent).toContain('Awaiting project manager')
  })

  it('the edit dialog renames the project but offers no project-manager picker: only the ops manager picks one', async () => {
    await renderProject(awaiting(), {
      'PATCH /projects/p1': () => ({ status: 200, body: { ...awaiting(), name: 'Intranet 2', version: 4 } }),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Edit details' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit project' })
    expect(within(dialog).queryByRole('combobox', { name: /Project manager/ })).toBeNull()
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Intranet 2' } })
    fireEvent.click(within(dialog).getByTestId('project-edit-submit'))
    await waitFor(() => expect(writes().length).toBe(1))
    expect(writes()[0]!.body).toEqual({ name: 'Intranet 2' })
  })

  it('a refused activation (409 awaiting_project_manager) says why', async () => {
    await renderProject(awaiting(), {
      'POST /projects/p1/transitions': () => problem(409, 'awaiting_project_manager'),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start project' }))
    expect((await screen.findByTestId('project-action-error')).textContent).toContain('waiting for its project manager')
  })
})
