import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('shell/session', () => ({
  apiFetch: vi.fn(),
  getCrmApiBaseUrl: vi.fn(() => 'http://crm-api.test'),
  getAuthBaseUrl: vi.fn(() => 'http://auth.test'),
}))

import { apiFetch } from 'shell/session'
import { ApiError, getJson, ifMatch, isStaleWrite, query, sendJson } from './api'
import { listDirectory, setCompanyArchived, updateDeal } from './crmApi'

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/problem+json', ...headers } })

beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
})

const catchError = async (promise: Promise<unknown>): Promise<ApiError> => {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    return error as ApiError
  }
  throw new Error('expected the call to reject')
}

const lastInit = (): RequestInit => vi.mocked(apiFetch).mock.calls.at(-1)![1] as RequestInit

describe('requests', () => {
  it('GET goes through shell/session apiFetch against crm-api', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { items: [] }))
    await expect(getJson('/companies')).resolves.toEqual({ items: [] })
    expect(apiFetch).toHaveBeenCalledWith('http://crm-api.test/companies', undefined)
  })

  it('a mutation of an existing record sends If-Match with the quoted version (ADR-0038)', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { id: 'd1' }))
    await updateDeal('d1', 7, { title: 'New' })
    const init = lastInit()
    expect(init.method).toBe('PATCH')
    expect((init.headers as Record<string, string>)['If-Match']).toBe('"7"')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ title: 'New' })
  })

  it('a body-less transition still carries If-Match and no body', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { id: 'c1' }))
    await setCompanyArchived('c1', 3, true)
    expect(vi.mocked(apiFetch).mock.calls[0]![0]).toBe('http://crm-api.test/companies/c1/archive')
    const init = lastInit()
    expect(init.body).toBeUndefined()
    expect((init.headers as Record<string, string>)['If-Match']).toBe('"3"')
  })

  it('a create sends no If-Match', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(201, { id: 'x' }))
    await sendJson('/companies', 'POST', { name: 'Acme' })
    expect((lastInit().headers as Record<string, string>)['If-Match']).toBeUndefined()
  })

  it('a 204 resolves undefined', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response(null, { status: 204 }))
    await expect(sendJson('/contacts/x', 'DELETE')).resolves.toBeUndefined()
  })

  it('the directory read targets auth, not crm-api', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { users: [] }))
    await listDirectory()
    expect(vi.mocked(apiFetch).mock.calls[0]![0]).toBe('http://auth.test/authz/users/directory')
  })
})

describe('errors', () => {
  it('maps a Problem body to ApiError with code and top-level extras', async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      json(409, { type: 't', title: 'Conflict', status: 409, detail: 'Taken', code: 'company_name_taken', companyId: 'c9' }),
    )
    const error = await catchError(getJson('/companies'))
    expect(error.status).toBe(409)
    expect(error.code).toBe('company_name_taken')
    expect(error.detail).toBe('Taken')
    expect(error.extras).toEqual({ companyId: 'c9' })
  })

  it('reads Retry-After on a 429', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(429, { title: 'Too Many Requests', status: 429 }, { 'Retry-After': '12' }))
    expect((await catchError(getJson('/x'))).retryAfterSeconds).toBe(12)
  })

  it('falls back to the HTTP status when the body is not JSON', async () => {
    vi.mocked(apiFetch).mockResolvedValue(new Response('oops', { status: 502, statusText: 'Bad Gateway' }))
    const error = await catchError(getJson('/x'))
    expect(error.status).toBe(502)
    expect(error.title).toBe('Bad Gateway')
  })

  it('isStaleWrite is true for 409 version_conflict and for 428, and nothing else', () => {
    expect(isStaleWrite(new ApiError({ status: 409, title: 'c', code: 'version_conflict' }))).toBe(true)
    expect(isStaleWrite(new ApiError({ status: 428, title: 'p' }))).toBe(true)
    expect(isStaleWrite(new ApiError({ status: 409, title: 'c', code: 'company_name_taken' }))).toBe(false)
    expect(isStaleWrite(new TypeError('network'))).toBe(false)
  })
})

describe('helpers', () => {
  it('ifMatch quotes the version as a strong ETag', () => {
    expect(ifMatch(12)).toBe('"12"')
  })

  it('query keeps only defined, non-empty values', () => {
    expect(query({ q: '', status: undefined, page: 2, open: true, ownerId: null })).toBe('?page=2&open=true')
    expect(query({})).toBe('')
  })
})
