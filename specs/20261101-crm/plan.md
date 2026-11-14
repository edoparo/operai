---
spec: 20261101
status: approved
approved: 2026-11-01
---

# Plan — CRM (specs/20261101-crm)

Decisions referenced as D-n are in [decisions.md](./decisions.md); ADR 20261101-crm-tool-shape-and-authorization (tool shape and
authorization) and ADR 20261101-user-directory-gate-widened-to-deal-manage (directory gate widened) record the significant ones.

## Architecture

```
shell (/crm/$, gated on crm:access) ──MF──► crm-ui (remote "crm", :5179)
                                              │ apiFetch (shell/session, Bearer JWT)
                                              ▼
                                         crm-api (:8084, DB "crm")
                                              │ GET  /authz/resolve            (fail closed, 503)
                                              │ POST /authz/users/identities   (names: fail soft;
                                              ▼                                 owner checks: fail closed)
                                            auth
crm-ui ──apiFetch──► auth GET /authz/users/directory   (owner/assignee picker, deal:manage holders)
```

- `crm-api` is an **authorization-enforcing resource server** (ADR 20260716-refund-api-authorization-enforcing-resource-server): `jwtMiddleware`
  (RS256, issuer, `aud=AUTH_AUDIENCE`) then `authzMiddleware` (live `/authz/resolve`,
  `(sub, perm_epoch)` cache, 30 s TTL, fail closed). Every route except `/health` requires
  `crm:access`. Copied from inventory-api (no shared package, by design).
- No object storage, no notify calls (D-14), so the env is the minimal resource-server set:
  `DATABASE_URL`, `ALLOWED_ORIGINS`, `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`,
  `AUTH_BASE_URL`, `PORT` (8084), `NODE_ENV`.
- `auth` changes: `catalogs/crm.ts`, `seedCrmCatalog` + `seedCrmGrants` (role `sales`),
  `crm` in `ALL_APP_IDS`, `deal:manage` added to `DIRECTORY_GATE_PERMISSIONS`.
- `shell` changes: `crm` remote (vite.config, runtimeRemotes, remotes.d.ts, stubs,
  useRemoteVersions), `/crm/$` route, `TOOLS` entry + sidebar icon, `VITE_CRM_API_URL`
  trusted origin + `getCrmApiBaseUrl()`, CSP, `@source` for crm-ui, strings.

## Data model (Prisma, DB `crm`)

```
enum Entity        { welld_ch welld_it }
enum CompanyStatus { prospect customer former }
enum DealStage     { lead qualified proposal negotiation won lost }
enum Currency      { CHF EUR }
enum ActivityType  { note call meeting email task }

company   id cuid · name ≤200 · status · entity · website? · industry? · city? · country? (A-Z{2})
          · notes? · ownerUserId · archivedAt? · version int · createdBy/updatedBy · timestamps
          UNIQUE lower(name)  (functional index, raw SQL in the migration; D-11)
contact   id · companyId? → company (Restrict) · firstName · lastName · email? · phone? · jobTitle?
          · notes? · archivedAt? · version · createdBy/updatedBy · timestamps
deal      id · companyId → company (Restrict) · title · stage · amountCents BigInt≥0 · currency
          · entity · expectedCloseDate (date)? · ownerUserId · lostReason? · closedAt? · notes?
          · version · createdBy/updatedBy · timestamps
activity  id · type · subject · body? · occurredAt · companyId → company (Restrict)
          · contactId? → contact (SetNull, D-13) · dealId? → deal (Restrict) · authorUserId
          · dueDate (date)? · assigneeUserId? · completedAt? · completedByUserId? · timestamps
```

Indexes: company(status), company(ownerUserId); contact(companyId), contact(lower(email));
deal(stage), deal(companyId), deal(closedAt); activity(companyId, occurredAt),
activity(contactId), activity(dealId), activity(assigneeUserId, completedAt).
`amountCents` is `BigInt` in Postgres and a JS `number` on the wire (≤ 10^13, safe).

## API contract (crm-api)

All bodies JSON; errors RFC 7807 with top-level `code` and extension members (inventory-api's
`problem.ts`). Validation failure → **422** with `field` + `errors[]`. Dates `YYYY-MM-DD`,
instants ISO 8601. Every route: 401 no/invalid token, **403** no `crm:access`, **503** auth
outage.

### Shared shapes

```ts
type Entity = 'welld_ch' | 'welld_it'
type PersonRef = { id: string; name: string | null; status: 'active' | 'deleted' | 'unknown' | 'system' }
type Page<T> = { items: T[]; total: number; page: number; pageSize: number }
// list query: page (≥1, default 1), pageSize (1..100, default 25)
```

Concurrency (D-7): `GET`, `POST`, `PATCH` and the archive/stage routes of company, contact and
deal return `ETag: "<version>"` and the body carries `version`. Every **mutation of an existing
company, contact or deal** requires `If-Match: "<version>"` → **428** `precondition_required`
when absent or malformed, **409** `version_conflict` (extras `{ currentVersion }`) when stale.

### Scope

`GET /scope` → `{ deal: Entity[], canErase: boolean }` — entities `deal:manage` covers for
the caller (empty = cannot manage deals), and whether the caller holds `contact:erase`.

### Companies

```ts
type CompanyStatus = 'prospect' | 'customer' | 'former'
type CompanySummary = { id; name; status; entity; industry: string|null; city: string|null;
  country: string|null; owner: PersonRef; archived: boolean; contactCount: number;
  openDealCount: number; updatedAt: string }
type Company = CompanySummary & { website: string|null; notes: string|null; version: number; createdAt: string }
```

| Route | Body / query | Answer |
|---|---|---|
| `GET /companies` | `q?`, `status?`, `archived?` (`false` default \| `true` \| `all`), `ownerId?`, `page`, `pageSize` | `Page<CompanySummary>` sorted by name |
| `POST /companies` | `{ name, status, entity, website?, industry?, city?, country?, notes?, ownerUserId? }` | 201 `Company`; 409 `company_name_taken` `{companyId}`; 422 `owner_not_active` |
| `GET /companies/:id` | | `Company`; 404 |
| `PATCH /companies/:id` | any create field (nullable optionals accept `null` to clear) | `Company`; 409/428/422 as above |
| `POST /companies/:id/archive` · `/unarchive` | (If-Match) | `Company` |

### Contacts

```ts
type ContactSummary = { id; firstName; lastName; email: string|null; phone: string|null;
  jobTitle: string|null; company: { id: string; name: string } | null; archived: boolean; updatedAt: string }
type Contact = ContactSummary & { notes: string|null; version: number; createdAt: string }
```

| Route | Body / query | Answer |
|---|---|---|
| `GET /contacts` | `q?` (first/last name, email), `companyId?`, `archived?`, `page`, `pageSize` | `Page<ContactSummary>` sorted by last, first name |
| `POST /contacts` | `{ firstName, lastName, email?, phone?, jobTitle?, companyId?, notes? }` | 201 `Contact`; 422 `company_not_found` |
| `GET /contacts/:id` · `PATCH` · `POST …/archive` · `…/unarchive` | as companies | `Contact` |
| `DELETE /contacts/:id` | needs `contact:erase` (403 otherwise) | 204 (erasure, D-13) |

### Deals

```ts
type DealStage = 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost'
type Currency = 'CHF' | 'EUR'
type DealSummary = { id; title; company: { id; name }; stage; amountCents: number; currency;
  entity; expectedCloseDate: string|null; owner: PersonRef; closedAt: string|null; updatedAt: string;
  version: number }   // version: the If-Match of a move from the board (D-25)
type Deal = DealSummary & { lostReason: string|null; notes: string|null; createdAt: string }
```

| Route | Body / query | Answer |
|---|---|---|
| `GET /deals` | `q?` (title), `stage?`, `open?` (`true` = open stages only), `board?` (`true` = open deals plus those won or lost this calendar year, the set `GET /pipeline` totals; D-25), `companyId?`, `ownerId?`, `entity?`, `page`, `pageSize` (≤ 200) | `Page<DealSummary>`, open deals by expected close date (nulls last), else `updatedAt` desc |
| `POST /deals` | `{ companyId, title, amountCents, currency, stage?, entity?, expectedCloseDate?, ownerUserId?, notes? }` | 201 `Deal`; 403 (no `deal:manage`) / 403 `out_of_scope`; 422 `company_not_found` · `company_archived` · `stage_not_open` · `owner_not_active` |
| `GET /deals/:id` | | `Deal` |
| `PATCH /deals/:id` | `{ title?, amountCents?, currency?, entity?, expectedCloseDate?, ownerUserId?, notes? }` | `Deal`; 403 `out_of_scope` for the current or the new entity |
| `POST /deals/:id/stage` | `{ stage, lostReason? }` (If-Match) | `Deal`; closed → `closedAt=now`; reopened → `closedAt`/`lostReason` cleared; `lostReason` only kept for `lost` |

`GET /pipeline?entity?` →

```ts
{ probabilities: Record<DealStage, number>,            // percent, D-8
  year: number,                                         // UTC calendar year of won/lost (D-10)
  stages: { stage: DealStage; count: number;
            totals: { currency: Currency; amountCents: number; weightedCents: number }[] }[] }
// one entry per stage in order; open stages over all open deals, won/lost over closedAt in `year`
```

### Activities and tasks

```ts
type ActivityType = 'note' | 'call' | 'meeting' | 'email' | 'task'
type Activity = { id; type; subject; body: string|null; occurredAt: string;
  company: { id; name }; contact: { id; name: string } | null; deal: { id; title } | null;
  author: PersonRef; task: null | { dueDate: string|null; assignee: PersonRef|null;
  completedAt: string|null; completedBy: PersonRef|null }; createdAt; updatedAt }
```

| Route | Body / query | Answer |
|---|---|---|
| `GET /activities` | exactly one of `companyId` / `contactId` / `dealId` (422 otherwise), `page`, `pageSize` | `Page<Activity>` by `occurredAt` desc |
| `POST /activities` | `{ type, subject, companyId, body?, occurredAt?, contactId?, dealId?, dueDate?, assigneeUserId? }` | 201; 422 `company_not_found` · `contact_not_in_company` · `deal_not_in_company` · `task_fields_on_non_task` · `owner_not_active` |
| `PATCH /activities/:id` | `{ subject?, body?, occurredAt?, dueDate?, assigneeUserId? }` | author only → 403 `author_only` |
| `DELETE /activities/:id` | | 204; author only |
| `POST /activities/:id/complete` · `/reopen` | | `Activity`; 422 `not_a_task` |
| `GET /tasks` | `status?` (`open` default \| `done`), `assignee?` (`me` default \| `any` \| a user id; D-26), `page`, `pageSize` | `Page<Activity>`; open by due date asc nulls last, done by `completedAt` desc |
| `GET /tasks/assignees` | | `{ items: PersonRef[] }`: everyone tasks were ever assigned to, by name (≤ 500); the task filter's colleagues (D-26) |

## UI (crm-ui)

`ToolLayout` "CRM" (`default` width) with `TabNav`: Companies · Contacts · Pipeline · Tasks.
Routes (basepath `/crm`): `/companies`, `/companies/$id`, `/contacts`, `/contacts/$id`,
`/pipeline`, `/deals/$id`, `/tasks`; `/` redirects to `/companies`. Built per
`operai-ui/docs/building-pages.md`: every page a `<section aria-labelledby>` with `PageHeader`,
one state at a time (403 → `PermissionDenied`, loading → `SkeletonRows` + live line, failure →
`Banner warning` with Retry, 503 → the "Authorization service unavailable" banner, empty →
`StatePanel`). Lists: `DataTable` + filters `Card` + `Pagination`. Create forms ≤ 5 fields →
`FormDialog`; the company/contact/deal edit dialogs are `FormDialog size="lg"`. Archive →
`ConfirmDialog tone="primary"`; erase → `ConfirmDialog tone="danger"` with `acknowledgeLabel`.
Statuses through ONE map (`lib/statusMeanings.ts`): company prospect→pending,
customer→active, former→voided; stage lead→draft, qualified/proposal/negotiation→pending,
won→settled, lost→failed; task open→pending, overdue→attention, done→settled. Entity and
currency are neutral `Badge`s. People are picked with `Combobox` over the directory (403 →
the picker is not offered and the field shows the current owner read-only). A company is
picked with `Combobox` over `GET /companies?q=`. 409 `version_conflict` / 428 → a danger
banner "Someone else changed this record. Reload to see their changes." with a Reload action.

## Test strategy

- crm-api (`bun test`, real Postgres DB `crm`, mocked JWT + resolve as in inventory-api):
  authorization matrix over the assembled route table (403 without `crm:access`, 401 without
  token); companies (create, duplicate name incl. case and archived, 428/409, archive, paging,
  search); contacts (company link, erase gated + activity link nulled); deals (scope 403,
  stage rules, reopen, company archived); pipeline arithmetic (per currency, weighted rounding,
  won/lost year); activities (cross-company refs refused, author-only, tasks complete/reopen,
  my-tasks ordering); identities (owner must be active; outage → 503).
- auth: catalog test for `crm`, seed grants test for `sales`, directory gate includes
  `deal:manage`.
- crm-ui (vitest): strings parity + hardcoded-copy scan, api error mapping, status map,
  pipeline formatting helpers, key pages rendering each state with mocked `shell/session`.
- shell: existing tests extended for the `crm` tool/remote (tools, runtimeRemotes, CSP,
  About modal sources).

## Rollout (not done in this session, D-22)

`provision-tool` for `crm`: Railway service `crm-api` (EU, DB `crm` on the shared Postgres),
Vercel project `crm-ui` (`crm.operai.welld.io`), `crm-api.operai.welld.io`, shell env
`VITE_CRM_API_URL`, `runtime-config.json` `crm` entry, `crm-api` `ALLOWED_ORIGINS` = shell
origin, auth re-seed (deploy runs it) for the catalog and `sales` role.
