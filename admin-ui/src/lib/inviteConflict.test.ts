import { describe, expect, it } from 'vitest'
import { en, it as itCatalog } from '../strings'
import { domainNotAllowedMessage } from './inviteConflict'

describe('domainNotAllowedMessage (specs/023 T8, AC-5.1)', () => {
  const problem = {
    allowedDomains: ['welld.ch', 'welld.it'],
    detail: 'Invitations can only be sent to welld.ch, welld.it addresses',
  }

  it('names the allowed domains in English', () => {
    expect(domainNotAllowedMessage(problem, en.users.invite)).toBe(
      'Invitations can only be sent to welld.ch, welld.it addresses.',
    )
  })

  it('names the allowed domains in Italian', () => {
    expect(domainNotAllowedMessage(problem, itCatalog.users.invite)).toBe(
      'Gli inviti possono essere inviati solo a indirizzi welld.ch, welld.it.',
    )
  })

  it('falls back to the server detail when allowedDomains is missing or empty', () => {
    expect(domainNotAllowedMessage({ detail: 'server text' }, en.users.invite)).toBe('server text')
    expect(domainNotAllowedMessage({ allowedDomains: [], detail: 'server text' }, en.users.invite)).toBe('server text')
  })

  it('falls back to the generic conflict copy when there is nothing at all', () => {
    expect(domainNotAllowedMessage({}, en.users.invite)).toBe(en.users.invite.conflictFallback)
  })
})
