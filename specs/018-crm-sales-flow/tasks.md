---
spec: 018
status: in-progress
---

# Tasks — CRM sales flow (specs/018)

| ID | Task | State | Verified by |
|---|---|---|---|
| T1 | Spec, plan, decisions (O1–O4 answered in decisions.md) | [x] | this directory |
| T2 | auth: `deal:financials`, `crm-technical` role, app-access-check by `userId`, directory `?appId=` filter, ADR-0055 | [x] | 80 tests in the four touched files (scratch DB) + typecheck |
| T3 | crm-api: migration (`deal_estimate`, `deal_offer`, `deal_attachment`, `entity_profile`, CHECKs), optional `ESTIMAI_API_URL` / `CRM_S3_*` | [x] | `migrate deploy` on `crm_test`, typecheck |
| T4 | crm-api: money redaction (deals, pipeline, scope), `requireCrmUsers` for owners/assignees, ADR-0054 | [x] | `financials.test.ts`, updated companies/activities/matrix tests |
| T5 | crm-api: estimate request/ready/reopen/override/unlink, the gate, no deal created past qualified | [x] | `estimate.test.ts`, `deals.test.ts` |
| T6 | crm-api: offers (scope arithmetic, PDF, numbering, download, delete) and entity profiles | [x] | `scope.test.ts`, `offers.test.ts` |
| T7 | crm-api: attachments (two-phase upload, limits, download rule) | [x] | `attachments.test.ts` (crm-api total: 106) |
| T8 | env-doctor manifest (optional ESTIMAI_API_URL, CRM_S3 residency, secret vars) and the local MinIO bucket in compose | [x] | env-doctor 123 tests, `mise run env:doctor` |
| T9 | Env files the guard keeps from the agent: add `ESTIMAI_API_URL=http://localhost:8080` and the `CRM_S3_*` block (local MinIO, see crm-api/README.md) to `crm-api/.env.example` and `.env`. Once provisioned, add them to the env-doctor production template `crm-api.env` and require them in the manifest | [ ] | developer |
| T10 | crm-ui: money hiding, estimate card, gate messages, offers, attachments, settings tab | [x] | `pnpm lint && pnpm build && pnpm test` (126 tests, 34 new) |
| T11 | Browser smoke through the real stack | [ ] | blocked 2026-11-01: the running dev servers predate the change (stale Prisma client → 500 on `/deals?board=true`; stale Vite deps → invalid hook call). Restart `mise run dev` after T9, then re-run. The offer PDF itself was rendered and checked visually. |
| T12 | Production: CRM bucket + crm-api env (with specs/017 T16) | [ ] | owner, `provision-tool` |
