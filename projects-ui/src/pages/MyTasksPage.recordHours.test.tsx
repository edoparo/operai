/**
 * @vitest-environment jsdom
 *
 * My tasks × Record hours (specs/20261116-record-hours-in-place AC-3.1 – AC-3.4, AC-3.6, AC-4.5, design S2): the
 * drawer of a task of My tasks — a project task or a pre-sales task, opened from its card — offers hours-ui's widget,
 * through the shell's `hours.recordHours` extension, to the task's assignee and its participants and to nobody else,
 * as the LAST item of the drawer's actions (after "Open in CRM" for a pre-sales task), done tasks included. The board
 * itself mounts no widget. A project task records on its
 * project and the task, a pre-sales task with a deal on that deal and the task, a pre-sales task with no deal as
 * other work with no ids. Rendered through the app's real router against a fake activities-api; `shell/extensions`
 * is a spy that records what each drawer hands the widget. It is AUTOMOCKED, with the widget set per test, as the
 * shell's extensions.test.tsx does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import ProjectsShell from '../components/ProjectsShell'
import { createAppRouter } from '../router'
import { fakeApi, personRef, projectTask, scope } from '../test-support/fakeApi'
import { closeDrawer, openCard } from '../test-support/taskBoard'
import { HostExtension } from 'shell/extensions'

type Mode = 'ready' | 'fallsBack'
type Call = { name: string; props: Record<string, unknown> }
const { apiFetch, session, seam } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  session: { id: 'u-ada' as string | null },
  seam: { mode: 'ready' as Mode, calls: [] as Call[] },
}))

vi.mock('shell/session', () => ({
  usePermissions: () => ({ epoch: 0, apps: [], roles: [], departments: [], permissions: [] }),
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  useSession: () => ({ data: session.id === null ? null : { user: { id: session.id, name: 'Someone' } } }),
}))

vi.mock('shell/extensions')

/** The widget of a shell that has hours-ui: its button; or, when it cannot be had, the host's fallback it renders. */
const widget = ({ name, props, fallback }: { name: string; props: Record<string, unknown>; fallback: ReactNode }) => {
  seam.calls.push({ name, props })
  return seam.mode === 'fallsBack' ? <>{fallback}</> : <button data-testid="widget-record-hours">Record hours</button>
}

const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 100 })

/** A pre-sales task as `GET /tasks?kind=all` returns it: a CRM company, no project, assigned to `u-ada`. */
const preSalesTask = (id: string, over: Record<string, unknown> = {}, task: Record<string, unknown> = {}) =>
  projectTask(
    id,
    {
      kind: 'pre_sales',
      subject: `Pre-sales ${id}`,
      project: null,
      company: { id: 'c9', name: 'Globex AG' },
      deal: { id: 'd1', title: 'Website' },
      ...over,
    },
    task,
  )

const renderPage = async (items: unknown[], first: string) => {
  apiFetch.mockImplementation(
    fakeApi({
      'GET /scope': () => ({ status: 200, body: scope() }),
      'GET /tasks': () => ({ status: 200, body: page(items) }),
    }),
  )
  window.history.pushState(null, '', '/tasks')
  render(<RouterProvider router={createAppRouter(undefined, ProjectsShell)} />)
  await screen.findByTestId(`my-task-${first}`)
}

/** Opens a task's drawer and returns its action group, named after the task (null when the drawer has none). */
const actionsOf = async (id: string, subject: string) => {
  const drawer = await openCard('my-task', id)
  return drawer.queryByRole('group', { name: `Actions for ${subject}` })
}

const labels = (group: HTMLElement) => Array.from(group.children).map((item) => item.textContent)

/** Waits for the wrapper's dynamic import of `shell/extensions` to settle, so an absence is not just "not yet". */
const settled = () => new Promise((resolve) => setTimeout(resolve, 25))

const person = (id: string) => personRef(id, id)

beforeEach(() => {
  vi.mocked(HostExtension).mockImplementation(widget as unknown as typeof HostExtension)
  seam.mode = 'ready'
  seam.calls = []
  session.id = 'u-ada'
  window.scrollTo = () => undefined
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  }
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('Record hours in a My tasks drawer — what it records on (AC-3.2, AC-3.3, AC-3.4)', () => {
  it('a project task records on its project and on the task, after Mark done', async () => {
    await renderPage([projectTask('p1', { subject: 'Write the offer' })], 'p1')
    expect(seam.calls).toEqual([])

    const group = (await actionsOf('p1', 'Write the offer'))!
    const widget = await screen.findByTestId('widget-record-hours')
    expect(group.lastElementChild?.contains(widget)).toBe(true)
    expect(labels(group)).toEqual(['Record hours'])
    expect(labels(screen.getByRole('group', { name: 'Progress of Write the offer' }))).toEqual(['Start', 'Mark done'])
    expect(seam.calls.at(-1)).toEqual({
      name: 'hours.recordHours',
      props: {
        on: 'project',
        targetId: 'p1',
        targetName: 'Intranet',
        activityId: 'p1',
        activityName: 'Write the offer',
        placement: 'row',
      },
    })
  })

  it('a pre-sales task with a deal records on the deal and on the task, as the last item after "Open in CRM"', async () => {
    await renderPage([preSalesTask('s1', { subject: 'Send the quote' })], 's1')

    const group = (await actionsOf('s1', 'Send the quote'))!
    const widget = await screen.findByTestId('widget-record-hours')
    expect(labels(group)).toEqual(['Open in CRM', 'Record hours'])
    expect(group.lastElementChild?.contains(widget)).toBe(true)
    expect(seam.calls.at(-1)?.props).toEqual({
      on: 'deal',
      targetId: 'd1',
      targetName: 'Website',
      activityId: 's1',
      activityName: 'Send the quote',
      placement: 'row',
    })
  })

  it('a pre-sales task with no deal records as other work: no ids, no name, the subject only names the button', async () => {
    await renderPage([preSalesTask('s2', { subject: 'Call Globex back', deal: null })], 's2')

    const group = (await actionsOf('s2', 'Call Globex back'))!
    await screen.findByTestId('widget-record-hours')
    expect(seam.calls.at(-1)?.props).toEqual({
      on: 'none',
      targetId: '',
      targetName: '',
      activityId: '',
      activityName: 'Call Globex back',
      placement: 'row',
    })
    expect(group.lastElementChild?.contains(screen.getByTestId('widget-record-hours'))).toBe(true)
  })

  it('offers it for a pre-sales task that has no company link: it is then the only action of More', async () => {
    await renderPage([preSalesTask('s3', { subject: 'Orphan', company: null })], 's3')
    const group = (await actionsOf('s3', 'Orphan'))!
    await screen.findByTestId('widget-record-hours')
    expect(labels(group)).toEqual(['Record hours'])
  })
})

describe('Record hours in a My tasks drawer — who is offered it (AC-3.1, AC-3.6)', () => {
  it('offers it to a participant who is not the assignee, and not on the task of someone else', async () => {
    session.id = 'u-pat'
    await renderPage(
      [projectTask('p1', { participants: [person('u-pat')] }, { assignee: person('u-bob') }), projectTask('p2')],
      'p1',
    )
    await actionsOf('p1', 'Task p1')
    expect(await screen.findByTestId('widget-record-hours')).toBeTruthy()
    closeDrawer()
    seam.calls = []
    await actionsOf('p2', 'Task p2')
    await settled()
    expect(seam.calls).toEqual([])
    expect(screen.queryByTestId('widget-record-hours')).toBeNull()
  })

  it('offers it to nobody else who can read the task, and mounts nothing for those drawers', async () => {
    session.id = 'u-author'
    await renderPage(
      [
        projectTask('p1', { author: person('u-author') }, { assignee: person('u-bob') }),
        preSalesTask('s1', { author: person('u-author') }, { assignee: person('u-bob') }),
      ],
      'p1',
    )
    await actionsOf('p1', 'Task p1')
    await settled()
    closeDrawer()
    const group = (await actionsOf('s1', 'Pre-sales s1'))!
    await settled()
    expect(seam.calls).toEqual([])
    expect(screen.queryByTestId('widget-record-hours')).toBeNull()
    expect(screen.queryByTestId('record-hours-fallback')).toBeNull()
    // The pre-sales task keeps its own link and Mark done.
    expect(labels(group)).toEqual(['Open in CRM'])
  })

  it('offers it to nobody while the session has not given the person’s id', async () => {
    session.id = null
    await renderPage([projectTask('p1')], 'p1')
    await actionsOf('p1', 'Task p1')
    await settled()
    expect(seam.calls).toEqual([])
  })

  it('leaves the action group empty for a task with nothing in it: not completable, and not the person’s', async () => {
    session.id = 'u-author'
    await renderPage(
      [
        projectTask(
          'p1',
          { author: person('u-author'), may: { edit: false, delete: false, complete: false } },
          { assignee: person('u-bob') },
        ),
      ],
      'p1',
    )
    const group = await actionsOf('p1', 'Task p1')
    await settled()
    expect(group).toBeNull()
    expect(screen.queryByRole('group', { name: 'Progress of Task p1' })).toBeNull()
  })

  it('the group holds only the button for a task the person cannot complete but may record on', async () => {
    await renderPage([projectTask('p1', { may: { edit: false, delete: false, complete: false } })], 'p1')
    const group = (await actionsOf('p1', 'Task p1'))!
    const widget = await screen.findByTestId('widget-record-hours')
    expect(labels(group)).toEqual(['Record hours'])
    expect(group.lastElementChild?.contains(widget)).toBe(true)
  })

  it('offers it on done tasks exactly as on open ones: same place, same props (AC-3.6)', async () => {
    const done = { completedAt: '2026-11-05T10:00:00.000Z', completedBy: person('u-ada') }
    await renderPage(
      [
        projectTask('p1', { subject: 'Write the offer' }, done),
        preSalesTask('s1', { subject: 'Send the quote' }, done),
      ],
      'p1',
    )
    let group = (await actionsOf('p1', 'Write the offer'))!
    await screen.findByTestId('widget-record-hours')
    expect(labels(group)).toEqual(['Record hours'])
    closeDrawer()
    group = (await actionsOf('s1', 'Send the quote'))!
    await screen.findByTestId('widget-record-hours')
    expect(labels(group)).toEqual(['Open in CRM', 'Record hours'])
    const props = seam.calls.map((call) => call.props)
    expect(props).toContainEqual(expect.objectContaining({ on: 'project', targetId: 'p1', activityId: 'p1' }))
    expect(props).toContainEqual(expect.objectContaining({ on: 'deal', targetId: 'd1', activityId: 's1' }))
  })

  it('withholds it from a done task for the author alone, as from an open one', async () => {
    session.id = 'u-author'
    const done = { assignee: person('u-bob'), completedAt: '2026-11-05T10:00:00.000Z', completedBy: person('u-bob') }
    await renderPage([projectTask('p1', { author: person('u-author') }, done)], 'p1')
    await actionsOf('p1', 'Task p1')
    await settled()
    expect(seam.calls).toEqual([])
  })
})

describe('Record hours in a My tasks drawer when the hours screens cannot be loaded (AC-4.5)', () => {
  it('shows the link to My hours as the last action, after "Open in CRM", and the drawer still works', async () => {
    seam.mode = 'fallsBack'
    await renderPage([preSalesTask('s1', { subject: 'Send the quote' })], 's1')

    const group = (await actionsOf('s1', 'Send the quote'))!
    const link = await waitFor(() => within(group).getByRole('link', { name: 'Record hours in My hours' }))
    expect(link.getAttribute('href')).toBe('/hours')
    expect(group.lastElementChild?.contains(link)).toBe(true)
    expect(labels(group)).toEqual(['Open in CRM', 'Record hours in My hours'])
    expect(within(group).getByRole('link', { name: 'Open in CRM: Send the quote' })).not.toBeNull()
  })
})

describe('Record hours on a long My tasks board (R1)', () => {
  it('mounts no widget for the board; each drawer hands the widget its own task’s props', async () => {
    // 100 cards. Ada is signed in: 80 are hers — the even ones project tasks, the odd ones pre-sales tasks, of which
    // those with i % 4 === 1 have no deal — and 20 more are somebody else's.
    const mine = (i: number) => (i % 2 === 0 ? projectTask : preSalesTask)
    const items = [
      ...Array.from({ length: 80 }, (_, i) =>
        mine(i)(`m${i}`, { subject: `Mine ${i}`, ...(i % 4 === 1 ? { deal: null } : {}) }),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        projectTask(`o${i}`, { subject: `Theirs ${i}`, author: person('u-other') }, { assignee: person('u-other') }),
      ),
    ]
    await renderPage(items, 'm0')
    await settled()
    expect(seam.calls).toEqual([])
    expect(screen.queryByTestId('widget-record-hours')).toBeNull()

    const expected: Record<number, Record<string, unknown>> = {
      0: { on: 'project', targetId: 'p1', activityId: 'm0' },
      6: { on: 'project', targetId: 'p1', activityId: 'm6' },
      1: { on: 'none', targetId: '', activityId: '' },
      5: { on: 'none', targetId: '', activityId: '' },
      3: { on: 'deal', targetId: 'd1', activityId: 'm3' },
      7: { on: 'deal', targetId: 'd1', activityId: 'm7' },
    }
    for (const [i, props] of Object.entries(expected)) {
      await actionsOf(`m${i}`, `Mine ${i}`)
      await screen.findByTestId('widget-record-hours')
      expect(seam.calls.at(-1)?.props).toMatchObject({ ...props, activityName: `Mine ${i}` })
      closeDrawer()
    }
    seam.calls = []
    await actionsOf('o4', 'Theirs 4')
    await settled()
    expect(seam.calls).toEqual([])
  })
})
