/**
 * @vitest-environment jsdom
 *
 * Personal notes: loaded from the caller's own notes, saved by themselves after a pause in typing (and on
 * leaving the field) with the version last seen, a save from a stale tab that stops and asks to reload,
 * and a failed save that can be retried.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../../strings'
import { fakeApi, problem } from '../../test-support/fakeApi'
import type { FakeHandler } from '../../test-support/fakeApi'
import NotesCard, { NOTES_DEBOUNCE_MS } from './NotesCard'
import { stubLayoutForRichText } from '@operai/ui/rich-text'

stubLayoutForRichText()

const session = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('shell/session', () => ({
  apiFetch: session.apiFetch,
  getMeetingsApiBaseUrl: () => 'http://meetings-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
}))

beforeEach(() => {
  session.apiFetch.mockReset()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const t = en.notes

function serve(routes: Record<string, FakeHandler>) {
  const api = fakeApi(routes)
  session.apiFetch.mockImplementation(api)
  return api
}
const puts = (api: ReturnType<typeof fakeApi>) => api.mock.calls.filter(([, init]) => init?.method === 'PUT')
const sent = (call: readonly unknown[]) => ({
  body: JSON.parse(String((call[1] as RequestInit | undefined)?.body)) as { content: unknown },
  ifMatch: ((call[1] as RequestInit | undefined)?.headers as Record<string, string>)["If-Match"],
})

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const editor = () => screen.findByRole('textbox', { name: t.label })
/** A real edit through the editor: the toolbar turns the paragraph into a bulleted list. */
const makeList = () => userEvent.click(screen.getByRole('button', { name: t.toolbar.bulletList }))

describe('NotesCard', () => {
  it('shows the caller own notes, says they are private, and saves a moment after an edit', async () => {
    let version = 3
    const api = serve({
      'GET /meetings/:id/notes': () => ({ status: 200, body: { content: doc('Earlier'), version, updatedAt: '2026-11-12T10:00:00Z' } }),
      'PUT /meetings/:id/notes': (_url, init) => {
        version += 1
        return { status: 200, body: { content: JSON.parse(String(init?.body)).content, version, updatedAt: '2026-11-12T10:01:00Z' } }
      },
    })
    render(<NotesCard meetingId="m1" />)
    expect((await editor()).textContent).toBe('Earlier')
    expect(screen.getByText(t.hint)).toBeTruthy()
    expect((await editor()).getAttribute('aria-describedby')).toBeTruthy()

    vi.useFakeTimers({ shouldAdvanceTime: true })
    await makeList()
    expect(screen.getByRole('status').textContent).toBe(t.status.unsaved)
    expect(puts(api)).toHaveLength(0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTES_DEBOUNCE_MS)
    })
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(t.status.saved))
    expect(puts(api)).toHaveLength(1)
    const first = sent(puts(api)[0]!)
    expect(first.ifMatch).toBe('"3"')
    expect((first.body as unknown as { content: { content: { type: string }[] } }).content.content[0]!.type).toBe('bulletList')

    // the next save carries the version the last one returned
    await makeList()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(NOTES_DEBOUNCE_MS)
    })
    await waitFor(() => expect(puts(api)).toHaveLength(2))
    expect(sent(puts(api)[1]!).ifMatch).toBe('"4"')
  })

  it('saves at once when the editor is left, and nothing when nothing changed', async () => {
    const api = serve({
      'GET /meetings/:id/notes': () => ({ status: 200, body: { content: null, version: 0, updatedAt: null } }),
      'PUT /meetings/:id/notes': () => ({ status: 200, body: { content: doc(''), version: 1, updatedAt: null } }),
    })
    render(<NotesCard meetingId="m1" />)
    const box = await editor()
    fireEvent.focus(box)
    fireEvent.blur(box)
    expect(puts(api)).toHaveLength(0)
    await makeList()
    fireEvent.blur(box)
    await waitFor(() => expect(puts(api)).toHaveLength(1))
    expect(sent(puts(api)[0]!).ifMatch).toBe('"0"')
  })

  it('a save from a stale tab stops saving and asks to reload; reloading shows what the server holds', async () => {
    let reads = 0
    serve({
      'GET /meetings/:id/notes': () => {
        reads += 1
        return { status: 200, body: reads === 1 ? { content: doc('Old'), version: 1, updatedAt: null } : { content: doc('From the other tab'), version: 2, updatedAt: null } }
      },
      'PUT /meetings/:id/notes': () => ({ status: 409, body: problem(409, 'version_conflict', { currentVersion: 2 }) }),
    })
    render(<NotesCard meetingId="m1" />)
    const box = await editor()
    await makeList()
    fireEvent.blur(box)
    expect(await screen.findByText(t.conflict.title)).toBeTruthy()
    expect(box.getAttribute('contenteditable')).toBe('false')

    await userEvent.click(screen.getByRole('button', { name: t.reload }))
    await waitFor(async () => expect((await editor()).textContent).toBe('From the other tab'))
    expect(screen.queryByText(t.conflict.title)).toBeNull()
  })

  it('a failed save says so and can be saved again', async () => {
    let fail = true
    const api = serve({
      'GET /meetings/:id/notes': () => ({ status: 200, body: { content: doc('Kept'), version: 1, updatedAt: null } }),
      'PUT /meetings/:id/notes': () =>
        fail ? { status: 503, body: problem(503) } : { status: 200, body: { content: doc('Kept'), version: 2, updatedAt: null } },
    })
    render(<NotesCard meetingId="m1" />)
    const box = await editor()
    await makeList()
    fireEvent.blur(box)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(t.status.failed))
    fail = false
    await userEvent.click(screen.getByRole('button', { name: t.retry }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(t.status.saved))
    expect(puts(api)).toHaveLength(2)
  })
})
