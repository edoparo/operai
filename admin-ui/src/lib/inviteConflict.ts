/**
 * inviteConflictMessageFor — shared 409 message mapping for `POST
 * /admin/invitations` (AC-1.3 "active user exists" / AC-1.4 "live pending
 * invitation exists").
 *
 * Extracted out of InvitationsPage.tsx so every "Invite user" entry point
 * — the Invitations tab's own button (T12) and Screen U1's parallel entry
 * point on the Users list (design.md Screen U1 "New key elements", closed as
 * a design-fidelity gap after T12) — share one copy instead of each
 * re-deriving the same fixed-template pattern-match, per "do NOT re-implement
 * invite logic."
 *
 * Distinguishes AC-1.3 (active user) vs AC-1.4 (live pending invite) 409s —
 * the backend contract carries only a `detail` string, no structured
 * discriminant field (design.md Gaps #1), so this pattern-matches the fixed
 * template text `invitations.routes.ts` actually emits.
 */
import { strings } from '../strings'

export const inviteConflictMessageFor = (detail: string | undefined): string => {
  const lower = (detail ?? '').toLowerCase()
  if (lower.includes('active user')) {
    return strings.users.invite.conflictActiveUser
  }
  if (lower.includes('pending invitation')) {
    return strings.users.invite.conflictPending
  }
  return detail ?? strings.users.invite.conflictFallback
}

/**
 * Message for a 422 `code: "domain_not_allowed"` (specs/20261105-signup-gate, AC-5.1): the
 * allowed domains rendered in the UI language from the `allowedDomains`
 * extension, else the server's English `detail`, else the generic copy. The
 * caller decides it is this case by `error.code`, never by prose.
 */
export const domainNotAllowedMessage = (
  problem: { allowedDomains?: string[]; detail?: string },
  t: Pick<typeof strings.users.invite, 'domainNotAllowed' | 'conflictFallback'> = strings.users.invite,
): string =>
  problem.allowedDomains && problem.allowedDomains.length > 0
    ? t.domainNotAllowed(problem.allowedDomains.join(', '))
    : (problem.detail ?? t.conflictFallback)
