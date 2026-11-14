/**
 * accessRequestOutcomeFor — maps a failed approve/reject call (specs/20261105-signup-gate, design.md F2–F4)
 * onto what the page does. Decided by `ApiError.status` and `code`, never by the English
 * `detail` (unlike the older `inviteConflict.ts`).
 *
 *   - `refresh`   — the request is no longer actionable (409 already_decided, 404): close the
 *                   dialog, reload the list, show a warning banner (AC-3.6).
 *   - `forbidden` — 403: the page shows `PermissionDenied` (AC-3.10).
 *   - `inline`    — keep the dialog open and show the message in it (AC-3.5 and the rest).
 */
import { ApiError } from './adminApi'
import { domainNotAllowedMessage } from './inviteConflict'
import { strings } from '../strings'

export type AccessRequestOutcome =
  { kind: 'refresh'; message: string } | { kind: 'forbidden' } | { kind: 'inline'; message: string }

export const accessRequestOutcomeFor = (
  error: unknown,
  email: string,
  action: 'approve' | 'reject',
): AccessRequestOutcome => {
  const t = strings.accessRequests
  const generic = action === 'approve' ? t.approveFailed : t.rejectFailed

  if (!(error instanceof ApiError)) return { kind: 'inline', message: generic }

  if (error.status === 403) return { kind: 'forbidden' }
  if (error.status === 404) return { kind: 'refresh', message: t.conflict.notFound }
  if (error.status === 409) {
    if (error.code === 'already_decided') return { kind: 'refresh', message: t.conflict.alreadyDecided }
    if (error.code === 'active_user_exists') return { kind: 'inline', message: t.conflict.activeUser(email) }
    if (error.code === 'pending_invitation_exists') {
      return { kind: 'inline', message: t.conflict.pendingInvitation(email) }
    }
    return { kind: 'inline', message: generic }
  }
  if (error.status === 422) {
    return error.code === 'domain_not_allowed'
      ? { kind: 'inline', message: domainNotAllowedMessage(error) }
      : { kind: 'inline', message: strings.users.invite.stale }
  }
  return { kind: 'inline', message: generic }
}
