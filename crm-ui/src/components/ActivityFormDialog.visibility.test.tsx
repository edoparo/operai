/**
 * @vitest-environment jsdom
 *
 * ActivityFormDialog — "Who sees the details" (specs/20261110-activities US-9): the chosen visibility is sent on
 * create, and on edit only when it changed; a hidden description is never sent back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ActivityFormDialog from './ActivityFormDialog'
import type { Activity } from '../lib/types'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

const saved = {
  id: 'a1',
  type: 'note',
  subject: 'Call',
  body: null,
  occurredAt: '2026-11-03T09:30:00.000Z',
  company: { id: 'c1', name: 'Acme' },
  contact: null,
  deal: null,
  author: { id: 'u-ada', name: 'Ada', status: 'active' },
  task: null,
  createdAt: '2026-11-03T09:30:00.000Z',
  updatedAt: '2026-11-03T09:30:00.000Z',
}

const answer = (input: unknown, init?: { method?: string }) => {
  const url = new URL(String(input))
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  if (init?.method === 'POST' || init?.method === 'PATCH') return json(saved)
  if (url.pathname === '/authz/users/directory') return json({ users: [] })
  if (url.pathname === '/activities') return json({ items: [], total: 0, page: 1, pageSize: 100 })
  return json({ items: [], total: 0, page: 1, pageSize: 100 })
}

const sentBody = (method: string) => {
  const call = apiFetch.mock.calls.find(([, init]) => init?.method === method)
  return call ? JSON.parse(String(call[1].body)) : null
}

afterEach(() => {
  cleanup()
  apiFetch.mockReset()
})

const company = { id: 'c1', name: 'Acme' } as never
const activity = { ...saved, detailsVisibility: 'everyone' } as Activity

describe('ActivityFormDialog — details visibility', () => {
  it('sends the chosen visibility on create and the always-visible hint is shown', async () => {
    apiFetch.mockImplementation(answer)
    render(<ActivityFormDialog company={company} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText(/always visible/)).not.toBeNull()
    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: 'Call' } })
    fireEvent.click(screen.getByLabelText('Sales team'))
    fireEvent.click(screen.getByRole('button', { name: 'Log activity' }))
    await waitFor(() => expect(sentBody('POST')).not.toBeNull())
    expect(sentBody('POST').detailsVisibility).toBe('sales_team')
  })

  it('omits the visibility on create when left at everyone', async () => {
    apiFetch.mockImplementation(answer)
    render(<ActivityFormDialog company={company} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: 'Call' } })
    fireEvent.click(screen.getByRole('button', { name: 'Log activity' }))
    await waitFor(() => expect(sentBody('POST')).not.toBeNull())
    expect(sentBody('POST')).not.toHaveProperty('detailsVisibility')
  })

  it('on edit sends the visibility only when changed', async () => {
    apiFetch.mockImplementation(answer)
    render(<ActivityFormDialog activity={activity} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByLabelText('Only me'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sentBody('PATCH')).not.toBeNull())
    expect(sentBody('PATCH').detailsVisibility).toBe('author')
  })

  it('on edit does not send the visibility when unchanged', async () => {
    apiFetch.mockImplementation(answer)
    render(<ActivityFormDialog activity={activity} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sentBody('PATCH')).not.toBeNull())
    expect(sentBody('PATCH')).not.toHaveProperty('detailsVisibility')
  })

  it('never sends a body derived from hidden details', async () => {
    apiFetch.mockImplementation(answer)
    render(<ActivityFormDialog activity={{ ...activity, detailsHidden: true }} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sentBody('PATCH')).not.toBeNull())
    expect(sentBody('PATCH')).not.toHaveProperty('body')
  })
})
