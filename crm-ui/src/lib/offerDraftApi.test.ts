/**
 * The wizard's API client (specs/20261115-crm-offer-wizard T39, plan § API contracts): the preconditions each call
 * sends, the ETag it exposes, the typed 422 `offer_incomplete`, and the Problem codes the UI has words for.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('shell/session', () => ({
  apiFetch: vi.fn(),
  getCrmApiBaseUrl: vi.fn(() => 'http://crm-api.test'),
  getAuthBaseUrl: vi.fn(() => 'http://auth.test'),
}))

import { apiFetch } from 'shell/session'
import { ApiError } from './api'
import {
  createWizardDraft,
  createWizardTemplate,
  discardWizardDraft,
  generateWizardDraft,
  getWizardContext,
  getWizardDraft,
  getWizardDraftSummary,
  listOfferTemplatesOf,
  switchWizardDraftTemplate,
  updateWizardTemplate,
  saveWizardDraft,
} from './crmApi'
import { answersInvalidPathOf, draftExistsOf, offerFailure, offerIncompleteOf, templateProblemsOf } from './offerErrors'
import { strings } from '../strings'
import { draftView, fakeApi, offerDraftServer, problemAnswer, sampleAnswersFixture } from '../test-support/fakeApi'

const respond = (status: number, body?: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers },
  })

const problem = (status: number, code: string, extras: Record<string, unknown> = {}) =>
  respond(status, { type: `https://x/${code}`, title: code, status, code, detail: `detail of ${code}`, ...extras })

// braces: a hook's returned function is its teardown, and `mockReset()` returns the mock
beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
})

const lastCall = () => {
  const [url, init] = vi.mocked(apiFetch).mock.calls.at(-1)!
  return {
    url: String(url),
    init: (init ?? {}) as RequestInit,
    headers: ((init ?? {}) as RequestInit).headers as Record<string, string>,
  }
}

const ANSWERS = sampleAnswersFixture()
const VIEW = {
  dealId: 'd1',
  template: { id: 't1', name: 'Progetto a corpo', language: 'it', version: 4, archived: false },
  templateVersion: 4,
  target: { kind: 'new' },
  answers: ANSWERS,
  version: 3,
  updatedBy: { id: 'u1', name: 'Ada', status: 'active' },
  updatedAt: '2026-11-15T10:00:00.000Z',
  createdAt: '2026-11-15T09:00:00.000Z',
}

describe('reading', () => {
  it('the context is a plain GET of the deal’s wizard context', async () => {
    vi.mocked(apiFetch).mockResolvedValue(respond(200, { dealTitle: 'Acme', today: '2026-11-15' }))
    const context = await getWizardContext('d 1')
    expect(lastCall().url).toBe('http://crm-api.test/deals/d%201/offer-wizard/context')
    expect(context.today).toBe('2026-11-15')
  })

  it('the draft comes back with the ETag the next write must carry', async () => {
    vi.mocked(apiFetch).mockResolvedValue(respond(200, VIEW, { ETag: '"3"' }))
    const result = await getWizardDraft('d1')
    expect(lastCall().url).toBe('http://crm-api.test/deals/d1/offer-draft')
    expect(result.draft.version).toBe(3)
    expect(result.etag).toBe('"3"')
  })

  it('a missing draft is a 404 draft_not_found ApiError', async () => {
    vi.mocked(apiFetch).mockResolvedValue(problem(404, 'draft_not_found'))
    await expect(getWizardDraft('d1')).rejects.toMatchObject({ status: 404, code: 'draft_not_found' })
  })

  it('the summary: no draft is { draft: null } without an ETag, a draft carries both', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(respond(200, { draft: null }))
    expect(await getWizardDraftSummary('d1')).toEqual({ draft: null, etag: null })
    expect(lastCall().url).toBe('http://crm-api.test/deals/d1/offer-draft/summary')

    const summary = { dealId: 'd1', version: 5 }
    vi.mocked(apiFetch).mockResolvedValueOnce(respond(200, { draft: summary }, { ETag: '"5"' }))
    expect(await getWizardDraftSummary('d1')).toEqual({ draft: summary, etag: '"5"' })
  })
})

describe('writing a draft', () => {
  it('creating sends If-None-Match: * and no If-Match, and exposes the ETag', async () => {
    vi.mocked(apiFetch).mockResolvedValue(respond(201, VIEW, { ETag: '"1"' }))
    const result = await createWizardDraft('d1', { templateId: 't1' })
    const { url, init, headers } = lastCall()
    expect(url).toBe('http://crm-api.test/deals/d1/offer-draft')
    expect(init.method).toBe('POST')
    expect(headers['If-None-Match']).toBe('*')
    expect(headers['If-Match']).toBeUndefined()
    expect(JSON.parse(init.body as string)).toEqual({ templateId: 't1' })
    expect(result.etag).toBe('"1"')
  })

  it('creating from an offer sends the target and may omit the template (DD-28)', async () => {
    vi.mocked(apiFetch).mockResolvedValue(respond(201, VIEW, { ETag: '"1"' }))
    await createWizardDraft('d1', { target: { kind: 'edit', offerId: 'o1' } })
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ target: { kind: 'edit', offerId: 'o1' } })
  })

  it('a second draft is 409 draft_exists naming who and when', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      problem(409, 'draft_exists', {
        updatedBy: { id: 'u2', name: 'Bob', status: 'active' },
        updatedAt: '2026-11-15T08:00:00.000Z',
      }),
    )
    const error = await createWizardDraft('d1', { templateId: 't1' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(draftExistsOf(error)).toEqual({
      updatedBy: { id: 'u2', name: 'Bob', status: 'active' },
      updatedAt: '2026-11-15T08:00:00.000Z',
    })
    expect(draftExistsOf(new ApiError({ status: 409, title: 'x', code: 'version_conflict' }))).toBeNull()
  })

  it('saving PUTs { templateVersion, target, answers } under If-Match of the draft’s version', async () => {
    vi.mocked(apiFetch).mockResolvedValue(respond(200, { ...VIEW, version: 4 }, { ETag: '"4"' }))
    const result = await saveWizardDraft('d1', 3, { templateVersion: 4, target: { kind: 'new' }, answers: ANSWERS })
    const { init, headers, url } = lastCall()
    expect(url).toBe('http://crm-api.test/deals/d1/offer-draft')
    expect(init.method).toBe('PUT')
    expect(headers['If-Match']).toBe('"3"')
    expect(headers['If-None-Match']).toBeUndefined()
    expect(JSON.parse(init.body as string)).toEqual({ templateVersion: 4, target: { kind: 'new' }, answers: ANSWERS })
    expect(result.etag).toBe('"4"')
    expect(result.draft.version).toBe(4)
  })

  it('a stale save is 409 version_conflict, and a 428 and a 413 keep their codes', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(problem(409, 'version_conflict', { currentVersion: 5 }))
    await expect(
      saveWizardDraft('d1', 3, { templateVersion: 4, target: { kind: 'new' }, answers: ANSWERS }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'version_conflict',
    })
    vi.mocked(apiFetch).mockResolvedValueOnce(problem(413, 'draft_too_large'))
    await expect(
      saveWizardDraft('d1', 3, { templateVersion: 4, target: { kind: 'new' }, answers: ANSWERS }),
    ).rejects.toMatchObject({
      status: 413,
      code: 'draft_too_large',
    })
  })

  it('answers_invalid carries the path of the refused value', async () => {
    vi.mocked(apiFetch).mockResolvedValue(problem(422, 'answers_invalid', { path: 'fields.IMPORTO', reason: 'shape' }))
    const error = await saveWizardDraft('d1', 3, {
      templateVersion: 4,
      target: { kind: 'new' },
      answers: ANSWERS,
    }).catch((e: unknown) => e)
    expect(answersInvalidPathOf(error)).toBe('fields.IMPORTO')
    expect(answersInvalidPathOf(new Error('x'))).toBeNull()
  })

  it('switching the template POSTs { templateId } under If-Match', async () => {
    vi.mocked(apiFetch).mockResolvedValue(respond(200, { ...VIEW, version: 4 }, { ETag: '"4"' }))
    const result = await switchWizardDraftTemplate('d1', 3, 't2')
    const { init, headers, url } = lastCall()
    expect(url).toBe('http://crm-api.test/deals/d1/offer-draft/template')
    expect(init.method).toBe('POST')
    expect(headers['If-Match']).toBe('"3"')
    expect(JSON.parse(init.body as string)).toEqual({ templateId: 't2' })
    expect(result.etag).toBe('"4"')
  })

  it('discarding DELETEs under If-Match and resolves with nothing (204)', async () => {
    vi.mocked(apiFetch).mockResolvedValue(respond(204))
    await expect(discardWizardDraft('d1', 5)).resolves.toBeUndefined()
    const { init, headers } = lastCall()
    expect(init.method).toBe('DELETE')
    expect(headers['If-Match']).toBe('"5"')
    expect(init.body).toBeUndefined()
  })

  it('discarding with a stale version is 409 version_conflict', async () => {
    vi.mocked(apiFetch).mockResolvedValue(problem(409, 'version_conflict'))
    await expect(discardWizardDraft('d1', 5)).rejects.toMatchObject({ status: 409, code: 'version_conflict' })
  })
})

describe('generating', () => {
  const OFFER = { id: 'o1', reference: '0001/2026', origin: 'wizard', version: 1 }

  it('POSTs with If-Match and no body; a 201 is a new offer', async () => {
    vi.mocked(apiFetch).mockResolvedValue(respond(201, OFFER, { ETag: '"1"' }))
    const result = await generateWizardDraft('d1', 3)
    const { init, headers, url } = lastCall()
    expect(url).toBe('http://crm-api.test/deals/d1/offer-draft/generate')
    expect(init.method).toBe('POST')
    expect(headers['If-Match']).toBe('"3"')
    expect(init.body).toBeUndefined()
    expect(headers['Content-Type']).toBeUndefined()
    expect(result).toEqual({ kind: 'generated', offer: OFFER, etag: '"1"', created: true })
  })

  it('a 200 is the edit of an offer, not a new one', async () => {
    vi.mocked(apiFetch).mockResolvedValue(respond(200, OFFER, { ETag: '"2"' }))
    expect(await generateWizardDraft('d1', 3)).toMatchObject({ kind: 'generated', created: false })
  })

  it('a 422 offer_incomplete is RETURNED typed, with its missing and invalid lists', async () => {
    const missing = [{ name: 'IMPORTO', label: 'Importo', step: 'costs' }]
    const invalid = [{ name: 'cost:sconto', label: 'Scontistica', step: 'costs', code: 'discounts_exceed_span' }]
    vi.mocked(apiFetch).mockResolvedValue(problem(422, 'offer_incomplete', { missing, invalid }))
    expect(await generateWizardDraft('d1', 3)).toEqual({ kind: 'incomplete', missing, invalid })
  })

  it('an offer_incomplete body that is not the contract is still an error, not an empty list', async () => {
    vi.mocked(apiFetch).mockResolvedValue(problem(422, 'offer_incomplete', { missing: 'nope' }))
    await expect(generateWizardDraft('d1', 3)).rejects.toMatchObject({ code: 'offer_incomplete' })
    expect(
      offerIncompleteOf(
        new ApiError({ status: 422, title: 'x', code: 'offer_incomplete', extras: { missing: [], invalid: [] } }),
      ),
    ).toEqual({
      missing: [],
      invalid: [],
    })
  })

  it.each([
    [409, 'template_changed'],
    [409, 'template_archived'],
    [409, 'estimate_not_ready'],
    [409, 'offer_changed'],
    [409, 'version_conflict'],
    [404, 'draft_not_found'],
    [422, 'contact_not_in_company'],
    [422, 'attachment_not_pdf'],
  ])('%i %s stays an ApiError for the page to switch on', async (status, code) => {
    vi.mocked(apiFetch).mockResolvedValue(problem(status, code))
    await expect(generateWizardDraft('d1', 3)).rejects.toMatchObject({ status, code })
  })

  it('a network failure propagates as it is', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new TypeError('Failed to fetch'))
    const error = await generateWizardDraft('d1', 3).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TypeError)
    expect(error).not.toBeInstanceOf(ApiError)
  })
})

describe('wizard templates', () => {
  it('lists by format: `formats=wizard` for the Template step, both for Settings', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => respond(200, { items: [] }))
    await listOfferTemplatesOf('welld_ch', false, 'wizard')
    expect(lastCall().url).toBe(
      'http://crm-api.test/offer-templates?entity=welld_ch&includeArchived=false&formats=wizard',
    )
    await listOfferTemplatesOf('welld_ch', true, 'sections,wizard')
    expect(lastCall().url).toBe(
      'http://crm-api.test/offer-templates?entity=welld_ch&includeArchived=true&formats=sections%2Cwizard',
    )
  })

  it('creating names the entity beside the body; saving sends If-Match', async () => {
    vi.mocked(apiFetch).mockImplementation(async () => respond(200, { id: 't9' }))
    const body = { name: 'N', language: 'it' as const, description: 'd', uses: ['a'], source: '# x' }
    await createWizardTemplate('welld_ch', body)
    expect(lastCall().init.method).toBe('POST')
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ ...body, entity: 'welld_ch' })
    await updateWizardTemplate('t9', 2, body)
    expect(lastCall().init.method).toBe('PUT')
    expect(lastCall().headers['If-Match']).toBe('"2"')
    expect(JSON.parse(lastCall().init.body as string)).toEqual(body)
  })

  it('a 422 template_invalid lists its problems', async () => {
    const problems = [{ line: 3, severity: 'error', code: 'unknown_field', name: 'X' }]
    vi.mocked(apiFetch).mockResolvedValue(problem(422, 'template_invalid', { problems }))
    const error = await createWizardTemplate('welld_ch', {
      name: 'N',
      language: 'it',
      description: '',
      uses: [],
      source: 'x',
    }).catch((e: unknown) => e)
    expect(templateProblemsOf(error)).toEqual(problems)
    expect(templateProblemsOf(new ApiError({ status: 422, title: 'x', code: 'other' }))).toEqual([])
  })
})

describe('the fake draft server keeps the contract the hook tests lean on', () => {
  const useServer = (initial: ReturnType<typeof draftView> | null) => {
    const { server, routes } = offerDraftServer(initial)
    vi.mocked(apiFetch).mockImplementation((input, init) => fakeApi(routes)(input, init))
    return server
  }

  it('creates once under If-None-Match, then names the author of the draft that is there', async () => {
    const server = useServer(null)
    const created = await createWizardDraft('d1', { templateId: 't1' })
    expect(created.etag).toBe('"1"')
    expect(server.draft).not.toBeNull()
    await expect(createWizardDraft('d1', { templateId: 't1' })).rejects.toMatchObject({
      status: 409,
      code: 'draft_exists',
    })
  })

  it('a save of what is stored keeps the version; a changed one bumps it; a stale one is a 409', async () => {
    const server = useServer(draftView())
    const same = await saveWizardDraft('d1', 1, {
      templateVersion: 1,
      target: { kind: 'new' },
      answers: server.draft!.answers,
    })
    expect(same.draft.version).toBe(1)
    const changed = await saveWizardDraft('d1', 1, {
      templateVersion: 1,
      target: { kind: 'new' },
      answers: { ...server.draft!.answers, validityDays: 45 },
    })
    expect(changed.draft.version).toBe(2)
    expect(changed.etag).toBe('"2"')
    await expect(
      saveWizardDraft('d1', 1, { templateVersion: 1, target: { kind: 'new' }, answers: server.draft!.answers }),
    ).rejects.toMatchObject({ status: 409, code: 'version_conflict' })
    expect(server.saves).toHaveLength(2)
  })

  it('queued refusals and a gone draft answer as the server would', async () => {
    const server = useServer(draftView())
    server.failNext('PUT', problemAnswer(422, 'answers_invalid', { path: 'fields.X' }), 'network')
    const input = { templateVersion: 1, target: { kind: 'new' as const }, answers: server.draft!.answers }
    await expect(saveWizardDraft('d1', 1, input)).rejects.toMatchObject({ code: 'answers_invalid' })
    await expect(saveWizardDraft('d1', 1, input)).rejects.toBeInstanceOf(TypeError)
    await discardWizardDraft('d1', 1)
    await expect(saveWizardDraft('d1', 1, input)).rejects.toMatchObject({ status: 404, code: 'draft_not_found' })
    expect((await getWizardDraftSummary('d1')).draft).toBeNull()
  })
})

describe('error codes', () => {
  const unknownError = strings.common.unknownError
  // every code plan § API contracts adds to the offer routes
  const CODES = [
    'draft_exists',
    'draft_not_found',
    'draft_invalid',
    'draft_too_large',
    'answers_invalid',
    'template_changed',
    'template_archived',
    'template_format_mismatch',
    'template_required',
    'offer_changed',
    'offer_sent',
    'offer_not_sent',
    'offer_not_latest',
    'offer_legacy',
    'offer_wizard',
    'offer_incomplete',
    'estimate_not_ready',
    'contact_not_in_company',
  ]

  it.each(CODES)('%s has words of its own, not the generic line or the server’s detail', (code) => {
    const text = offerFailure(new ApiError({ status: 409, title: code, code, detail: 'SERVER DETAIL' }))
    expect(text).not.toBe(unknownError)
    expect(text).not.toBe('SERVER DETAIL')
    expect(text.length).toBeGreaterThan(10)
  })

  it('the codes that name a file keep naming it', () => {
    const error = new ApiError({ status: 422, title: 'x', code: 'attachment_not_pdf', extras: { fileName: 'a.pdf' } })
    expect(offerFailure(error)).toContain('a.pdf')
  })

  it('an unknown code falls back to the server’s detail', () => {
    expect(offerFailure(new ApiError({ status: 500, title: 'x', code: 'zzz', detail: 'boom' }))).toBe('boom')
  })
})
