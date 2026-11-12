/**
 * @vitest-environment jsdom
 *
 * The agenda outside its card: "Follow the agenda" when generating a summary (offered only when the
 * meeting has an agenda, never with "By agenda"), and the agenda inside the recorder widget.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agenda } from '../../lib/types'
import { en } from '../../strings'
import { fakeApi, readyMeeting, template } from '../../test-support/fakeApi'
import type { FakeHandler } from '../../test-support/fakeApi'
import DockAgenda from '../../dock/DockAgenda'
import { GenerateSummaryDialog } from '../summaries/GenerateSummaryDialog'

const session = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('shell/session', () => ({
  apiFetch: session.apiFetch,
  getMeetingsApiBaseUrl: () => 'http://meetings-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
}))

beforeEach(() => {
  session.apiFetch.mockReset()
})
afterEach(cleanup)

const t = en.agenda

function serve(routes: Record<string, FakeHandler>) {
  const api = fakeApi(routes)
  session.apiFetch.mockImplementation(api)
  return api
}

const MINUTES = template({ id: 'builtin:minutes', source: 'builtin', name: 'Meeting minutes', recommended: false })
const BY_AGENDA = template({
  id: 'builtin:agenda',
  source: 'builtin',
  name: 'By agenda',
  recommended: true,
  sections: [
    { heading: 'Budget', instruction: '' },
    { heading: 'Other topics', instruction: '' },
  ],
})

describe('Follow the agenda', () => {
  it('is offered for another template when the meeting has an agenda, and sent only when ticked', async () => {
    const api = serve({
      'GET /templates': () => ({ status: 200, body: { items: [BY_AGENDA, MINUTES] } }),
      'POST /meetings/:id/summaries': () => ({ status: 202, body: { id: 's1' } }),
    })
    render(<GenerateSummaryDialog meeting={readyMeeting()} hostInfo={null} onClose={() => {}} onGenerated={() => {}} />)
    const dialog = await screen.findByRole('dialog')
    // "By agenda" comes first and needs no option
    await within(dialog).findByRole('combobox')
    expect(within(dialog).queryByRole('checkbox', { name: t.summary.followAgenda })).toBeNull()

    await userEvent.selectOptions(within(dialog).getByRole('combobox'), 'builtin:minutes')
    const follow = within(dialog).getByRole('checkbox', { name: t.summary.followAgenda })
    expect((follow as HTMLInputElement).checked).toBe(false)
    await userEvent.click(follow)
    await userEvent.click(within(dialog).getByRole('button', { name: en.summaries.dialog.submit }))

    await waitFor(() => expect(api.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const [, init] = api.mock.calls.find(([, request]) => request?.method === 'POST')!
    expect(JSON.parse(String(init?.body))).toMatchObject({ templateId: 'builtin:minutes', followAgenda: true })
  })

  it('is not offered when the meeting has no agenda', async () => {
    serve({ 'GET /templates': () => ({ status: 200, body: { items: [MINUTES] } }) })
    render(<GenerateSummaryDialog meeting={readyMeeting()} hostInfo={null} onClose={() => {}} onGenerated={() => {}} />)
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('combobox')
    expect(within(dialog).queryByRole('checkbox', { name: t.summary.followAgenda })).toBeNull()
  })
})

describe('the recorder widget', () => {
  const agenda: Agenda = {
    version: 1,
    points: [
      { id: 'p1', title: 'Budget', note: 'Q3', covered: false },
      { id: 'p2', title: 'Hiring', note: null, covered: true },
    ],
    can: { edit: true },
  }

  it('shows how much is covered, opens the list and ticks a point', async () => {
    const api = serve({
      'GET /meetings/:id/agenda': () => ({ status: 200, body: agenda }),
      'PUT /meetings/:id/agenda/points/:pointId/covered': () => ({
        status: 200,
        body: { ...agenda, points: agenda.points.map((p) => ({ ...p, covered: true })) },
      }),
    })
    render(<DockAgenda meetingId="m1" />)
    const toggle = await screen.findByRole('button', { name: new RegExp(t.dock.show) })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(toggle.textContent).toContain(t.dock.progress(1, 2))
    await userEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await userEvent.click(screen.getByRole('checkbox', { name: t.card.tickLabel(1, 'Budget') }))
    await waitFor(() => expect(toggle.textContent).toContain(t.dock.progress(2, 2)))
    expect(api.mock.calls.some(([url]) => String(url).endsWith('/agenda/points/p1/covered'))).toBe(true)
  })

  it('shows nothing for an empty agenda, or one that cannot be loaded', async () => {
    serve({ 'GET /meetings/:id/agenda': () => ({ status: 200, body: { ...agenda, points: [] } }) })
    const { container } = render(<DockAgenda meetingId="m1" />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(container.textContent).toBe('')
    cleanup()

    serve({ 'GET /meetings/:id/agenda': () => ({ status: 503, body: { status: 503 } }) })
    const failed = render(<DockAgenda meetingId="m1" />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(failed.container.textContent).toBe('')
  })
})
