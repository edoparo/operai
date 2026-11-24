// I-9 (specs/20261124-receipt-numbers-from-the-register, security review): the e2e release step auto-confirms every proposal, so it
// must not be pointed at a database that is not on this machine unless the operator says so.
import { describe, expect, it } from 'vitest'
import { assertLocalDatabase } from '../e2e/global-setup'

const VARIABLE = 'E2E_REFUND_DATABASE_URL'

describe('assertLocalDatabase', () => {
  it.each([
    'postgresql://u:p@localhost:5432/refund',
    'postgres://u:p@127.0.0.1:5432/refund',
    'postgresql://u:p@[::1]:5432/refund',
  ])('allows a local host (%s)', (url) => {
    expect(() => assertLocalDatabase(url, VARIABLE, {})).not.toThrow()
  })

  it('refuses a remote host, and never echoes the URL, the password or the host', () => {
    const url = 'postgresql://admin:s3cret-pw@db.prod.example.com:5432/refund'
    let message = ''
    try {
      assertLocalDatabase(url, VARIABLE, {})
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain(VARIABLE)
    expect(message).toContain('E2E_ALLOW_REMOTE_DB=1')
    expect(message).not.toMatch(/s3cret-pw|admin|prod\.example|postgres/)
  })

  it('refuses a host that merely starts with a local name', () => {
    expect(() => assertLocalDatabase('postgresql://u:p@localhost.evil.example/refund', VARIABLE, {})).toThrow(/not on this machine/)
    expect(() => assertLocalDatabase('postgresql://u:p@127.0.0.1.evil.example/refund', VARIABLE, {})).toThrow(/not on this machine/)
  })

  it('allows a remote host only with E2E_ALLOW_REMOTE_DB=1 exactly', () => {
    const url = 'postgresql://u:p@db.example.com/refund'
    expect(() => assertLocalDatabase(url, VARIABLE, { E2E_ALLOW_REMOTE_DB: '1' })).not.toThrow()
    expect(() => assertLocalDatabase(url, VARIABLE, { E2E_ALLOW_REMOTE_DB: 'true' })).toThrow()
  })
})
