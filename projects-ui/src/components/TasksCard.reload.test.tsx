/**
 * @vitest-environment jsdom
 *
 * TasksCard — what a re-read of the lists keeps (specs/20261116-record-hours-in-place, QE D3; design S3 "The message
 * goes by ×, by the next save, or by leaving the page", plan G1: no timer). A write (a move, a button in a drawer)
 * reads the lists again; that read keeps the cards it still holds (the same elements, React keys them by task id) and
 * the open drawer with them, so the Record hours widget's success message survives; a card the re-read removes goes;
 * and what the lists depend on (the project, Show older, the pages loaded) is in the fetcher, so one list is never
 * shown for another. The first read, a failed read and empty lanes are unchanged.
 *
 * `shell/extensions` is mocked with a widget that keeps its own state, as hours-ui's does: its message is the thing an
 * unmount would drop.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { stubLayoutForBoard } from '@operai/ui/board'
import { fakeApi, personRef, problem, projectDetail, projectTask } from '../test-support/fakeApi'
import type { FakeAnswer } from '../test-support/fakeApi'
import { dragCard, laneCards, openCard } from '../test-support/taskBoard'
import TasksCard from './TasksCard'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('shell/session', () => ({
  usePermissions: () => ({ epoch: 0, apps: [], roles: [], departments: [], permissions: [] }),
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada', name: 'Ada Lovelace' } } }),
}))

vi.mock('shell/extensions', async () => {
  const { useState } = await import('react')
  return {
    HostExtension: ({ props }: { props: { activityName: string } }) => {
      const [recorded, setRecorded] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setRecorded(true)}>
            {`Record hours on ${props.activityName}`}
          </button>
          {recorded && <p role="status">{`2 h recorded on ${props.activityName}.`}</p>}
        </>
      )
    },
  }
})

const other = personRef('u-other', 'Olga Other')
/** A task of someone else's: no Record hours for Ada, but moving it is hers to do. */
const theirs = (id: string) => projectTask(id, { author: other }, { assignee: other, dueDate: '2099-01-01' })
const mine = (id: string, task: Record<string, unknown> = {}) => projectTask(id, {}, { dueDate: '2099-01-01', ...task })
const page = (items: unknown[], total = items.length, pageNumber = 1) => ({
  items,
  total,
  page: pageNumber,
  pageSize: 100,
})
const empty: FakeAnswer = { status: 200, body: page([]) }

/** A request that answers only when the test says so: the re-read "in flight". */
const deferred = () => {
  let release: (answer: FakeAnswer) => void = () => undefined
  const answer = new Promise<FakeAnswer>((resolve) => {
    release = resolve
  })
  return { answer, release }
}

const openReads = () =>
  apiFetch.mock.calls.filter(([input, init]) => {
    const url = new URL(String(input))
    return (
      url.pathname === '/tasks' &&
      url.searchParams.get('status') === 'open' &&
      ((init as RequestInit | undefined)?.method ?? 'GET') === 'GET'
    )
  }).length

let restoreLayout: () => void
beforeEach(() => {
  restoreLayout = stubLayoutForBoard()
  window.scrollTo = () => undefined
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0)
    return 0
  }
})

afterEach(() => {
  restoreLayout()
  cleanup()
  vi.clearAllMocks()
})

describe('a re-read after a write (QE D3, design S3)', () => {
  it('keeps the open drawer, and so the widget’s message, while the lists are read again and after it', async () => {
    const reread = deferred()
    let reads = 0
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': (url) => {
          if (url.searchParams.get('status') === 'done') return empty
          reads += 1
          return reads === 1 ? { status: 200, body: page([mine('t1')]) } : reread.answer.then((answer) => answer)
        },
        'POST /activities/t1/start': () => ({ status: 200, body: mine('t1', { status: 'in_progress' }) }),
      }),
    )
    render(<TasksCard project={projectDetail()} canManage currentUserId="u-ada" />)

    // The person records hours on their own task, in its drawer: the widget's message shows there.
    const drawer = await openCard('project-task', 't1')
    fireEvent.click(await drawer.findByRole('button', { name: 'Record hours on Task t1' }))
    const panel = screen.getByTestId('task-drawer')
    expect(drawer.getByText('2 h recorded on Task t1.')).toBeTruthy()

    // Then Start, in the same drawer: the board reads its lists again.
    fireEvent.click(drawer.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(reads).toBe(2))
    expect(screen.queryByTestId('projects-loading')).toBeNull()
    expect(screen.getByTestId('task-drawer')).toBe(panel)
    expect(within(panel).getByText('2 h recorded on Task t1.')).toBeTruthy()

    reread.release({ status: 200, body: page([mine('t1', { status: 'in_progress' })]) })
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Stop' })).toBeTruthy())
    expect(screen.getByTestId('task-drawer')).toBe(panel)
    expect(within(panel).getByText('2 h recorded on Task t1.')).toBeTruthy()
  })

  it('keeps the cards it still holds, the same elements, and lets the card that left go', async () => {
    const reread = deferred()
    let reads = 0
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': (url) => {
          if (url.searchParams.get('status') === 'done') return empty
          reads += 1
          return reads === 1
            ? { status: 200, body: page([theirs('t1'), theirs('t2'), theirs('t3')]) }
            : reread.answer.then((answer) => answer)
        },
        'POST /activities/t2/complete': () => ({ status: 200, body: theirs('t2') }),
      }),
    )
    render(<TasksCard project={projectDetail()} canManage currentUserId="u-ada" />)

    const below = await screen.findByTestId('project-task-t3')
    await dragCard(screen.getByTestId('project-task-t2'), 2)
    await waitFor(() => expect(reads).toBe(2))
    expect(screen.queryByTestId('projects-loading')).toBeNull()
    expect(screen.getByTestId('project-task-t3')).toBe(below)

    reread.release({ status: 200, body: page([theirs('t1'), theirs('t3')]) })
    await waitFor(() => expect(screen.queryByTestId('project-task-t2')).toBeNull())
    expect(screen.getByTestId('project-task-t3')).toBe(below)
    expect(below.isConnected).toBe(true)
  })

  it('still ends in the card’s own error when the re-read fails, instead of showing cards as if they were current', async () => {
    let reads = 0
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': (url) => {
          if (url.searchParams.get('status') === 'done') return empty
          reads += 1
          return reads === 1
            ? { status: 200, body: page([mine('t1'), theirs('t2')]) }
            : problem(500, undefined, {}, 'Database is down')
        },
        'POST /activities/t2/complete': () => ({ status: 200, body: theirs('t2') }),
      }),
    )
    render(<TasksCard project={projectDetail()} canManage currentUserId="u-ada" />)

    await dragCard(await screen.findByTestId('project-task-t2'), 2)

    expect((await screen.findByTestId('project-tasks-error')).textContent).toContain('Database is down')
    expect(screen.queryByTestId('project-task-t1')).toBeNull()
  })
})

describe('what the lists are read for', () => {
  it('shows the loading state, not another project’s cards, when the card is given another project', async () => {
    const other = deferred()
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': (url) =>
          url.searchParams.get('projectId') === 'p2'
            ? other.answer.then((answer) => answer)
            : { status: 200, body: page(url.searchParams.get('status') === 'done' ? [] : [mine('t1')]) },
      }),
    )
    const { rerender } = render(<TasksCard project={projectDetail()} canManage currentUserId="u-ada" />)
    await screen.findByTestId('project-task-t1')

    rerender(<TasksCard project={projectDetail({ id: 'p2' })} canManage currentUserId="u-ada" />)

    expect(await screen.findByTestId('projects-loading')).toBeTruthy()
    expect(screen.queryByTestId('project-task-t1')).toBeNull()
    other.release({ status: 200, body: page([mine('x1')]) })
    await screen.findByTestId('project-task-x1')
  })

  it('"Show older" says the Done lane is loading, and never shows the last 30 days as if they were all', async () => {
    const older = deferred()
    const done = (id: string) => mine(id, { status: 'done', completedAt: '2026-11-20T08:00:00.000Z' })
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': (url) =>
          url.searchParams.get('status') !== 'done'
            ? { status: 200, body: page([mine('t1')]) }
            : url.searchParams.has('completedSince')
              ? { status: 200, body: page([done('d1')]) }
              : older.answer.then((answer) => answer),
      }),
    )
    render(<TasksCard project={projectDetail()} canManage currentUserId="u-ada" />)
    await screen.findByTestId('project-task-d1')

    fireEvent.click(screen.getByRole('button', { name: 'Show older' }))

    await waitFor(() => expect(screen.queryByTestId('project-task-d1')).toBeNull())
    expect(within(screen.getByTestId('project-tasks-lane-done')).getByText('Loading tasks…')).toBeTruthy()
    // The Open lane stays as it was.
    expect(screen.getByTestId('project-task-t1')).toBeTruthy()
    older.release({ status: 200, body: page([done('d1'), done('d0')]) })
    await screen.findByTestId('project-task-d0')
    expect(laneCards('project-tasks', 'done', 'project-task')).toEqual(['project-task-d1', 'project-task-d0'])
  })

  it('a re-read after "Load more" reads every page loaded, so the appended cards stay', async () => {
    let started = false
    apiFetch.mockImplementation(
      fakeApi({
        'GET /tasks': (url) => {
          if (url.searchParams.get('status') === 'done') return empty
          const n = Number(url.searchParams.get('page'))
          const task = n === 1 ? (started ? mine('a1', { status: 'in_progress' }) : mine('a1')) : theirs(`b${n}`)
          return { status: 200, body: page([task], 150, n) }
        },
        'POST /activities/a1/start': () => {
          started = true
          return { status: 200, body: mine('a1', { status: 'in_progress' }) }
        },
      }),
    )
    render(<TasksCard project={projectDetail()} canManage currentUserId="u-ada" />)
    await screen.findByTestId('project-task-a1')
    fireEvent.click(within(screen.getByTestId('project-tasks-open-more')).getByRole('button', { name: 'Load more' }))
    const appended = await screen.findByTestId('project-task-b2')

    await dragCard(screen.getByTestId('project-task-a1'), 1)

    await waitFor(() => expect(laneCards('project-tasks', 'in_progress', 'project-task')).toEqual(['project-task-a1']))
    expect(screen.getByTestId('project-task-b2')).toBe(appended)
    const pages = apiFetch.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname === '/tasks' && url.searchParams.get('status') === 'open')
      .map((url) => url.searchParams.get('page'))
    expect(pages).toEqual(['1', '2', '1', '2'])
    expect(openReads()).toBe(4)
  })
})
