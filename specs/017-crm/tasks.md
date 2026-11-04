---
spec: 017
status: in-progress
synced: 2026-11-04
---

# Tasks — CRM (specs/017)

Executed in one autonomous session on branch `feat/crm` (2026-11-01). `[x]` = done and
verified by the named check; `[ ]` = open, with the reason.

| ID | Task | State | Verified by |
|---|---|---|---|
| T1 | Spec, decisions log, plan with API contract | [x] | this directory |
| T2 | crm-api scaffold: env, JWT + authz middleware (copied from inventory-api), problem JSON, OpenAPI, health, Dockerfile, railway.json | [x] | `bun run typecheck` |
| T3 | Prisma schema + initial migration with functional unique index and CHECKs | [x] | `migrate deploy` on `crm` and `crm_test` |
| T4 | Companies routes (CRUD, archive, uniqueness, If-Match) | [x] | `companies.test.ts` |
| T5 | Contacts routes (CRUD, archive, erase) | [x] | `contacts.test.ts` |
| T6 | Deals routes, stage moves, pipeline arithmetic | [x] | `deals.test.ts`, `stages.test.ts` |
| T7 | Activities and tasks routes | [x] | `activities.test.ts` |
| T8 | Authorization matrix over the assembled app, `GET /scope` | [x] | `matrix.test.ts` (crm-api total: 62 tests) |
| T9 | auth: `crm` catalog, `sales` role, seed, directory gate (ADR-0053) | [x] | `crm.test.ts`, `seed.test.ts`, `directory.routes.test.ts` (63 tests in the three files) |
| T10 | crm-ui remote: all screens, strings en+it, tests | [x] | `pnpm lint && pnpm build && pnpm test` (75 tests) |
| T11 | shell: `/crm/$` route, TOOLS, sidebar, remote registration, session origin, CSP, About modal | [x] | shell `pnpm build && pnpm test` (283 tests) |
| T12 | Repo wiring: lerna, mise tasks, env-doctor manifest + production template | [x] | `mise run env:doctor`, env-doctor tests (123) |
| T13 | ADR-0052, ADR-0053, AGENTS.md, changesets | [x] | review |
| T14 | Manual smoke through the real stack (auth + crm-api + shell + crm-ui): company list, create deal in the UI, move stage, pipeline totals | [x] | browser session, 2026-11-01 |
| T15 | Shell e2e journey (`shell/e2e/crm.spec.ts`) | [ ] | needs the full stack + seeded sessions; next step towards `production` rigor |
| T16 | Production provisioning (Railway, Vercel, DNS, shell env, runtime-config) | [ ] | outward-facing — needs the owner (D-22); run the `provision-tool` skill for `crm` |
| T17 | Local `crm-api/.envrc` + `.env.example`, `VITE_CRM_API_URL` in the shell (D-23) | [ ] | drafted by the agent, copied in by the developer (the guard stops the agent writing env files); done when `mise run dev` serves `/crm` |
| T18 | Notifications for tasks assigned to someone else | [ ] | non-goal of v1 (D-14) |
| T19 | QE verification (verdict: pass with findings; added `authz-outage.test.ts`) and OWASP review (0 critical/high/medium); fixes for the low findings (D-24) | [x] | crm-api 63/63 on `crm_test`, crm-ui lint + build + 76 tests |
| T20 | Suite-wide dependency bump: `@tanstack/react-router` (seroval ≥ 1.6.11) and `better-auth` in every frontend together; zod 4 + `@hono/zod-openapi` 1.x in the backends | [ ] | separate `chore/` branch (D-24 e, f) |
| T21 | "New task" in My tasks (company picked in the dialog, type fixed to task); stage meanings on the pipeline board and in the stage dialog (AC-3.3, 3.4, 4.4 amended) | [x] | crm-ui lint + build + 78 tests (`TasksPage.test.tsx`, stage-hint test in `DealDetailPage.test.tsx`) |
| T22 | Task filter (me / everyone / colleague, `GET /tasks/assignees`, D-26) and drag-and-drop pipeline board with Won/Lost columns (D-25) | [x] | crm-api 64/64 on `crm_test`; crm-ui lint + build + 84 tests (`PipelinePage.test.tsx` keyboard moves, `TasksPage.test.tsx` filter) |
| T23 | Company status automations (AC-1.8 won → customer, written on the stage move; AC-1.9 lapse to former after 12 months, derived on read; O2 resolved) | [x] | crm-api 250/250 on `crm_test` (`status.test.ts`, `companies.test.ts`); crm-ui lint + build + 179 tests |
| T24 | Edit a contact from the company page (AC-2.3); deal amount optional, nullable column (AC-3.2) | [x] | crm-api 253/253 on `crm_test`; crm-ui lint + build + 182 tests |
| T25 | Tasks blocked by other tasks (US-6): `task_blocker` table, picker in the task form, Blocked state, 409 on completion, unblock notification (in-app + email) | [x] | crm-api 258/258 on `crm_test` (`blockers.test.ts`); crm-ui lint + build + 184 tests |
| T26 | Source of a company and a lead (US-7): `LeadSource` enum + detail on company and deal, shared form fields, deal prefilled from its company, shown on both pages | [x] | crm-api 260/260 on `crm_test`; crm-ui lint + build + 187 tests |
| T27 | Participants on activities (US-8): `activity_participant` table, picker in the activity form, "With …" on the row, task list includes tasks one takes part in, in-app notice | [x] | crm-api 263/263 on `crm_test` (`participants.test.ts`); crm-ui lint + build + 189 tests |
| T28 | Sortable lists and owner filter (US-9): `sortable` columns in `@operai/ui` DataTable (aria-sort, story, tests), `sort`/`order` on `GET /companies` and `/contacts`, `GET /companies/owners`, owner filter on Companies | [x] | operai-ui 84 tests; crm-api 267/267 on `crm_test`; crm-ui lint + build + 191 tests |
| T29 | Board year picker (AC-3.6): `year` on `GET /pipeline` and the board list, `years` for the picker, select on the Pipeline page | [x] | crm-api 281/281 on `crm_test`; crm-ui lint + build + 195 tests |
