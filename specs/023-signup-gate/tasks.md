---
spec: 023
generated: 2026-11-05
synced: 2026-11-05
---

# Tasks: Access to Operai only by invitation, with a waiting list

Work happens in the `main` worktree (`/Users/matteocodogno/LAB/aiscream/operai-main`), never in the
`feat/021-meetings` checkout. Contracts: `plan.md`. Screens and components: `design.md`.

**Shared-state rules for this feature (user decisions, 2026-11-05):**
- Backend commands (`bun test`, `db:*`, `typecheck`) run through the session wrapper
  `with-main-db.sh <service> <cmd…>`. It reads the service's direnv environment from the
  original checkout (read-only), runs in this worktree and points `DATABASE_URL` at an
  isolated `<db>_main` database. Never run `prisma migrate dev` against the shared
  `operai_auth` / `notify` databases.
- T10 (e2e) needs the whole suite on the standard ports, which the other checkout's stack
  occupies. It is deferred until the user stops that stack.

- [x] T1: [backend] Add the `access_request` table — refs: AC-2.1, AC-2.2 — deps: none
  - touch: `auth/prisma/schema.prisma`, `auth/prisma/migrations/*`, `auth/src/lib/generated/**`
  - do: the `AccessRequest` model exactly as plan.md § Data model (unique `email`, index
    `(status, requestedAt)`, FKs to `User`/`Invitation` with `onDelete: SetNull`, back
    relations), a NEW migration (existing ones untouched) whose SQL adds the `status` and
    `provider` CHECK constraints.
  - done when: `bun run db:migrate` applies cleanly on the local DB, `bun run typecheck`
    passes, and inserting `status = 'other'` via raw SQL fails on the CHECK.

- [x] T2: [backend] `ALLOWED_SIGNUP_DOMAINS` and the domain match — refs: AC-1.3, AC-1.8, AC-5.1 — deps: none
  - touch: `auth/src/lib/env.ts`, `auth/src/system/env.startup.test.ts`, `auth/src/signup/allowedDomains*.ts`, `auth/.env.example`, `auth/.envrc`, `tools/env-doctor/manifest.ts`, `tools/env-doctor/templates/production/auth.env`, `tools/env-doctor/*.test.ts`
  - do: required env var, a comma-separated list of lower-case domains, at least one,
    malformed → exit 1; `isAllowedDomain(email, domains)`, an exact case-insensitive match
    on the part after the last `@`; manifest + production template + `.env.example` +
    local `.envrc` (`welld.ch,welld.it`). A guard hook may block edits to the env files:
    if it does, stop and hand those two lines back to the user instead of working
    around it.
  - done when: the unit table of plan.md AC-1.8 passes; `env.startup.test.ts` proves a
    missing or malformed value exits; `mise run env:doctor` (production templates) is green.

- [x] T3: [backend] test-auth creates its user outside the sign-up gate — refs: AC-1.9 — deps: none
  - touch: `auth/src/test-auth/*`
  - do: `@operai.test` users are created with `db.user.create` plus
    `assignBaselineRolesToNewUser` (keeps `employee`), and the session still comes from
    `internalAdapter.createSession`; the endpoint's production/flag/suffix gates are
    unchanged.
  - done when: `test-auth.routes.test.ts` covers a new user (created, holds `employee`,
    session valid) and an existing one (unchanged); all `auth` tests pass.

- [x] T4: [backend] `auth` can push notifications to admins — refs: AC-4.1, AC-4.3 — deps: none
  - touch: `auth/src/lib/notify.ts`, `auth/src/lib/notify*.test.ts`, `auth/src/system/selfServiceToken*.ts`, `auth/src/auth/self-service-token.contract.test.ts`, `auth/src/signup/notifyAdmins*.ts`, `notify-api/src/system/systemAuth.middleware*.ts`, `notify-api/src/system/systemAuth.routes.test.ts`
  - do: `SELF_SERVICE_SCOPES = ["emails.send", "notifications.push"]`;
    `pushSystemNotification()` (same token provider, retries once on 401, never throws);
    `notifyAdminsOfAccessRequest(request)`, which posts the plan.md body to every
    `getEffectiveAdminUserIds` admin, is NOT awaited by its caller, and logs failures as
    `auth.access_request_notify_failed` without email; notify-api binding
    `"system:auth": ["admin"]` (ADR-0072).
  - done when:
    - tests prove one call per effective admin (a direct admin and a department admin are
      both included, a soft-deleted admin is not) with `email: true`, `originApp: "admin"`
      and a relative link;
    - a notify 500, a timeout or a mint failure resolves without throwing;
    - a notify-api test shows `system:auth` may raise `admin` and gets 403 for `refund`;
    - the `auth` and `notify-api` test suites pass.

- [x] T5: [backend] The sign-up gate and the waiting list — refs: AC-1.1, AC-1.2, AC-1.3, AC-1.4, AC-1.5, AC-1.6, AC-1.7, AC-2.1, AC-2.2, AC-2.3, AC-2.4, AC-3.8, AC-4.1, AC-4.2, AC-4.3 — deps: T1, T2, T3, T4
  - touch: `auth/src/signup/signupGate*.ts`, `auth/src/signup/accessRequests.repo*.ts`, `auth/src/auth/auth.config.ts`, `auth/src/auth/auth.config.test.ts`, `auth/src/signin/signin.routes.ts`, `auth/src/signin/signin.routes.test.ts`
  - do:
    - `databaseHooks.user.create.before` running plan.md's four-step order;
    - `recordAccessRequest` following plan.md's state table, written through the module
      `db` client (outside better-auth's transaction), with a P2002 retry and a notify
      call on insert or on approved→pending only;
    - the three `APIError` messages and `auth.signup_refused` logs (no email or name);
    - `applyLivePendingInvitationOnUserCreate` closes the person's pending request in its
      transaction (AC-3.8);
    - three `ERROR_MESSAGES` entries with plan.md's wording.
  - done when: integration tests drive better-auth's real
    `internalAdapter.createOAuthUser` and cover every row of plan.md § Test strategy for
    AC-1.1–1.7, AC-2.1–2.4, AC-3.8 and AC-4.1–4.3. They must include:
    - T-INT-1: no `user`/`account`/`user_role` row after a refusal;
    - T-INT-2: the `access_request` row survives the rollback;
    - concurrent first sign-ins → one row and one notification;
    - `provider` recorded as `google`, or `unknown` if the context lacks it (R6);
    - `signin.routes.test.ts` renders each new code;
    - all specs/006 hook tests still green.

- [x] T6: [backend] Shared invitation creation, limited to allowed domains — refs: AC-5.1, AC-5.2, AC-3.2 — deps: T2
  - touch: `auth/src/invitations/createInvitation*.ts`, `auth/src/invitations/invitations.routes.ts`, `auth/src/invitations/invitations.routes.test.ts`, `auth/src/invitations/invitations.schemas.ts`, `auth/src/authz/audit.ts`, `auth/src/authz/audit*.test.ts`
  - do:
    - extract the `POST /admin/invitations` body into `createInvitation.ts`: validation
      (with a domain 422 carrying `code: "domain_not_allowed"` and `allowedDomains`),
      creation inside a caller-supplied transaction, and email delivery after commit;
    - the route keeps its exact behaviour;
    - `withAudit`'s `entry` also accepts an array.
  - done when:
    - the existing invitation route tests pass unchanged;
    - new tests: `x@gmail.com` → 422 with both fields, no row, no email; a pre-existing
      outside-domain pending invitation still lists, resends and revokes;
    - an audit test writes two rows in one transaction and rolls both back on a throw.

- [x] T7: [backend] Admin API for access requests — refs: AC-2.5, AC-3.1, AC-3.2, AC-3.3, AC-3.4, AC-3.5, AC-3.6, AC-3.7, AC-3.9, AC-3.10 — deps: T1, T5, T6
  - touch: `auth/src/signup/accessRequests.routes*.ts`, `auth/src/signup/accessRequests.schemas.ts`, `auth/src/signup/accessRequests.repo*.ts`, `auth/src/index.ts`
  - do: `GET /admin/access-requests`, `POST …/{id}/approve` and `POST …/{id}/reject`
    exactly as plan.md § API contracts. Approve uses one `withAudit` transaction: a CAS on
    `pending`, then `createInvitation`'s in-transaction part, then the request update, with
    `invitation.create` and `access_request.approve` audit rows. The invitation email goes
    out after commit. Admin-gated like the other `/admin/*` routers, and listed in the
    OpenAPI document.
  - done when: integration tests cover every AC-3.x row of plan.md § Test strategy:
    - ordering and filter;
    - an approve that creates exactly the chosen ids, followed by a `createOAuthUser`
      activation (AC-3.3);
    - reject;
    - the three 409 codes, with the request unchanged;
    - two concurrent approves → one 200, one 409 and one invitation;
    - a failed email → `approved` + `emailDelivery: "failed"`;
    - the audit rows;
    - non-admin → 403;
    - a route-table assertion that no `access_request` route lives outside `/admin/*`.

- [x] T8: [frontend] admin-ui reads problem codes; the invite dialog's domain message — refs: AC-5.1, AC-3.5 — deps: none
  - touch: `admin-ui/src/lib/adminApi.ts`, `admin-ui/src/lib/adminApi.test.ts`, `admin-ui/src/components/InviteUserModal.tsx`, `admin-ui/src/components/InviteUserModal.test.tsx`, `admin-ui/src/strings/invitations.ts`, `admin-ui/src/strings/users.ts`, `admin-ui/src/strings.ts`
  - do: `ApiProblem`/`ApiError` gain optional `code` and `allowedDomains`; the
    access-request client functions (`listAccessRequests`, `approveAccessRequest`,
    `rejectAccessRequest`) and their types are added per plan.md; `InviteUserModal` shows
    the localised `domain_not_allowed` message from `allowedDomains`, falling back to
    `detail` (design.md F5); copy is en + it.
  - done when: `pnpm lint`, `pnpm build` and `pnpm test` pass in `admin-ui`, with tests for
    the code/allowedDomains parsing, the three client calls (request shape and error
    mapping) and the modal message in both languages.

- [x] T9: [frontend] The "Access requests" screen — refs: AC-3.1, AC-3.2, AC-3.4, AC-3.5, AC-3.6, AC-3.7, AC-3.10 — deps: T8
  - touch: `admin-ui/src/pages/AccessRequestsPage*.tsx`, `admin-ui/src/components/ApproveAccessRequestModal*.tsx`, `admin-ui/src/components/AccessRequestStatusBadge*.tsx`, `admin-ui/src/lib/accessRequestConflict*.ts`, `admin-ui/src/lib/statusMeaning.ts`, `admin-ui/src/components/UsersSubNav.tsx`, `admin-ui/src/components/UsersSubNav.test.tsx`, `admin-ui/src/router.tsx`, `admin-ui/src/router.test.tsx`, `admin-ui/src/strings/accessRequests.ts`, `admin-ui/src/strings/nav.ts`, `admin-ui/src/strings/badges.ts`, `admin-ui/src/strings.ts`
  - do: everything design.md specifies for flows F1–F4 and F7:
    - status filter (Pending by default), list, loading, empty and error states;
    - approve dialog (roles and departments, `employee` helper copy) and reject confirm;
    - conflict messages by `code`, already-decided refresh, email-failed banner with
      "Open Invitations";
    - focus handling and `aria-label`s per design.md § Accessibility;
    - `/users/access-requests` route, asserted to win over `/users/$id`;
    - a third `UsersSubNav` tab with an explicit test id per view;
    - `access-request-*` test ids; `@operai/ui` components only; copy en + it.
  - done when: `pnpm lint`, `pnpm build` and `pnpm test` pass in `admin-ui` (including
    `catalogGaps` and the hardcoded-copy scan), with component tests for each state and
    flow listed above, and `mise run ui:check` is green.

- [x] T10: [e2e] Waiting-list journeys through the shell — refs: AC-1.9, AC-3.2, AC-3.4, AC-3.10 — deps: T3, T7, T9, T13
  - touch: `auth/scripts/e2e-invite-fixtures.ts`, `shell/e2e/helpers/*ccess*`, `shell/e2e/access-requests.spec.ts`
  - do: `seed-access-request` / `clear-access-requests` fixture commands; a Playwright
    spec in which an admin sees a seeded request, approves it with a role (the request
    moves to Approved and an invitation appears under Invitations), rejects another
    one, and a non-admin is denied. *(Code landed in ba47be6; open only on the full-run
    criterion.)*
  - done when (amended 2026-11-05, plan.md § E2E baseline): `cd shell && pnpm e2e
    access-requests.spec.ts` passes against the local stack started from this worktree on
    the isolated `_main` databases with `ALLOWED_SIGNUP_DOMAINS=welld.ch,welld.it,operai.test`,
    and a full `pnpm e2e` run shows NO failure that the baseline run of `9d0fbb9` (same
    databases, same stack shape) does not also show. Pre-existing baseline failures are
    listed in the run trace, not fixed here (proves AC-1.9).

- [x] T11: [docs] Specs agree, operator query, changesets — refs: AC-6.1, AC-6.2 — deps: none
  - touch: `specs/004-auth-roles-permissions/spec.md`, `specs/006-user-invitations/spec.md`, `infra/README.md`, `AGENTS.md`, `.changeset/*`
  - do: amend specs/004 AC-6.3 and specs/006 (Problem + Non-goals) to point to specs/023;
    add the `infra/README.md` § "Users who entered without an invitation" SQL (users with
    no accepted invitation; users outside the allowed domains); add the rollout step for
    `ALLOWED_SIGNUP_DOMAINS`; update the AGENTS.md `auth` and admin-ui descriptions;
    one changeset selecting `@operai/auth`, `@operai/admin-ui` and `@operai/notify-api`
    (minor, minor, patch).
  - done when: `grep` for the "signs in and receives the baseline `employee`" sentence finds
    only amended text; the SQL runs against the local DB; `mise run changeset:check` passes.

- [x] T13: [backend] test-auth regressions and the production guard on test domains — refs: AC-1.9, AC-3.8, AC-5.1 — deps: T3, T5
  - touch: `auth/src/test-auth/*`, `auth/src/lib/env.ts`, `auth/src/system/env.startup.test.ts`, `auth/src/signup/allowedDomains*.ts`, `auth/.env.example`, `tools/env-doctor/**`
  - do (plan.md amendment 2026-11-05, T10 findings):
    - test-auth lower-cases the email before lookup and `db.user.create`;
    - after `assignBaselineRolesToNewUser`, test-auth calls the hook's own
      `applyLivePendingInvitationOnUserCreate` (not a copy) when the email's domain is
      allowed — invitation roles replace `employee`, departments added, invitation
      `accepted`, pending access request closed (AC-3.8); no live invitation → `employee`;
    - one shared predicate for reserved test domains (`.test`, `.example`, `.invalid`,
      `.localhost`): auth's env validation exits under `NODE_ENV=production` when
      `ALLOWED_SIGNUP_DOMAINS` contains one, and env-doctor's production check errors on it;
    - `auth/.env.example` shows the local value `welld.ch,welld.it,operai.test` with a comment.
  - done when: `test-auth.routes.test.ts` covers a mixed-case email stored lower-cased and an
    invited test user activated with exactly the invitation's roles/departments (invitation
    `accepted`, request `approved`); `env.startup.test.ts` proves production exits on
    `operai.test` and development accepts it; an env-doctor test fails the production
    template carrying it; `auth` tests and typecheck pass; `mise run env:doctor` is green.

- [x] T14: [backend] Security hardening from the review notes — refs: AC-1.9, AC-4.1, AC-3.1, AC-5.1 — deps: T4, T8, T13
  - touch: `auth/src/lib/env.ts`, `auth/src/system/env.startup.test.ts`, `auth/src/signup/allowedDomains*.ts`, `auth/src/lib/notify*.ts`, `auth/src/signup/notifyAdmins*.ts`, `admin-ui/src/lib/adminApi.ts`, `admin-ui/src/lib/adminApi.test.ts`, `auth/src/invitations/invitations.routes.test.ts`
  - do (owasp low findings recorded in the batch-1 and T13 run traces):
    - reserved test domains in `ALLOWED_SIGNUP_DOMAINS` are refused at startup unless
      `ENABLE_TEST_AUTH` is true (in addition to `NODE_ENV=production`);
    - a trailing-dot domain (`operai.test.`) is rejected by `parseAllowedDomains` or flagged
      reserved — proven by a test either way;
    - `notify.ts` never returns or logs a raw `error.message` that can carry the internal host;
    - `notifyAdmins` strips control characters from the provider-supplied name before it
      goes into the notification title/body;
    - `adminApi.ts` passes path ids through `encodeURIComponent`.
    `auth/.env.example` keeps the local value (plan.md amendment stands).
  - done when: a test for each bullet fails before and passes after; `auth` tests and
    typecheck pass; `admin-ui` lint/build/test pass; `mise run env:doctor` is green.

- [x] T12: Close the feature — refs: all — deps: T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T13, T14
  - touch: `specs/023-signup-gate/*`
  - do:
    - all gates green: `auth` typecheck and tests, `notify-api` tests, `admin-ui`
      lint/build/test, `mise run ui:check`, `mise run env:doctor`, full shell e2e;
    - an `owasp-reviewer` pass (plan.md § Security) and the QE verdict;
    - `/wellforge:eval`;
    - then `/wellforge:done`.
  - done when: `/wellforge:done 023-signup-gate` accepts the gate and the spec is `done`.
