/**
 * @vitest-environment jsdom
 *
 * The deal page's offers card with the wizard (specs/20261115-crm-offer-wizard T51; AC-6.2, AC-6.4, AC-7.1, AC-7.2,
 * AC-7.3; design S11, F10, F11): the draft row from `GET …/offer-draft/summary` — asked only with `financials` and
 * `deal:manage` of the deal's entity — Continue and Discard, and Edit / New revision decided by the offer's origin.
 * Through the real router, the deal page and the fake draft server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import CrmShell from './CrmShell'
import { createAppRouter } from '../router'
import { strings } from '../strings'
import {
  ADA,
  draftView,
  fakeApi,
  offerDraftServer,
  page,
  problemAnswer,
  type FakeDraftServer,
  type FakeHandler,
} from '../test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getActivitiesApiBaseUrl: () => 'http://activities-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))
vi.mock('shell/extensions', () => ({ HostExtension: () => null }))

const t = strings.offers

const DEAL = {
  id: 'd1',
  title: 'Platform rebuild',
  company: { id: 'c1', name: 'Acme SA' },
  stage: 'proposal',
  amountCents: 10_000_000,
  currency: 'CHF',
  entity: 'welld_ch',
  expectedCloseDate: null,
  owner: ADA,
  closedAt: null,
  updatedAt: '2026-10-30T10:00:00.000Z',
  lostReason: null,
  notes: null,
  version: 4,
  createdAt: '2026-10-01T10:00:00.000Z',
  estimateState: 'ready',
  estimateOverridden: false,
  estimate: {
    estimateId: 'est-1',
    state: 'ready',
    name: 'E',
    technical: ADA,
    requestedBy: ADA,
    requestedAt: '2026-10-30T10:00:00.000Z',
    readyAt: '2026-10-31T10:00:00.000Z',
  },
  estimateOverride: null,
}

const OFFER = {
  id: 'o2',
  number: 1,
  reference: '0001/2026',
  language: 'it',
  priceCents: 9_000_000,
  currency: 'CHF',
  validityDays: 30,
  validUntil: '2026-12-01',
  aiAssisted: false,
  manDaysTenths: 100,
  sizeBytes: 1000,
  createdBy: ADA,
  createdAt: '2026-11-01T09:00:00.000Z',
  deleted: false,
  templateName: 'Progetto a corpo',
  sent: null,
  version: 3,
  origin: 'wizard',
}
const SENT = { ...OFFER, sent: { at: '2026-11-03T10:00:00.000Z', by: ADA }, version: 4 }

const WIZARD_IT = {
  id: 't1',
  entity: 'welld_ch',
  name: 'Progetto a corpo',
  language: 'it',
  format: 'wizard',
  description: null,
  uses: [],
  source: '',
  seeded: false,
  showTotal: true,
  annex: false,
  version: 1,
  archived: false,
  updatedBy: ADA,
  updatedAt: '2026-11-01T09:00:00.000Z',
  createdAt: '2026-10-01T09:00:00.000Z',
}

type Scope = { deal: string[]; financials: boolean; managesAll: boolean }
const MANAGER: Scope = { deal: ['welld_ch'], financials: true, managesAll: false }

let server: FakeDraftServer
const requests = () =>
  apiFetch.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${new URL(String(url)).pathname}`)
const bodyOf = (method: string, path: string): Record<string, unknown> | undefined => {
  const call = apiFetch.mock.calls.find(
    ([url, init]) => (init?.method ?? 'GET') === method && new URL(String(url)).pathname === path,
  )
  return call?.[1]?.body ? (JSON.parse(String(call[1].body)) as Record<string, unknown>) : undefined
}

async function mount(
  options: {
    scope?: Scope
    draft?: ReturnType<typeof draftView> | null
    offers?: unknown[]
    routes?: Record<string, FakeHandler>
  } = {},
) {
  const made = offerDraftServer(options.draft ?? null)
  server = made.server
  apiFetch.mockImplementation(
    fakeApi({
      'GET /scope': () => ({ status: 200, body: { ...(options.scope ?? MANAGER), canErase: false } }),
      'GET /deals/d1': () => ({ status: 200, body: DEAL }),
      'GET /pipeline': () => ({ status: 200, body: { probabilities: {}, year: 2026, stages: [] } }),
      'GET /activities': () => ({ status: 200, body: page([]) }),
      'GET /deals/d1/offers': () => ({ status: 200, body: { items: options.offers ?? [] } }),
      'GET /deals/d1/attachments': () => ({ status: 200, body: { items: [] } }),
      'GET /offer-templates': () => ({ status: 200, body: { items: [WIZARD_IT] } }),
      ...made.routes,
      ...options.routes,
    }),
  )
  window.history.pushState(null, '', '/deals/d1')
  render(<RouterProvider router={createAppRouter(undefined, CrmShell)} />)
  await screen.findByRole('heading', { level: 2, name: 'Platform rebuild' })
  if ((options.scope ?? MANAGER).financials) await screen.findByTestId('crm-offers-card')
}

beforeEach(() => {
  window.scrollTo = () => undefined
})
afterEach(() => {
  cleanup()
  apiFetch.mockReset()
})

describe('OffersCard — who asks for the draft (AC-6.2)', () => {
  it('asks nobody without deal:financials', async () => {
    await mount({ scope: { ...MANAGER, financials: false } })
    await waitFor(() => expect(requests()).toContain('GET /deals/d1'))
    expect(requests().some((request) => request.includes('offer-draft'))).toBe(false)
  })

  it('asks nobody without deal:manage of the deal’s entity', async () => {
    await mount({ scope: { ...MANAGER, deal: ['welld_it'] } })
    await waitFor(() => expect(screen.queryByTestId('crm-offers-card')).not.toBeNull())
    expect(requests().some((request) => request.includes('offer-draft'))).toBe(false)
  })

  it('asks the summary of a manager, and shows nothing for a deal with no draft', async () => {
    await mount()
    await waitFor(() => expect(requests()).toContain('GET /deals/d1/offer-draft/summary'))
    expect(screen.queryByTestId('crm-offer-draft-row')).toBeNull()
    expect(requests().some((request) => request === 'GET /deals/d1/offer-draft')).toBe(false)
  })

  it('shows nothing, not an error, when the summary is refused (403)', async () => {
    await mount({ routes: { 'GET /deals/d1/offer-draft/summary': () => problemAnswer(403, 'forbidden') } })
    await waitFor(() => expect(requests()).toContain('GET /deals/d1/offer-draft/summary'))
    expect(screen.queryByText(t.draft.checkFailed)).toBeNull()
    expect(screen.queryByTestId('crm-offer-draft-row')).toBeNull()
  })

  it('says it could not check, and retries on request, when the summary fails', async () => {
    let asked = 0
    await mount({
      routes: {
        'GET /deals/d1/offer-draft/summary': () => {
          asked += 1
          return asked === 1 ? problemAnswer(500, 'boom') : { status: 200, body: { draft: null } }
        },
      },
    })
    fireEvent.click(await screen.findByRole('button', { name: t.draft.checkRetry }))
    await waitFor(() => expect(asked).toBe(2))
    await waitFor(() => expect(screen.queryByText(t.draft.checkFailed)).toBeNull())
  })
})

describe('OffersCard — the draft row (AC-6.4)', () => {
  const withDraft = () => draftView({ updatedAt: '2026-11-15T10:00:00.000Z', version: 7 })

  it('shows the template, the target, who changed it and when, and offers Continue and no new offer', async () => {
    await mount({ draft: withDraft() })
    const row = await screen.findByTestId('crm-offer-draft-row')
    expect(row.textContent).toContain('Progetto a corpo')
    expect(row.textContent).toContain(t.draft.target.new)
    expect(row.textContent).toContain('Changed by Ada Lovelace')
    expect(within(row).getByRole('link', { name: t.draft.continue }).getAttribute('href')).toBe('/deals/d1/offer')
    expect(screen.queryByTestId('crm-offer-new')).toBeNull()
    expect(screen.queryByTestId('crm-offer-generate')).toBeNull()
  })

  it('without a draft the header starts the wizard', async () => {
    await mount()
    expect((await screen.findByTestId('crm-offer-new')).getAttribute('href')).toBe('/deals/d1/offer')
  })

  it('names an edit’s offer, and a template edited or archived since', async () => {
    await mount({
      draft: draftView({
        target: { kind: 'edit', offerId: 'o2', offerVersion: 3, reference: '0001/2026' },
        template: { ...draftView().template, archived: true },
        templateVersion: 0,
      }),
    })
    const row = await screen.findByTestId('crm-offer-draft-row')
    expect(row.textContent).toContain(t.draft.target.edit('0001/2026'))
    expect(row.textContent).toContain(t.draft.templateChanged)
    expect(row.textContent).toContain(t.draft.templateArchived)
  })

  it('Discard asks first, then deletes with the summary’s version and says so', async () => {
    await mount({ draft: withDraft() })
    fireEvent.click(await screen.findByRole('button', { name: t.draft.discardOf('Progetto a corpo') }))
    const dialog = await screen.findByRole('alertdialog', { name: t.draft.discardDialog.title })
    expect(requests()).not.toContain('DELETE /deals/d1/offer-draft')
    fireEvent.click(within(dialog).getByRole('button', { name: t.draft.discardDialog.confirm }))
    await waitFor(() => expect(screen.queryByTestId('crm-offer-draft-row')).toBeNull())
    const call = apiFetch.mock.calls.find(([, init]) => init?.method === 'DELETE')!
    expect((call[1].headers as Record<string, string>)['If-Match']).toBe('"7"')
    expect(server.draft).toBeNull()
    expect(screen.getByText(t.draft.discardDialog.done)).not.toBeNull()
  })

  it('a stale Discard (409) deletes nothing, refetches and says the draft changed', async () => {
    await mount({ draft: withDraft() })
    fireEvent.click(await screen.findByRole('button', { name: t.draft.discardOf('Progetto a corpo') }))
    const dialog = await screen.findByRole('alertdialog')
    // someone saved the draft meanwhile
    server.draft = { ...server.draft!, version: 8, updatedAt: '2026-11-15T11:00:00.000Z' }
    fireEvent.click(within(dialog).getByRole('button', { name: t.draft.discardDialog.confirm }))
    expect(await screen.findByText(t.draft.changedMeanwhile)).not.toBeNull()
    expect(server.draft).not.toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByTestId('crm-offer-draft-row')).not.toBeNull()
  })
})

describe('OffersCard — Edit and New revision by origin (AC-7.1, AC-7.2, AC-7.3)', () => {
  it('Edit of a wizard offer starts a draft with no templateId, then opens the wizard', async () => {
    await mount({ offers: [OFFER] })
    fireEvent.click(await screen.findByTestId('crm-offer-edit-o2'))
    await waitFor(() => expect(requests()).toContain('POST /deals/d1/offer-draft'))
    expect(bodyOf('POST', '/deals/d1/offer-draft')).toEqual({ target: { kind: 'edit', offerId: 'o2' } })
    await waitFor(() => expect(window.location.pathname).toBe('/deals/d1/offer'))
  })

  it('New revision of a sent wizard offer starts a revision draft with no templateId', async () => {
    await mount({ offers: [SENT] })
    const revise = await screen.findByTestId('crm-offer-generate')
    expect(revise.textContent).toBe(t.revise)
    fireEvent.click(revise)
    await waitFor(() => expect(requests()).toContain('POST /deals/d1/offer-draft'))
    expect(bodyOf('POST', '/deals/d1/offer-draft')).toEqual({ target: { kind: 'revision', offerId: 'o2' } })
    await waitFor(() => expect(window.location.pathname).toBe('/deals/d1/offer'))
  })

  it('a wizard offer whose template was archived goes to the Template step with the offer as target', async () => {
    await mount({
      offers: [OFFER],
      routes: { 'POST /deals/d1/offer-draft': () => problemAnswer(409, 'template_archived', { templateId: 't1' }) },
    })
    fireEvent.click(await screen.findByTestId('crm-offer-edit-o2'))
    await waitFor(() => expect(window.location.pathname).toBe('/deals/d1/offer'))
    expect(window.location.search).toContain('kind=edit')
    expect(window.location.search).toContain('offer=o2')
  })

  it('a classic offer goes to the wizard’s Template step when its language has a wizard template', async () => {
    await mount({ offers: [{ ...OFFER, origin: 'sections' }] })
    fireEvent.click(await screen.findByTestId('crm-offer-edit-o2'))
    await waitFor(() => expect(window.location.pathname).toBe('/deals/d1/offer'))
    expect(window.location.search).toContain('kind=edit')
    expect(window.location.search).toContain('offer=o2')
    expect(requests()).not.toContain('POST /deals/d1/offer-draft')
  })

  it('a classic offer opens the legacy dialog when its language has no wizard template', async () => {
    await mount({
      offers: [{ ...OFFER, origin: 'sections', language: 'en' }],
      routes: {
        'GET /contacts': () => ({ status: 200, body: page([]) }),
        'GET /deals/d1/offers/o2/form': () => ({
          status: 200,
          body: {
            templateId: 't-en',
            templateName: 'Standard EN',
            language: 'en',
            currency: 'CHF',
            salutation: 'Dear Sir or Madam,',
            clientLines: ['Acme SA'],
            opening: 'As sent.',
            sections: [{ heading: 'Object', body: 'Rebuild.', costs: false }],
            costColumns: { position: true, unit: true },
            showTotal: true,
            costLines: [{ description: 'Development', kind: 'one_off', unitCents: 1_000_000, percentBp: null, quantity: 10 }],
            acceptanceLabel: null,
            annex: false,
            validityDays: 30,
            aiAssisted: false,
            manDays: 10,
            contactIds: [],
            attachmentIds: [],
            version: 3,
            sent: false,
          },
        }),
      },
    })
    fireEvent.click(await screen.findByTestId('crm-offer-edit-o2'))
    expect(await screen.findByRole('dialog', { name: /Edit offer/ })).not.toBeNull()
    expect(window.location.pathname).toBe('/deals/d1')
  })

  it('an offer from before the origin existed counts as classic', async () => {
    const { origin: _origin, ...older } = OFFER // eslint-disable-line @typescript-eslint/no-unused-vars
    await mount({ offers: [older] })
    fireEvent.click(await screen.findByTestId('crm-offer-edit-o2'))
    await waitFor(() => expect(window.location.pathname).toBe('/deals/d1/offer'))
    expect(requests()).not.toContain('POST /deals/d1/offer-draft')
  })

  it('with a draft already there, Edit asks to continue it or discard it first', async () => {
    await mount({ draft: draftView({ version: 7 }), offers: [OFFER] })
    fireEvent.click(await screen.findByTestId('crm-offer-edit-o2'))
    const dialog = await screen.findByRole('dialog', { name: t.draft.exists.title })
    expect(requests()).not.toContain('POST /deals/d1/offer-draft')
    fireEvent.click(within(dialog).getByRole('link', { name: t.draft.exists.continue }))
    await waitFor(() => expect(window.location.pathname).toBe('/deals/d1/offer'))
    expect(server.draft).not.toBeNull()
  })

  it('Discard it and continue deletes the draft, then starts the edit', async () => {
    await mount({ draft: draftView({ version: 7 }), offers: [OFFER] })
    fireEvent.click(await screen.findByTestId('crm-offer-edit-o2'))
    const dialog = await screen.findByRole('dialog', { name: t.draft.exists.title })
    fireEvent.click(within(dialog).getByRole('button', { name: t.draft.exists.discard }))
    await waitFor(() =>
      expect(bodyOf('POST', '/deals/d1/offer-draft')).toEqual({ target: { kind: 'edit', offerId: 'o2' } }),
    )
    expect(requests().indexOf('DELETE /deals/d1/offer-draft')).toBeLessThan(
      requests().indexOf('POST /deals/d1/offer-draft'),
    )
    await waitFor(() => expect(window.location.pathname).toBe('/deals/d1/offer'))
  })

  it('the draft already being for this very offer just continues', async () => {
    await mount({
      draft: draftView({ target: { kind: 'edit', offerId: 'o2', offerVersion: 3, reference: '0001/2026' } }),
      offers: [OFFER],
    })
    fireEvent.click(await screen.findByTestId('crm-offer-edit-o2'))
    await waitFor(() => expect(window.location.pathname).toBe('/deals/d1/offer'))
    expect(screen.queryByRole('dialog', { name: t.draft.exists.title })).toBeNull()
  })
})
