/**
 * A URL-dispatching stand-in for `shell/session`'s `apiFetch` (tests only):
 * each route is `METHOD /path` → a handler answering `{status, body}`. The
 * request reaches the real `lib/projectsApi.ts` + `lib/api.ts`, so a page test
 * also exercises the request paths, query strings and headers the contract
 * fixes. Modelled on crm-ui/src/test-support/fakeApi.ts.
 */
import { vi } from 'vitest'
import type { Person, Project, ProjectSummary, ProjectType, PurchaseOrder, Scope, Terms } from '../lib/types'

export type FakeAnswer = { status: number; body?: unknown }
export type FakeHandler = (url: URL, init: RequestInit | undefined) => FakeAnswer | Promise<FakeAnswer>

export function fakeApi(routes: Record<string, FakeHandler>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const key = `${init?.method ?? 'GET'} ${url.pathname}`
    const handler = routes[key]
    if (!handler) return new Response(JSON.stringify({ status: 404, title: 'Not Found' }), { status: 404 })
    const answer = await handler(url, init)
    return answer.body === undefined
      ? new Response(null, { status: answer.status })
      : new Response(JSON.stringify(answer.body), { status: answer.status })
  })
}

export const page = <T>(items: T[], total = items.length, pageNumber = 1, pageSize = 25) => ({
  items,
  total,
  page: pageNumber,
  pageSize,
})

/** A `Problem` answer: the shape every non-2xx of projects-api has. */
export const problem = (status: number, code?: string, extras: Record<string, unknown> = {}, detail = 'Problem') => ({
  status,
  body: { type: 'about:blank', title: 'Problem', status, detail, ...(code ? { code } : {}), ...extras },
})

export const ADA: Person = { id: 'u-ada', name: 'Ada Lovelace', deleted: false }
export const OLGA: Person = { id: 'u-ops', name: 'Olga Ops', deleted: false }

/** A scope: nothing by default, so a test of something gated says what it grants. */
export const scope = (overrides: Partial<Scope> = {}): Scope => ({
  manage: [],
  managesAll: false,
  bexio: false,
  take: [],
  oversees: false,
  ...overrides,
})

export const projectSummary = (overrides: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: 'p1',
  name: 'Intranet',
  type: 't_and_m',
  state: 'active',
  entity: 'welld_ch',
  company: { id: 'c1', name: 'Acme SA' },
  projectManager: ADA,
  awaitingProjectManager: false,
  ...overrides,
})

/** A purchase order made from a won deal: no estimate, no referent, the deal still won. */
export const purchaseOrderOf = (overrides: Partial<PurchaseOrder> = {}): PurchaseOrder => ({
  id: 'po1',
  deal: { id: 'd1', title: 'Website relaunch', won: true },
  estimate: null,
  bexioOrderId: null,
  referent: null,
  opsManager: OLGA,
  version: 2,
  ...overrides,
})

/** The terms of a project as `GET /projects/:id` reads them, flat; `members` are those of the type. */
export const termsOf = (type: ProjectType, members: Partial<Terms> = {}, overrides: Partial<Terms> = {}): Terms => ({
  id: 't1',
  type,
  startDate: '2026-02-01',
  endDate: null,
  version: 4,
  ...members,
  ...overrides,
})

/** A full `Project` (`GET /projects/:id`): an active, hand-made one — no team, no terms, no purchase order. */
export const projectDetail = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1',
  name: 'Intranet',
  type: 't_and_m',
  state: 'active',
  stateBeforeHold: null,
  entity: 'welld_ch',
  company: { id: 'c1', name: 'Acme SA' },
  projectManager: ADA,
  awaitingProjectManager: false,
  team: [],
  purchaseOrder: null,
  terms: null,
  startDate: null,
  endDate: null,
  version: 3,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-30T10:00:00.000Z',
  ...overrides,
})
