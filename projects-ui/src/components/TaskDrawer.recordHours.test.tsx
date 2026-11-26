/**
 * @vitest-environment jsdom
 *
 * TaskDrawer × Record hours (specs/20261116-record-hours-in-place AC-3.1, AC-3.2, AC-3.6, AC-4.5, design S2): a
 * project task's drawer (opened from its card on the project's Tasks board) offers hours-ui's widget, through the
 * shell's `hours.recordHours` extension, to the task's assignee and to its participants and to nobody else — in the
 * drawer's "More" actions, after the links and before Edit and Delete (the owner's 2026-11-26 layout: the destructive
 * action is last), done tasks included — with the six plain strings of the task and its project
 * (`placement: 'row'`, the task's placement). When the widget cannot be had the drawer works as before and shows the
 * link to My hours in its place. `shell/extensions` is a spy that records what the drawer hands the widget (the real
 * one is the shell's).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { projectTask } from '../test-support/fakeApi'
import type { ProjectTask } from '../lib/activitiesApi'
import TaskDrawer from './TaskDrawer'

type Mode = 'ready' | 'fallsBack' | 'noExport'
type Call = { name: string; props: Record<string, unknown>; hasLoading: boolean }
const seam = vi.hoisted(() => ({ mode: 'ready' as Mode, calls: [] as Call[] }))

vi.mock('shell/extensions', () => {
  const HostExtension = ({
    name,
    props,
    fallback,
    ...rest
  }: {
    name: string
    props: Record<string, unknown>
    fallback: ReactNode
    loading?: ReactNode
  }) => {
    seam.calls.push({ name, props, hasLoading: 'loading' in rest })
    return seam.mode === 'fallsBack' ? <>{fallback}</> : <button data-testid="widget-record-hours">Record hours</button>
  }
  return {
    get HostExtension() {
      return seam.mode === 'noExport' ? undefined : HostExtension
    },
  }
})

const noop = () => undefined

/** A project task as the card lists it: assigned to `u-ada`, written by `u-ada`, in project `p1` "Intranet". */
const task = (over: Record<string, unknown> = {}, details: Record<string, unknown> = {}) =>
  projectTask('t1', { subject: 'Write the offer', ...over }, details) as unknown as ProjectTask

const person = (id: string) => ({ id, name: id, status: 'active' })

const renderRow = (row: ProjectTask, me: string | null = 'u-ada') =>
  render(
    <TaskDrawer
      task={row}
      mode="project"
      currentUserId={me}
      testIdPrefix="project-task"
      notice={null}
      onDismissNotice={noop}
      onClose={noop}
      onWritten={noop}
      onDeleted={noop}
      onStale={noop}
      onEdit={noop}
    />,
  )

/** The drawer's "More" action group, which names itself after the task. */
const actions = () => screen.getByRole('group', { name: 'Actions for Write the offer' })
/** The drawer's primary actions (Start / Stop, Mark done / Mark not done). */
const progress = () => screen.getByRole('group', { name: 'Progress of Write the offer' })
const labelsOf = (group: HTMLElement) => Array.from(group.children).map((item) => item.textContent)

/** Waits for the wrapper's dynamic import of `shell/extensions` to settle, so an absence is not just "not yet". */
const settled = () => new Promise((resolve) => setTimeout(resolve, 25))

beforeEach(() => {
  seam.mode = 'ready'
  seam.calls = []
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Record hours in a project task’s drawer — who is offered it (AC-3.1)', () => {
  it('offers it to the assignee in the drawer’s More actions, before Edit and the set-apart Delete', async () => {
    renderRow(task())

    const widget = await screen.findByTestId('widget-record-hours')
    const group = actions()
    expect(group.firstElementChild?.contains(widget)).toBe(true)
    expect(labelsOf(group)).toEqual(['Record hours', 'Edit', 'Delete'])
    expect(labelsOf(progress())).toEqual(['Start', 'Mark done'])
  })

  it('hands the widget the extension’s name and the six plain strings of the task and its project (AC-3.2, R10)', async () => {
    renderRow(task({ id: 't-7', project: { id: 'p-9', name: 'Alpenstrom — portale clienti' } }))

    await screen.findByTestId('widget-record-hours')
    expect(seam.calls.length).toBeGreaterThan(0)
    for (const call of seam.calls) {
      expect(call.name).toBe('hours.recordHours')
      expect(call.props).toEqual({
        on: 'project',
        targetId: 'p-9',
        targetName: 'Alpenstrom — portale clienti',
        activityId: 't-7',
        activityName: 'Write the offer',
        placement: 'row',
      })
      // Nothing is shown while the widget loads: the row asks for no placeholder.
      expect(call.hasLoading).toBe(false)
    }
  })

  it('offers it to a participant who is not the assignee', async () => {
    renderRow(task({ participants: [person('u-pat')] }, { assignee: person('u-bob') }), 'u-pat')
    await screen.findByTestId('widget-record-hours')
    expect(actions().contains(screen.getByTestId('widget-record-hours'))).toBe(true)
  })

  it('offers it to nobody else who can read the task: the author alone, or anyone else', async () => {
    // Written by u-author, assigned to u-bob, u-pat takes part.
    const row = task({ author: person('u-author'), participants: [person('u-pat')] }, { assignee: person('u-bob') })

    renderRow(row, 'u-author')
    await settled()
    expect(seam.calls).toEqual([])
    expect(screen.queryByTestId('widget-record-hours')).toBeNull()
    expect(screen.queryByTestId('record-hours-fallback')).toBeNull()
    // The drawer's own buttons are all still there.
    expect(labelsOf(progress())).toEqual(['Start', 'Mark done'])
    expect(labelsOf(actions())).toEqual(['Edit', 'Delete'])
    cleanup()

    renderRow(row, 'u-someone-else')
    await settled()
    expect(seam.calls).toEqual([])
    expect(screen.queryByTestId('widget-record-hours')).toBeNull()
  })

  it('offers it to nobody while the session has not given the person’s id', async () => {
    renderRow(task(), null)
    await settled()
    expect(seam.calls).toEqual([])
    expect(screen.queryByTestId('widget-record-hours')).toBeNull()
  })

  it('does not depend on the row’s `may` flags: a person who may not edit, delete or complete still records', async () => {
    renderRow(task({ may: { edit: false, delete: false, complete: false } }))

    const widget = await screen.findByTestId('widget-record-hours')
    expect(actions().children).toHaveLength(1)
    expect(actions().firstElementChild?.contains(widget)).toBe(true)
    expect(screen.queryByRole('group', { name: 'Progress of Write the offer' })).toBeNull()
  })

  it('offers no button for a task whose project the answer left out: the widget would have nothing to record on', async () => {
    renderRow(task({ project: null }))
    await settled()
    expect(seam.calls).toEqual([])
    expect(screen.queryByTestId('widget-record-hours')).toBeNull()
    expect(screen.queryByTestId('record-hours-fallback')).toBeNull()
  })
})

describe('Record hours in a done project task’s drawer (AC-3.6)', () => {
  const done = { completedAt: '2026-11-05T10:00:00.000Z', completedBy: person('u-ada') }

  it('offers it exactly as an open task does: same props, same place', async () => {
    renderRow(task({}, done))

    const widget = await screen.findByTestId('widget-record-hours')
    expect(labelsOf(progress())).toEqual(['Mark not done'])
    expect(labelsOf(actions())).toEqual(['Record hours', 'Edit', 'Delete'])
    expect(actions().firstElementChild?.contains(widget)).toBe(true)
    expect(seam.calls.at(-1)?.props).toEqual({
      on: 'project',
      targetId: 'p1',
      targetName: 'Intranet',
      activityId: 't1',
      activityName: 'Write the offer',
      placement: 'row',
    })
  })

  it('is withheld from a done row for the author alone, as from an open one', async () => {
    renderRow(task({ author: person('u-author') }, { ...done, assignee: person('u-bob') }), 'u-author')
    await settled()
    expect(seam.calls).toEqual([])
    expect(screen.queryByTestId('widget-record-hours')).toBeNull()
  })
})

describe('Record hours in a project task’s drawer when the hours screens cannot be loaded (AC-4.5)', () => {
  it('works as before and shows the link to My hours in the widget’s place', async () => {
    seam.mode = 'fallsBack'
    renderRow(task())

    const link = await waitFor(() => screen.getByRole('link', { name: 'Record hours in My hours' }))
    expect(link.getAttribute('href')).toBe('/hours')
    expect(actions().firstElementChild?.contains(link)).toBe(true)
    // The drawer's own actions still work and are in their places.
    expect(within(progress()).getByRole('button', { name: 'Mark done' })).not.toBeNull()
    expect(within(actions()).getByRole('button', { name: 'Edit' })).not.toBeNull()
  })

  it('shows the same link when the shell predates the expose (no HostExtension)', async () => {
    seam.mode = 'noExport'
    renderRow(task())
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Record hours in My hours' })).not.toBeNull())
  })

  it('shows no link to someone who would not have been offered the button', async () => {
    seam.mode = 'fallsBack'
    renderRow(task({ author: person('u-author') }, { assignee: person('u-bob') }), 'u-author')
    await settled()
    expect(screen.queryByRole('link', { name: 'Record hours in My hours' })).toBeNull()
  })
})
