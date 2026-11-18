import { getJson, sendJson } from './api'
import type { Office, OfficeInput, OfficePatch } from './types'

/**
 * `/offices` routes of inventory-api: the list is open to every `inventory:access`
 * holder (name order, archived included); create and PATCH need `asset:manage` over
 * the office's entity. 409 `office_name_taken` / `office_in_use` narrow through `toInventoryError`.
 */

export const listOffices = (init?: RequestInit): Promise<{ items: Office[] }> =>
  getJson<{ items: Office[] }>('/offices', init)

export const createOffice = (input: OfficeInput): Promise<Office> => sendJson<Office>('/offices', 'POST', input)

export const updateOffice = (id: string, patch: OfficePatch): Promise<Office> =>
  sendJson<Office>(`/offices/${encodeURIComponent(id)}`, 'PATCH', patch)
