/**
 * @vitest-environment jsdom
 *
 * Settings of specs/20261102-crm-offer-document: the letterhead (three-call upload), the offer-template
 * list and the template editor, through the real router and request code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import CrmShell from '../components/CrmShell'
import { createAppRouter } from '../router'
import { ADA, fakeApi } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

const MANAGER = { deal: ['welld_ch'], financials: true, managesAll: false, canErase: false }

const PROFILE = {
  entity: 'welld_ch',
  legalName: 'wellD SA',
  addressLines: ['Via Nassa 1'],
  vatNumber: null,
  iban: null,
  offerTermsEn: null,
  offerTermsIt: null,
  placeOfIssue: 'Lugano',
  letterhead: null,
  updatedAt: '2026-11-01T09:00:00.000Z',
}

const TEMPLATE = {
  id: 't1',
  entity: 'welld_ch',
  name: 'Fixed price',
  language: 'it',
  salutation: 'Gentile Cliente,',
  opening: 'Facciamo seguito all’incontro.',
  sections: [
    { heading: 'Oggetto', body: 'Sviluppo.', costs: false },
    { heading: 'Corrispettivo', body: '', costs: true },
    { heading: 'Validità', body: '30 giorni.', costs: false },
  ],
  costLines: [
    { description: 'Sviluppo', kind: 'one_off', amount: 'deal', quantity: 1 },
    { description: 'Manutenzione', kind: 'yearly', amount: { cents: 120_000 }, quantity: 1 },
    { description: 'Sconto', kind: 'discount', amount: { percentBp: 500 }, quantity: 1 },
  ],
  costColumns: { position: true, unit: false },
  showTotal: false,
  acceptanceLabel: null,
  annex: true,
  version: 3,
  archived: false,
  updatedBy: ADA,
  updatedAt: '2026-10-30T10:00:00.000Z',
  createdAt: '2026-10-01T10:00:00.000Z',
}

const body = (init: RequestInit | undefined) => JSON.parse(String(init?.body)) as Record<string, unknown>
const header = (init: RequestInit | undefined, name: string) => (init?.headers as Record<string, string> | undefined)?.[name] ?? null

const open = (path: string, extra: Record<string, FakeHandler> = {}, scope = MANAGER) => {
  apiFetch.mockImplementation(
    fakeApi({
      'GET /scope': () => ({ status: 200, body: scope }),
      'GET /entity-profiles': () => ({ status: 200, body: { items: [PROFILE] } }),
      'GET /offer-templates': () => ({ status: 200, body: { items: [TEMPLATE] } }),
      ...extra,
    }),
  )
  window.history.pushState(null, '', path)
  render(<RouterProvider router={createAppRouter(undefined, CrmShell)} />)
}

beforeEach(() => {
  window.scrollTo = () => undefined
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('letterhead (AC-2.5)', () => {
  const pdf = (name = 'letterhead.pdf', size = 1000) => {
    const file = new File(['%PDF'], name, { type: 'application/pdf' })
    Object.defineProperty(file, 'size', { value: size })
    return file
  }
  const pick = async (file: File) => {
    const input = await screen.findByTestId('crm-letterhead-welld_ch-file')
    fireEvent.change(input, { target: { files: [file] } })
  }

  it('uploads in three calls: start, bucket without the token, confirm with the key; then shows who and when', async () => {
    const order: string[] = []
    let confirmed: Record<string, unknown> | null = null
    const bucket = vi.fn(async (url: string, init?: RequestInit) => {
      order.push('bucket')
      expect(init?.headers).toBeUndefined()
      expect((init?.body as FormData).get('key')).toBe('letterheads/welld_ch/x.pdf')
      expect((init?.body as FormData).get('file')).toBeInstanceOf(Blob)
      void url
      return new Response(null, { status: 204 })
    })
    vi.stubGlobal('fetch', bucket)
    open('/settings', {
      'POST /entity-profiles/welld_ch/letterhead': () => {
        order.push('start')
        return {
          status: 201,
          body: { key: 'letterheads/welld_ch/x.pdf', upload: { url: 'https://bucket.test/up', fields: { key: 'letterheads/welld_ch/x.pdf' } } },
        }
      },
      'POST /entity-profiles/welld_ch/letterhead/confirm': (_url, init) => {
        order.push('confirm')
        confirmed = body(init)
        return {
          status: 200,
          body: { ...PROFILE, letterhead: { uploadedBy: ADA, uploadedAt: '2026-11-02T09:00:00.000Z' } },
        }
      },
    })
    expect((await screen.findByTestId('crm-letterhead-welld_ch')).textContent).toContain('No letterhead uploaded yet')
    await pick(pdf())
    await waitFor(() => expect(order).toEqual(['start', 'bucket', 'confirm']))
    expect(confirmed).toEqual({ key: 'letterheads/welld_ch/x.pdf' })
    expect(String(bucket.mock.calls[0]![0])).toBe('https://bucket.test/up')
    expect(apiFetch.mock.calls.some(([url]) => String(url).includes('bucket.test'))).toBe(false)
    expect((await screen.findByTestId('crm-letterhead-welld_ch-by')).textContent).toBe(
      'Uploaded by Ada Lovelace (You) on 02.11.2026',
    )
    expect(screen.getByTestId('crm-letterhead-welld_ch-upload').textContent).toBe('Replace letterhead')
  })

  it('refuses a non-PDF or a file over 5 MiB before any request', async () => {
    open('/settings')
    await screen.findByTestId('crm-letterhead-welld_ch')
    const calls = apiFetch.mock.calls.length
    await pick(new File(['x'], 'a.png', { type: 'image/png' }))
    expect((await screen.findByTestId('crm-letterhead-welld_ch-error')).textContent).toContain('Choose a PDF file')
    await pick(pdf('big.pdf', 5 * 1024 * 1024 + 1))
    await waitFor(() => expect(screen.getByTestId('crm-letterhead-welld_ch-error').textContent).toContain('larger than 5 MiB'))
    expect(apiFetch.mock.calls.length).toBe(calls)
  })

  it.each([
    ['page_count', 'exactly one page'],
    ['not_a4', 'must be A4'],
    ['not_pdf', 'not a readable PDF'],
    ['unembeddable', 'cannot be used as a background'],
    ['too_large', 'larger than 5 MiB'],
  ])('shows the reason %s inline and keeps the page usable', async (reason, text) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })))
    open('/settings', {
      'POST /entity-profiles/welld_ch/letterhead': () => ({
        status: 201,
        body: { key: 'letterheads/welld_ch/x.pdf', upload: { url: 'https://bucket.test/up', fields: {} } },
      }),
      'POST /entity-profiles/welld_ch/letterhead/confirm': () => ({
        status: 422,
        body: { status: 422, title: 'Unprocessable', code: 'letterhead_invalid', reason, detail: 'x' },
      }),
    })
    await pick(pdf())
    expect((await screen.findByTestId('crm-letterhead-welld_ch-error')).textContent).toContain(text)
    expect((screen.getByTestId('crm-letterhead-welld_ch-upload') as HTMLButtonElement).disabled).toBe(false)
  })

  it('cannot upload before the profile exists, and downloads through a short-lived link', async () => {
    const openTab = vi.fn()
    vi.stubGlobal('open', openTab)
    open('/settings', { 'GET /entity-profiles': () => ({ status: 200, body: { items: [] } }) })
    await screen.findByTestId('crm-letterhead-welld_ch')
    expect((screen.getByTestId('crm-letterhead-welld_ch-upload') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('crm-letterhead-welld_ch').textContent).toContain('Save the profile above first')
    cleanup()
    open('/settings', {
      'GET /entity-profiles': () => ({
        status: 200,
        body: { items: [{ ...PROFILE, letterhead: { uploadedBy: ADA, uploadedAt: '2026-11-02T09:00:00.000Z' } }] },
      }),
      'GET /entity-profiles/welld_ch/letterhead': () => ({ status: 200, body: { url: 'https://files.test/l.pdf' } }),
    })
    fireEvent.click(await screen.findByTestId('crm-letterhead-welld_ch-download'))
    await waitFor(() => expect(openTab).toHaveBeenCalledWith('https://files.test/l.pdf', '_blank', 'noopener'))
  })
})

describe('template list (US-2)', () => {
  it('shows name, language and last update, and loads archived ones on request', async () => {
    const queries: string[] = []
    open('/settings', {
      'GET /offer-templates': (url) => {
        queries.push(url.search)
        return {
          status: 200,
          body: { items: url.searchParams.get('includeArchived') === 'true' ? [TEMPLATE, { ...TEMPLATE, id: 't2', name: 'Old one', archived: true }] : [TEMPLATE] },
        }
      },
    })
    const table = await screen.findByTestId('crm-templates-welld_ch-table')
    const row = within(table).getAllByRole('row')[1]!
    expect(row.textContent).toContain('Fixed price')
    expect(row.textContent).toContain('Italian')
    expect(row.textContent).toContain('30.10.2026')
    expect(queries[0]).toBe('?entity=welld_ch&includeArchived=false')
    fireEvent.click(screen.getByTestId('crm-templates-welld_ch-archived'))
    expect(await screen.findByTestId('crm-template-restore-t2')).not.toBeNull()
    expect(queries.at(-1)).toBe('?entity=welld_ch&includeArchived=true')
    expect(screen.queryByTestId('crm-template-restore-t1')).toBeNull()
  })

  it('archives with the row’s version as If-Match and reloads; restore and duplicate use their routes', async () => {
    const calls: string[] = []
    open('/settings', {
      'POST /offer-templates/t1/archive': (_url, init) => {
        calls.push(`archive ${header(init, 'If-Match')}`)
        return { status: 200, body: { ...TEMPLATE, archived: true, version: 4 } }
      },
      'POST /offer-templates/t1/duplicate': (_url, init) => {
        calls.push(`duplicate ${init?.body === undefined}`)
        return { status: 201, body: { ...TEMPLATE, id: 't9', name: 'Fixed price (copy)' } }
      },
    })
    fireEvent.click(await screen.findByTestId('crm-template-archive-t1'))
    expect(await screen.findByText('Template Fixed price archived.')).not.toBeNull()
    fireEvent.click(await screen.findByTestId('crm-template-duplicate-t1'))
    expect(await screen.findByText('Template Fixed price (copy) created.')).not.toBeNull()
    expect(calls).toEqual(['archive "3"', 'duplicate true'])
  })

  it('a stale archive reloads the list and explains', async () => {
    open('/settings', {
      'POST /offer-templates/t1/archive': () => ({
        status: 409,
        body: { status: 409, title: 'Conflict', code: 'version_conflict', detail: 'x' },
      }),
    })
    fireEvent.click(await screen.findByTestId('crm-template-archive-t1'))
    expect((await screen.findByTestId('crm-templates-error')).textContent).toContain('Someone else changed this record')
  })
})

describe('template editor (US-2, AC-3.3)', () => {
  it('saves the whole template with If-Match, then adopts the returned version', async () => {
    const puts: { body: Record<string, unknown>; ifMatch: string | null }[] = []
    open('/settings/templates/t1', {
      'GET /offer-templates/t1': () => ({ status: 200, body: TEMPLATE }),
      'PUT /offer-templates/t1': (_url, init) => {
        puts.push({ body: body(init), ifMatch: header(init, 'If-Match') })
        return { status: 200, body: { ...TEMPLATE, ...body(init), version: 4 } }
      },
    })
    await screen.findByTestId('crm-template-page')
    expect((await screen.findByLabelText(/^Name/) as HTMLInputElement).value).toBe('Fixed price')
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Fixed price v2' } })
    fireEvent.click(screen.getByTestId('crm-template-save'))
    expect(await screen.findByText('Template saved.')).not.toBeNull()
    fireEvent.click(screen.getByTestId('crm-template-save'))
    await waitFor(() => expect(puts).toHaveLength(2))
    expect(puts[0]!.ifMatch).toBe('"3"')
    expect(puts[1]!.ifMatch).toBe('"4"')
    expect(puts[0]!.body).toEqual({
      name: 'Fixed price v2',
      language: 'it',
      salutation: 'Gentile Cliente,',
      opening: 'Facciamo seguito all’incontro.',
      sections: TEMPLATE.sections,
      costLines: TEMPLATE.costLines,
      costColumns: { position: true, unit: false },
      showTotal: false,
      acceptanceLabel: null,
      annex: true,
    })
  })

  it('adds, removes and reorders sections; exactly one carries the cost table', async () => {
    let saved: Record<string, unknown> | null = null
    open('/settings/templates/t1', {
      'GET /offer-templates/t1': () => ({ status: 200, body: TEMPLATE }),
      'PUT /offer-templates/t1': (_url, init) => {
        saved = body(init)
        return { status: 200, body: { ...TEMPLATE, ...saved, version: 4 } }
      },
    })
    const heading = (n: number) => screen.getByLabelText(new RegExp(`^Heading \\(${n}\\)`)) as HTMLInputElement
    await screen.findByTestId('crm-template-sections')
    expect(heading(1).value).toBe('Oggetto')
    // Move "Oggetto" down: Corrispettivo is now first.
    fireEvent.click(screen.getByTestId('crm-template-section-0-down'))
    expect(heading(1).value).toBe('Corrispettivo')
    expect(heading(2).value).toBe('Oggetto')
    expect((screen.getByTestId('crm-template-section-0-up') as HTMLButtonElement).disabled).toBe(true)
    // Add a fourth, make it the costs section: the radio group keeps just one.
    fireEvent.click(screen.getByTestId('crm-template-section-add'))
    fireEvent.change(heading(4), { target: { value: 'Allegati' } })
    fireEvent.click(screen.getByTestId('crm-template-section-3-costs'))
    const checked = [0, 1, 2, 3].filter((n) => (screen.getByTestId(`crm-template-section-${n}-costs`) as HTMLInputElement).checked)
    expect(checked).toEqual([3])
    // Remove "Validità" (now third).
    fireEvent.click(screen.getByTestId('crm-template-section-2-remove'))
    expect(screen.queryByLabelText(/^Heading \(4\)/)).toBeNull()
    fireEvent.click(screen.getByTestId('crm-template-save'))
    await waitFor(() => expect(saved).not.toBeNull())
    expect((saved as unknown as { sections: unknown }).sections).toEqual([
      { heading: 'Corrispettivo', body: '', costs: false },
      { heading: 'Oggetto', body: 'Sviluppo.', costs: false },
      { heading: 'Allegati', body: '', costs: true },
    ])
  })

  it('cannot remove the last section, and the 15-section cap disables Add', async () => {
    open('/settings/templates/new/welld_ch')
    await screen.findByTestId('crm-template-sections')
    expect((screen.getByTestId('crm-template-section-0-remove') as HTMLButtonElement).disabled).toBe(true)
    for (let i = 0; i < 14; i++) fireEvent.click(screen.getByTestId('crm-template-section-add'))
    expect((screen.getByTestId('crm-template-section-add') as HTMLButtonElement).disabled).toBe(true)
  })

  it('validates before calling the API: required texts, headings and cost amounts', async () => {
    open('/settings/templates/new/welld_ch')
    await screen.findByTestId('crm-template-sections')
    fireEvent.click(screen.getByTestId('crm-template-save'))
    expect((await screen.findByTestId('crm-template-error')).textContent).toContain('Some fields need attention')
    expect(screen.getAllByText('This field is required.').length).toBeGreaterThanOrEqual(3)
    expect(screen.getByText('The heading is required.')).not.toBeNull()
    expect(screen.getByText('The description is required.')).not.toBeNull()
    expect(apiFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false)
  })

  it('needs at least one one-off line, and quantity 1 without the unit columns', async () => {
    open('/settings/templates/t1', { 'GET /offer-templates/t1': () => ({ status: 200, body: { ...TEMPLATE, costColumns: { position: true, unit: true }, costLines: [{ description: 'Hosting', kind: 'yearly', amount: { cents: 100 }, quantity: 4 }] } }) })
    await screen.findByTestId('crm-template-costlines')
    fireEvent.click(screen.getByTestId('crm-template-save'))
    expect((await screen.findByTestId('crm-template-costlines-error')).textContent).toContain('At least one line must be one-off')
    // Turning the unit columns off puts every quantity back to 1.
    fireEvent.click(screen.getByTestId('crm-template-cost-unit'))
    expect(screen.queryByLabelText(/^Quantity \(1\)/)).toBeNull()
  })

  it('a percentage is offered to discounts only; a per-release split to one-off lines only', async () => {
    open('/settings/templates/t1', { 'GET /offer-templates/t1': () => ({ status: 200, body: TEMPLATE }) })
    await screen.findByTestId('crm-template-costlines')
    const modes = (n: number) => [...(screen.getByLabelText(`Amount type (${n})`) as HTMLSelectElement).options].map((option) => option.value)
    expect(modes(1)).toEqual(['deal', 'perRelease', 'fixed'])
    expect(modes(2)).toEqual(['deal', 'fixed'])
    expect(modes(3)).toEqual(['fixed', 'percent'])
    expect((screen.getByLabelText(/^Percentage \(3\)/) as HTMLInputElement).value).toBe('5')
  })

  it('a stale save shows the reload banner; reloading brings the latest version back', async () => {
    let version = 3
    open('/settings/templates/t1', {
      'GET /offer-templates/t1': () => ({ status: 200, body: { ...TEMPLATE, version, name: version === 3 ? 'Fixed price' : 'Edited elsewhere' } }),
      'PUT /offer-templates/t1': () => ({
        status: 409,
        body: { status: 409, title: 'Conflict', code: 'version_conflict', detail: 'x' },
      }),
    })
    await screen.findByTestId('crm-template-sections')
    version = 5
    fireEvent.click(screen.getByTestId('crm-template-save'))
    fireEvent.click(await screen.findByTestId('crm-stale-write-reload'))
    await waitFor(() => expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Edited elsewhere'))
    expect(screen.queryByTestId('crm-stale-write')).toBeNull()
  })

  it('a missing precondition (428) is handled the same way', async () => {
    open('/settings/templates/t1', {
      'GET /offer-templates/t1': () => ({ status: 200, body: TEMPLATE }),
      'PUT /offer-templates/t1': () => ({ status: 428, body: { status: 428, title: 'Precondition required', code: 'precondition_required' } }),
    })
    await screen.findByTestId('crm-template-sections')
    fireEvent.click(screen.getByTestId('crm-template-save'))
    expect(await screen.findByTestId('crm-stale-write')).not.toBeNull()
  })

  it('creates a template of the entity in the path, then opens it; a taken name lands on the name field', async () => {
    let posted: Record<string, unknown> | null = null
    let taken = true
    open('/settings/templates/new/welld_ch', {
      'POST /offer-templates': (_url, init) => {
        posted = body(init)
        return taken
          ? { status: 409, body: { status: 409, title: 'Conflict', code: 'template_name_taken', detail: 'x' } }
          : { status: 201, body: { ...TEMPLATE, id: 't7', name: 'Brand new', version: 1 } }
      },
      'GET /offer-templates/t7': () => ({ status: 200, body: { ...TEMPLATE, id: 't7', name: 'Brand new', version: 1 } }),
    })
    await screen.findByTestId('crm-template-sections')
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Brand new' } })
    fireEvent.change(screen.getByLabelText(/^Salutation/), { target: { value: 'Dear Sir,' } })
    fireEvent.change(screen.getByLabelText(/^Opening/), { target: { value: 'Thank you.' } })
    fireEvent.change(screen.getByLabelText(/^Heading \(1\)/), { target: { value: 'Costs' } })
    fireEvent.change(screen.getByLabelText(/^Description \(1\)/), { target: { value: 'Development' } })
    fireEvent.change(screen.getByLabelText('Amount type (1)'), { target: { value: 'deal' } })
    fireEvent.click(screen.getByTestId('crm-template-save'))
    expect(await screen.findByText('A template with this name already exists for this entity.')).not.toBeNull()
    taken = false
    fireEvent.click(screen.getByTestId('crm-template-save'))
    await waitFor(() => expect(window.location.pathname).toBe('/settings/templates/t7'))
    expect(posted).toMatchObject({
      entity: 'welld_ch',
      name: 'Brand new',
      language: 'it',
      costLines: [{ description: 'Development', kind: 'one_off', amount: 'deal', quantity: 1 }],
      sections: [{ heading: 'Costs', body: '', costs: true }],
      costColumns: { position: true, unit: false },
      annex: false,
    })
  })

  it('is read-only for an entity the caller does not manage', async () => {
    open('/settings/templates/t1', { 'GET /offer-templates/t1': () => ({ status: 200, body: { ...TEMPLATE, entity: 'welld_it' } }) })
    await screen.findByTestId('crm-template-sections')
    expect(screen.getByText(/you do not manage deals for this entity/)).not.toBeNull()
    expect(screen.queryByTestId('crm-template-save')).toBeNull()
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).matches(':disabled')).toBe(true)
  })

  it('the formatting reference is a collapsible section listing the placeholders', async () => {
    open('/settings/templates/t1', { 'GET /offer-templates/t1': () => ({ status: 200, body: TEMPLATE }) })
    const help = await screen.findByTestId('crm-markup-help')
    expect(help.tagName).toBe('DETAILS')
    expect(help.textContent).toContain('{validityDays}')
    expect(help.textContent).toContain('**bold**')
  })
})
