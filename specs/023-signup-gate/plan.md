---
spec: 023
status: approved
approved: 2026-11-05
---

# Plan: Access to Operai only by invitation, with a waiting list

## Architecture

The whole decision happens in `auth`, at the one moment a person would become a user: the
creation of their `user` row during the OAuth callback. Nothing changes for an existing row
(AC-1.6, AC-1.7), because better-auth creates a row only for an identity it has never seen.

### Components

| Component | Change |
|---|---|
| `auth/src/signup/` (new) | `allowedDomains.ts` (pure domain match), `signupGate.ts` (the decision + the waiting-list write), `accessRequests.repo.ts`, `accessRequests.routes.ts` + `.schemas.ts` (admin API), `notifyAdmins.ts` |
| `auth/src/auth/auth.config.ts` | new `databaseHooks.user.create.before` calling the gate; `applyLivePendingInvitationOnUserCreate` also closes the person's pending access request (AC-3.8) |
| `auth/src/invitations/` | the create handler's body moves to `createInvitation.ts` (validation → transaction → email), reused by `POST /admin/invitations` and by approve; adds the allowed-domain check (AC-5.1) |
| `auth/src/authz/audit.ts` | `withAudit`'s `entry` also accepts an array, so approve writes `invitation.create` AND `access_request.approve` in one transaction |
| `auth/src/test-auth/test-auth.routes.ts` | creates its `@operai.test` user through Prisma (email lower-cased) + `assignBaselineRolesToNewUser` + `applyLivePendingInvitationOnUserCreate` instead of `internalAdapter.createUser`, so it never passes through the gate but still activates a live invitation (AC-1.9; amended 2026-11-05) |
| `auth/src/system/selfServiceToken.ts` | `SELF_SERVICE_SCOPES` becomes `["emails.send", "notifications.push"]` |
| `auth/src/lib/notify.ts` | `pushSystemNotification()` for `POST /system/notifications`, same token provider, same never-throw posture as `sendInvitationEmail` |
| `auth/src/signin/signin.routes.ts` | three new `ERROR_MESSAGES` entries |
| `auth/src/lib/env.ts` | required `ALLOWED_SIGNUP_DOMAINS`; refuses a reserved test domain when `NODE_ENV=production` (amended 2026-11-05) |
| `notify-api/src/system/systemAuth.middleware.ts` | `SERVICE_ORIGIN_BINDINGS["system:auth"] = ["admin"]` |
| `admin-ui` | "Access requests" as the third view of the Users section (`/users/access-requests`): list with status filter, approve dialog (roles + departments), reject confirm; `adminApi.ts` client; en/it strings |
| `tools/env-doctor/manifest.ts` + check, `auth/.env.example`, the `auth.env` production template | `ALLOWED_SIGNUP_DOMAINS`; production check fails on a reserved test domain (amended 2026-11-05) |
| `auth/scripts/e2e-invite-fixtures.ts` | `seed-access-request` / `clear-access-requests` commands for the e2e |

### The sign-up gate (`user.create.before`)

Evaluated in this order. The input is the profile better-auth is about to persist, which comes
from the provider (email lower-cased by better-auth, `emailVerified`, `name`). The provider
id comes from the callback context's `params.id`, or `unknown` when it is absent.

1. **Domain not allowed** (`isAllowedDomain(email, env.ALLOWED_SIGNUP_DOMAINS)` is false):
   throw `APIError("FORBIDDEN", { message: "signup domain not allowed" })`. Nothing is
   written (AC-1.3, AC-5.2). This comes first, so a live invitation for an outside address
   never activates.
2. **Invited**: `emailVerified === true` and `findLivePendingInvitationByEmail` finds a row.
   Return normally. The existing `user.create.after` assigns `employee`, then applies the
   invitation as specs/006 does today: a named-role invitation REPLACES `employee`, a
   no-role invitation keeps it (specs/006 AC-1.1). The verified-email rule is unchanged
   (spec Constraints). An unverified email with an invitation falls through to step 4,
   so it never becomes a user without its invitation.
3. **Bootstrap admin**: `emailVerified === true` and the email equals
   `BOOTSTRAP_ADMIN_EMAIL`. Return normally; `assignBaselineRolesToNewUser` grants
   `employee` + `admin` as today (AC-1.4).
4. **Waiting list**: `recordAccessRequest(...)` runs, then the hook throws
   `APIError("FORBIDDEN", { message: "access request pending" })`, or
   `"access request rejected"` when the stored request is `rejected` (AC-2.3).

better-auth turns a thrown `APIError` inside `createOAuthUser` into
`/sign-in?error=<message joined by _>`, which gives the codes `signup_domain_not_allowed`,
`access_request_pending` and `access_request_rejected` (checked against 1.6.23
`oauth2/link-account.mjs` and `api/routes/callback.mjs`). `createOAuthUser` runs inside a
better-auth transaction. The access-request write uses the module `db` client, NOT that
transaction, so it survives the throw that rolls the user creation back. Test T-INT-2 pins
this down, because a better-auth upgrade could change it.

Every refusal logs one structured line, `{"event":"auth.signup_refused","reason":…,
"accessRequestId"?:…}`. It carries no email or name, following the posture of
`logSessionDenied` (ADR-0012 follow-up, data residency).

### Recording a request (`recordAccessRequest`)

The input is the lower-cased email, the name (trimmed, ≤ 200 chars, falling back to the
email's local part) and the provider. A unique `email` column keeps it to one row per email.

| Stored state | Effect | Notify admins |
|---|---|---|
| none | insert `pending`, `requestedAt = firstRequestedAt = now` | yes (AC-2.1, AC-4.1) |
| `pending` | update `requestedAt`, `name`, `provider` | no (AC-2.2, AC-4.2) |
| `rejected` | nothing changes | no (AC-2.3) |
| `approved` | back to `pending` (CAS `WHERE status='approved'`), `requestedAt = now`, decision fields cleared, `invitationId` kept for history in the audit log only | yes (AC-2.4) |

`approved` can only reach this branch when its invitation is no longer live. With a live
invitation, step 2 would have let the person in, so no extra lookup is needed.

Two concurrent first sign-ins both try the insert; the unique index lets one win. The loser
catches `P2002` and takes the `pending` row, so exactly one notification goes out.

### Notifying admins (`notifyAdmins.ts`)

Recipients are `getEffectiveAdminUserIds` (direct role + via department, active users only,
`admin/lastAdminGuard.ts`). For each admin, `POST {NOTIFY_INTERNAL_URL}/system/notifications`:

```json
{ "recipientId": "<admin id>", "originApp": "admin", "severity": "info",
  "title": "Access request from <name>",
  "body": "<email> asked to join Operai. Review it in Admin › Users › Access requests.",
  "link": { "href": "/admin/users/access-requests" }, "email": true }
```

The calls start after the request row is committed and are NOT awaited by the hook, so the
person's redirect never waits on notify-api. Each failure is caught and logged as
`auth.access_request_notify_failed {accessRequestId, recipientId, status}` (AC-4.3). The copy
is English only, like every `notification_notice` (specs/019 D-5); notify-api on `main` has
no bilingual field (that is ADR-0065, on the meetings branch).

This makes `auth` a push caller, which amends ADR-0048/0049's "auth: email only".
`system:auth` gains the `notifications.push` scope and the origin binding `admin`.
`email: true` needs `emails.send` too, which `auth` already holds. notify-api resolves each
admin's address through `auth POST /system/users/contact` (ADR-0056), so `auth` puts no
address in the request. → ADR-0072.

### Admin API and approval

Approval reuses specs/006's invitation creation rather than creating a user. There is still
no user row until the person's own first sign-in matches the invitation, so specs/006's
activation, expiry, resend and revoke all apply unchanged. `POST /admin/access-requests/{id}/approve`
runs one `withAudit` transaction:

1. CAS `accessRequest.updateMany({ where: { id, status: "pending" } })`; 0 rows → 409
   `already_decided` (AC-3.6), or 404 when the id does not exist;
2. the same checks `POST /admin/invitations` makes: an active user exists → 409
   `active_user_exists`; a live pending invitation exists → 409 `pending_invitation_exists`
   (AC-3.5); unknown role or department → 422. Any throw rolls back step 1;
3. `reconcileExpiredPending` + `createInvitationRow`, then set `approved`, `decidedAt`,
   `decidedByUserId`, `invitationId` on the request;
4. two audit rows: `invitation.create` (identical to a direct invite) and
   `access_request.approve` with `{ email, invitationId, roleIds, departmentIds }` (AC-3.9).

After the commit, the invitation email is sent and its delivery stored exactly as
`POST /admin/invitations` does it today (AC-3.7). A failed send leaves the request
`approved` and the invitation `failed`, resendable from the Invitations screen.

`reject` is a CAS from `pending` to `rejected` plus an `access_request.reject` audit row.
Nothing is sent (AC-3.4).

When the person is activated by ANY invitation (`applyLivePendingInvitationOnUserCreate`),
the same transaction runs `accessRequest.updateMany({ where: { email, status: "pending" },
data: { status: "approved", decidedAt: now, decidedByUserId: invitation.invitedByUserId,
invitationId } })` (AC-3.8).

### Invitations limited to allowed domains

`createInvitation` (the shared function) refuses an email outside the allowed domains with
422 `code: "domain_not_allowed"` before any write. Its detail names the domains (AC-5.1).
Existing outside-domain invitations are left alone: they still list, resend and revoke as
before, and the gate refuses them at sign-in (AC-5.2).

### Test sign-in (AC-1.9)

`internalAdapter.createUser` fires `user.create.before`, and `@operai.test` is not an allowed
domain, so the dev path would be refused. `test-auth` therefore creates its user with
`db.user.create` and calls `assignBaselineRolesToNewUser` itself, which keeps today's
`employee` default for e2e users. It still creates the session through
`internalAdapter.createSession`, so `session.create.before` keeps applying. The endpoint's
own gates (non-production, `ENABLE_TEST_AUTH`, `@operai.test` suffix) are unchanged.
Rejected alternative: an `@operai.test` exemption inside the gate itself. That would put a
test branch into the production sign-up path, guarded only by environment flags.

**Amendment 2026-11-05 (T10 findings).** "As it does today" includes what the
`user.create.after` hook did for a test user, which the T3 version dropped:
1. **Lower-case the email** before lookup and `db.user.create`, as better-auth's
   `adapter.createUser` does; a mixed-case seed must land on the same row the lower-cased
   fixtures look up.
2. **Activate a live invitation.** After `assignBaselineRolesToNewUser`, call
   `applyLivePendingInvitationOnUserCreate(created)` itself (the same function the hook calls,
   not a copy) when `isAllowedDomain(email, env.ALLOWED_SIGNUP_DOMAINS)` holds, mirroring the
   gate's step 1. It replaces `employee` with a named-role invitation's roles, adds
   departments, marks the invitation `accepted` and closes the pending access request
   (AC-3.8). No live invitation → baseline `employee` only. This keeps specs/006's AC-2.3 e2e
   (invited test user gets the invitation's roles) green.

**Test domain in local/e2e config only** (user decision 2026-11-05). specs/006's
`invitations.spec.ts` invites `@operai.test` addresses, which AC-5.1 refuses unless the domain is
allowed. The local env and the e2e stack therefore run with
`ALLOWED_SIGNUP_DOMAINS=welld.ch,welld.it,operai.test`; production stays `welld.ch,welld.it`. The
gate code gets no exemption (the rejected alternative above stands): `operai.test` is plain
configuration. Two guards keep it out of production:
- `auth/src/lib/env.ts`: with `NODE_ENV=production`, a domain equal to or ending in a reserved
  test TLD (`.test`, `.example`, `.invalid`, `.localhost`, RFC 2606/6761) exits at startup;
- `tools/env-doctor`: the production check reports an error for the same rule on `auth`'s
  `ALLOWED_SIGNUP_DOMAINS` (one shared predicate in the check, same TLD list).

`auth/.env.example` shows the local value with a comment that production is
`welld.ch,welld.it` and that `operai.test` is refused there.

### Decisions and ADRs

- `docs/adr/0071-access-only-by-invitation-waiting-list.md`. Access to the suite is decided
  at user creation, only invitations create users, and the waiting list is a separate
  `access_request` table whose approval creates an invitation. Rejected alternatives:
  - a `pending` user row whose session is refused. Every "active user" query in `auth`
    would have to learn a new state, and a row with a JWT already reaches estimai-api,
    which is not authorization-enforcing (ADR-0036);
  - better-auth's `disableImplicitSignUp`. It cannot record a waiting list or tell the
    domain refusal apart;
  - Google's `hd` parameter alone. It is only a hint to the account picker and does
    nothing for GitHub;
  - approving by creating the user directly. That would be a second activation path beside
    specs/006;
  - an `@operai.test` exemption in the gate (see above).

  The allowed domains are deployment configuration, not an admin setting.
- `docs/adr/0072-auth-pushes-admin-notifications.md`. `system:auth` gains
  `notifications.push` bound to origin `admin`, amending ADR-0048/0049. Rejected
  alternatives:
  - a new email-only template through `/system/emails`. The user asked for in-app too, and
    `auth` would be sending addresses it should not need to;
  - a new origin app `auth`. The notification belongs to the Admin tool, where the work
    happens.

  0071 is the number reserved in spec Constraints. 0072 is also free on `main` and on
  `feat/021-meetings` (which ends at 0070).

## Data model

New Prisma model in `auth/prisma/schema.prisma` and a new migration
`auth/prisma/migrations/<ts>_access_request/` (existing migrations untouched):

```prisma
// specs/023 (ADR-0071). The waiting list. Not a user: grants nothing.
model AccessRequest {
  id               String    @id @default(cuid())
  email            String    @unique // lower-case
  name             String
  provider         String    // google | github | unknown
  status           String    @default("pending") // pending | approved | rejected
  firstRequestedAt DateTime  @default(now())
  requestedAt      DateTime  @default(now()) // last attempt
  decidedAt        DateTime?
  decidedByUserId  String?
  decidedBy        User?       @relation("AccessRequestDecider", fields: [decidedByUserId], references: [id], onDelete: SetNull)
  invitationId     String?
  invitation       Invitation? @relation(fields: [invitationId], references: [id], onDelete: SetNull)
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@index([status, requestedAt])
  @@map("access_request")
}
```

The migration's SQL also adds `CHECK (status IN ('pending','approved','rejected'))` and
`CHECK (provider IN ('google','github','unknown'))`. `User` and `Invitation` get the back
relations, which are schema-only and add no columns. Rows are never deleted (spec Open
question, resolved 2026-11-05) and no state is time-derived. Tier 2 audit only: the table is
not append-only, because its status changes (ADR-0033).

## API contracts

All new routes run behind `sessionMiddleware` + `requireAuth` + `requireAdmin`, like the
other `/admin/*` routers. Errors are RFC 7807 with an optional `code` extension, as the
existing invitation 409s use. Dates are ISO 8601.

```ts
type AccessRequestStatus = "pending" | "approved" | "rejected"
type AccessRequestDetail = {
  id: string
  email: string
  name: string
  provider: "google" | "github" | "unknown"
  status: AccessRequestStatus
  firstRequestedAt: string
  requestedAt: string            // last attempt
  decidedAt: string | null
  decidedBy: { id: string; name: string; email: string } | null
  invitationId: string | null
}
```

**`GET /admin/access-requests?status=pending&page=1&pageSize=20`**. `status` defaults to
`pending`; `pageSize` ≤ 100. Results are ordered by `requestedAt desc` for `pending` and by
`decidedAt desc` for the others.
→ `200 { items: AccessRequestDetail[], page, pageSize, total }` · 401 · 403 · 400 (bad query)

**`POST /admin/access-requests/{id}/approve`**, body `{ roleIds?: string[], departmentIds?: string[] }`
→ `200 { request: AccessRequestDetail, invitation: InvitationDetail }` (`InvitationDetail` as
in specs/006, with `emailDelivery` `sent` | `failed`)
- 404 unknown id
- 409 `code: "already_decided"` | `"active_user_exists"` | `"pending_invitation_exists"`
- 422 unknown role/department id(s) | `code: "domain_not_allowed"` (defensive: a stored
  request is always in-domain, but the domain list may have shrunk since)
- 401 · 403

**`POST /admin/access-requests/{id}/reject`** (no body) → `200 AccessRequestDetail` · 404 ·
409 `already_decided` · 401 · 403

**`POST /admin/invitations`** (existing) gains `422 { code: "domain_not_allowed",
allowedDomains: ["welld.ch", "welld.it"], detail: "Invitations can only be sent to welld.ch,
welld.it addresses" }`. `allowedDomains` lets admin-ui render the message in en/it; `detail` is
the English fallback. The same body is used by approve's defensive 422.

**admin-ui error reading** (amended 2026-11-05 after design.md, gap 1): `ApiProblem`/`ApiError`
in `admin-ui/src/lib/adminApi.ts` gain optional `code?: string` and `allowedDomains?: string[]`,
copied from the problem body. New UI branches on `code`, never on `detail` prose (the existing
`inviteConflict.ts` prose matching is left as is).

**Roles granted by an invitation** (clarified 2026-11-05, design.md gap 3; unchanged specs/006
behaviour): an invitation with one or more roles grants exactly those roles; an invitation with
no roles, including one with departments only, keeps the baseline `employee` and adds the
departments.

**Hosted sign-in page** `GET /sign-in?error=…`, three new `ERROR_MESSAGES` entries,
English like the rest of the page (`<html lang="en">`):
- `access_request_pending` — "You don't have access to Operai yet. Your request has been
  recorded and an administrator will review it."
- `access_request_rejected` — "Your request to access Operai was not approved. Please
  contact an administrator."
- `signup_domain_not_allowed` — "Sign-in is reserved for wellD accounts (welld.ch,
  welld.it)."

**Env** — `ALLOWED_SIGNUP_DOMAINS` (auth, required): a comma-separated list of lower-case
domain names, at least one; anything malformed exits at startup. Production value:
`welld.ch,welld.it`. Local and e2e value: `welld.ch,welld.it,operai.test`; a reserved test TLD
exits at startup in production (amended 2026-11-05).

## Test strategy

Unit and integration tests use `bun test` against the local Postgres, as the existing auth
tests do. Admin-ui uses Vitest. E2E is Playwright from `shell/`. Real Google/GitHub OAuth
cannot run in e2e, so the gate is proven at integration level through better-auth's own
`internalAdapter.createOAuthUser`, the call the callback makes.

| AC | Level | Test |
|---|---|---|
| AC-1.1 | integration | `createOAuthUser` for an in-domain verified email with a live invitation → user created, exactly the invitation's roles; regression of specs/006's `auth.config.test.ts` suite |
| AC-1.2 | integration | no invitation / expired / revoked / accepted invitation → `APIError` "access request pending", no `user`/`account`/`user_role` row (T-INT-1) |
| AC-1.3 | integration | outside-domain email, with and without a live invitation → "signup domain not allowed", no user, no `access_request` |
| AC-1.4 | integration | bootstrap email, no invitation → user with `admin` + `employee`; bootstrap email outside the domains → refused |
| AC-1.5 | integration | covered by AC-1.2/1.3 asserting zero `user_role` rows for the email; unit: the gate's decision table |
| AC-1.6 | integration | an existing user (no invitation, outside domain) signs in through `handleOAuthUserInfo` → session created, roles unchanged, hook not consulted |
| AC-1.7 | integration | existing specs/006 soft-delete tests stay green; plus: refused soft-deleted sign-in leaves no `access_request` |
| AC-1.8 | unit | `isAllowedDomain`: `Name@WellD.CH` ✓, `a@welld.it` ✓, `a@sub.welld.ch` ✗, `a@welld.ch.example` ✗, `a@xwelld.ch` ✗, no `@` ✗ |
| AC-1.9 | integration + e2e | `test-auth.routes.test.ts`: new `@operai.test` user still minted with `employee`; mixed-case email stored lower-cased and found again; with a live pending invitation → exactly the invitation's roles/departments, invitation `accepted`, pending access request `approved` (amended 2026-11-05); shell e2e: no new failures against the baseline below |
| AC-2.1 | integration | first refused attempt → one `pending` row with email lower-cased, name, provider, time |
| AC-2.2 | integration | second attempt → same row, updated `requestedAt`/name/provider, row count 1; concurrent double first attempt → one row, one notification |
| AC-2.3 | integration | `rejected` row → stays `rejected`, "access request rejected", no notification |
| AC-2.4 | integration | `approved` row whose invitation expired/revoked → `pending` again, notification sent |
| AC-2.5 | contract | no route exposes `access_request` outside `/admin/*` (route-table assertion, as `invite` routes do today) |
| AC-3.1 | integration + component | `GET` ordering, status filter, `decidedBy`; admin-ui page renders list/filter/empty/error states |
| AC-3.2 | integration + e2e | approve → invitation row with exactly the chosen ids, email sent (notify stub), request `approved` with decider; e2e: admin approves a seeded request and sees it under Approved and in Invitations |
| AC-3.3 | integration | approve, then `createOAuthUser` for that email → activated with the chosen roles |
| AC-3.4 | integration + e2e | reject → `rejected`, no invitation, no notify call; e2e reject flow |
| AC-3.5 | integration + component | approve with an active user / live invitation → 409 with the right `code`, request unchanged; UI shows the message |
| AC-3.6 | integration | approve/reject a decided request → 409 `already_decided`; two concurrent approves → one 200, one 409, one invitation |
| AC-3.7 | integration | notify stub fails → 200, request `approved`, invitation `emailDelivery: "failed"` |
| AC-3.8 | integration | pending request, then a direct invitation + activation → request `approved`, `invitationId` set |
| AC-3.9 | integration | `audit_log` rows `invitation.create` + `access_request.approve` (with ids) / `access_request.reject`, actor = admin |
| AC-3.10 | integration + e2e | non-admin → 403 on all three routes; the admin tool is already admin-gated (existing e2e) |
| AC-4.1 | integration | new request → one `/system/notifications` call per effective admin (direct and via department; soft-deleted admin excluded), `email: true`, `originApp: "admin"`, relative link; notify-api: `system:auth` may raise `admin`, not other origins |
| AC-4.2 | integration | repeat attempt while pending → no call |
| AC-4.3 | integration | notify-api 500/timeout/mint failure → request row present, refusal still "access request pending" |
| AC-5.1 | integration + component | `POST /admin/invitations` with `x@gmail.com` → 422 `domain_not_allowed`, no row, no email; invite dialog shows the message |
| AC-5.2 | integration | pre-existing outside-domain pending invitation: listed, revocable, and its sign-in refused by domain |
| AC-6.1 | review | QE checks specs/004 AC-6.3 and specs/006 Problem/Non-goals are amended to point to specs/023 (`grep` for the uninvited-`employee` sentence returns only amended text) |
| AC-6.2 | review | `infra/README.md` § "Users who entered without an invitation" holds the SQL (users with no `invitation.acceptedByUserId` row, and users outside the allowed domains); QE runs it against the local DB |

Also covered:
- env: `ALLOWED_SIGNUP_DOMAINS` missing or malformed makes the process exit (`env.startup.test.ts`);
- `env-doctor` manifest test;
- sign-in page: each new code renders its sentence (`signin.routes.test.ts`);
- `SELF_SERVICE_SCOPES` test updated;
- (amended 2026-11-05) env: `operai.test` (and any reserved test TLD) in
  `ALLOWED_SIGNUP_DOMAINS` exits under `NODE_ENV=production`, starts otherwise; env-doctor:
  production check errors on it, local check accepts it.

**E2E baseline (Amendment 2026-11-05, T10 findings).** A fresh database seeded by `auth`'s seed
gives `employee` no estimai/refund access, which several pre-existing e2e specs assume, so a
red full run cannot be attributed to 023 on its own. T10's done-when is therefore measured
against a baseline: a full shell e2e run of the pre-023 commit `9d0fbb9` on the same isolated
`_main` databases, then the 023 run. 023 must introduce no new failures; the failures present in
the baseline are listed in the run trace, not fixed in this feature.

## Risks

- **R1 — better-auth changes the abort contract.** If a thrown `APIError` stopped mapping to
  `?error=` or the access-request write started joining the callback transaction, the gate
  could fail open or lose the waiting list. *Mitigation:* T-INT-1/T-INT-2 run the real
  `createOAuthUser` and assert no user row and a surviving `access_request`. They fail on
  any upgrade that breaks either.
- **R2 — an invitation dies between the gate and `user.create.after`** (expires or is
  revoked in the same millisecond window). The person is created with `employee` and no
  invitation applied. *Mitigation:* accepted. The window is the duration of one callback,
  and the user is visible in Users for an admin to delete. Recorded in ADR-0071.
- **R3 — `ALLOWED_SIGNUP_DOMAINS` missing at deploy** makes auth exit, and then nobody can
  sign in. *Mitigation:* set the Railway variable before the push (rollout below); the
  env-doctor CI check fails the PR without it in the template.
- **R4 — notify-api deploys after auth.** Pushes get 403 until it does. *Mitigation:*
  best effort by design (AC-4.3), and the requests are on the screen anyway; no
  ordering needed.
- **R5 — test-auth bypassing the hook hides a gate regression from e2e.** *Mitigation:*
  the gate's coverage lives in the integration tests above, not in e2e.
- **R6 — `user.create.before` context lacks the provider id.** *Early check:* the first
  integration test asserts `provider = "google"` from a simulated callback; fall back to
  `unknown`, which the schema allows.

Rollout (single push to `main`):
1. Railway: set `ALLOWED_SIGNUP_DOMAINS=welld.ch,welld.it` on `auth` — never the local value
   with `operai.test`, which auth and env-doctor refuse in production (amended 2026-11-05).
2. Push; `auth` migrates `access_request` on start.
3. Run AC-6.2's query in production and give the user the list.

## Security

**YES.** This feature is the suite's authentication boundary: it changes who becomes a user,
stores personal data (name and email) of people who are not users, adds an admin
write-API that creates invitations, and widens `system:auth`'s service-token scope.
- Fails closed: any error inside the gate other than the deliberate refusals propagates,
  and better-auth then creates no user.
- Logs carry no email or name.
- The domain check is exact-match on the part after the last `@`.
- A reserved test domain (`operai.test`) is allowed only by local/e2e configuration; auth's
  env validation and env-doctor refuse it in production (amended 2026-11-05).
- The access-request name is stored and rendered as plain text, escaped by React and by
  notify-api's template.
- No requester-facing endpoint exists.

An `owasp-reviewer` pass runs in parallel with QE (A01 access control on the admin routes,
A04 race on approve, A07 the auth gate, A09 logging).
