/**
 * @vitest-environment jsdom
 *
 * My tasks keeps the cards it still lists, and the open drawer (specs/20261116-record-hours-in-place design S3, plan
 * G1, QE D3): the success message of hours-ui's Record hours lives in the task's drawer and goes by ×, by the next save
 * or by leaving the page — not because the lists were read again after a write. Moving a card to Done takes it out of
 * the Open lane, so every card below it moves up one place; each keeps its element only if the board follows the task,
 * not the slot (the board keys its cards by task id).
 *
 * `shell/extensions` is mocked with a widget that keeps its own state, as hours-ui's does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import ProjectsShell from '../components/ProjectsShell'
import { createAppRouter } from '../router'
import { stubLayoutForBoard } from '@operai/ui/board'
import { fakeApi, personRef, projectTask, scope } from '../test-support/fakeApi'
import { dragCard, openCard } from '../test-support/taskBoard'
import type { FakeAnswer } from '../test-support/fakeApi'

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
/** A task of someone else's: no Record hours for Ada, but Mark done is hers to press (`may.complete`). */
const theirs = (id: string) => projectTask(id, { author: other }, { assignee: other })
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 100 })

const deferred = () => {
  let release: (answer: FakeAnswer) => void = () => undefined
  const answer = new Promise<FakeAnswer>((resolve) => {
    release = resolve
  })
  return { answer, release }
}

const openReads = () =>
  apiFetch.mock.calls.filter(([input]) => {
    const url = new URL(String(input))
    return url.pathname === '/tasks' && url.searchParams.get('status') === 'open'
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

describe('My tasks — a write does not unmount what is still listed', () => {
  const render_ = (routes: Parameters<typeof fakeApi>[0]) => {
    apiFetch.mockImplementation(fakeApi({ 'GET /scope': () => ({ status: 200, body: scope() }), ...routes }))
    window.history.pushState(null, '', '/tasks')
    render(<RouterProvider router={createAppRouter(undefined, ProjectsShell)} />)
  }

  it('moving a card above to Done: the card below keeps its element', async () => {
    const reread = deferred()
    let reads = 0
    render_({
      'GET /tasks': (url) => {
        if (url.searchParams.get('status') === 'done') return { status: 200, body: page([]) }
        reads += 1
        return reads === 1
          ? { status: 200, body: page([theirs('t1'), theirs('t2'), projectTask('t3')]) }
          : reread.answer.then((answer) => answer)
      },
      'POST /activities/t2/complete': () => ({ status: 200, body: theirs('t2') }),
    })

    const below = await screen.findByTestId('my-task-t3')
    await dragCard(screen.getByTestId('my-task-t2'), 2)
    await waitFor(() => expect(openReads()).toBe(2))
    // The re-read is out: no skeleton, the same elements.
    expect(screen.queryByTestId('projects-loading')).toBeNull()
    expect(screen.getByTestId('my-task-t3')).toBe(below)

    reread.release({ status: 200, body: page([theirs('t1'), projectTask('t3')]) })
    await waitFor(() => expect(screen.queryByTestId('my-task-t2')).toBeNull())
    expect(screen.getByTestId('my-task-t3')).toBe(below)
    expect(below.isConnected).toBe(true)
    expect(screen.getByTestId('my-task-t1')).not.toBeNull()
  })

  it('a write in the drawer keeps the drawer, and the hours message in it, through the re-read', async () => {
    const reread = deferred()
    let reads = 0
    render_({
      'GET /tasks': (url) => {
        if (url.searchParams.get('status') === 'done') return { status: 200, body: page([]) }
        reads += 1
        return reads === 1 ? { status: 200, body: page([projectTask('t3')]) } : reread.answer.then((answer) => answer)
      },
      'POST /activities/t3/start': () => ({ status: 200, body: projectTask('t3', {}, { status: 'in_progress' }) }),
    })

    const drawer = await openCard('my-task', 't3')
    fireEvent.click(await drawer.findByRole('button', { name: 'Record hours on Task t3' }))
    expect(drawer.getByText('2 h recorded on Task t3.')).toBeTruthy()
    const panel = screen.getByTestId('task-drawer')

    fireEvent.click(drawer.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(openReads()).toBe(2))
    reread.release({ status: 200, body: page([projectTask('t3', {}, { status: 'in_progress' })]) })
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Stop' })).toBeTruthy())
    expect(screen.getByTestId('task-drawer')).toBe(panel)
    expect(within(panel).getByText('2 h recorded on Task t3.')).toBeTruthy()
  })
})
