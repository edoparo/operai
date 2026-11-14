import { describe, expect, it } from 'vitest'
import { ORIGIN_APP_LABELS, originAppLabel, type NotificationOriginApp } from './severity'

describe('originAppLabel', () => {
  it('labels every origin app notify-api accepts, including inventory (specs/20261006-hardware-inventory) and crm (specs/20261101-crm-notifications)', () => {
    const all: NotificationOriginApp[] = ['estimai', 'refund', 'admin', 'inventory', 'crm', 'meetings', 'projects']
    for (const app of all) {
      expect(ORIGIN_APP_LABELS[app]).toBeTruthy()
    }
    expect(originAppLabel('inventory')).toBe('Inventory')
    expect(originAppLabel('crm')).toBe('CRM')
    expect(originAppLabel('projects')).toBe('Projects')
    expect(originAppLabel('estimai')).toBe('EstimAI')
  })

  it('falls back to the raw id for an origin it does not know yet', () => {
    expect(originAppLabel('reviewai')).toBe('reviewai')
  })
})
