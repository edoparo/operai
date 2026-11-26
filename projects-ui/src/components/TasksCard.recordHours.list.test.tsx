/**
 * @vitest-environment jsdom
 *
 * A long Tasks board × Record hours (specs/20261116-record-hours-in-place plan R1): the widget lives in a task's
 * drawer, never on its card, so a board of any length mounts NO widget and never asks for `shell/extensions` until a
 * drawer the person may record on opens; then it is imported once, and every later drawer reuses it (the federation
 * runtime caches the module after the first import). The mock factory counts how often the module is evaluated.
 *
 * The two tests are ORDER-DEPENDENT on purpose and share one module registry (a vitest module mock lives per file):
 * the first proves a board, even of the person's own tasks, and a drawer they may not record on, never load the seam
 * (the count stays 0); the second that opening drawers loads it once. Run the file as a whole, or each test alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { fakeApi, personRef, projectDetail, projectTask } from '../test-support/fakeApi'
import { closeDrawer, openCard } from '../test-support/taskBoard'
import TasksCard from './TasksCard'

const { apiFetch, seam } = vi.hoisted(() => ({ apiFetch: vi.fn(), seam: { factoryRuns: 0 } }))

vi.mock('shell/session', () => ({
  usePermissions: () => ({ epoch: 0, apps: [], roles: [], departments: [], permissions: [] }),
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada', name: 'Ada Lovelace' } } }),
}))

vi.mock('shell/extensions', () => {
  seam.factoryRuns += 1
  return { HostExtension: () => <button data-testid="widget-record-hours">Record hours</button> }
})

const person = (id: string) => personRef(id, id)
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 100 })

const renderCard = (items: unknown[]) => {
  apiFetch.mockImplementation(
    fakeApi({
      'GET /tasks': (url) => ({ status: 200, body: page(url.searchParams.get('status') === 'done' ? [] : items) }),
    }),
  )
  render(<TasksCard project={projectDetail()} canManage={false} currentUserId="u-ada" />)
}

/** Lets any dynamic import settle, so a count that stays 0 is not just "not yet". */
const settled = () => new Promise((resolve) => setTimeout(resolve, 50))

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

describe('a long Tasks board (R1)', () => {
  it('never loads `shell/extensions` for the board itself, nor for a drawer the person may not record on', async () => {
    const theirs = Array.from({ length: 30 }, (_, i) =>
      projectTask(`o${i}`, { author: person('u-other') }, { assignee: person('u-other') }),
    )
    renderCard([...theirs, ...Array.from({ length: 70 }, (_, i) => projectTask(`m${i}`))])

    await waitFor(() => expect(screen.getAllByTestId(/^project-task-[om]\d+$/)).toHaveLength(100))
    await settled()
    expect(seam.factoryRuns).toBe(0)
    expect(screen.queryByTestId('widget-record-hours')).toBeNull()

    await openCard('project-task', 'o3')
    await settled()
    expect(seam.factoryRuns).toBe(0)
    expect(screen.queryByTestId('widget-record-hours')).toBeNull()
    expect(screen.queryByTestId('record-hours-fallback')).toBeNull()
  })

  it('imports `shell/extensions` once, for the first drawer the person may record on, and reuses it after', async () => {
    renderCard(Array.from({ length: 100 }, (_, i) => projectTask(`t${i}`)))
    await waitFor(() => expect(screen.getAllByTestId(/^project-task-t\d+$/)).toHaveLength(100))

    const first = await openCard('project-task', 't0')
    expect(await first.findByTestId('widget-record-hours')).toBeTruthy()
    closeDrawer()
    const second = await openCard('project-task', 't57')
    expect(await second.findByTestId('widget-record-hours')).toBeTruthy()
    expect(seam.factoryRuns).toBe(1)
  })
})
