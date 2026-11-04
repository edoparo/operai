---
spec: 022
generated: 2026-11-04
synced: 2026-11-04
---

# Tasks: Projects hand-off — a won deal reaches OPS "in series"

Rigor `mvp`: no plan.md; the contract below binds the dev agents as a plan would. Drift
against it is routed to the product owner. Builds on specs/021's contract
(`../021-projects/tasks.md` § Architecture notes) and changes it only where stated here.

## Architecture notes

### Components
- **auth** — three new service scopes; no new permission, role or grant (specs/021's
  `projects:access` and entity-scoped `project:manage` already cover AC-1.2 / AC-1.4, D36).
- **estimai-api** — first `/system/*` route: an estimate's man-days for a scoped service
  credential.
- **crm-api** — `GET /system/deals` for projects-api; the deal page reads its project and
  Bexio order id from projects-api.
- **projects-api** — `GET /system/contracts` for crm-api; the to-start queue; taking a deal
  (new project or attach); contracts and projects show their deal live.
- **projects-ui** — queue page, "New project" and "Attach" dialogs, contract card and
  project page show the deal, its notice and the estimate link.
- **crm-ui** — a read-only "Delivery" card on the deal page.

### Decided here (mvp, no architect — each is an ADR candidate, written in T15)
- **Man-days come from EstimAI over a service credential** (user, 2026-11-04, at task
  derivation). The person taking a deal is often not a collaborator on its estimate, and
  estimai-api accepts only user JWTs today, so projects-api reads `GET /system/estimates/{id}/summary`
  as itself (`sub = system:projects-api`, scope `estimai.estimates.read`, ADR-0049
  pattern). estimai-api computes the figure and returns only it — never the estimate's
  content. Rejected: a snapshot in crm-api when the estimate is marked ready (misses
  estimates already ready and admin-marked ones); the latest offer's figure (020 offers
  without the estimate annex carry none).
- **The man-days figure** is the estimate's **Expected** effort without AI gain — the sum
  over activities of PERT + risk buffer, unrounded, then rounded half up once to one decimal
  (`numeric(6,1)`). It is the figure an offer prints when "AI-assisted" is off. The formula
  is crm-api's `src/offers/scope.ts` (itself pinned to estimai-ui's `pertCalc`); estimai-api
  gets a byte-identical copy, enforced by a new `manDays` group in
  `scripts/check-shared-copies.ts`.
- **The deal is read live, never synced.** The queue is "CRM deals with stage `won`" minus
  "deals with a contract", computed on every read; the "no longer won" notice is the deal's
  live stage. AC-2.1, AC-2.2 and AC-2.4 then hold by construction — no event, no webhook, no
  CRM write path changes (D17: least invasive). crm-api down → the queue answers 503
  `crm_unavailable`; a project or contract still loads, with the deal's title and stage
  unknown (`null`) and no notice.
- **The deal page reads projects-api server-side.** A CRM user may hold no
  `projects:access`, so crm-api calls `GET /system/contracts` with its existing service
  client (which gains `projects.contracts.read`) and fails soft.
- **Taking a deal collects the contract's dates and terms in the same step.** A contract
  cannot exist without them (specs/021 CHECKs: fixed price needs deadline and max effort,
  maintenance an SLA or hours, T&M a position), and AC-1.3 / AC-1.4 make the contract in the
  same action. Project and contract are written in one transaction.
- **A contract made from a deal keeps the deal's estimate id** (`Contract.estimateId`,
  copied at creation like the man-days, A6): it is the AC-3.2 link, and it is what locks the
  man-days (AC-3.1). The deal's later estimate changes in the CRM do not reach it.
- **Scope of a take is the deal's entity** (AC-1.2, AC-1.4 as written; A9 lets a deal of
  the other entity join a project). The new project's entity is the deal's. Attaching does
  **not** additionally require manage on the target project's entity.
- **Types offered for a new project from a deal** are the client types `t_and_m`,
  `fixed_price`, `maintenance` (AC-1.2): `saas` and `internal` are born without a company
  (specs/021 AC-1.1) and so never from a deal; a deal joins them only by attach (`saas`).

### Authorization
No new user permission. Taking a deal needs `project:manage` for the deal's entity; reading
the queue needs `projects:access`. New service scopes (auth `KNOWN_SERVICE_SCOPES`):

| Scope | Accepted by | Client that holds it |
|---|---|---|
| `crm.deals.read` | crm-api `GET /system/deals` | `projects-api` |
| `estimai.estimates.read` | estimai-api `GET /system/estimates/{id}/summary` | `projects-api` |
| `projects.contracts.read` | projects-api `GET /system/contracts` | `crm-api` |

Every `/system/*` route copies crm-api's `src/system/systemAuth.middleware.ts`: RS256 via
the suite JWKS, issuer pinned, `aud = SERVICE_AUDIENCE` (optional env; unset → every request
401, fail closed), the scope in `scope`, `sub = system:<client>`, one identical `401` body
for every failure, a user JWT never accepted.

### Data model (projects-api, migration `prisma/migrations/*_handoff`)
- `Contract.estimateId text?` — the deal's EstimAI estimate id at creation; `null` for
  hand-entered contracts and for deals without an estimate.
- CHECK `contract_origin_matches_deal`: `("origin" = 'deal') = ("dealId" IS NOT NULL)`.
- CHECK `contract_estimate_needs_deal`: `"estimateId" IS NULL OR "origin" = 'deal'`.
- `dealId` stays unique (specs/021) — the database half of AC-1.6.

No change in crm-api or estimai-api data.

### API contracts
Errors are `application/problem+json` with a `code`, as in specs/021. `CompanyRef` and
`Person` as in specs/021.

**estimai-api (T2)**
- `GET /system/estimates/{id}/summary` — service JWT, scope `estimai.estimates.read` →
  `200 { id, name, manDays: number }` (one decimal, ≥ 0); `404 estimate_not_found`; `401`
  as above. Reads any estimate regardless of owner or collaborators.

**crm-api (T3, T10)**
- `GET /system/deals?stage=won` or `?ids=a,b` (exactly one of the two; `ids` 1–64
  characters each, ≤ 100) — service JWT, scope `crm.deals.read` → `200 { items:
  DealSummary[], truncated: boolean }`. `DealSummary = { id, title, stage, entity, company:
  { id, name }, wonAt: string | null, estimate: { id, name } | null }` — `wonAt` is
  `closedAt` while the stage is `won`, else `null`; `estimate` is `null` when the deal has
  no linked estimate. **No amount, currency, owner or notes** (D14). `stage=won` returns
  won deals by `wonAt` descending, at most 500 (`truncated: true` beyond); `ids` returns
  those deals in any stage. `400` for neither or both parameters.
- `GET /deals/{id}` (existing, user route) gains `delivery: { project: { id, name },
  bexioOrderId: string | null } | null` and `deliveryKnown: boolean` — `false` when
  projects-api is not configured (`PROJECTS_INTERNAL_URL` unset) or does not answer; then
  `delivery` is `null` and the deal still loads (fail soft).

**projects-api (T4–T8)**
- `GET /system/contracts?dealIds=a,b` (1–100) — service JWT, scope
  `projects.contracts.read` → `200 { items: [{ dealId, contractId, project: { id, name },
  bexioOrderId: string | null }] }`; deals without a contract are absent.
- `GET /queue?q=&entity=` — `projects:access` → `200 { items: QueueItem[], truncated:
  boolean }`, `QueueItem = { dealId, title, entity, company: CompanyRef, wonAt, estimate:
  { id, name } | null }`, won deals without a contract, by `wonAt` descending; `q`
  case-insensitive substring of title or company name. `503 crm_unavailable`.
- `POST /queue/{dealId}/project` `{ name, type: "t_and_m" | "fixed_price" | "maintenance",
  projectManagerId?, contract: { startDate, endDate?, terms } }` → `201 Project`. The
  project takes the deal's company and entity, state `planned`, PM = the caller unless
  given; its one contract has `origin: "deal"`, `dealId`, the deal's company, the
  project's type and `estimateId`.
- `POST /queue/{dealId}/attach` `{ projectId, contract: { startDate, endDate?, terms } }` →
  `201 Contract` (same contract fields).
- Errors of both takes: `404 deal_not_found`; `409 deal_not_won` (live stage is not `won`);
  `409 deal_taken` (the deal already has a contract — also the unique-index race); `403
  out_of_scope` (no `project:manage` for the deal's entity); `422 not_project_user` (PM);
  attach only: `404` unknown project, `409 contracts_not_allowed` (`internal`), `409
  project_not_open` (`closed` / `cancelled`), `422 company_mismatch` (client project of
  another company) — each with a `detail` the UI shows (AC-1.5); `422
  estimated_man_days_from_estimate` when `terms.estimatedManDays` is sent for a deal with
  an estimate; `503 crm_unavailable`; `503 estimai_unavailable` / `estimai_unconfigured`
  (only when a `fixed_price` contract must copy man-days). An estimate EstimAI answers
  `404` for → `estimatedManDays: null`, `estimateId` kept.
- `ContractSummary` (in `Project.contracts`) and `Contract` gain `deal: { id, title: string
  | null, won: boolean | null } | null` (`null` for hand-entered contracts; `title` / `won`
  `null` when crm-api cannot answer). `Contract` gains `estimate: { id } | null`.
  `Contract.dealId` carries the deal id (it was always `null` in specs/021).
- `PATCH /projects/{id}/contracts/{contractId}`: `terms.estimatedManDays` on a contract with
  an `estimateId` → `422 estimated_man_days_from_estimate`; the body schema stays strict, so
  `dealId`, `projectId` or `origin` → `400` (AC-1.7: no detach, no move).

**UI links**
- Estimate: `/estimai/estimates/<id>` (crm-ui `links.ts` precedent); EstimAI's own page
  decides access and shows its unavailable state (AC-3.2, A16).
- Deal: `/crm/deals/<id>`.
- Queue: projects-ui inner route `/queue` (URL `/projects/queue`); no shell change.

### Deferred (knowingly not done at this tier)
- Queue pagination: `stage=won` is capped at 500 and the UI says "showing the newest 500"
  when `truncated` — enough while the CRM is weeks old (A26).
- The AI-assisted variant of the man-days; offers may print the other one.
- Production provisioning of the new env keys and service-client scopes (owner, after
  merge, `provision-tool` skill) and a shell e2e journey — as specs/021.

## Tasks

- [ ] T1: auth — `crm.deals.read`, `estimai.estimates.read`, `projects.contracts.read` service scopes — refs: AC-1.1, AC-3.1, AC-3.4 — deps: none
  - touch: `auth/src/system/serviceClients.ts`, `auth/src/system/serviceClients.test.ts`
  - done when: `cd auth && bun test src/system` is green with a test that a `SERVICE_CLIENTS` entry carrying each new scope is accepted and an unknown scope still refuses to start.
- [ ] T2: estimai-api — `GET /system/estimates/{id}/summary` behind `estimai.estimates.read`; man-days formula copied from crm-api under a `manDays` shared-copy group — refs: AC-3.1 — deps: none
  - touch: `estimai-api/src/system/**`, `estimai-api/src/index.ts`, `estimai-api/src/lib/env.ts`, `estimai-api/src/openapi/registry.ts`, `crm-api/src/offers/scope.ts`, `scripts/check-shared-copies.ts`
  - done when: `cd estimai-api && bun run typecheck && bun test` is green with tests that a scoped service JWT gets `200 { id, name, manDays }` for an estimate it neither owns nor collaborates on; a user JWT, another scope and no token get the identical `401`; an unknown id is `404`; `manDays` equals crm-api's `totalManDays(estimate, false)` to one decimal on the shared vectors of `crm-api/src/offers/scope.test.ts`; `bun scripts/check-shared-copies.ts` exits 0 with the `manDays` group; crm-api `bun test src/offers` still green.
- [ ] T3: crm-api — `GET /system/deals` behind `crm.deals.read` — refs: AC-1.1, AC-2.1, AC-2.2, AC-2.3 — deps: none
  - touch: `crm-api/src/system/**`, `crm-api/src/index.ts`, `crm-api/src/openapi/registry.ts`
  - done when: `cd crm-api && bun test src/system` is green: `stage=won` lists only won deals by `wonAt` descending with `truncated` past 500; `ids` returns deals in any stage with `wonAt: null` when not won; a reopened deal drops out of `stage=won`; no item carries an amount, currency, owner or notes; neither or both parameters → `400`; a user JWT, another scope and no token → the identical `401`. Full `bun test` still green.
- [ ] T4: projects-api — system auth (copy), `SERVICE_AUDIENCE`, `GET /system/contracts`, and stub `queue` / `take` routers mounted — refs: AC-3.4 — deps: none
  - touch: `projects-api/src/system/**`, `projects-api/src/index.ts`, `projects-api/src/lib/env.ts`, `projects-api/src/openapi/**`, `projects-api/src/queue/queue.routes.ts`, `projects-api/src/queue/take.routes.ts`
  - done when: `cd projects-api && bun run typecheck && bun test src/system` is green: a scoped service JWT gets the contracts of the asked deals with project name and Bexio order id, deals without a contract absent; > 100 ids → `400`; a user JWT, another scope, no token and an unset `SERVICE_AUDIENCE` → the identical `401`; `src/index.ts` mounts `systemRouter`, `queueRouter` and `takeRouter` (stubs) so T6 and T7 never edit it.
- [ ] T5: projects-api — migration (`Contract.estimateId`, two CHECKs), crm-api deals client, estimai-api summary client, test fakes — refs: AC-1.6, AC-3.1, AC-3.2 — deps: T4
  - touch: `projects-api/prisma/**`, `projects-api/src/db.constraints.test.ts`, `projects-api/src/lib/crm.ts`, `projects-api/src/lib/estimai.ts`, `projects-api/src/lib/estimai.test.ts`, `projects-api/src/lib/crm.deals.test.ts`, `projects-api/src/lib/env.ts`, `projects-api/src/test-support/**`
  - done when: `bun run db:deploy` succeeds on `projects` and `projects_test`; `bun test src/db.constraints.test.ts src/lib` is green proving at the database that a `deal` contract without `dealId`, a `manual` contract with one, and an `estimateId` on a `manual` contract are refused; `lib/crm.ts` exposes `wonDeals()` and `dealsById(ids)` (crm-api down → `CrmUnavailableError`); `lib/estimai.ts` exposes `estimateManDays(id)` → number, `null` on `404`, `503 estimai_unavailable` when down, `503 estimai_unconfigured` when `ESTIMAI_INTERNAL_URL` is unset; `test-support` has fakes for both that T6–T8 use.
- [ ] T6: projects-api — `GET /queue` — refs: AC-1.1, AC-1.6, AC-2.1, AC-2.2 — deps: T4, T5
  - touch: `projects-api/src/queue/queue.routes.ts`, `projects-api/src/queue/queue.test.ts`
  - done when: `bun test src/queue/queue.test.ts` is green: a won deal without a contract is listed with title, company, entity, `wonAt` and estimate (or `null`), and no amount field exists in the response; a deal with a contract is absent; a deal reopened in the fake CRM is absent and back once won again; `q` matches title or company name; `entity` filters; `truncated` passes through; crm-api down → `503 crm_unavailable`; no `projects:access` → `403`.
- [ ] T7: projects-api — take a deal: `POST /queue/{dealId}/project` and `/attach`; project and contract creation extracted for reuse — refs: AC-1.2, AC-1.3, AC-1.4, AC-1.5, AC-1.6, AC-3.1, AC-3.2 — deps: T4, T5
  - touch: `projects-api/src/queue/take.routes.ts`, `projects-api/src/queue/take.test.ts`, `projects-api/src/projects/create.ts`, `projects-api/src/contracts/create.ts`, `projects-api/src/projects/projects.routes.ts`, `projects-api/src/contracts/contracts.routes.ts`
  - done when: `bun test src/queue/take.test.ts src/projects src/contracts` is green: "new project" creates a `planned` project with the deal's company and entity, the given name, the caller (or the given module user) as PM, and one `deal` contract with `dealId`, company, type and `estimateId`, in one transaction; only client types are accepted; attach adds a contract of the project's type; each refusal of the contract (`contracts_not_allowed`, `project_not_open` for `closed` and `cancelled`, `company_mismatch`, `out_of_scope` for the other entity, `deal_not_won`, `deal_taken` including two concurrent takes of one deal, `deal_not_found`) leaves no project and no contract behind; a `fixed_price` contract from a deal with an estimate gets the fake EstimAI's man-days and sending `estimatedManDays` → `422`; EstimAI `404` → `null`; EstimAI down → `503` and nothing written; specs/021's `POST /projects` and `POST /projects/{id}/contracts` tests still pass unchanged.
- [ ] T8: projects-api — contracts and projects show their deal; man-days locked; no detach — refs: AC-1.7, AC-2.3, AC-2.4, AC-3.1, AC-3.2, AC-3.3 — deps: T7
  - touch: `projects-api/src/contracts/contracts.routes.ts`, `projects-api/src/contracts/contracts.schemas.ts`, `projects-api/src/contracts/contracts.test.ts`, `projects-api/src/projects/projects.routes.ts`, `projects-api/src/projects/projects.schemas.ts`, `projects-api/src/projects/projects.test.ts`
  - done when: `bun test src/contracts src/projects` is green: `GET /projects/{id}` and `GET …/contracts/{id}` return `deal: { id, title, won }` read live (one `dealsById` call per request), `won: false` after the fake CRM reopens the deal and `true` again once re-won, `title` / `won` `null` with crm-api down while the project still returns `200`; hand-entered contracts have `deal: null`; `Contract.estimate` is `{ id }` or `null`; `PATCH` with `terms.estimatedManDays` on an estimate-backed contract → `422 estimated_man_days_from_estimate`, on a hand-entered one still allowed; `PATCH` with `dealId`, `projectId` or `origin` → `400`; `DELETE` still `405`.
- [ ] T9: projects-api — authorization matrix covers the new routes — refs: AC-1.1, AC-1.2, AC-1.4 — deps: T4, T6, T7, T8
  - touch: `projects-api/src/matrix.test.ts`
  - done when: `bun test src/matrix.test.ts` is green for `GET /queue`, both takes and `GET /system/contracts` × {no access, access only, `project-manager` (welld_ch), `sales` (welld_it), `accounting`, admin} — takes allowed only for manage of the deal's entity, the system route refusing every user JWT — and the full `bun test` and `bun run typecheck` are green.
- [ ] T10: crm-api — the deal page reads its project and Bexio order id from projects-api — refs: AC-3.4 — deps: none
  - touch: `crm-api/src/lib/projects.ts`, `crm-api/src/lib/projects.test.ts`, `crm-api/src/lib/env.ts`, `crm-api/src/deals/deals.routes.ts`, `crm-api/src/deals/delivery.test.ts`
  - done when: `cd crm-api && bun run typecheck && bun test` is green with tests that `GET /deals/{id}` returns `delivery: { project: { id, name }, bexioOrderId }` for a deal the fake projects-api knows, `delivery: null` with `deliveryKnown: true` for one it does not, and `delivery: null` with `deliveryKnown: false` — and still `200` — when projects-api is down or `PROJECTS_INTERNAL_URL` is unset; the call uses a service token from crm-api's existing `SERVICE_CLIENT_ID` / `SERVICE_CLIENT_SECRET` without editing the shared `serviceToken.ts` region.
- [ ] T11: crm-ui — read-only "Delivery" card on the deal page (en + it) — refs: AC-3.4 — deps: T10
  - touch: `crm-ui/src/components/DeliveryCard.tsx`, `crm-ui/src/components/DeliveryCard.test.tsx`, `crm-ui/src/pages/DealDetailPage.tsx`, `crm-ui/src/pages/DealDetailPage.test.tsx`, `crm-ui/src/lib/types.ts`, `crm-ui/src/strings/deals.ts`
  - done when: `cd crm-ui && pnpm lint && pnpm build && pnpm test` is green with tests that the card shows the project name and the Bexio order id ("—" when empty) with no edit control, is absent when `delivery` is `null` and known, and says the delivery side is unavailable when `deliveryKnown` is `false`.
- [ ] T12: projects-ui — queue page `/queue`, nav entry, API client and types for every 022 route (en + it) — refs: AC-1.1, AC-1.6, AC-2.1 — deps: none
  - touch: `projects-ui/src/router.tsx`, `projects-ui/src/pages/QueuePage.tsx`, `projects-ui/src/pages/QueuePage.test.tsx`, `projects-ui/src/components/ProjectsShell.tsx`, `projects-ui/src/components/ProjectsShell.test.tsx`, `projects-ui/src/lib/projectsApi.ts`, `projects-ui/src/lib/types.ts`, `projects-ui/src/lib/errors.ts`, `projects-ui/src/strings.ts`, `projects-ui/src/strings/queue.ts`, `projects-ui/src/strings/nav.ts`
  - done when: `cd projects-ui && pnpm lint && pnpm build && pnpm test` is green with tests that `/queue` lists title, company, entity, won date and an estimate link (`/estimai/estimates/<id>`) when there is one, renders no amount, filters by search and entity, shows "showing the newest 500" when `truncated`, shows the crm-unavailable state on `503`, and that the shell's nav offers "To start" to every reader; `projectsApi.ts` and `types.ts` carry the queue, take, attach and the new contract fields so T13 and T14 do not edit them.
- [ ] T13: projects-ui — "New project" and "Attach to project" from a queued deal — refs: AC-1.2, AC-1.3, AC-1.4, AC-1.5, AC-3.1 — deps: T12
  - touch: `projects-ui/src/components/TakeDealDialog.tsx`, `projects-ui/src/components/TakeDealDialog.test.tsx`, `projects-ui/src/components/AttachDealDialog.tsx`, `projects-ui/src/components/AttachDealDialog.test.tsx`, `projects-ui/src/components/ContractTermsFields.tsx`, `projects-ui/src/components/ContractFormDialog.tsx`, `projects-ui/src/pages/QueuePage.tsx`, `projects-ui/src/strings/queue.ts`
  - done when: `pnpm lint && pnpm build && pnpm test` is green with tests that both actions show only with manage scope for the deal's entity; "New project" prefills the name from the deal title (editable), offers only T&M / Fixed price / Maintenance, defaults the PM to the user and lets it change, and asks the contract's dates and terms with the specs/021 per-type fields (now `ContractTermsFields`, shared with `ContractFormDialog`); a fixed-price form from a deal with an estimate shows "estimated man-days: from the estimate" instead of an input; each refusal (`contracts_not_allowed`, `project_not_open`, `company_mismatch`, `deal_taken`, `deal_not_won`) shows its own message; on success the deal leaves the list and the user lands on the project.
- [ ] T14: projects-ui — contract card and project page show the deal, "no longer won" notice, estimate link; man-days read-only — refs: AC-1.7, AC-2.3, AC-2.4, AC-3.1, AC-3.2, AC-3.3 — deps: T12, T13
  - touch: `projects-ui/src/components/ContractCard.tsx`, `projects-ui/src/components/ContractCard.test.tsx`, `projects-ui/src/components/ContractFormDialog.tsx`, `projects-ui/src/components/ContractFormDialog.test.tsx`, `projects-ui/src/pages/ProjectDetailPage.tsx`, `projects-ui/src/pages/ProjectDetailPage.test.tsx`, `projects-ui/src/strings/contracts.ts`, `projects-ui/src/strings/project.ts`
  - done when: `pnpm lint && pnpm build && pnpm test` is green with tests that a deal contract shows the deal title linking to `/crm/deals/<id>` and the origin "from deal" ("entered by hand" otherwise), the estimate link `/estimai/estimates/<id>` when `estimate` is set, the notice "the deal is no longer won" on the card and on the project page when `deal.won` is `false` and neither when it is `true` or `null`; editing an estimate-backed fixed-price contract shows the man-days read-only; no control detaches or moves a contract.
- [ ] T15: docs — ADR-0060 (hand-off reads between crm-api and projects-api over service credentials, live, no events), ADR-0061 (estimai-api estimate man-days for a service credential; the `manDays` copy), AGENTS.md, READMEs, glossary, changesets — refs: AC-1.1, AC-3.1, AC-3.4 — deps: T2, T3, T4, T10
  - touch: `docs/adr/0060-*.md`, `docs/adr/0061-*.md`, `AGENTS.md`, `estimai-api/README.md`, `crm-api/README.md`, `projects-api/README.md`, `.claude/context/glossary.md`, `.changeset/*.md`
  - done when: both ADRs exist with Context / Decision / Alternatives / Consequences, AGENTS.md's ADR index lists them, the glossary defines **to-start queue** and a contract's **deal**, and `pnpm changeset status` shows bumps for auth, estimai-api, crm-api, crm-ui, projects-api and projects-ui.
- [ ] T16: local env — new keys and service-client scopes in the env examples and env-doctor — drafted by the agent, applied by the developer (the guard stops agents writing env files) — refs: AC-1.1, AC-3.1, AC-3.4 — deps: T1, T2, T3, T4, T5, T10
  - touch: `auth/.env.example`, `estimai-api/.env*`, `crm-api/.env*`, `projects-api/.env*`, `tools/env-doctor/manifest.ts`, `tools/env-doctor/*.test.ts`
  - done when: `bun test tools/env-doctor` is green with `SERVICE_AUDIENCE` for estimai-api and projects-api, `ESTIMAI_INTERNAL_URL` for projects-api and `PROJECTS_INTERNAL_URL` for crm-api in the manifest; the `SERVICE_CLIENTS` example gives `projects-api` `crm.companies.read crm.deals.read estimai.estimates.read` and `crm-api` `projects.contracts.read` besides its notify scopes; with them applied, `mise run dev` shows a seeded won deal in `/projects/queue`.
- [ ] T17: QE-light verification; all gates green; spec status → done — refs: every AC — deps: T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, T15, T16
  - touch: `specs/022-projects-handoff/qe-report.md`, `specs/022-projects-handoff/spec.md`
  - done when: the quality-engineer's QE-light verdict is PASS in `qe-report.md` — including a live pass: take a won deal into a new fixed-price project and see the estimate's man-days, attach a second deal, reopen and re-win a deal in the CRM and see the notice come and go, open the estimate link as a user without EstimAI access and see EstimAI's unavailable state, see project and Bexio id on the CRM deal page — every local gate it lists is green (auth, estimai-api, crm-api, crm-ui, projects-api, projects-ui, env-doctor, shared copies, changeset, secret scan), and `/wellforge:done 022-projects-handoff` accepts the feature.

## Coverage

| AC | Tasks |
|---|---|
| AC-1.1 | T1, T3, T6, T9, T12, T16 |
| AC-1.2 | T7, T9, T13 |
| AC-1.3 | T7, T13 |
| AC-1.4 | T7, T9, T13 |
| AC-1.5 | T7, T13 |
| AC-1.6 | T5, T6, T7, T12 |
| AC-1.7 | T8, T14 |
| AC-2.1 | T3, T6, T12 |
| AC-2.2 | T3, T6 |
| AC-2.3 | T3, T8, T14 |
| AC-2.4 | T8, T14 |
| AC-3.1 | T1, T2, T5, T7, T8, T13, T14, T16 |
| AC-3.2 | T5, T7, T8, T14 |
| AC-3.3 | T8, T14 |
| AC-3.4 | T1, T4, T10, T11, T16 |

Effective graph (`deps:` ∪ `touch:` overlap), batches that can run in parallel:
1. T1, T2, T3, T4, T10, T12
2. T5, T11, T13, T15
3. T6, T7, T14, T16
4. T8
5. T9
6. T17

Declared edges that exist only because of a shared file (all resolved by ordering, none
merged): T4 → T5 (`projects-api/src/lib/env.ts`), T4 → T6 / T7 (the stub `queue` and
`take` routers T4 mounts), T7 → T8 (`projects.routes.ts`, `contracts.routes.ts`),
T12 → T13 (`QueuePage.tsx`, `strings/queue.ts`), T13 → T14 (`ContractFormDialog.tsx`).
