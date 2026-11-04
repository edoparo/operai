/**
 * @vitest-environment jsdom
 *
 * CompaniesPage (AC-1.1–1.4): states, filters reaching the query string,
 * pagination, and the New company dialog — including the 409
 * `company_name_taken` link to the existing company. Rendered through the
 * app's real router with a bare root, against a fake crm-api.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import { createAppRouter } from '../router'
import { companySummary, fakeApi, page } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

const renderAt = async (routes: Record<string, FakeHandler>, path = '/companies') => {
  apiFetch.mockImplementation(fakeApi(routes))
  window.history.pushState(null, '', path)
  render(<RouterProvider router={createAppRouter()} />)
  await screen.findByRole('heading', { level: 2, name: 'Companies' })
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

const companiesUrls = () =>
  apiFetch.mock.calls.map(([input]) => new URL(String(input))).filter((url) => url.pathname === '/companies')

describe('CompaniesPage', () => {
  it('lists companies with their status, owner and counts', async () => {
    await renderAt({ 'GET /companies': () => ({ status: 200, body: page([companySummary()]) }) })
    const table = await screen.findByTestId('crm-companies-table')
    const row = within(table).getByRole('rowheader', { name: /Acme SA/ }).closest('tr')!
    expect(row.textContent).toContain('Customer')
    expect(row.textContent).toContain('wellD CH')
    expect(row.textContent).toContain('Ada Lovelace (You)')
    expect(row.textContent).toContain('Lugano, CH')
    expect(within(row).getByRole('link', { name: 'Acme SA' }).getAttribute('href')).toBe('/companies/c1')
    expect(screen.getByTestId('crm-companies-pagination-status').textContent).toBe('Page 1 of 1 — showing 1–1 of 1')
  })

  it('asks for active companies sorted by the server, 25 per page', async () => {
    await renderAt({ 'GET /companies': () => ({ status: 200, body: page([]) }) })
    await screen.findByText('No companies yet')
    const url = companiesUrls()[0]!
    expect(url.searchParams.get('archived')).toBe('false')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('pageSize')).toBe('25')
  })

  it('a search with no match shows the filtered empty state, and the query reaches the API', async () => {
    await renderAt({ 'GET /companies': () => ({ status: 200, body: page([]) }) })
    await screen.findByText('No companies yet')
    fireEvent.change(screen.getByLabelText(/Search/), { target: { value: 'zzz' } })
    fireEvent.click(screen.getByTestId('crm-companies-archived'))
    expect(await screen.findByText('No companies match these filters')).not.toBeNull()
    const last = companiesUrls().at(-1)!
    expect(last.searchParams.get('q')).toBe('zzz')
    expect(last.searchParams.get('archived')).toBe('all')
  })

  it('a failed load shows the retry banner, and Retry loads again', async () => {
    let calls = 0
    await renderAt({
      'GET /companies': () => {
        calls += 1
        return calls === 1
          ? { status: 500, body: { status: 500, title: 'Internal Server Error', detail: 'boom' } }
          : { status: 200, body: page([companySummary()]) }
      },
    })
    expect((await screen.findByTestId('crm-load-error')).textContent).toContain('boom')
    fireEvent.click(screen.getByTestId('crm-load-error-retry'))
    expect(await screen.findByTestId('crm-companies-table')).not.toBeNull()
  })

  it('pages forward through the API', async () => {
    await renderAt({
      'GET /companies': (url) => ({
        status: 200,
        body: page([companySummary({ id: `c${url.searchParams.get('page')}` })], 30, Number(url.searchParams.get('page'))),
      }),
    })
    await screen.findByTestId('crm-companies-table')
    fireEvent.click(screen.getByTestId('crm-companies-pagination-next'))
    await waitFor(() => expect(companiesUrls().at(-1)!.searchParams.get('page')).toBe('2'))
  })

  it('New company validates required fields before calling the API', async () => {
    await renderAt({ 'GET /companies': () => ({ status: 200, body: page([]) }) })
    await screen.findByText('No companies yet')
    fireEvent.click(screen.getByTestId('crm-companies-new'))
    const dialog = await screen.findByRole('dialog', { name: 'New company' })
    fireEvent.click(within(dialog).getByTestId('crm-company-form-submit'))
    expect(within(dialog).getAllByText('This field is required.')).toHaveLength(3)
    expect(apiFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false)
  })

  it('posts the legal name, street and postal code of the offer’s client block (specs/020 AC-5.1)', async () => {
    let posted: Record<string, unknown> | null = null
    await renderAt({
      'GET /companies': () => ({ status: 200, body: page([]) }),
      'POST /companies': (_url, init) => {
        posted = JSON.parse(String(init?.body)) as Record<string, unknown>
        return { status: 409, body: { status: 409, title: 'Conflict', code: 'company_name_taken' } }
      },
    })
    await screen.findByText('No companies yet')
    fireEvent.click(screen.getByTestId('crm-companies-new'))
    const dialog = await screen.findByRole('dialog', { name: 'New company' })
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Acme' } })
    fireEvent.change(within(dialog).getByLabelText(/Relationship status/), { target: { value: 'prospect' } })
    fireEvent.change(within(dialog).getByLabelText(/wellD entity/), { target: { value: 'welld_ch' } })
    fireEvent.change(within(dialog).getByLabelText(/^Legal name/), { target: { value: ' Acme SA ' } })
    fireEvent.change(within(dialog).getByLabelText(/^Street/), { target: { value: 'Via Nassa 1' } })
    fireEvent.change(within(dialog).getByLabelText(/^Postal code/), { target: { value: '6900' } })
    fireEvent.click(within(dialog).getByTestId('crm-company-form-submit'))
    await waitFor(() => expect(posted).not.toBeNull())
    expect(posted).toMatchObject({ legalName: 'Acme SA', street: 'Via Nassa 1', postalCode: '6900' })
  })

  it('refuses a postal code over 20 characters before calling the API', async () => {
    await renderAt({ 'GET /companies': () => ({ status: 200, body: page([]) }) })
    await screen.findByText('No companies yet')
    fireEvent.click(screen.getByTestId('crm-companies-new'))
    const dialog = await screen.findByRole('dialog', { name: 'New company' })
    fireEvent.change(within(dialog).getByLabelText(/^Postal code/), { target: { value: '1'.repeat(21) } })
    fireEvent.click(within(dialog).getByTestId('crm-company-form-submit'))
    expect(await within(dialog).findByText('Use at most 20 characters.')).not.toBeNull()
  })

  it('a duplicate name is refused on the name field, with a link to the existing company (AC-1.4)', async () => {
    let posted: unknown = null
    await renderAt({
      'GET /companies': () => ({ status: 200, body: page([]) }),
      'POST /companies': (_url, init) => {
        posted = JSON.parse(String(init?.body))
        return {
          status: 409,
          body: { status: 409, title: 'Conflict', detail: 'Taken', code: 'company_name_taken', companyId: 'c-old' },
        }
      },
    })
    await screen.findByText('No companies yet')
    fireEvent.click(screen.getByTestId('crm-companies-new'))
    const dialog = await screen.findByRole('dialog', { name: 'New company' })
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: ' Acme SA ' } })
    fireEvent.change(within(dialog).getByLabelText(/Relationship status/), { target: { value: 'prospect' } })
    fireEvent.change(within(dialog).getByLabelText(/wellD entity/), { target: { value: 'welld_it' } })
    fireEvent.change(within(dialog).getByLabelText(/Country/), { target: { value: 'it' } })
    fireEvent.click(within(dialog).getByTestId('crm-company-form-submit'))
    const link = await within(dialog).findByRole('link', { name: 'Open the existing company' })
    expect(link.getAttribute('href')).toBe('/companies/c-old')
    expect(within(dialog).getByText(/A company with this name already exists/)).not.toBeNull()
    expect(posted).toEqual({
      name: 'Acme SA',
      status: 'prospect',
      entity: 'welld_it',
      website: null,
      industry: null,
      city: null,
      country: 'IT',
      notes: null,
      legalName: null,
      street: null,
      postalCode: null,
      source: null,
      sourceDetail: null,
    })
  })

  it('a lapsed customer reads as former client, with the reason on its page (specs/017 AC-1.9)', async () => {
    const lapsed = companySummary({ status: 'former', statusLapsed: true, openDealCount: 0 })
    apiFetch.mockImplementation(
      fakeApi({
        'GET /companies/c1': () => ({
          status: 200,
          body: { ...lapsed, website: null, legalName: null, street: null, postalCode: null, notes: null, version: 3, createdAt: '2025-01-01T00:00:00.000Z' },
        }),
        'GET /contacts': () => ({ status: 200, body: page([]) }),
        'GET /deals': () => ({ status: 200, body: page([]) }),
      }),
    )
    window.history.pushState(null, '', '/companies/c1')
    render(<RouterProvider router={createAppRouter()} />)
    const notice = await screen.findByTestId('crm-company-lapsed')
    expect(notice.textContent).toContain('no deal won in the last 12 months')
    expect(screen.getByTestId('crm-company-page').textContent).toContain('Former client')
  })

  it('edits a contact from the company page, with the contact’s own version (If-Match)', async () => {
    const contact = {
      id: 'p1',
      firstName: 'Mirko',
      lastName: 'Bianchi',
      email: 'mirko@example.ch',
      phone: null,
      jobTitle: 'Head of IT',
      company: { id: 'c1', name: 'Acme SA' },
      archived: false,
      updatedAt: '2026-11-01T10:00:00.000Z',
    }
    let ifMatch: string | null = null
    let sent: Record<string, unknown> | null = null
    apiFetch.mockImplementation(
      fakeApi({
        'GET /companies/c1': () => ({
          status: 200,
          body: { ...companySummary(), website: null, legalName: null, street: null, postalCode: null, notes: null, version: 1, createdAt: '2025-01-01T00:00:00.000Z' },
        }),
        'GET /contacts': () => ({ status: 200, body: page([contact]) }),
        'GET /contacts/p1': () => ({ status: 200, body: { ...contact, notes: null, version: 7, createdAt: '2026-01-01T00:00:00.000Z' } }),
        'PATCH /contacts/p1': (_url, init) => {
          ifMatch = new Headers(init?.headers).get('If-Match')
          sent = JSON.parse(String(init?.body))
          return { status: 200, body: { ...contact, jobTitle: 'CIO', notes: null, version: 8, createdAt: '2026-01-01T00:00:00.000Z' } }
        },
        'GET /deals': () => ({ status: 200, body: page([]) }),
      }),
    )
    window.history.pushState(null, '', '/companies/c1')
    render(<RouterProvider router={createAppRouter()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit “Mirko Bianchi”' }))
    const dialog = await screen.findByRole('dialog')
    const job = within(dialog).getByLabelText(/Job title/) as HTMLInputElement
    expect(job.value).toBe('Head of IT')
    fireEvent.change(job, { target: { value: 'CIO' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /Save/ }))
    await screen.findByText('Contact saved.')
    expect(ifMatch).toBe('"7"')
    expect(sent).toMatchObject({ jobTitle: 'CIO' })
  })
})
