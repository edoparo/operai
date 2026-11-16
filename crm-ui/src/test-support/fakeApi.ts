/**
 * A URL-dispatching stand-in for `shell/session`'s `apiFetch` (tests only):
 * each route is `METHOD /path` → a handler answering `{status, body}`. The
 * request reaches the real `lib/crmApi.ts` + `lib/api.ts`, so a page test also
 * exercises the request paths, query strings and headers the contract fixes.
 */
import { vi } from 'vitest'
import type { WizardAnswers } from '../lib/offerEngine/answers'
import type { OfferDraftView } from '../lib/types'

export type FakeAnswer = { status: number; body?: unknown; headers?: Record<string, string> }
export type FakeHandler = (url: URL, init: RequestInit | undefined) => FakeAnswer | Promise<FakeAnswer>

export function fakeApi(routes: Record<string, FakeHandler>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const key = `${init?.method ?? 'GET'} ${url.pathname}`
    const handler = routes[key]
    if (!handler) return new Response(JSON.stringify({ status: 404, title: 'Not Found' }), { status: 404 })
    const answer = await handler(url, init)
    return answer.body === undefined
      ? new Response(null, { status: answer.status, headers: answer.headers })
      : new Response(JSON.stringify(answer.body), { status: answer.status, headers: answer.headers })
  })
}

export const page = <T>(items: T[], total = items.length, pageNumber = 1, pageSize = 25) => ({
  items,
  total,
  page: pageNumber,
  pageSize,
})

export const ADA = { id: 'u-ada', name: 'Ada Lovelace', status: 'active' as const }

export const companySummary = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Acme SA',
  status: 'customer',
  entity: 'welld_ch',
  industry: 'Energy',
  city: 'Lugano',
  country: 'CH',
  owner: ADA,
  archived: false,
  contactCount: 2,
  openDealCount: 1,
  statusLapsed: false,
  updatedAt: '2026-10-30T10:00:00.000Z',
  ...overrides,
})

// ─── The offer wizard (specs/20261115-crm-offer-wizard T39) ─────────────────────────────────────────────

/** A Problem JSON answer: what crm-api sends for every refusal (`code` is what the UI switches on). */
export const problemAnswer = (status: number, code: string, extras: Record<string, unknown> = {}): FakeAnswer => ({
  status,
  body: {
    type: `https://crm.test/problems/${code}`,
    title: code,
    status,
    code,
    detail: `detail of ${code}`,
    ...extras,
  },
})

/**
 * crm-api's 422 for a NUL in free text (crm-api/src/lib/nulText.test.ts): the field named, in `field`, in `detail`
 * behind its key and in `errors`; the value is never echoed. Used to assert that no placement shows any of that raw.
 */
export const nulRefusalAnswer = (field: string, message = 'Not text: contains a NUL character'): FakeAnswer => ({
  status: 422,
  body: {
    type: 'https://crm.test/problems/validation',
    title: 'Unprocessable Entity',
    status: 422,
    detail: `${field}: ${message}`,
    field,
    errors: [{ field, message }],
  },
})

/** The smallest answers document crm-api accepts: nothing filled, one client line. */
export const sampleAnswersFixture = (overrides: Record<string, unknown> = {}): WizardAnswers => ({
  v: 1,
  client: { lines: ['Acme SA'], contactIds: [], place: 'Lugano', date: null },
  fields: {},
  prefilled: {},
  blocks: {},
  lists: {},
  tables: {},
  costs: { lines: {}, extra: [], columns: { position: false, unit: true }, showTotals: true },
  handEdits: {},
  orphanedEdits: [],
  validityDays: 30,
  aiAssisted: false,
  effortAnnex: false,
  attachmentIds: [],
  lastStep: 'client',
  ...overrides,
})

export const draftView = (overrides: Record<string, unknown> = {}): OfferDraftView => ({
  dealId: 'd1',
  template: { id: 't1', name: 'Progetto a corpo', language: 'it', version: 1, archived: false },
  templateVersion: 1,
  target: { kind: 'new' },
  answers: sampleAnswersFixture(),
  version: 1,
  updatedBy: ADA,
  updatedAt: '2026-11-15T10:00:00.000Z',
  createdAt: '2026-11-15T09:00:00.000Z',
  ...overrides,
})

/** What the fake remembers and lets a test inspect or steer: the one draft, every save it took, and a queue of refusals. */
export type FakeDraftServer = {
  draft: OfferDraftView | null
  /** The bodies of every `PUT`, in order — a no-op counts, as it reaches the server. */
  saves: { ifMatch: string | null; body: { templateVersion: number; target: unknown; answers: WizardAnswers } }[]
  /** Answers given to the next calls of a route (`'PUT'`, `'POST generate'`…) instead of its normal behaviour, in order. */
  failNext: (route: string, ...answers: (FakeAnswer | 'network')[]) => void
}

const etagOf = (version: number) => ({ ETag: `"${version}"` })
const quoted = (version: number) => `"${version}"`

/**
 * The routes of the deal's offer draft, with the preconditions crm-api enforces: `If-None-Match: *` to create (428
 * without, 409 `draft_exists`), `If-Match` on every write (428 without, 409 `version_conflict` when stale), a `PUT`
 * equal to the stored draft answered 200 with the same version (DD-31), 404 `draft_not_found` without a draft.
 * Merge into `fakeApi({ ...offerDraftRoutes(server) })`. Behaviour is the contract's, not the real validation: a
 * test of a 422 queues it with `failNext`.
 */
export function offerDraftServer(initial: OfferDraftView | null = null, dealId = 'd1') {
  const base = `/deals/${dealId}`
  const queued = new Map<string, (FakeAnswer | 'network')[]>()
  const server: FakeDraftServer = {
    draft: initial,
    saves: [],
    failNext: (route, ...answers) => queued.set(route, [...(queued.get(route) ?? []), ...answers]),
  }
  const header = (init: RequestInit | undefined, name: string): string | null => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    return headers[name] ?? null
  }
  const injected = (route: string): FakeAnswer | undefined => {
    const next = queued.get(route)?.shift()
    if (next === 'network') throw new TypeError('Failed to fetch')
    return next
  }
  const noDraft = () => problemAnswer(404, 'draft_not_found')
  /** 428 / 409 for a write that names the draft's version. */
  const stale = (init: RequestInit | undefined): FakeAnswer | null => {
    const sent = header(init, 'If-Match')
    if (sent === null) return problemAnswer(428, 'precondition_required')
    if (server.draft === null) return noDraft()
    return sent === quoted(server.draft.version)
      ? null
      : problemAnswer(409, 'version_conflict', { currentVersion: server.draft.version })
  }
  const bodyOf = (init: RequestInit | undefined) => JSON.parse(String(init?.body ?? '{}')) as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const view = (status: number): FakeAnswer => ({ status, body: server.draft, headers: etagOf(server.draft!.version) })

  const routes: Record<string, FakeHandler> = {
    [`GET ${base}/offer-draft`]: () => injected('GET') ?? (server.draft ? view(200) : noDraft()),
    [`GET ${base}/offer-draft/summary`]: () => {
      const forced = injected('GET summary')
      if (forced) return forced
      if (!server.draft) return { status: 200, body: { draft: null } }
      const { answers: _answers, templateVersion, template, ...rest } = server.draft // eslint-disable-line @typescript-eslint/no-unused-vars
      return {
        status: 200,
        body: { draft: { ...rest, template: { ...template }, templateChanged: templateVersion !== template.version } },
        headers: etagOf(server.draft.version),
      }
    },
    [`POST ${base}/offer-draft`]: (_url, init) => {
      const forced = injected('POST')
      if (forced) return forced
      if (header(init, 'If-None-Match') !== '*') return problemAnswer(428, 'precondition_required')
      if (server.draft)
        return problemAnswer(409, 'draft_exists', {
          updatedBy: server.draft.updatedBy,
          updatedAt: server.draft.updatedAt,
        })
      const body = bodyOf(init)
      server.draft = draftView({
        template: { ...draftView().template, id: body['templateId'] ?? 't1' },
        ...(body['target'] && body['target'].kind !== 'new'
          ? { target: { ...body['target'], offerVersion: 1, reference: '0001/2026' } }
          : {}),
      })
      return view(201)
    },
    [`PUT ${base}/offer-draft`]: (_url, init) => {
      const forced = injected('PUT')
      if (forced) return forced
      const refused = stale(init)
      if (refused) return refused
      const body = bodyOf(init) as FakeDraftServer['saves'][number]['body']
      server.saves.push({ ifMatch: header(init, 'If-Match'), body })
      const current = server.draft!
      const same =
        body.templateVersion === current.templateVersion &&
        JSON.stringify(body.answers) === JSON.stringify(current.answers)
      if (!same) {
        server.draft = {
          ...current,
          templateVersion: body.templateVersion,
          answers: body.answers,
          version: current.version + 1,
          updatedAt: new Date().toISOString(),
        }
      }
      return view(200)
    },
    [`POST ${base}/offer-draft/template`]: (_url, init) => {
      const forced = injected('POST template')
      if (forced) return forced
      const refused = stale(init)
      if (refused) return refused
      const current = server.draft!
      const templateId = String(bodyOf(init)['templateId'])
      if (templateId !== current.template.id) {
        server.draft = {
          ...current,
          template: { ...current.template, id: templateId },
          templateVersion: current.template.version,
          version: current.version + 1,
        }
      }
      return view(200)
    },
    [`DELETE ${base}/offer-draft`]: (_url, init) => {
      const forced = injected('DELETE')
      if (forced) return forced
      const refused = stale(init)
      if (refused) return refused
      server.draft = null
      return { status: 204 }
    },
    [`POST ${base}/offer-draft/generate`]: (_url, init) => {
      const forced = injected('POST generate')
      if (forced) return forced
      const refused = stale(init)
      if (refused) return refused
      server.draft = null
      return {
        status: 201,
        body: { id: 'o1', reference: '0001/2026', origin: 'wizard', version: 1 },
        headers: etagOf(1),
      }
    },
  }
  return { server, routes }
}
