---
id: 023
slug: signup-gate
status: in-progress
rigor: production
created: 2026-11-05
approved: 2026-11-05
---

# Access to Operai only by invitation, with a waiting list

## Problem

Anyone who completes a Google or GitHub sign-in today becomes an Operai user and is given the
baseline `employee` role, with or without an invitation and whatever their email domain. A
colleague (carlotta.roggero@welld.ch) entered and received `employee` without ever being
invited; an outsider with a personal Gmail or GitHub account could do the same. specs/006
describes the suite as having "no self-service sign-up" (Problem) while its own Non-goals
keep the uninvited sign-in path open, so the documented intent and the behaviour disagree.
The suite holds financial, personnel and client data, so who gets in must be an admin's
decision, not a side effect of owning an account at an OAuth provider.

## Domain language

Terms used throughout (to be reused in the plan, APIs and UI copy). Existing terms —
**invitation**, **invitation state**, **activation**, **soft-deleted user** — keep their
specs/006 meaning.

- **allowed domain** — an email domain whose holders may become Operai users at all:
  `welld.ch` and `welld.it`. Matched exactly and case-insensitively on the part after `@`;
  a subdomain (`x.welld.ch`) is not an allowed domain.
- **access request** — the waiting-list record created when a person with an allowed-domain
  email signs in without a live pending invitation. It is not a `user`: it grants nothing
  and holds only the person's email, display name, sign-in provider and when they last
  asked. At most one per email.
- **waiting list** — the set of access requests in state `pending`.
- **access request state** — `pending` (waiting for an admin), `approved` (an admin
  approved it, or the person was activated by an invitation by any other route) or
  `rejected` (an admin turned it down).
- **approve** — an admin's decision on a pending access request that creates an invitation
  for the requester's email, with the roles/departments the admin chooses, through the
  existing invitation flow (specs/006 US-1), including its email.
- **reject** — an admin's decision on a pending access request that closes it without
  granting anything.

## User stories

### US-1: Only invited people enter

As wellD, I want only people an admin has invited to become Operai users, so that owning a
Google or GitHub account is never enough to see the suite's data.

**Acceptance criteria:**
- AC-1.1: Given a person who has never signed in to Operai, whose email is in an allowed
  domain and for whom a live pending invitation exists (specs/006), when they complete
  sign-in, then they are activated exactly as specs/006 US-2 describes — holding exactly
  the invitation's roles/departments — and land in the suite.
- AC-1.2: Given a person who has never signed in, whose email is in an allowed domain and
  for whom NO live pending invitation exists (none at all, or only expired/revoked/accepted
  ones), when they complete sign-in, then no Operai user is created, they hold no role and
  no session, and they see the hosted sign-in page with a message stating that their
  request has been recorded and an administrator will review it.
- AC-1.3: Given a person whose email is NOT in an allowed domain, when they complete
  sign-in — whether or not an invitation exists for that email — then no Operai user is
  created, no access request is recorded, and they see the hosted sign-in page with a
  message, distinct from AC-1.2's, stating that sign-in is reserved for wellD accounts.
- AC-1.4: Given the configured bootstrap admin email (specs/004 AC-6.1) belongs to an
  allowed domain, when that person signs in for the first time with no invitation, then
  they are created and receive `admin` (and `employee`, as specs/004 grants today) — the
  only first sign-in that needs no invitation. *(Delegated decision, confirmed by the user 2026-11-05:
  the bootstrap admin is exempt from the invitation requirement, not from the domain rule.)*
- AC-1.5: Given a first sign-in that does not satisfy AC-1.1 or AC-1.4, then the person
  receives no role at all — in particular never the baseline `employee` role.
- AC-1.6: Given a user who already existed before this feature (including ones who entered
  without an invitation, or whose email is outside the allowed domains), when they sign in,
  then they enter exactly as before, with their existing roles; this feature changes
  nothing for them.
- AC-1.7: Given a soft-deleted user (specs/006 US-5), when they sign in, then the specs/006
  behaviour holds unchanged (re-activated only by a live pending invitation, otherwise
  refused), and no access request is recorded for them.
- AC-1.8: Given an allowed-domain email in any letter case (e.g. `Name@WellD.CH`), then it
  is treated as in an allowed domain; given `name@sub.welld.ch` or `name@welld.ch.example`,
  then it is not.
- AC-1.9: Given the development-only test sign-in used by the end-to-end suite, then it
  keeps producing signed-in test users as it does today.

### US-2: An uninvited colleague joins the waiting list

As a wellD colleague who was not invited, I want my sign-in attempt to put me on a waiting
list, so that I can ask for access without having to find out who the admins are.

**Acceptance criteria:**
- AC-2.1: Given AC-1.2 applies and no access request exists for that email, then a
  `pending` access request is recorded with the email (lower-cased), the display name and
  the provider the person used, and the time of the attempt.
- AC-2.2: Given AC-1.2 applies and a `pending` access request already exists for that
  email, then no second request is recorded; the existing one's time, name and provider are
  updated to this attempt's, and the person sees the same AC-1.2 message.
- AC-2.3: Given AC-1.2 applies and the existing access request for that email is
  `rejected`, then it stays `rejected`, no new pending request is created, no admin is
  notified, and the person sees a message stating that access was not granted and to
  contact an administrator. *(Delegated decision, confirmed by the user 2026-11-05: a
  rejection is not reopened by signing in again; an admin can still invite the person
  directly.)*
- AC-2.4: Given AC-1.2 applies and the existing access request for that email is
  `approved` but its invitation is no longer live (expired or revoked), then the request
  returns to `pending` with this attempt's time, and admins are notified as in US-4.
- AC-2.5: Given a person on the waiting list, then nothing about their request is visible
  to them beyond the AC-1.2 / AC-2.3 messages — there is no page where they can see or
  edit it.

### US-3: An admin approves or rejects a request

As an admin, I want to see who is waiting for access and approve or reject each request, so
that colleagues get in with the right access and no one else does.

**Acceptance criteria:**
- AC-3.1: Given an admin opens the admin tool's access-requests screen, then they see the
  pending access requests, most recent first, each with email, name, provider and when
  they last asked; they can also switch to see approved and rejected requests, each with
  who decided and when.
- AC-3.2: Given a pending request, when an admin approves it choosing zero or more roles
  and zero or more departments, then an invitation for the requester's email with exactly
  those roles/departments is created through the existing invitation flow (specs/006 US-1,
  invitation email included), and the request becomes `approved`, recording the deciding
  admin and time.
- AC-3.3: Given AC-3.2 succeeds, when the requester then signs in, then they are activated
  by that invitation as in AC-1.1.
- AC-3.4: Given a pending request, when an admin rejects it, then it becomes `rejected`,
  recording the deciding admin and time; no invitation is created and nothing is sent to
  the requester.
- AC-3.5: Given a pending request for an email that already has a live pending invitation
  or an active user, when an admin tries to approve it, then the approval is refused with a
  message saying which of the two already exists, and the request is left unchanged.
- AC-3.6: Given a request that is no longer `pending`, when an admin tries to approve or
  reject it (e.g. another admin decided first), then the action is refused with a message
  that it was already decided, and the earlier decision stands.
- AC-3.7: Given an approval whose invitation is created but whose invitation email fails to
  send, then the request is still `approved` and the invitation shows the delivery failure
  exactly as specs/006 shows it for any invitation (resendable from the Invitations
  screen).
- AC-3.8: Given a person who has a `pending` access request is activated by an invitation
  created any other way (e.g. directly from the Invitations screen), then their request
  becomes `approved` at activation and leaves the waiting list.
- AC-3.9: Given an approval or a rejection, then it is recorded in the admin audit trail
  with the acting admin, the request's email and the decision (and, for an approval, the
  roles/departments granted).
- AC-3.10: Given a non-admin, when they open the access-requests screen or call its
  underlying API to list, approve or reject, then they are denied, consistent with
  specs/006 AC-1.8.

### US-4: Admins learn that someone is waiting

As an admin, I want to be told when someone joins the waiting list, so that a colleague is
not left waiting because nobody looked.

**Acceptance criteria:**
- AC-4.1: Given a new `pending` access request is recorded (AC-2.1) or a request returns to
  `pending` (AC-2.4), then every active admin receives an in-app notification and an email
  saying who asked (name and email), linking to the access-requests screen.
- AC-4.2: Given AC-2.2 (a repeat attempt while already pending), then no further
  notification is sent. *(Delegated decision, confirmed by the user 2026-11-05: one
  notice per request, not per attempt.)*
- AC-4.3: Given the notification or its email cannot be delivered, then the access request
  is still recorded and the requester still sees the AC-1.2 message — delivery is best
  effort and never blocks or undoes the request.

### US-5: Invitations go only to allowed domains

As an admin, I want the invitation form to refuse addresses outside wellD's domains, so that
I never send an invitation that could not be accepted.

**Acceptance criteria:**
- AC-5.1: Given an admin creates an invitation (from the Invitations screen or by approving
  a request), when the email is not in an allowed domain, then the invitation is refused
  with a message naming the allowed domains, and nothing is stored or sent.
- AC-5.2: Given an existing pending invitation for an email outside the allowed domains
  (created before this feature), then it cannot be accepted (AC-1.3 applies) and it stays
  visible in the Invitations screen, where an admin can revoke it.

### US-6: The documented intent matches the behaviour

As a maintainer, I want the specs to say who may enter Operai in one consistent way, so that
the next feature is not built on the contradiction this one fixes.

**Acceptance criteria:**
- AC-6.1: Given specs/006 and specs/004, then every statement that an uninvited person
  signing in receives `employee` is amended to point to this spec, and no spec in `specs/`
  still describes that path as current behaviour.
- AC-6.2: Given the operator documentation, then it includes a way to list the users who
  entered before this feature without an accepted invitation, and those outside the
  allowed domains, so an admin can review them by hand (AC-1.6 leaves them untouched).

## Non-goals

- **Changing or removing existing users.** Users who entered before this feature keep
  their account and roles (user decision, 2026-11-05); reviewing them is a manual admin
  task using AC-6.2's query and specs/006's deletion.
- **A self-service way to withdraw, edit or follow an access request.** The requester only
  ever sees the sign-in page message (AC-2.5).
- **Automatic expiry or clean-up of access requests.** Requests stay until decided; no
  time-based state is introduced.
- **A narrower "access approver" permission.** Approving and rejecting use the existing
  admin gate, like inviting does (specs/006 Non-goals).
- **Telling the requester the outcome.** An approval reaches them as the invitation email;
  a rejection sends nothing.
- **Adding an email-verification step.** No new verification is introduced; the existing
  rule that only a provider-verified email can activate an invitation stays as it is.
- **Admin-configurable allowed domains.** The list is deployment configuration, not a
  setting in the admin tool.

## Constraints

Technical decisions given by the user, recorded verbatim for the plan:

- Allowed domains: welld.ch and welld.it only (env `ALLOWED_SIGNUP_DOMAINS`).
- Keep the existing `emailVerified === true` requirement for invitation matching; add no
  new verification step ("la verifica della email non è necessaria dato che usiamo gmail e
  github").
- Approving a request creates an invitation through the existing invitation flow (email
  sent).
- Admin notification: in-app and email via notify-api `/system/notifications` with
  `email: true` (ADR-0017/0049/0056); best effort, never blocks the request.
- Mechanism (verified against better-auth 1.6.23): a `user.create.before` hook throwing an
  `APIError` aborts user creation and the OAuth callback redirects to
  `/sign-in?error=<message words joined by _>`, so distinct codes such as
  `access_request_pending` / `signup_domain_not_allowed` are achievable.
- The dev-only test-auth mint path used by the shell e2e must keep working.
- Work lands directly on `main` from a separate worktree; spec number 023 and ADR number
  0071 are used because 021–022 and ADR-0058–0070 are taken on `feat/021-meetings`.

## Open questions

- [x] How long are rejected and approved access requests kept? — Resolved by the user
  2026-11-05: indefinitely, like invitations, for audit. No deletion or expiry (see
  Non-goals).
