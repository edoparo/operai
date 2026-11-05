import { describe, expect, it } from 'vitest'
import { ApiError } from './adminApi'
import { accessRequestOutcomeFor } from './accessRequestConflict'
import { strings } from '../strings'

const t = strings.accessRequests
const problem = (status: number, code?: string, extra: Record<string, unknown> = {}) =>
  new ApiError({ status, title: 'T', detail: 'server detail', code, ...extra } as never)

describe('accessRequestOutcomeFor (approve)', () => {
  it('409 already_decided -> refresh with the already-decided warning (AC-3.6)', () => {
    expect(accessRequestOutcomeFor(problem(409, 'already_decided'), 'a@welld.ch', 'approve')).toEqual({
      kind: 'refresh',
      message: t.conflict.alreadyDecided,
    })
  })
  it('404 -> refresh with the not-found warning', () => {
    expect(accessRequestOutcomeFor(problem(404), 'a@welld.ch', 'approve')).toEqual({
      kind: 'refresh',
      message: t.conflict.notFound,
    })
  })
  it('409 active_user_exists -> inline, by code not prose (AC-3.5)', () => {
    expect(accessRequestOutcomeFor(problem(409, 'active_user_exists'), 'a@welld.ch', 'approve')).toEqual({
      kind: 'inline',
      message: t.conflict.activeUser('a@welld.ch'),
    })
  })
  it('409 pending_invitation_exists -> inline (AC-3.5)', () => {
    expect(accessRequestOutcomeFor(problem(409, 'pending_invitation_exists'), 'a@welld.ch', 'approve')).toEqual({
      kind: 'inline',
      message: t.conflict.pendingInvitation('a@welld.ch'),
    })
  })
  it('422 domain_not_allowed -> localised domain message from allowedDomains', () => {
    const out = accessRequestOutcomeFor(
      problem(422, 'domain_not_allowed', { allowedDomains: ['welld.ch', 'welld.it'] }),
      'a@x.com',
      'approve',
    )
    expect(out).toEqual({ kind: 'inline', message: strings.users.invite.domainNotAllowed('welld.ch, welld.it') })
  })
  it('other 422 -> stale roles/departments copy', () => {
    expect(accessRequestOutcomeFor(problem(422), 'a@welld.ch', 'approve')).toEqual({
      kind: 'inline',
      message: strings.users.invite.stale,
    })
  })
  it('403 -> forbidden (page shows PermissionDenied, AC-3.10)', () => {
    expect(accessRequestOutcomeFor(problem(403), 'a@welld.ch', 'approve')).toEqual({ kind: 'forbidden' })
  })
  it('network / 5xx / unknown -> generic per-action message', () => {
    expect(accessRequestOutcomeFor(problem(500), 'a@welld.ch', 'approve')).toEqual({
      kind: 'inline',
      message: t.approveFailed,
    })
    expect(accessRequestOutcomeFor(new Error('net'), 'a@welld.ch', 'reject')).toEqual({
      kind: 'inline',
      message: t.rejectFailed,
    })
  })
})
