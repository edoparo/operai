/**
 * @vitest-environment jsdom
 *
 * Starting a meeting from a project task (specs/20261104-meetings A18): in the task's drawer, a holder of
 * `meetings:access` gets "Start a meeting", a link to Meetings' new-meeting page linked to the task's PROJECT and
 * titled after the task; anyone else gets no link.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { projectTask } from '../test-support/fakeApi'
import type { ProjectTask } from '../lib/activitiesApi'
import { newMeetingHref } from '../lib/meetings'
import { strings } from '../strings'

const perms = vi.hoisted(() => ({ list: [] as { resource: string; action: string }[] }))

vi.mock('shell/session', () => ({
  usePermissions: () => ({ epoch: 1, apps: [], roles: [], departments: [], permissions: perms.list }),
  apiFetch: vi.fn(),
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

import TaskDrawer from './TaskDrawer'

afterEach(() => {
  cleanup()
  perms.list = []
})

const noop = () => undefined

const renderDrawer = () =>
  render(
    <TaskDrawer
      task={projectTask('t1', { subject: 'Kick-off & scope' }) as unknown as ProjectTask}
      mode="project"
      currentUserId="u-ada"
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

describe('Start a meeting on a project task (A18)', () => {
  it('links to a new meeting on the task’s project, titled after the task', () => {
    perms.list = [{ resource: 'meetings', action: 'access' }]
    renderDrawer()
    const link = screen.getByRole('link', { name: strings.tasks.row.startMeetingFor('Kick-off & scope') })
    const url = new URL(link.getAttribute('href')!, 'http://suite.test')
    expect(url.pathname).toBe('/meetings/new')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      hostApp: 'projects',
      hostType: 'project',
      hostId: 'p1',
      title: 'Kick-off & scope',
    })
  })

  it('is absent without meetings:access', () => {
    renderDrawer()
    expect(screen.queryByTestId('project-task-t1-meeting')).toBeNull()
  })
})

describe('newMeetingHref', () => {
  it('omits a blank title', () => {
    expect(newMeetingHref('p 1', '  ')).toBe('/meetings/new?hostApp=projects&hostType=project&hostId=p+1')
  })
})
