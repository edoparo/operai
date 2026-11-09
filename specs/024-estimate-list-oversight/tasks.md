---
spec: 024
generated: 2026-11-09
synced: 2026-11-09
---

# Tasks: EstimAI list — every estimate for admins, closed estimates out of the way, the deal at a glance

- [x] T1: auth — `estimate:read-all` in the estimai catalog, seeded to `admin` only; `deal-link-notices.send` service scope — refs: US-1, AC-1.8, US-3 — deps: none
  - touch: `auth/src/authz/catalogs/estimai.ts`, `auth/src/authz/seed.ts`, `auth/src/authz/seed.test.ts`, `auth/src/system/serviceClients.ts`, `auth/src/system/serviceClients.test.ts`, `auth/src/**/*.contract.test.ts`
  - done when: a seed contract test pins `estimate:read-all` to `admin` and no other seeded role; a `SERVICE_CLIENTS` entry with `deal-link-notices.send` is accepted; `bun test` + `bun run typecheck` green in auth

- [x] T2: estimai-api — `crmDealId`/`crmLinkAt` migration; `GET /estimates` `status` filter and `crmDealId` on the list item — refs: AC-2.2, AC-2.3, AC-2.5, AC-3.3 — deps: none
  - touch: `estimai-api/prisma/schema.prisma`, `estimai-api/prisma/migrations/*`, `estimai-api/src/estimates/estimates.repo.ts`, `estimai-api/src/estimates/estimates.schemas.ts`, `estimai-api/src/estimates/estimates.wire.ts`, `estimai-api/src/estimates/estimates.routes.ts`, `estimai-api/src/estimates/estimates.routes.test.ts`
  - done when: `status=open|closed` filters for owner and collaborator; absent `status` returns both (import offer unchanged); unknown value → 400; a pre-existing closed row is in `status=closed`; list items carry `crmDealId`

- [x] T3: estimai-api — oversight: `/authz/resolve` client (only a refusal cached per `(sub, perm_epoch)`, amended by T12), `whose=all`, `GET /estimates/{id}` fallback with `access:"oversight"`, write guards answering 403 `oversight_read_only` — refs: AC-1.2, AC-1.3, AC-1.4, AC-1.5, AC-1.6, AC-1.7 — deps: T2
  - touch: `estimai-api/src/lib/authClient.ts`, `estimai-api/src/lib/authClient.test.ts`, `estimai-api/src/estimates/access.ts`, `estimai-api/src/estimates/oversight*.ts`, `estimai-api/src/estimates/estimates.routes.ts`, `estimai-api/src/estimates/lifecycle.routes.ts`, `estimai-api/src/estimates/collaborators.routes.ts`, `estimai-api/src/estimates/estimates.schemas.ts`, `estimai-api/src/estimates/*.test.ts`
  - done when: plan.md § API contracts' oversight rows each have a passing integration test, including "owner path makes no resolver call" and "resolver down → own/shared still 200"

- [x] T4: estimai-api — `POST /system/deal-link-notices` behind a service-JWT middleware (aud `SERVICE_AUDIENCE`, scope `deal-link-notices.send`, sub `system:crm-api`), ordered conditional update — refs: AC-3.3, AC-3.5, AC-3.6 — deps: T2
  - touch: `estimai-api/src/auth/systemAuth.middleware.ts`, `estimai-api/src/auth/systemAuth.middleware.test.ts`, `estimai-api/src/estimates/dealLinkNotices.routes.ts`, `estimai-api/src/estimates/dealLinkNotices.routes.test.ts`, `estimai-api/src/lib/env.ts`, `estimai-api/src/lib/env.test.ts`, `estimai-api/src/index.ts`
  - done when: repeat/older/equal-time/other-deal-unlink/unknown-estimate cases pass; user JWT, wrong aud/scope/sub and unset `SERVICE_AUDIENCE` are refused; strict body (extra field → 400)

- [x] T5: crm-api — deal-link notice client; send `linked` after a request and `unlinked` after an unlink, never failing the CRM action; optional `ESTIMAI_INTERNAL_URL` — refs: AC-3.4, AC-3.5, AC-3.8 — deps: none
  - touch: `crm-api/src/lib/estimaiNotices.ts`, `crm-api/src/lib/estimaiNotices.test.ts`, `crm-api/src/lib/env.ts`, `crm-api/src/estimates/estimate.routes.ts`, `crm-api/src/estimates/*.test.ts`, `crm-api/src/index.ts`
  - done when: integration tests assert one notice per link/unlink with the right body; a failing client (network, 500, 401 twice) leaves the CRM action 2xx and committed

- [x] T6: crm-api — `scripts/backfill-estimate-links.ts` (dry run default, `--apply`, `at = requestedAt`) — refs: AC-3.7 — deps: T5
  - touch: `crm-api/scripts/backfill-estimate-links.ts`, `crm-api/scripts/backfill-estimate-links.test.ts`
  - done when: dry run sends nothing and prints the count; `--apply` sends one `linked` per linked deal (`estimateId <> ''`)

- [x] T7: estimai-ui — list filters: API params, search params + sessionStorage restore, `EstimateFilters`, dynamic heading, empty/403/503 states — refs: AC-1.1, AC-1.2, AC-2.1, AC-2.6 — deps: none (contract in plan.md)
  - touch: `estimai-ui/src/lib/estimatesApi.ts`, `estimai-ui/src/federation/remotes.d.ts`, `estimai-ui/src/federation/__stubs__/*`, `estimai-ui/src/router.tsx`, `estimai-ui/src/pages/EstimatesPage.tsx`, `estimai-ui/src/pages/EstimatesPage.test.tsx`, `estimai-ui/src/components/EstimateFilters.tsx`, `estimai-ui/src/components/EstimateFilters.test.tsx`, `estimai-ui/src/strings.ts`, `estimai-ui/src/hooks/useImportOffer.ts`
  - done when: component tests cover Whose present/absent, defaults, combination in the query string, restore from sessionStorage, 403 panel, 503 banner; the import offer still lists without `status`

- [x] T8: estimai-ui — row anatomy: Closed badge, `DealBadge` (link with `(crm, access)`, plain otherwise), Oversight level on `AccessLevelBadge`, "You" on own rows in All, no delete on oversight rows — refs: AC-1.3, AC-2.2, AC-3.1, AC-3.2, AC-3.3 — deps: T7
  - touch: `estimai-ui/src/components/DealBadge.tsx`, `estimai-ui/src/components/DealBadge.test.tsx`, `estimai-ui/src/components/AccessLevelBadge.tsx`, `estimai-ui/src/components/AccessLevelBadge.test.tsx`, `estimai-ui/src/pages/EstimatesPage.tsx`, `estimai-ui/src/pages/EstimatesPage.test.tsx`, `estimai-ui/src/strings.ts`
  - done when: tests cover each badge state, the link calling `navigateSuite('/crm/deals/<id>')`, and the accessible names from design.md

- [x] T9: estimai-ui — estimate page in oversight mode (read-only, banner, no collaborators/close/reopen, exports kept), author auto-fill only when editable, loader error component for non-404 failures — refs: AC-1.4, AC-1.5, AC-1.7, AC-2.4 — deps: T7
  - touch: `estimai-ui/src/context/EstimatorContext.tsx`, `estimai-ui/src/EstimatorApp.tsx`, `estimai-ui/src/router.tsx`, `estimai-ui/src/pages/EstimatePage.tsx`, `estimai-ui/src/types.ts`, `estimai-ui/src/lib/estimatesApi.ts`, `estimai-ui/src/**/*.test.tsx`, `estimai-ui/src/strings.ts`
  - done when: tests show oversight is read-only with exports present and no dirty state; a 503 loader failure renders the error panel with Retry; 404 still redirects

- [x] T10: shell e2e — `estimate-oversight.spec.ts`: admin opens All, opens a stranger's estimate read-only, switches to Closed — refs: AC-1.1, AC-1.4, AC-2.1 — deps: T1, T3, T7, T9
  - touch: `shell/e2e/estimate-oversight.spec.ts`, `shell/e2e/helpers/*`
  - done when: the spec type-checks; it runs green against `mise run dev` (or is reported as not run if the stack is not up)
  - status 2026-11-09: run green against `mise run dev` after the owner approved migrating and re-seeding the dev databases — 15/15 with the EstimAI regression specs (commit 4edf436)

- [x] T11: env contract, docs and changesets — env-doctor manifest/templates (`SERVICE_AUDIENCE` on estimai-api, `ESTIMAI_INTERNAL_URL` on crm-api, crm-api scope in `SERVICE_CLIENTS`), infra README deploy order, AGENTS.md API contract + domain terms, spec 013/018 amendment pointers, changesets — refs: US-1, US-2, US-3 — deps: T1, T4, T5
  - touch: `tools/env-doctor/**`, `infra/README.md`, `AGENTS.md`, `specs/013-estimate-sharing/spec.md`, `specs/018-crm-sales-flow/spec.md`, `.changeset/*`
  - done when: `mise run env:doctor` passes on the production templates; changesets cover auth, estimai-api, crm-api and estimai-ui

- [x] T12: estimai-api — security-review hardening (2026-11-09, 4 low findings): cache only a refusal so a revocation applies on the next request even on an old-epoch token; refuse a notice `at` more than 5 minutes ahead (400); warn in the log when `whose=all` returns > 500 rows (ADR-0075's revisit trigger); log only the error name when `auth` fails — refs: AC-1.6, AC-1.7, AC-3.6 — deps: T3, T4
  - touch: `estimai-api/src/estimates/oversight.ts`, `estimai-api/src/estimates/dealLinkNotices.routes.ts`, `estimai-api/src/estimates/estimates.routes.ts`, `estimai-api/src/estimates/*.test.ts`, `docs/adr/0075-*.md`, `specs/024-estimate-list-oversight/plan.md`
  - done when: estimai-api `bun test` on `estimai_test` is green with tests for same-token revocation, refusal caching and the future-`at` 400; `tsc --noEmit` clean
