/**
 * @vitest-environment jsdom
 *
 * QE additions (specs/20261110-activities design.md § Accessibility, § S2): focus rules of the task dialog that the
 * dev tests do not pin.
 *
 *  - "Dialogs: ... Focus on Title" when the dialog opens.
 *  - "Participant chips: ... removal returns focus to the picker input."
 *
 * The second was QE defect D1 (the removed chip's button took focus with it and focus fell to <body>);
 * fixed through `PersonChips focusAfterRemove`. The same rule is pinned for crm-ui in ParticipantsField.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { fakeApi, personRef, projectDetail, projectTask } from '../test-support/fakeApi'
import type { ProjectTask } from '../lib/activitiesApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getProjectsApiBaseUrl: () => 'http://projects-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  useSession: () => ({ data: { user: { id: 'u-ada', name: 'Ada Lovelace' } } }),
}))

import TaskFormDialog from './TaskFormDialog'

const renderDialog = (task?: ProjectTask) => {
  apiFetch.mockImplementation(
    fakeApi({
      'GET /tasks': () => ({ status: 200, body: { items: [], total: 0, page: 1, pageSize: 100 } }),
      'GET /authz/users/directory': () => ({ status: 200, body: { users: [] } }),
    }),
  )
  render(
    <TaskFormDialog
      project={projectDetail({ team: [] })}
      task={task}
      currentUserId="u-ada"
      onSaved={vi.fn()}
      onCancel={vi.fn()}
      onHostReadOnly={vi.fn()}
    />,
  )
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

describe('focus in the task dialog (design.md § Accessibility)', () => {
  it('opens with focus on the Title field', () => {
    renderDialog()
    expect(document.activeElement).toBe(screen.getByLabelText('Title', { exact: false }))
  })

  it('after a participant chip is removed, focus returns to the participant picker input', () => {
    renderDialog(projectTask('t1', { participants: [personRef('u-dan', 'Dan Dev')] }) as unknown as ProjectTask)
    const remove = screen.getByRole('button', { name: 'Remove Dan Dev' })
    remove.focus()
    fireEvent.click(remove)
    expect(document.activeElement).toBe(screen.getByTestId('task-form-participants-picker-input'))
  })
})
