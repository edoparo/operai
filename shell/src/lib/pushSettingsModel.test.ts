/**
 * @vitest-environment jsdom
 *
 * Pure parts of the push section's model (specs/029, T9): browser mode order (design F1) and the
 * focus target after a removal (design F5).
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('./session', () => ({
  apiFetch: vi.fn(),
  getCachedSession: vi.fn(),
  getNotifyBaseUrl: vi.fn(),
  getSession: vi.fn(),
  navigateSuite: vi.fn(),
  onBeforeSignOut: vi.fn(),
}))

import { focusAfterRemoval, pushMode } from './pushSettingsModel'

const device = (id: string) => ({ id, label: id, createdAt: '2026-10-31T09:00:00.000Z' })

describe('pushMode', () => {
  it('checks unsupported, then blocked, then on, otherwise off', () => {
    expect(pushMode({ supported: false, permission: null, thisId: 'd1' })).toEqual({
      unsupported: true,
      blocked: false,
      on: false,
    })
    expect(pushMode({ supported: true, permission: 'denied', thisId: 'd1' })).toEqual({
      unsupported: false,
      blocked: true,
      on: false,
    })
    expect(pushMode({ supported: true, permission: 'granted', thisId: 'd1' })).toEqual({
      unsupported: false,
      blocked: false,
      on: true,
    })
    expect(pushMode({ supported: true, permission: 'default', thisId: null })).toEqual({
      unsupported: false,
      blocked: false,
      on: false,
    })
  })
})

describe('focusAfterRemoval', () => {
  const rows = [device('a'), device('b'), device('c')]
  it('picks the next row, else the previous, else nothing', () => {
    expect(focusAfterRemoval(rows, 'b')).toBe('c')
    expect(focusAfterRemoval(rows, 'c')).toBe('b')
    expect(focusAfterRemoval([device('a')], 'a')).toBeNull()
  })
})
