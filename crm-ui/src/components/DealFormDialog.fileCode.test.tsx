/**
 * @vitest-environment jsdom
 *
 * The deal's code in its offers' file names (2026-11-24, owner): edited on an existing deal, shown with the initials
 * of the title it replaces, sent upper case and only when it changed, cleared to null, refused when it is not 1–10
 * letters or digits; absent when the server predates it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import DealFormDialog from './DealFormDialog'
import { ScopeContext } from '../hooks/scopeContext'
import { fakeApi } from '../test-support/fakeApi'
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

const ADA = { id: 'u-ada', name: 'Ada Lovelace', status: 'active' as const }
const DEAL = {
  id: 'd1',
  title: 'Presa in carico sito RMS',
  company: { id: 'c1', name: 'RMS Militare Svizzera' },
  entity: 'welld_ch',
  currency: 'CHF',
  amountCents: null,
  owner: ADA,
  version: 4,
  expectedCloseDate: null,
  source: null,
  sourceDetail: null,
  fileCode: null,
  fileCodeDefault: 'PICSR',
} as unknown as Deal

const withScope = (node: ReactElement) => (
  <ScopeContext.Provider value={{ deal: ['welld_ch'], canErase: false }}>{node}</ScopeContext.Provider>
)
const t = strings.deals.form
const input = () => screen.getByTestId('crm-deal-form-file-code').querySelector('input')!
const sent = () => {
  const call = apiFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')
  return call ? (JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>) : null
}
const serve = (onSaved = vi.fn()) => {
  apiFetch.mockImplementation(fakeApi({ 'PATCH /deals/d1': () => ({ status: 200, body: { ...DEAL, version: 5 } }) }))
  render(withScope(<DealFormDialog deal={DEAL} onSaved={onSaved} onCancel={() => undefined} onStale={() => undefined} />))
  return onSaved
}

describe('the deal’s code in file names', () => {
  it('shows the initials it replaces, and sends what was typed in upper case', async () => {
    const onSaved = serve()
    expect(screen.getByTestId('crm-deal-form-file-code').textContent).toContain(t.fileCodeHint('PICSR'))
    expect(input().placeholder).toBe('PICSR')
    await userEvent.type(input(), 'pcs')
    await userEvent.click(screen.getByTestId('crm-deal-form-submit'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(sent()).toMatchObject({ fileCode: 'PCS' })
  })

  it('is not sent when unchanged, and an emptied code is sent as null', async () => {
    const onSaved = serve()
    await userEvent.click(screen.getByTestId('crm-deal-form-submit'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(sent()).not.toHaveProperty('fileCode')
    cleanup()
    apiFetch.mockReset()
    apiFetch.mockImplementation(fakeApi({ 'PATCH /deals/d1': () => ({ status: 200, body: DEAL }) }))
    const saved = vi.fn()
    render(withScope(<DealFormDialog deal={{ ...DEAL, fileCode: 'PCS' }} onSaved={saved} onCancel={() => undefined} onStale={() => undefined} />))
    await userEvent.clear(input())
    await userEvent.click(screen.getByTestId('crm-deal-form-submit'))
    await waitFor(() => expect(saved).toHaveBeenCalled())
    expect(sent()).toMatchObject({ fileCode: null })
  })

  it('refuses spaces and symbols before sending', async () => {
    serve()
    await userEvent.type(input(), 'P-CS')
    await userEvent.click(screen.getByTestId('crm-deal-form-submit'))
    expect(await screen.findByText(t.fileCodeInvalid)).toBeDefined()
    expect(sent()).toBeNull()
  })

  it('is absent when the server predates it (no fileCodeDefault)', () => {
    const old = { ...DEAL } as Deal & { fileCodeDefault?: string }
    delete old.fileCodeDefault
    render(withScope(<DealFormDialog deal={old as Deal} onSaved={() => undefined} onCancel={() => undefined} onStale={() => undefined} />))
    expect(screen.queryByTestId('crm-deal-form-file-code')).toBeNull()
  })
})
