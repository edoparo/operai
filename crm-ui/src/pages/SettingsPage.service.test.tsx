/**
 * @vitest-environment jsdom
 *
 * CRM Settings on the letterhead service path (specs/20261116-letterhead-service T33; design F14, S10; AC-10.11): with
 * `letterheadService` on, the letterhead upload card is gone and nothing replaces it; with it off or absent, Settings is
 * exactly as before. Real router and shell, fake API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { RouterProvider } from '@tanstack/react-router'
import CrmShell from '../components/CrmShell'
import { createAppRouter } from '../router'
import { en, it as italian, strings } from '../strings'
import { fakeApi } from '../test-support/fakeApi'

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('shell/session', () => ({
  apiFetch,
  getCrmApiBaseUrl: () => 'http://crm-api.test',
  getAuthBaseUrl: () => 'http://auth.test',
  useSession: () => ({ data: { user: { id: 'u-ada' } } }),
}))

const PROFILE = (entity: string) => ({
  entity,
  legalName: `wellD ${entity}`,
  addressLines: ['Via Nassa 1'],
  vatNumber: null,
  iban: null,
  offerTermsEn: null,
  offerTermsIt: null,
  placeOfIssue: 'Lugano',
  letterhead: null,
  updatedAt: '2026-11-01T09:00:00.000Z',
})

async function open(service: boolean | undefined) {
  apiFetch.mockImplementation(
    fakeApi({
      'GET /scope': () => ({
        status: 200,
        body: {
          deal: ['welld_it', 'welld_ch'],
          financials: true,
          managesAll: false,
          canErase: false,
          ...(service === undefined ? {} : { letterheadService: service }),
        },
      }),
      'GET /entity-profiles': () => ({ status: 200, body: { items: [PROFILE('welld_it'), PROFILE('welld_ch')] } }),
      'GET /offer-numbering/welld_it': () => ({ status: 200, body: { nextNumber: 1, example: '0001/2026' } }),
      'GET /offer-numbering/welld_ch': () => ({ status: 200, body: { nextNumber: 1, example: '0001/2026' } }),
      'GET /offer-templates': () => ({ status: 200, body: { items: [] } }),
    }),
  )
  window.history.pushState(null, '', '/settings')
  render(<RouterProvider router={createAppRouter(undefined, CrmShell)} />)
  await screen.findByTestId('crm-settings-page')
  // both entities' profile forms are in: the page has loaded, the cards below them with it
  await screen.findAllByRole('heading', { name: strings.settings.profile(strings.badges.entity.welld_it) })
}

beforeEach(() => {
  window.scrollTo = () => undefined
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  apiFetch.mockReset()
})

describe('Settings on the service path (AC-10.11, design F14)', () => {
  it('has no letterhead card for any entity, and still the profile, the numbering and the templates', async () => {
    await open(true)
    for (const entity of ['welld_it', 'welld_ch']) {
      expect(screen.queryByTestId(`crm-letterhead-${entity}`)).toBeNull()
      expect(screen.queryByTestId(`crm-letterhead-${entity}-upload`)).toBeNull()
    }
    expect(screen.queryByText(strings.templates.letterhead.upload)).toBeNull()
    expect(screen.getAllByRole('heading', { name: strings.settings.profile(strings.badges.entity.welld_ch) })).toHaveLength(1)
    // nothing replaces the card: the description no longer says the letterhead is here
    expect(screen.getByText(strings.settings.descriptionService)).toBeTruthy()
    expect(screen.queryByText(strings.settings.description)).toBeNull()
    // and the upload routes are never called
    expect(apiFetch.mock.calls.map(([url]) => new URL(String(url)).pathname).filter((p) => p.includes('letterhead'))).toEqual([])
  })

  it.each([
    ['off', false],
    ['absent (an older crm-api)', undefined],
  ])('%s: Settings is as it was, with the upload card of each entity', async (_name, service) => {
    await open(service)
    expect(screen.getByTestId('crm-letterhead-welld_it')).toBeTruthy()
    expect(screen.getByTestId('crm-letterhead-welld_ch')).toBeTruthy()
    expect(screen.getByText(strings.settings.description)).toBeTruthy()
  })

  it('says its description in both languages with the same keys', () => {
    expect(en.settings.descriptionService).not.toBe('')
    expect(italian.settings.descriptionService).not.toBe(en.settings.descriptionService)
  })
})
