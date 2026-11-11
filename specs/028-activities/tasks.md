---
spec: 028
generated: 2026-11-10
synced: 2026-11-11
---

# Tasks: Activities — one place for CRM and project activities and tasks

Contracts are `plan.md` (approved 2026-11-10, amended at the design stage: G1, G3, G4, G7, G8,
AC-3.1, AC-3.8). Screens, states and copy are `design.md`. Decisions with rejected alternatives
are ADR-0081 (access delegated to the host), ADR-0082 (caller-chosen ids) and ADR-0083
(migration with a write pause).

Re-sync 2026-11-11 (after the eval round): spec.md amendment (owner-accepted narrowing of the
`task_unblocked` notice context, no new AC) and plan.md amendment (completion `context`, id
formats, the 2 s / 4 s bound under the `deal_estimate` lock) checked against this list. Both record
behaviour already delivered by T10/T12 and the eval-round fixes (89278f6f, 01eb8abc); no task is
added, changed or made obsolete. Domain prefixes:
- `[BE]` = backend-dev (activities-api, auth, crm-api, projects-api);
- `[FE]` = frontend-dev (shell, operai-ui, crm-ui, projects-ui);
- `[OPS]` = devops (files only, no real provisioning);
- `[QE]` = e2e;
- `[DOC]` = docs (main loop).

Tests never reach a real host: activities-api tests run against Hono test hosts (crm and
projects) built in T3, the meetings-api `MEETINGS_TEST_HOSTS` pattern. "On `activities_test`"
means `DATABASE_URL` points at the test database after `bun run db:deploy`. FE tasks test
against a fake activities API (`src/test-support/fakeApi.ts`, crm-ui style), not a running
service.

- [x] T1: [BE] auth: service scope `activities.write`; documented clients `crm-api` (+ `activities.write`) and `activities-api` (`notifications.push emails.send`, plan amendment 2026-11-11) — refs: AC-1.2, AC-1.3, AC-1.4, AC-6.1, AC-8.4 — deps: none
  - touch: `auth/src/system/serviceClients.ts`, `auth/src/system/serviceClients*.test.ts`, `auth/.env.example`
  - done when: `cd auth && bun test src/system` passes; a new test mints a token for a client holding `activities.write` and still refuses an unknown scope; `DOCUMENTED_CLIENT_SCOPES` pins `crm-api` and `activities-api` as above, and `auth/.env.example`'s `activities-api` entry carries both scopes

- [x] T2: [BE] activities-api scaffold: env, JWT middleware (`AUTH_AUDIENCE`), `/health`, OpenAPI, Problem JSON, logger, Prisma schema + init migration with every CHECK of plan § Data model, maintenance switch (`ACTIVITIES_MAINTENANCE`), Dockerfile, railway.json, `.env.example`, `.envrc`, test-support — refs: AC-2.5, AC-3.6, AC-8.2 — deps: none
  - touch: `activities-api/**`, `scripts/check-shared-copies.ts`, `scripts/check-shared-copies.test.ts`
  - done when: `cd activities-api && bun run typecheck && bun test` passes on `activities_test`, including: `/health` 200 with maintenance on; every other route 503 `maintenance` with maintenance on; a DB test that each CHECK rejects its violating row (project non-task, project with contactId, crm with kind operational, task fields on a note, completion pair, meetingId on a non-meeting, blocker self); `bun scripts/check-shared-copies.ts` passes with activities-api's shared copies registered
  - open item: the activities-api direnv file is NOT in the repo — the protected-file hook forbids agents from creating it; a person creates it (variables listed in `activities-api/.env.example`) and runs `direnv allow activities-api` (QE D2, environment row)

- [x] T3: [BE] activities-api host registry, resolve client and test hosts — refs: AC-8.1, AC-8.2, AC-8.3 — deps: T2
  - touch: `activities-api/src/hosts/**`, `activities-api/src/test-support/hosts*.ts`, `activities-api/src/lib/env.ts`
  - done when: `bun test src/hosts` passes: registry is data (crm, projects) with the rules of plan § Access; the resolve client forwards the caller's Authorization, batches by 25, uses a 2 s timeout and `redirect:"error"`, and maps timeout / 5xx / malformed / incomplete answers to `unavailable`; the crm and projects test hosts can be scripted per test (reader, may, writable, assignees, related, failures)

- [x] T4: [BE] crm-api: `POST /activity-host/v1/resolve` (companies + related contacts/deals, `reader`/`may` = `crm:access`, `writable: true`) — refs: AC-8.1, AC-8.3 — deps: none
  - touch: `crm-api/src/activity-host/**`, `crm-api/src/index.ts`, `crm-api/src/matrix.test.ts`
  - done when: `cd crm-api && bun test src/activity-host` passes: with `crm:access` → open items with label/href and related items of that company only; without → `reader:false`; unknown company → `missing`; a contact/deal of another company is omitted; `ids: []` answers only `reader`; auth outage → 503; body > 25 ids → 422

- [x] T5: [BE] projects-api: `POST /activity-host/v1/resolve` (`reader` = `projects:access`, `may.manage` = `project:manage` on the project's entity, `writable` = not closed/cancelled, `assignees` = PM + team) — refs: AC-3.2, AC-3.5, AC-3.8, AC-8.1 — deps: none
  - touch: `projects-api/src/activity-host/**`, `projects-api/src/index.ts`, `projects-api/src/matrix.test.ts`
  - done when: `cd projects-api && bun test src/activity-host` passes: manage in scope / out of scope / absent; closed and cancelled → `writable:false`; assignees list PM + members; unknown project → `missing`; auth outage → 503

- [x] T6: [BE] activities-api notify: service token client, `announce` with en + it copy (ADR-0065) for `task_assigned`, `activity_participant_added`, `task_unblocked` per host (CRM copy and hrefs unchanged; projects href `/projects/<id>`) — refs: AC-6.1, AC-6.2, AC-6.3, AC-6.4 — deps: T2
  - touch: `activities-api/src/lib/notify.ts`, `activities-api/src/lib/notify.test.ts`, `activities-api/src/lib/serviceToken.ts`
  - done when: `bun test src/lib/notify.test.ts` passes: per kind and host, the notify stub receives recipient, `originApp`, email flag, href, `title`/`body` and `it {title, body}`; the actor is never a recipient; a notify outage resolves without throwing

- [x] T7: [BE] activities-api activities routes: `GET/POST /activities`, `PATCH/DELETE /activities/{id}`, `POST /activities/{id}/complete|reopen`; view with labels from the host and `may {edit, delete, complete}`; registry rules (author vs manager, reader vs assignee-or-manager, types per host, `host_read_only`); assignee default author, explicit assignee checked only when changed; participants and CRM assignees checked via auth app-access-check — refs: AC-1.1, AC-3.1, AC-3.2, AC-3.3, AC-3.6, AC-3.7, AC-3.8, AC-5.1, AC-5.2, AC-6.1, AC-6.2, AC-8.1, AC-8.2, AC-8.3 — deps: T3, T6
  - touch: `activities-api/src/activities/**`, `activities-api/src/lib/identities.ts`, `activities-api/src/lib/people.ts`, `activities-api/src/index.ts`
  - done when: `bun test src/activities` passes on `activities_test`, including crm-api's `activities.test.ts` and `participants.test.ts` scenarios ported to the crm test host, plus the projects cases of plan § Test strategy rows 3.1–3.3, 3.6–3.8, 5.1, 8.2, 8.3

- [x] T8: [BE] activities-api blockers: same-host only (`blocker_not_in_host`), ≤ 10, no self, no cycle, delete removes, `task_blocked` 409, `task_unblocked` on completion — refs: AC-1.1, AC-4.1, AC-4.2, AC-4.3, AC-6.3 — deps: T7
  - touch: `activities-api/src/activities/blockers.ts`, `activities-api/src/activities/blockers.test.ts`
  - done when: `bun test src/activities/blockers.test.ts` passes with crm-api's blocker scenarios ported plus: a project task blocked by tasks of the same project; a pre-sales task as blocker of a project task → 422 `blocker_not_in_host`, and the reverse

- [x] T9: [BE] activities-api task lists: `GET /tasks` (`kind`, `projectId`, `status`, `assignee`, due-date order, `unavailable`) and `GET /tasks/assignees` — refs: AC-1.1, AC-3.4, AC-3.5, AC-7.1, AC-7.2, AC-7.4, AC-7.5 — deps: T7
  - touch: `activities-api/src/tasks/**`, `activities-api/src/index.ts`
  - done when: `bun test src/tasks` passes: `kind=pre_sales` never returns operational; `projectId` lists one project in plan order with `status`; `kind=all&assignee=me` mixes both in one order; crm host `reader:false` → no pre-sales items; crm host down → operational items + `unavailable:["crm"]`; crm-api's Tasks-page scenarios (me / any / colleague, participants) ported

- [x] T10: [BE] activities-api system routes: `PUT/DELETE /system/v1/activities/{id}`, `/completion` with `seq`, `/system/v1/meeting-mirror` with `meeting_mirror_state`, `/system/v1/contacts/{id}/erase`; system-auth middleware (scope `activities.write`, sub `system:crm-api`) — refs: AC-1.2, AC-1.3, AC-1.4, AC-8.4 — deps: T8, T9
  - touch: `activities-api/src/system/**`, `activities-api/src/auth/systemAuth.middleware.ts`, `activities-api/src/index.ts`, `scripts/check-shared-copies.ts`
  - done when: `bun test src/system` passes: PUT create-if-absent never overwrites; DELETE `onlyIfOpen` keeps a done task; completion applies only a newer `seq` and announces `task_unblocked`; meeting-mirror linked/changed/relinked/unlinked/deleted with duplicate and reordered `seq`; erase nulls every `contactId` and is idempotent; wrong scope, wrong sub, user JWT → identical 401

- [x] T11: [BE] activities-api authorization matrix over the assembled app (host × rule × caller) — refs: AC-8.1, AC-8.2, AC-8.3 — deps: T9, T10
  - touch: `activities-api/src/matrix.test.ts`
  - done when: `bun test src/matrix.test.ts` passes and covers every user route for: crm reader, crm non-reader, project manager in scope, out of scope, assignee without manage, participant only, closed project, host down

- [x] T12: [BE] crm-api switches to activities-api: client (`ACTIVITIES_API_URL`, service token); estimate request (caller-chosen id + compensation), override note, unlink (`onlyIfOpen` before the tx), EstimAI notice completion inside the lock, meeting-host notices forwarded (`meeting_host_state` no longer written), contact erase before delete; `src/activities/` removed — refs: AC-1.2, AC-1.3, AC-1.4, AC-8.4 — deps: T1, T4, T10
  - touch: `crm-api/src/lib/activities.ts`, `crm-api/src/lib/env.ts`, `crm-api/.env.example`, `crm-api/src/estimates/**`, `crm-api/src/meeting-host/notices.routes.ts`, `crm-api/src/meeting-host/*.test.ts`, `crm-api/src/contacts/**`, `crm-api/src/activities/**`, `crm-api/src/index.ts`, `crm-api/src/matrix.test.ts`, `crm-api/src/notifications.test.ts`, `crm-api/src/authz-outage.test.ts`
  - done when: `cd crm-api && bun run typecheck && bun test` passes with an activities-api stub: estimate request put fails → no task, estimate deleted, 503; commit fails → compensating DELETE; notice calls completion with `seq = estimaiVersion` inside the lock; meeting notice relays `{applied}` and 503 on outage; erase with activities-api down → 503 and the contact still exists; no route `/activities` or `/tasks` is served by crm-api

- [x] T13: [BE] import script `activities-api/scripts/import-crm-activities.ts` (dry-run default, `--apply`, same ids and timestamps, field-by-field comparison, report, non-zero exit on mismatch) — refs: AC-2.1, AC-2.2, AC-2.3, AC-2.4 — deps: T2
  - touch: `activities-api/scripts/import-crm-activities*.ts`
  - done when: `bun test scripts` passes on a seeded crm test DB: every activity, participant, blocker and meeting state copied with equal fields and ids; second `--apply` inserts 0; a pre-existing different row is reported and exits ≠ 0 without writing; dry run writes nothing

- [x] T14: [BE] crm-api contract migration: drop `task_blocker`, `activity_participant`, `activity`, `meeting_host_state` and `ActivityType` — LATER PUSH, only after the import report is clean (ADR-0083) — refs: AC-2.3 — deps: T12, T13
  - touch: `crm-api/prisma/schema.prisma`, `crm-api/prisma/migrations/*`, `crm-api/src/lib/generated/**`, `crm-api/src/test-support/world.ts`, `crm-api/src/estimates/estimate.test.ts`, `crm-api/src/meeting-host/notices.test.ts`
  - delivered on branch `feat/activities-contract` (stacked on `feat/projects`, NOT merged into it): it ships only after the production import report is clean (ADR-0083). The import test's source DB must keep the pre-T14 crm schema (`IMPORT_TEST_SOURCE_DB`, see infra/README runbook).
  - done when: `cd crm-api && bun run db:deploy && bun run typecheck && bun test` passes on `crm_test`; the commit is separate from T12's and its message says it ships only after the production import report

- [x] T15: [FE] shell: `getActivitiesApiBaseUrl()` (`VITE_ACTIVITIES_API_URL`), trusted origin, `vite-env.d.ts`, CSP `connect-src` — refs: AC-1.1, AC-7.2 — deps: none
  - touch: `shell/src/lib/session.ts`, `shell/src/lib/session.test.ts`, `shell/src/vite-env.d.ts`, `shell/vercel.json`
  - done when: `cd shell && pnpm exec tsc -b && pnpm test --run src/lib/session.test.ts` passes with a case: the Bearer is attached to the activities-api origin and not to an untrusted one

- [x] T16: [FE] operai-ui: `TaskRow` and `PersonChips` (stories in both themes + tests), exported from the index — refs: AC-4.2, AC-5.2, AC-7.2 — deps: none
  - touch: `operai-ui/src/components/TaskRow*`, `operai-ui/src/components/PersonChips*`, `operai-ui/src/index.ts`, `.changeset/*`
  - done when: `mise run ui:check` passes; tests cover overdue and Blocked conveyed by glyph + text, blocked Mark done `aria-disabled` with `aria-describedby`, labelled remove buttons on chips, all copy taken as props

- [x] T17: [FE] crm-ui: `lib/activitiesApi.ts` replaces the activity functions of `crmApi.ts`; `errors.ts` reads the Problem `code`; unavailable state on `host_unavailable`/`maintenance`; `ActivityItem` through `TaskRow`, `ParticipantsField` through `PersonChips`; federation types + stub — refs: AC-1.1, AC-1.5, AC-2.5, AC-7.1 — deps: T15, T16
  - touch: `crm-ui/src/lib/**`, `crm-ui/src/components/Activity*`, `crm-ui/src/components/ParticipantsField*`, `crm-ui/src/pages/TasksPage*`, `crm-ui/src/federation/**`, `crm-ui/src/strings*`, `crm-ui/src/test-support/**`
  - done when: `cd crm-ui && pnpm lint && pnpm build && pnpm test` passes, including `ActivityItem.test.tsx` (a `disabled` assertion becomes `aria-disabled`, click still ignored) and new tests: company/deal page renders with the timeline in the unavailable state on 503 `host_unavailable` and on `maintenance`, with copy distinct from the authorization outage

- [x] T18: [FE] projects-ui: Tasks card on `ProjectDetailPage` and task dialog (assignee select PM + team, optional; due date; blockers; participants; closed/cancelled read-only; `may` flags; error codes of design.md) — refs: AC-3.1, AC-3.2, AC-3.3, AC-3.4, AC-3.7, AC-3.8, AC-4.1, AC-4.2, AC-5.1, AC-5.2 — deps: T15, T16
  - touch: `projects-ui/src/lib/activitiesApi.ts`, `projects-ui/src/lib/errors.ts`, `projects-ui/src/components/Task*`, `projects-ui/src/pages/ProjectDetailPage*`, `projects-ui/src/federation/**`, `projects-ui/src/strings.ts`, `projects-ui/src/strings/tasks.ts`, `projects-ui/src/test-support/**`
  - done when: `cd projects-ui && pnpm lint && pnpm build && pnpm test` passes, including: list order and Open/Done; no Add/Edit/Delete without `may` or on a closed project; dialog shows "(no longer on the project)" for a departed assignee and saves unchanged; 409 `task_blocked` lists blockers; strings parity en/it

- [x] T19: [FE] projects-ui: My tasks page at `/projects/tasks` with tabs in `ProjectsShell`, Pre-sales badge, done/not done for pre-sales, "Open in CRM" with task-specific accessible names, partial-unavailable banner — refs: AC-7.2, AC-7.3, AC-7.4, AC-7.5 — deps: T18
  - touch: `projects-ui/src/pages/MyTasksPage*`, `projects-ui/src/components/ProjectsShell*`, `projects-ui/src/router.tsx`, `projects-ui/src/strings.ts`, `projects-ui/src/strings/tasks.ts`
  - done when: `cd projects-ui && pnpm lint && pnpm build && pnpm test` passes, including: mixed list in one order with badges; toggle only where `may.complete`; `unavailable:["crm"]` → banner announced as status and operational rows shown; CRM link built from `company.id`

- [x] T20: [OPS] wiring: compose (service + `activities` and `activities_test` DBs), `mise.toml` (dev, dev:web env, dev:preview, db:migrate), `lerna.json`, `infra/check.sh`, env-doctor manifest + production templates + tests (`activities-api.env`, `auth.env` clients, `crm-api.env` `ACTIVITIES_API_URL`, `SERVICE_CLIENT_LINKS`, CORS) — refs: AC-1.1, AC-2.5 — deps: T2
  - touch: `compose.yaml`, `mise.toml`, `lerna.json`, `infra/check.sh`, `tools/env-doctor/**`
  - done when: `mise run db:migrate` creates and migrates `activities`; `mise run env:doctor` passes; `cd tools/env-doctor && bun test` passes; `mise run dev` starts activities-api on 8087 with `/health` 200

- [x] T24: [BE] notify-api + notify-ui + shell type: origin `projects`; `system:activities-api` bound to `["crm","projects"]`; email footer label (plan § Amendments 2026-11-11 item 6) — refs: AC-6.1, AC-6.2, AC-6.3, AC-6.4 — deps: none
  - touch: `notify-api/src/notifications/notifications.schemas.ts`, `notify-api/src/system/systemAuth.middleware.ts`, `notify-api/src/system/emailTemplates.ts`, `notify-api/src/system/*.test.ts`, `notify-api/src/notifications/*.test.ts`, `notify-ui/src/lib/severity*.ts`, `notify-ui/src/strings.ts`, `notify-ui/src/components/NotificationItem.test.tsx`, `notify-ui/src/italian.test.tsx`, `shell/src/lib/notifications.ts`
  - done when: `cd notify-api && bun run typecheck && bun test` passes with: `system:activities-api` → 201 for `crm` and `projects`, 403 for `refund`/`meetings`/`admin`; every other `system:*` sender → 403 for `projects` with nothing stored; `system:crm-api` still 201 for `crm`; a `projects` notice with `email:true` and both scopes → 201 with `emailStatus`, footer "Sent by Operai Projects"; `cd notify-ui && pnpm lint && pnpm build && pnpm test` passes with "Projects"/"Progetti" and catalog parity; `cd shell && pnpm exec tsc -b` passes

- [x] T21: [QE] e2e in `shell/e2e`: CRM activities/tasks/blockers unchanged, project Tasks card, My tasks with a Pre-sales badge and done from projects-ui, CRM page with activities-api in maintenance, a project task assigned to a team member reaching their `/notify` with origin "Projects" and opening `/projects/<id>` — refs: AC-1.1, AC-1.5, AC-3.4, AC-6.1, AC-7.1, AC-7.2, AC-7.3 — deps: T12, T17, T19, T20, T24
  - touch: `shell/e2e/activities*.spec.ts`, `shell/e2e/helpers/**`
  - done when: `cd shell && pnpm e2e` passes with the stack up (`mise run dev`), existing CRM specs included

- [x] T22: [DOC] docs: AGENTS.md (table, structure, services, ports, stack, domain language), README, `infra/README.md` migration runbook (deploy order, maintenance, import, unpause, retry meeting notices of the pause, later contract push), specs/027 US-1 → pointer to 028, changeset (activities-api, auth, crm-api, projects-api, notify-api, notify-ui, shell, operai-ui, crm-ui, projects-ui) — refs: AC-2.5 — deps: T20
  - touch: `AGENTS.md`, `README.md`, `infra/README.md`, `specs/027-project-collaboration/spec.md`, `.changeset/*.md`
  - done when: `mise run changeset:check` passes; the runbook lists the five steps of ADR-0083 with the check that gates each; specs/027 has no task story left

- [x] T23: Close: all gates green (typecheck, lint, unit, e2e, env-doctor, shared copies), security review PASS (plan § Security: YES), QE PASS, eval, spec status → done via `/wellforge:done` — refs: all — deps: T11, T14, T21, T22
  - touch: `specs/028-activities/qe-report.md`, `specs/028-activities/eval-report.md`, `specs/028-activities/spec.md`
  - done when: `/wellforge:done 028-activities` accepts the transition
