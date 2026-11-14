/**
 * @vitest-environment jsdom
 *
 * QE (specs/20261110-activities pass 2026-11-11): the converse of AC-7.5. activities-api's `GET /tasks?kind=all` also
 * answers `unavailable: ["projects"]` with only the pre-sales rows when the PROJECTS host fails (its own
 * tasks.test.ts pins that, since T9 and again for the label call in 89278f6f). The page only reads
 * `unavailable.includes('crm')`, so the list is silently short. design.md S4 and the spec say nothing
 * about this case: this is a recorded gap, not an AC. `it.fails` documents the current behaviour and turns
 * red ("expected to fail") the day a warning is added; then flip it to a plain `it`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import ProjectsShell from '../components/ProjectsShell'
import { createAppRouter } from '../router'
import { fakeApi, projectTask, scope } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada', name: 'Ada Lovelace' } } }),
}))

const page = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  ...extra,
})

/** A pre-sales task as `GET /tasks?kind=all` returns it: a CRM company, no project. */
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

const renderPage = async (routes: Record<string, FakeHandler>) => {
  apiFetch.mockImplementation(fakeApi({ 'GET /scope': () => ({ status: 200, body: scope() }), ...routes }))
  window.history.pushState(null, '', '/tasks')
  render(<RouterProvider router={createAppRouter(undefined, ProjectsShell)} />)
  await screen.findByRole('heading', { level: 2, name: 'My tasks' })
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

describe('when the PROJECTS host cannot be reached (gap G1, not an AC)', () => {
  it.fails('warns that project tasks could not be loaded instead of showing a silently short list', async () => {
    await renderPage({
      'GET /tasks': () => ({ status: 200, body: page([preSalesTask('c1')], { unavailable: ['projects'] }) }),
    })
    expect(await screen.findByTestId('my-task-c1')).toBeTruthy()
    // Some warning must be on the page; today there is none (the banner is keyed on 'crm' only).
    expect(screen.queryByTestId('my-tasks-unavailable')).not.toBeNull()
  })

  it.fails('an empty list with projects unavailable does not claim "Nothing on your list" without a warning', async () => {
    await renderPage({ 'GET /tasks': () => ({ status: 200, body: page([], { unavailable: ['projects'] }) }) })
    await screen.findByText('Nothing on your list')
    expect(screen.queryByTestId('my-tasks-unavailable')).not.toBeNull()
  })
})
