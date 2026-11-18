import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('shell/session', () => ({
  apiFetch: vi.fn(),
  getInventoryApiBaseUrl: vi.fn(() => 'http://inventory-api.test'),
  getAuthBaseUrl: vi.fn(() => 'http://auth.test'),
}))

import { apiFetch } from 'shell/session'
import { createOffice, listOffices, updateOffice } from './officesApi'
import { toInventoryError } from './types'
import { ApiError } from './api'

const BASE = 'http://inventory-api.test'
const json = (status: number, body: unknown, type = 'application/json'): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': type } })
const office = { id: 'o1', name: 'CH - Agno', entity: 'welld_ch', archived: false, assetCount: 0 }
const last = () => {
  const [url, init] = vi.mocked(apiFetch).mock.calls.at(-1) as [string, RequestInit | undefined]
  return {
    url,
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
  }
}

beforeEach(() => vi.mocked(apiFetch).mockReset())

describe('officesApi', () => {
  it('GET /offices', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(200, { items: [office] }))
    await expect(listOffices()).resolves.toEqual({ items: [office] })
    expect(last()).toMatchObject({ url: `${BASE}/offices`, method: 'GET' })
  })

  it('POST /offices sends name and entity', async () => {
    vi.mocked(apiFetch).mockResolvedValue(json(201, office))
    await createOffice({ name: 'CH - Agno', entity: 'welld_ch' })
    expect(last()).toMatchObject({
      url: `${BASE}/offices`,
      method: 'POST',
      body: { name: 'CH - Agno', entity: 'welld_ch' },
    })
  })

  it('PATCH /offices/{id} sends only the patch; 409 codes map to known errors', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(json(200, office))
    await updateOffice('o1', { archived: true })
    expect(last()).toMatchObject({ url: `${BASE}/offices/o1`, method: 'PATCH', body: { archived: true } })

    vi.mocked(apiFetch).mockResolvedValueOnce(
      json(409, { title: 'Conflict', status: 409, code: 'office_in_use' }, 'application/problem+json'),
    )
    const error = await updateOffice('o1', { archived: true }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(toInventoryError(error)).toMatchObject({ code: 'office_in_use', status: 409 })
  })
})
