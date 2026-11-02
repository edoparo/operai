---
spec: 019
status: in-progress
---

# Tasks — CRM notifications (specs/019)

| ID | Task | State | Verified by |
|---|---|---|---|
| T1 | Spec, plan, decisions | [x] | this directory |
| T2 | auth: `users.contact` scope, `POST /system/users/contact` (service JWT, active users only, same 401, identical 404, rate limit, log without data) | [x] | 73 auth tests (system, contracts, openapi; scratch DB) + typecheck |
| T3 | notify-api: `crm` origin + `system:crm-api` binding; optional env group; shared-copy `serviceToken.ts`; contact lookup client | [x] | notify-api 250 tests (`notify_test` DB) + typecheck |
| T4 | notify-api: `email: true` on `/system/notifications` (needs `emails.send`), `notification_notice` template, `emailStatus` | [x] | `notifications.email.routes.test.ts` (14), template and `/system/emails` cases |
| T5 | notify-ui + shell: `crm` origin type and labels | [x] | notify-ui 39 tests, shell 284 tests; lint and build of both |
| T6 | crm-api: optional env group, shared-copy `serviceToken.ts`, `notify.ts` notifier | [x] | `notify.test.ts` (6) |
| T7 | crm-api: E1–E9 hooks after commit | [x] | `notifications.test.ts` (14); crm-api total 126 + typecheck |
| T8 | env-doctor manifest, shared-copies registry | [x] | env-doctor 123 tests, `mise run env:doctor` green; shared:check after T3+T6 |
| T9 | ADR-0056, AGENTS.md, READMEs, changeset | [x] | ADR-0056, AGENTS.md, crm-api README, changeset `crm-notifications.md`; `shared:check` in sync (5 copies) |
| T10 | Env values the guard keeps from the agent (developer): auth `SERVICE_CLIENTS` gains `crm-api` (`notifications.push emails.send`) and `notify-api` (`users.contact`); crm-api and notify-api `.env` get their groups | [ ] | developer |
| T11 | Production: the same values on Railway, then required in env-doctor's templates | [ ] | owner |
| T12 | Browser smoke: request an estimate, see the bell and the email delivery row | [ ] | after T10 |
