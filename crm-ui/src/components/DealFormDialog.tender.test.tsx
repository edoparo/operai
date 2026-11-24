/**
 * @vitest-environment jsdom
 *
 * Tender deals (2026-11-24, owner): the deal form marks a deal as a public tender and, only then, takes its submission
 * deadline. A create sends `kind` and the deadline for a tender and nothing for a standard deal; an edit sends only what
 * changed; unticking forgets the deadline; the server's `deadline_only_on_tenders` lands on the deadline field; an edit
 * of a deal from a server that predates the kind neither shows nor sends it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import DealFormDialog from './DealFormDialog'
import { ScopeContext } from '../hooks/scopeContext'
import { ADA, fakeApi, problemAnswer } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'
import { strings } from '../strings'
import type { Deal } from '../lib/types'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const t = strings.deals.form
const DEAL = {
  id: 'd1',
  title: 'Chips JU pilot line',
  company: { id: 'c1', name: 'Chips Joint Undertaking' },
  entity: 'welld_ch',
  currency: 'CHF',
  amountCents: null,
  owner: ADA,
  version: 4,
  expectedCloseDate: null,
  source: null,
  sourceDetail: null,
  kind: 'standard',
  submissionDeadline: null,
} as unknown as Deal

const withScope = (node: ReactElement) => (
  <ScopeContext.Provider value={{ deal: ['welld_ch'], canErase: false }}>{node}</ScopeContext.Provider>
)
const sent = (method: 'POST' | 'PATCH') => {
  const call = apiFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === method)
  return call ? (JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>) : null
}
const tenderBox = () => screen.getByRole('checkbox', { name: new RegExp(t.tender) }) as HTMLInputElement
const deadline = () => screen.getByTestId('crm-deal-form-deadline').querySelector('input')!
const submit = () => userEvent.click(screen.getByTestId('crm-deal-form-submit'))

const create = (routes: Record<string, FakeHandler> = {}) => {
  apiFetch.mockImplementation(
    fakeApi({ 'POST /deals': () => ({ status: 201, body: { ...DEAL, kind: 'tender' } }), ...routes }),
  )
  const onSaved = vi.fn()
  render(
    withScope(
      <DealFormDialog
        company={{ id: 'c1', name: 'Chips Joint Undertaking', entity: 'welld_ch' }}
        onSaved={onSaved}
        onCancel={() => undefined}
        onStale={() => undefined}
      />,
    ),
  )
  return onSaved
}
const fill = async () => {
  await userEvent.type(screen.getByTestId('crm-deal-form-title').querySelector('input')!, DEAL.title)
  fireEvent.change(screen.getByTestId('crm-deal-form-currency').querySelector('select')!, { target: { value: 'CHF' } })
}
const edit = (deal: Deal) => {
  apiFetch.mockImplementation(fakeApi({ 'PATCH /deals/d1': () => ({ status: 200, body: { ...deal, version: 5 } }) }))
  const onSaved = vi.fn()
  render(
    withScope(<DealFormDialog deal={deal} onSaved={onSaved} onCancel={() => undefined} onStale={() => undefined} />),
  )
  return onSaved
}

describe('a tender, on create', () => {
  it('asks for the deadline only once the deal is marked a tender, and sends both', async () => {
    const onSaved = create()
    await fill()
    expect(tenderBox().checked).toBe(false)
    expect(screen.queryByTestId('crm-deal-form-deadline')).toBeNull()
    await userEvent.click(tenderBox())
    fireEvent.change(deadline(), { target: { value: '2026-12-15' } })
    await submit()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(sent('POST')).toMatchObject({ kind: 'tender', submissionDeadline: '2026-12-15' })
  })

  it('a standard deal sends neither the kind nor a deadline', async () => {
    const onSaved = create()
    await fill()
    await submit()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(sent('POST')).not.toHaveProperty('kind')
    expect(sent('POST')).not.toHaveProperty('submissionDeadline')
  })

  it('unticking the tender forgets the deadline', async () => {
    const onSaved = create()
    await fill()
    await userEvent.click(tenderBox())
    fireEvent.change(deadline(), { target: { value: '2026-12-15' } })
    await userEvent.click(tenderBox())
    expect(screen.queryByTestId('crm-deal-form-deadline')).toBeNull()
    await userEvent.click(tenderBox())
    expect(deadline().value).toBe('')
    await submit()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(sent('POST')).toMatchObject({ kind: 'tender' })
    expect(sent('POST')).not.toHaveProperty('submissionDeadline')
  })

  it('puts the server’s deadline_only_on_tenders on the deadline field', async () => {
    create({
      'POST /deals': () => problemAnswer(422, 'deadline_only_on_tenders', { field: 'submissionDeadline' }),
    })
    await fill()
    await userEvent.click(tenderBox())
    fireEvent.change(deadline(), { target: { value: '2026-12-15' } })
    await submit()
    await waitFor(() =>
      expect(screen.getByTestId('crm-deal-form-deadline').textContent).toContain('detail of deadline_only_on_tenders'),
    )
    expect(deadline().getAttribute('aria-invalid')).toBe('true')
  })
})

describe('a tender, on edit', () => {
  it('sends only what changed: the kind and the deadline when a deal becomes a tender', async () => {
    const onSaved = edit(DEAL)
    await userEvent.click(tenderBox())
    fireEvent.change(deadline(), { target: { value: '2027-01-10' } })
    await submit()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(sent('PATCH')).toMatchObject({ kind: 'tender', submissionDeadline: '2027-01-10' })
  })

  it('an unchanged tender sends neither; a changed deadline alone sends the deadline alone', async () => {
    const tender = { ...DEAL, kind: 'tender', submissionDeadline: '2026-12-15' } as Deal
    const onSaved = edit(tender)
    expect(tenderBox().checked).toBe(true)
    expect(deadline().value).toBe('2026-12-15')
    await submit()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(sent('PATCH')).not.toHaveProperty('kind')
    expect(sent('PATCH')).not.toHaveProperty('submissionDeadline')
    cleanup()
    apiFetch.mockReset()
    const again = edit(tender)
    fireEvent.change(deadline(), { target: { value: '2026-12-20' } })
    await submit()
    await waitFor(() => expect(again).toHaveBeenCalled())
    expect(sent('PATCH')).toEqual(expect.objectContaining({ submissionDeadline: '2026-12-20' }))
    expect(sent('PATCH')).not.toHaveProperty('kind')
  })

  it('making a tender standard again sends the kind alone (the server clears the deadline)', async () => {
    const onSaved = edit({ ...DEAL, kind: 'tender', submissionDeadline: '2026-12-15' } as Deal)
    await userEvent.click(tenderBox())
    expect(screen.queryByTestId('crm-deal-form-deadline')).toBeNull()
    await submit()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(sent('PATCH')).toMatchObject({ kind: 'standard' })
    expect(sent('PATCH')).not.toHaveProperty('submissionDeadline')
  })

  it('is absent when the server predates the kind', async () => {
    const old = { ...DEAL } as Deal & { kind?: string; submissionDeadline?: string | null }
    delete old.kind
    delete old.submissionDeadline
    const onSaved = edit(old as Deal)
    expect(screen.queryByTestId('crm-deal-form-tender')).toBeNull()
    await submit()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(sent('PATCH')).not.toHaveProperty('kind')
    expect(sent('PATCH')).not.toHaveProperty('submissionDeadline')
  })
})
