/**
 * A URL-dispatching stand-in for `shell/session`'s `apiFetch` (tests only):
 * each route is `METHOD /path` → a handler answering `{status, body}`. The
 * request reaches the real `lib/crmApi.ts` + `lib/api.ts`, so a page test also
 * exercises the request paths, query strings and headers the contract fixes.
 */
import { vi } from 'vitest'

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
  updatedAt: '2026-10-30T10:00:00.000Z',
  ...overrides,
})
