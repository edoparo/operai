# 20261105 — Access to the suite is decided at user creation: only an invitation (or the bootstrap admin) creates a user; everyone else joins a waiting list

**Date:** 2026-11-05
**Status:** Accepted (specs/20261105-signup-gate; domain list, bootstrap-admin exemption and "a rejection is not reopened" confirmed by the user 2026-11-05)
**Deciders:** wellD
**Project:** Operai

---

## Context

Until now, anyone who completed a Google or GitHub sign-in became an Operai user holding the
baseline `employee` role, invited or not, whatever the email domain. A colleague entered
without being invited, and an outsider with a personal account could have. specs/20260713-user-invitations says the
suite has "no self-service sign-up" while its own Non-goals keep the uninvited path open, so
documented intent and behaviour disagreed. The suite holds financial, personnel and client
data; who gets in must be an admin's decision, not a side effect of owning an OAuth account.

## Decision

We decided that access is decided once, at the moment a `user` row would be created
(better-auth `databaseHooks.user.create.before`), in this order:

1. **Domain not allowed** (not in `ALLOWED_SIGNUP_DOMAINS`, `welld.ch,welld.it`, exact and
   case-insensitive match on the part after the last `@`): refuse with `signup_domain_not_allowed`,
   record nothing. This applies even when an invitation exists for that address.
2. **Live pending invitation and provider-verified email**: create the user; the existing
   `user.create.after` applies the invitation (specs/20260713-user-invitations, unchanged).
3. **Bootstrap admin** (`BOOTSTRAP_ADMIN_EMAIL`, verified): create the user (`admin` + `employee`).
4. **Anyone else**: write an `access_request` row (the waiting list, one per email, states
   `pending`/`approved`/`rejected`) and refuse with `access_request_pending` or
   `access_request_rejected`. No user, account, role or session exists.

Approving a request **creates an invitation** through specs/20260713-user-invitations's flow (same function as
`POST /admin/invitations`, same email, same audit row, plus `access_request.approve`); there is
no second activation path and no user row until the person's own sign-in matches the invitation.
Allowed domains are deployment configuration (required env, process exits if missing or
malformed), not an admin setting. The dev-only `test-auth` endpoint creates its `@operai.test`
user with Prisma plus `assignBaselineRolesToNewUser`, outside the hook.

## Failure shape

**A system that says "invitation only" but admits anyone who can prove an identity somewhere
else.** Authentication (who are you?) is silently treated as authorization (may you be here?):
the first sign-in of any provider account creates a principal with default privileges, so the
real admission rule is "owns an account at a provider we accept". The defect is invisible in
normal use because every legitimate user still works; it shows up only when an unintended person
arrives. A close cousin is a gate placed *after* the principal exists (a refused session, a
disabled flag): the identity row, and anything that trusts it, already exists.

Where else this shape can appear, including the mirror-image positions:

- **Creation versus re-entry.** The gate belongs at the single point where a principal comes into
  being. A second creation path (import script, admin "create user", SSO, test endpoint, a new
  provider) is a way around it. Recognise it by any code that inserts into the identity table
  without going through the gate; each one must be deliberate, gated by its own rule, and listed.
- **Refuse versus remember.** Refusing a person without recording the attempt loses the demand
  signal; recording it in the identity table turns "waiting" into a state every identity query must
  know about. Keep requests in a separate record that grants nothing.
- **Approve versus activate.** Approval must produce the same artefact an admin's direct invite
  produces, never a shortcut that makes the principal directly; otherwise there are two activation
  paths with two sets of rules.
- **Inbound and outbound.** The same question ("may this identity exist?") also arises for service
  principals, imported records and federated accounts; the rule is the same: decided at creation,
  by something an admin controls, not by what the identity proves about itself.
- **Test exemptions.** A bypass for tests placed inside the production gate is the same hole
  guarded only by an environment flag; tests get their own creation path instead.

## Options considered

### Option A — Gate at `user.create.before`; separate `access_request` table; approval creates an invitation (chosen)
No row exists for a refused person; the waiting list is a plain table that grants nothing;
specs/20260713-user-invitations's invitation flow stays the only way in.

**Pros:** nothing downstream (JWT issuance, resource servers, "active user" queries) ever sees a
non-admitted person; one activation path; existing users untouched (the hook never fires for a
known identity); distinct, redirectable error codes through better-auth's `?error=`.
**Cons:** depends on better-auth's abort contract (risk R1); the waiting-list write must sit
outside better-auth's transaction; a small window between gate and after-hook (risk R2).

### Option B — A `pending` user row whose session is refused
**Pros:** the person is a normal row; approval is a status flip.
**Cons:** every "active user" query in `auth` must learn a new state; a row with an issued JWT
already reaches estimai-api, which is not authorization-enforcing (ADR 20260807-record-level-acl-resource-server-owned-access-primitive). Rejected.

### Option C — better-auth `disableImplicitSignUp`
**Pros:** built in. **Cons:** cannot record a waiting list and cannot distinguish the domain
refusal from the rest. Rejected.

### Option D — Google's `hd` parameter alone
**Pros:** trivial. **Cons:** only a hint to the account picker, enforced by the client, and
irrelevant to GitHub. Rejected.

### Option E — Approve creates the user directly
**Cons:** a second activation path beside specs/20260713-user-invitations with its own role-assignment rules. Rejected.

### Option F — An `@operai.test` exemption inside the production gate
**Cons:** puts a test branch into the sign-up path, guarded only by environment flags. Rejected;
`test-auth` bypasses the hook by creating its user through Prisma.

## Consequences

**Positive:**
- Owning a Google or GitHub account is no longer enough to enter; outsiders create no data in `auth`.
- Admins see and decide a waiting list (Admin > Users > Access requests); every decision is audited
  (`access_request.approve` / `.reject`, Tier 2, ADR 20260804-two-tier-audit-assurance-auth-audit-log-application-level).
- A person activated by any invitation leaves the waiting list (`approved`) in the same transaction.

**Negative / trade-offs:**
- **Amends specs/20260713-auth-roles-permissions AC-6.3 and specs/20260713-user-invitations's Non-goals**: an uninvited sign-in no longer yields
  `employee`. Both specs are changed to point to specs/20261105-signup-gate.
- Existing users (including uninvited or outside-domain ones) are untouched; reviewing them is a
  manual task with the query in `infra/README.md`.
- A rejection is not reopened by signing in again; an admin can still invite the person directly.
- Invitations to outside-domain addresses are refused at creation (422 `domain_not_allowed`);
  pre-existing ones stay listed and revocable but can never be accepted.
- The `access_request` write deliberately uses the module `db` client, not better-auth's
  transaction, so it survives the throw that rolls user creation back.
- Refusals log one structured line (`auth.signup_refused`, reason, request id) with no email or name.
- `ALLOWED_SIGNUP_DOMAINS` is a new required env var (env-doctor manifest, template, `.env.example`).

**Risks:**
- **R1: better-auth changes the abort contract** (a thrown `APIError` stops mapping to `?error=`, or
  the request write joins the callback transaction), so the gate could fail open or lose the list.
  Mitigation: integration tests call the real `internalAdapter.createOAuthUser` and assert no user
  row and a surviving `access_request`; any upgrade that breaks either fails them. Any unexpected
  error inside the gate propagates, so no user is created (fails closed).
- **R2: an invitation dies between the gate and `user.create.after`.** The person is created with
  `employee` and no invitation applied. Accepted: the window is one callback, and the user is
  visible in Users for an admin to delete.
- Test sign-in bypassing the hook means e2e cannot catch a gate regression; the gate's coverage
  lives in the integration tests.

## Compliance notes

- GDPR / data-protection impact: low. The waiting list stores name, email and provider of people
  who are not users; kept indefinitely like invitations (user decision), no requester-facing view.
  Logs carry neither.
- Data residency: compliant; stored in `auth`'s EU database.
- Audit trail: required; admin decisions are in `audit_log`.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
