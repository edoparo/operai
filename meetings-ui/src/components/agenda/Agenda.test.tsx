/**
 * @vitest-environment jsdom
 *
 * The meeting agenda: the card (points, covered marks, the progress line, the empty states), ticking
 * a point without a reload, the Edit agenda dialog (add, validate, save with the version it was opened
 * at, a stale save that asks to reload), and a reader who sees the marks but cannot change them.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agenda } from '../../lib/types'
import { en } from '../../strings'
import { fakeApi, problem } from '../../test-support/fakeApi'
import type { FakeHandler } from '../../test-support/fakeApi'
import AgendaCard from './AgendaCard'

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

const agenda = (over: Partial<Agenda> = {}): Agenda => ({
  version: 2,
  points: [
    { id: 'p1', title: 'Budget', note: 'Agree the Q3 numbers', covered: true },
    { id: 'p2', title: 'Hiring', note: null, covered: false },
  ],
  can: { edit: true },
  ...over,
})

function serve(routes: Record<string, FakeHandler>) {
  const api = fakeApi(routes)
  session.apiFetch.mockImplementation(api)
  return api
}

const bodyOf = (init: RequestInit | undefined) => JSON.parse(String(init?.body)) as Record<string, unknown>

describe('the card', () => {
  it('lists the points in order with their notes and how many are covered', async () => {
    serve({ 'GET /meetings/:id/agenda': () => ({ status: 200, body: agenda() }) })
    render(<AgendaCard meetingId="m1" live={false} />)
    const list = await screen.findByRole('list', { name: t.card.listLabel })
    const items = within(list).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['BudgetAgree the Q3 numbers', 'Hiring'])
    expect(screen.getByText(t.card.progress(1, 2))).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: t.card.tickLabel(1, 'Budget') }) as HTMLInputElement).checked).toBe(
      true,
    )
    expect((screen.getByRole('checkbox', { name: t.card.tickLabel(2, 'Hiring') }) as HTMLInputElement).checked).toBe(
      false,
    )
  })

  it('ticks a point with one request and no precondition, and shows what the server answered', async () => {
    const api = serve({
      'GET /meetings/:id/agenda': () => ({ status: 200, body: agenda() }),
      'PUT /meetings/:id/agenda/points/:pointId/covered': (_url, _init, params) => ({
        status: 200,
        body: agenda({
          points: agenda().points.map((p) => (p.id === params['pointId'] ? { ...p, covered: true } : p)),
        }),
      }),
    })
    render(<AgendaCard meetingId="m1" live={false} />)
    await userEvent.click(await screen.findByRole('checkbox', { name: t.card.tickLabel(2, 'Hiring') }))
    await waitFor(() => expect(screen.getByText(t.card.progress(2, 2))).toBeTruthy())
    const [, init] = api.mock.calls.find(([url]) => String(url).endsWith('/agenda/points/p2/covered'))!
    expect(bodyOf(init)).toEqual({ covered: true })
    expect((init?.headers as Record<string, string>)['If-Match']).toBeUndefined()
  })

  it('a point someone removed meanwhile: the message, and the agenda read again', async () => {
    let reads = 0
    serve({
      'GET /meetings/:id/agenda': () => {
        reads += 1
        return { status: 200, body: reads === 1 ? agenda() : agenda({ points: [agenda().points[0]!] }) }
      },
      'PUT /meetings/:id/agenda/points/:pointId/covered': () => ({
        status: 404,
        body: problem(404, 'agenda_point_not_found'),
      }),
    })
    render(<AgendaCard meetingId="m1" live={false} />)
    await userEvent.click(await screen.findByRole('checkbox', { name: t.card.tickLabel(2, 'Hiring') }))
    expect((await screen.findByRole('alert')).textContent).toBe(en.common.errors.agenda_point_not_found)
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: t.card.tickLabel(2, 'Hiring') })).toBeNull())
  })

  it('a reader sees the marks as text, with no ticks and no Edit', async () => {
    serve({ 'GET /meetings/:id/agenda': () => ({ status: 200, body: agenda({ can: { edit: false } }) }) })
    render(<AgendaCard meetingId="m1" live={false} />)
    const list = await screen.findByRole('list', { name: t.card.listLabel })
    expect(within(list).queryAllByRole('checkbox')).toHaveLength(0)
    expect(within(list).getAllByRole('listitem')[0]!.textContent).toContain(`(${t.card.covered})`)
    expect(within(list).getAllByRole('listitem')[1]!.textContent).toContain(`(${t.card.notCovered})`)
    expect(screen.queryByRole('button', { name: t.card.edit })).toBeNull()
  })

  it('an empty agenda invites an editor to add one, and only says so to a reader', async () => {
    serve({ 'GET /meetings/:id/agenda': () => ({ status: 200, body: agenda({ points: [] }) }) })
    render(<AgendaCard meetingId="m1" live={false} />)
    expect(await screen.findByText(t.card.emptyEditor)).toBeTruthy()
    expect(screen.getByRole('button', { name: t.card.add })).toBeTruthy()
    cleanup()

    serve({ 'GET /meetings/:id/agenda': () => ({ status: 200, body: agenda({ points: [], can: { edit: false } }) }) })
    render(<AgendaCard meetingId="m1" live={false} />)
    expect(await screen.findByText(t.card.emptyReader)).toBeTruthy()
    expect(screen.queryByRole('button', { name: t.card.add })).toBeNull()
  })
})

describe('Edit agenda', () => {
  it('adds a point, refuses an empty title, and saves the whole list with the version it was opened at', async () => {
    const api = serve({
      'GET /meetings/:id/agenda': () => ({ status: 200, body: agenda() }),
      'PUT /meetings/:id/agenda': (_url, init) => ({
        status: 200,
        body: agenda({
          version: 3,
          points: [...agenda().points, { id: 'p3', title: 'Next steps', note: null, covered: false }],
        }),
        headers: { ETag: '"3"', 'If-Match-Seen': String((init?.headers as Record<string, string>)['If-Match']) },
      }),
    })
    render(<AgendaCard meetingId="m1" live={false} />)
    await userEvent.click(await screen.findByRole('button', { name: t.card.edit }))
    const dialog = screen.getByRole('dialog', { name: t.dialog.title })
    await userEvent.click(within(dialog).getByRole('button', { name: t.dialog.sections.add }))
    await userEvent.click(within(dialog).getByRole('button', { name: t.dialog.save }))
    expect(within(dialog).getByText(t.dialog.errors.titleRequired)).toBeTruthy()

    await userEvent.type(
      within(dialog).getByRole('textbox', { name: t.dialog.sections.headingLabel(3) }),
      '  Next steps ',
    )
    await userEvent.click(within(dialog).getByRole('button', { name: t.dialog.save }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText(t.card.saved)).toBeTruthy()
    expect(screen.getByText('Next steps')).toBeTruthy()
    const [, init] = api.mock.calls.find(
      ([url, request]) => String(url).endsWith('/meetings/m1/agenda') && request?.method === 'PUT',
    )!
    expect((init?.headers as Record<string, string>)['If-Match']).toBe('"2"')
    expect(bodyOf(init)).toEqual({
      points: [
        { id: 'p1', title: 'Budget', note: 'Agree the Q3 numbers' },
        { id: 'p2', title: 'Hiring', note: null },
        { title: 'Next steps', note: null },
      ],
    })
  })

  it('a list someone changed meanwhile is refused: the dialog asks to reload and overwrites nothing', async () => {
    serve({
      'GET /meetings/:id/agenda': () => ({ status: 200, body: agenda() }),
      'PUT /meetings/:id/agenda': () => ({
        status: 409,
        body: problem(409, 'version_conflict', { currentVersion: 3 }),
      }),
    })
    render(<AgendaCard meetingId="m1" live={false} />)
    await userEvent.click(await screen.findByRole('button', { name: t.card.edit }))
    const dialog = screen.getByRole('dialog', { name: t.dialog.title })
    await userEvent.click(within(dialog).getByRole('button', { name: t.dialog.save }))
    expect(await within(dialog).findByText(en.common.staleWrite.title)).toBeTruthy()
    expect(screen.getByRole('dialog', { name: t.dialog.title })).toBeTruthy()
  })
})
