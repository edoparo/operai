/**
 * @vitest-environment jsdom
 *
 * Company kind (2026-11-24, owner): a company is a client (default) or a funding body, the body that issues public
 * tenders. A create sends `kind` only for a funding body, so a client create reads as before; an edit sends it only
 * when it changed; an edit of a company from a server that predates the kind neither shows nor sends it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CompanyFormDialog from './CompanyFormDialog'
import { ADA, fakeApi } from '../test-support/fakeApi'
import type { Company } from '../lib/types'

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

const COMPANY = {
  id: 'c1',
  name: 'Chips Joint Undertaking',
  status: 'prospect',
  statusLapsed: false,
  entity: 'welld_ch',
  industry: null,
  city: null,
  country: null,
  owner: ADA,
  archived: false,
  contactCount: 0,
  openDealCount: 0,
  source: null,
  sourceDetail: null,
  kind: 'client',
  updatedAt: '2026-11-24T10:00:00.000Z',
  legalName: null,
  street: null,
  postalCode: null,
  website: null,
  notes: null,
  version: 3,
  createdAt: '2026-11-24T10:00:00.000Z',
} as unknown as Company

const sent = (method: 'POST' | 'PATCH') => {
  const call = apiFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === method)
  return call ? (JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>) : null
}
const submit = () => userEvent.click(screen.getByTestId('crm-company-form-submit'))
const radio = (name: RegExp) => screen.getByRole('radio', { name }) as HTMLInputElement

const create = () => {
  apiFetch.mockImplementation(fakeApi({ 'POST /companies': () => ({ status: 201, body: COMPANY }) }))
  const onSaved = vi.fn()
  render(<CompanyFormDialog onSaved={onSaved} onCancel={() => undefined} onStale={() => undefined} />)
  return onSaved
}
const fill = () => {
  fireEvent.change(screen.getByTestId('crm-company-form-name').querySelector('input')!, {
    target: { value: COMPANY.name },
  })
  fireEvent.change(screen.getByTestId('crm-company-form-status').querySelector('select')!, {
    target: { value: 'prospect' },
  })
  fireEvent.change(screen.getByTestId('crm-company-form-entity').querySelector('select')!, {
    target: { value: 'welld_ch' },
  })
}
const edit = (company: Company) => {
  apiFetch.mockImplementation(
    fakeApi({ 'PATCH /companies/c1': () => ({ status: 200, body: { ...company, version: 4 } }) }),
  )
  const onSaved = vi.fn()
  render(<CompanyFormDialog company={company} onSaved={onSaved} onCancel={() => undefined} onStale={() => undefined} />)
  return onSaved
}

describe('CompanyFormDialog — company kind', () => {
  it('a create offers the type, Client by default, with its hint', () => {
    create()
    const group = screen.getByRole('radiogroup', { name: 'Type' })
    expect(group.textContent).toContain('A funding body issues public tenders; it is never invoiced.')
    expect(radio(/^Client$/).checked).toBe(true)
    expect(radio(/^Funding body$/).checked).toBe(false)
  })

  it('a client create sends no kind', async () => {
    const onSaved = create()
    fill()
    await submit()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(sent('POST')).not.toHaveProperty('kind')
  })

  it('a funding body create sends kind funding_body', async () => {
    const onSaved = create()
    fill()
    await userEvent.click(radio(/^Funding body$/))
    await submit()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(sent('POST')).toMatchObject({ kind: 'funding_body' })
  })

  it('an edit shows the server’s kind and sends it only when it changed', async () => {
    const onSaved = edit({ ...COMPANY, kind: 'funding_body' } as Company)
    expect(radio(/^Funding body$/).checked).toBe(true)
    await submit()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(sent('PATCH')).not.toHaveProperty('kind')
  })

  it('an edit that makes a client a funding body sends the kind', async () => {
    const onSaved = edit(COMPANY)
    await userEvent.click(radio(/^Funding body$/))
    await submit()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(sent('PATCH')).toMatchObject({ kind: 'funding_body' })
  })

  it('an edit of a company from a server without the kind neither shows nor sends it', async () => {
    const older = { ...COMPANY } as Partial<Company>
    delete older.kind
    const onSaved = edit(older as Company)
    expect(screen.queryByTestId('crm-company-form-kind')).toBeNull()
    await submit()
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(sent('PATCH')).not.toHaveProperty('kind')
  })
})
