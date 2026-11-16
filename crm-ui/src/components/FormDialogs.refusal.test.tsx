/**
 * @vitest-environment jsdom
 *
 * The company, contact and deal dialogs after a SERVER refusal (QE finding G1, specs/20261115-crm-offer-wizard
 * qe-report round 7): focus moves to the field the server named — `aria-invalid`, described by the sentence — and,
 * when the refusal names no field the dialog owns, to the dialog's announced error banner. Create and edit both.
 * Before this, focus stayed on the Submit button that had just gone busy (`<body>`), and in a tall dialog the
 * refused field was out of sight.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import CompanyFormDialog from './CompanyFormDialog'
import ContactFormDialog from './ContactFormDialog'
import DealFormDialog from './DealFormDialog'
import { ScopeContext } from '../hooks/scopeContext'
import { fakeApi, nulRefusalAnswer, problemAnswer } from '../test-support/fakeApi'
import type { FakeHandler } from '../test-support/fakeApi'
import { strings } from '../strings'
import type { Company, Contact, Deal } from '../lib/types'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))
// The "see the existing company" link needs a router; a plain anchor is enough here.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/companies/c9">{children}</a>,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const ADA = { id: 'u-ada', name: 'Ada Lovelace', status: 'active' as const }
const noop = () => undefined
const RAW = /NUL|Must not contain|Not text/

const COMPANY = {
  id: 'c1',
  name: 'Acme SA',
  status: 'customer',
  entity: 'welld_ch',
  owner: ADA,
  version: 3,
  website: null,
  industry: null,
  city: null,
  country: null,
  notes: null,
  legalName: null,
  street: null,
  postalCode: null,
  source: null,
  sourceDetail: null,
} as unknown as Company
const CONTACT = {
  id: 'p1',
  firstName: 'Grace',
  lastName: 'Hopper',
  email: null,
  phone: null,
  jobTitle: null,
  notes: null,
  company: { id: 'c1', name: 'Acme SA' },
  version: 2,
} as unknown as Contact
const DEAL = {
  id: 'd1',
  title: 'Fibre roll-out',
  company: { id: 'c1', name: 'Acme SA' },
  entity: 'welld_ch',
  currency: 'CHF',
  amountCents: null,
  owner: ADA,
  version: 4,
  expectedCloseDate: null,
  source: null,
  sourceDetail: null,
} as unknown as Deal

/** The caller manages CH deals: without a scope the deal dialog's entity field is itself in error ("no scope"). */
const withScope = (node: ReactElement) => (
  <ScopeContext.Provider value={{ deal: ['welld_ch'], canErase: false }}>{node}</ScopeContext.Provider>
)

const serve = (routes: Record<string, FakeHandler>) => apiFetch.mockImplementation(fakeApi(routes))
const field = (testId: string) => screen.getByTestId(testId).querySelector<HTMLElement>('input, select, textarea')!
const submit = async (prefix: string) => {
  await userEvent.click(screen.getByTestId(`${prefix}-submit`))
}
const expectFocusedWithSentence = async (control: HTMLElement, sentence: string) => {
  await waitFor(() => expect(document.activeElement).toBe(control))
  expect(control.getAttribute('aria-invalid')).toBe('true')
  const described = control.getAttribute('aria-describedby') ?? ''
  expect(described.split(' ').some((id) => document.getElementById(id)?.textContent?.includes(sentence))).toBe(true)
}
const expectBannerFocused = async (prefix: string, text: string) => {
  const banner = await screen.findByTestId(`${prefix}-error`)
  await waitFor(() => expect(document.activeElement).toBe(banner))
  expect(banner.getAttribute('role')).toBe('alert')
  expect(banner.textContent).toBe(text)
}

type Case = {
  name: string
  prefix: string
  /** The field a NUL / a server message lands on, and how to reach its control. */
  fieldTestId: string
  fieldKey: string
  mode: 'create' | 'edit'
  route: string
  render: () => ReactElement
  fill: () => Promise<void>
}

const fillCompany = async () => {
  await userEvent.type(field('crm-company-form-name'), 'Acme SA')
  await userEvent.selectOptions(field('crm-company-form-status'), 'customer')
  await userEvent.selectOptions(field('crm-company-form-entity'), 'welld_ch')
}
const fillContact = async () => {
  await userEvent.type(field('crm-contact-form-firstName'), 'Grace')
  await userEvent.type(field('crm-contact-form-lastName'), 'Hopper')
}
const fillDeal = async () => {
  await userEvent.type(field('crm-deal-form-title'), 'Fibre roll-out')
}

const cases: Case[] = [
  {
    name: 'company create',
    prefix: 'crm-company-form',
    fieldTestId: 'crm-company-form-name',
    fieldKey: 'name',
    mode: 'create',
    route: 'POST /companies',
    render: () => <CompanyFormDialog onSaved={noop} onCancel={noop} onStale={noop} />,
    fill: fillCompany,
  },
  {
    name: 'company edit',
    prefix: 'crm-company-form',
    fieldTestId: 'crm-company-form-name',
    fieldKey: 'name',
    mode: 'edit',
    route: 'PATCH /companies/c1',
    render: () => <CompanyFormDialog company={COMPANY} onSaved={noop} onCancel={noop} onStale={noop} />,
    fill: async () => {
      await userEvent.type(field('crm-company-form-name'), ' Group')
    },
  },
  {
    name: 'contact create',
    prefix: 'crm-contact-form',
    fieldTestId: 'crm-contact-form-firstName',
    fieldKey: 'firstName',
    mode: 'create',
    route: 'POST /contacts',
    render: () => (
      <ContactFormDialog company={{ id: 'c1', name: 'Acme SA' }} onSaved={noop} onCancel={noop} onStale={noop} />
    ),
    fill: fillContact,
  },
  {
    name: 'contact edit',
    prefix: 'crm-contact-form',
    fieldTestId: 'crm-contact-form-firstName',
    fieldKey: 'firstName',
    mode: 'edit',
    route: 'PATCH /contacts/p1',
    render: () => <ContactFormDialog contact={CONTACT} onSaved={noop} onCancel={noop} onStale={noop} />,
    fill: async () => {
      await userEvent.type(field('crm-contact-form-firstName'), 'a')
    },
  },
  {
    name: 'deal create',
    prefix: 'crm-deal-form',
    fieldTestId: 'crm-deal-form-title',
    fieldKey: 'title',
    mode: 'create',
    route: 'POST /deals',
    render: () =>
      withScope(
        <DealFormDialog
          company={{ id: 'c1', name: 'Acme SA', entity: 'welld_ch' }}
          onSaved={noop}
          onCancel={noop}
          onStale={noop}
        />,
      ),
    fill: fillDeal,
  },
  {
    name: 'deal edit',
    prefix: 'crm-deal-form',
    fieldTestId: 'crm-deal-form-title',
    fieldKey: 'title',
    mode: 'edit',
    route: 'PATCH /deals/d1',
    render: () => withScope(<DealFormDialog deal={DEAL} onSaved={noop} onCancel={noop} onStale={noop} />),
    fill: async () => {
      await userEvent.type(field('crm-deal-form-title'), ' II')
    },
  },
]

describe.each(cases)('$name — a server refusal moves focus', (c) => {
  it('a NUL in the field: focus on that field, our sentence (never the server line), aria-invalid', async () => {
    serve({ [c.route]: () => nulRefusalAnswer(c.fieldKey) })
    render(c.render())
    await c.fill()
    await submit(c.prefix)
    await expectFocusedWithSentence(field(c.fieldTestId), strings.common.validation.noNul)
    expect(document.body.textContent).not.toMatch(RAW)
    expect(screen.queryByTestId(`${c.prefix}-error`)).toBeNull()
  })

  it('a field the dialog does not own: the announced banner takes focus, with the dialog still open', async () => {
    serve({
      [c.route]: () => ({
        status: 422,
        body: { title: 'Unprocessable Entity', status: 422, detail: 'Something else is wrong', field: 'unmapped' },
      }),
    })
    render(c.render())
    await c.fill()
    await submit(c.prefix)
    await expectBannerFocused(c.prefix, 'Something else is wrong')
    // nothing is marked invalid: the focus is not misplaced on a field the server did not refuse
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull()
  })

  it('a refusal with no field at all (503): the banner takes focus', async () => {
    serve({ [c.route]: () => problemAnswer(503, 'auth_unavailable') })
    render(c.render())
    await c.fill()
    await submit(c.prefix)
    await expectBannerFocused(c.prefix, 'detail of auth_unavailable')
  })
})

describe('company dialog — an ordinary duplicate name', () => {
  it.each([
    ['create', 'POST /companies', undefined],
    ['edit', 'PATCH /companies/c1', COMPANY],
  ] as const)(
    '%s: focus on Name, marked invalid, with the link to the existing company',
    async (_mode, route, company) => {
      serve({ [route]: () => problemAnswer(409, 'company_name_taken', { companyId: 'c9' }) })
      render(<CompanyFormDialog company={company} onSaved={noop} onCancel={noop} onStale={noop} />)
      if (!company) await fillCompany()
      else await userEvent.type(field('crm-company-form-name'), '2')
      await submit('crm-company-form')
      await expectFocusedWithSentence(field('crm-company-form-name'), strings.companies.form.nameTaken)
      expect(screen.getByText(strings.companies.form.nameTakenLink)).not.toBeNull()
    },
  )

  it('a second refusal moves focus again after the person left the field', async () => {
    serve({ 'POST /companies': () => problemAnswer(409, 'company_name_taken', { companyId: 'c9' }) })
    render(<CompanyFormDialog onSaved={noop} onCancel={noop} onStale={noop} />)
    await fillCompany()
    await submit('crm-company-form')
    await waitFor(() => expect(document.activeElement).toBe(field('crm-company-form-name')))
    fireEvent.focus(field('crm-company-form-city'))
    field('crm-company-form-city').focus()
    await submit('crm-company-form')
    await waitFor(() => expect(document.activeElement).toBe(field('crm-company-form-name')))
  })
})

describe('deal dialog — a refusal the server maps by code', () => {
  it('owner_not_active style codes land on their field: focus on the stage select', async () => {
    serve({ 'POST /deals': () => problemAnswer(422, 'stage_not_open') })
    render(
      withScope(
        <DealFormDialog
          company={{ id: 'c1', name: 'Acme SA', entity: 'welld_ch' }}
          onSaved={noop}
          onCancel={noop}
          onStale={noop}
        />,
      ),
    )
    await fillDeal()
    await submit('crm-deal-form')
    await expectFocusedWithSentence(field('crm-deal-form-stage'), 'detail of stage_not_open')
  })
})
