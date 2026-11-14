---
spec: 20261108
status: approved
approved: 2026-11-09
---

# Plan: EstimAI list — every estimate for admins, closed estimates out of the way, the deal at a glance

## Architecture

Four services move. No new service, no new frontend remote.

| Component | Change |
|---|---|
| `auth` | catalog: new `estimate:read-all` action (no conditions), seeded to `admin` only; new service scope `deal-link-notices.send` |
| `estimai-api` | list filters (`whose`, `status`), the oversight read path, `crmDealId` on the list item, `POST /system/deal-link-notices` |
| `crm-api` | pushes a deal-link notice after it links (request) or unlinks an estimate; a re-runnable backfill script |
| `estimai-ui` | "Whose" and "Status" controls, closed and deal badges, read-only oversight mode in the estimate page |

### US-1 — oversight (amends ADR 20260807-record-level-acl-resource-server-owned-access-primitive/0037; ADR candidate A)

estimai-api stays what ADR 20260807-record-level-acl-resource-server-owned-access-primitive made it — record access is ownership or a collaborator
row, resolved locally — with ONE exception: the oversight path. It is the only place
estimai-api asks `auth` about a role-based permission.

- `access.ts` `resolveAccess` is unchanged. A new `resolveOversight(authHeader)` calls
  `auth GET /authz/resolve` with the caller's own JWT (ADR 20260716-refund-api-authorization-enforcing-resource-server: no new credential) and
  answers whether the caller holds `estimate:read-all`. Only a refusal is cached, by
  `(sub, perm_epoch)` with a 30 s backstop; a grant is asked for every time so a revocation
  applies on the next request (amended 2026-11-09, security review). The deal-link notice's
  `at` may be at most 5 minutes ahead of estimai-api's clock (400 otherwise), and a `whose=all`
  list over 500 rows logs a warning (ADR 20261108-estimai-oversight-permission-amends-0036's revisit trigger). On an `auth` failure it throws, and
  the route answers **503** (fail closed, AC-1.7).
- It is consulted ONLY when the caller asks for it:
  - `GET /estimates?whose=all` — always (403 without the permission, AC-1.2).
  - `GET /estimates/{id}` — only when `resolveAccess` returned `null`. With the permission
    the estimate is returned with `access: "oversight"`; without it, 404 as today (AC-1.6).
    A caller's own and shared estimates never touch `auth` (AC-1.7: they keep working).
- Every write route (`PUT`, `DELETE`, `close`, `reopen`, `collaborators/*`) is unchanged: it
  goes through `resolveAccess` only, so an oversight-only caller is still "no relationship"
  there. That would be a 404, but AC-1.4 asks for 403. So the write routes get a cheap guard:
  when `resolveAccess` returns `null` AND the caller holds `estimate:read-all`, answer 403
  `oversight_read_only`; otherwise 404 as today. A failure of `auth` on that guard answers
  404, not 503 — the write is refused either way, and a stranger still learns nothing.
- `access: "oversight"` is a WIRE value only. It is never stored, never a collaborator
  level, never accepted by the collaborators API.
- Permission shape: a NEW action, `estimate:read-all`, with `supportedConditions: []`.
  - Rejected: reusing the declared `estimate:view`. It declares ownership/entity/department
    conditions, and estimai-api would then have to evaluate them, or silently treat a
    conditioned grant as global.
  - Rejected: `requireAdmin` (a role-name check). It cannot be granted to an auditor
    without making them admin, and it bypasses the catalog the Admin UI composes roles
    from (ADR 20260713-authz-hand-rolled-rbac-abac-epoch-claims).
- AC-1.5: when `resolveAccess` returns a level, it wins. Oversight is only a fallback.

### US-2 — closed out of the default list (amends specs/20261101-crm-sales-flow AC-3.3 / ADR 20261105-estimai-closes-the-estimate-crm-follows)

No new status: `closedAt` already exists. Only the list query changes.

- `GET /estimates?status=open|closed`. When `status` is absent, both are returned, which
  is today's behaviour. That matters for `useImportOffer`: it dedupes against the account by
  name/id and must keep seeing closed estimates, or it would re-offer them (the bug fixed in
  3f6c467).
- The UI always sends an explicit `status`.

### US-3 — deal link pushed by the CRM (mirror of ADR 20261105-estimai-closes-the-estimate-crm-follows; ADR candidate B)

- **Where the link lives.** estimai-api gets two nullable columns:
  - `crmDealId` — the linked deal's id, or null;
  - `crmLinkAt` — the CRM instant of the last applied notice, linked or unlinked.
- **Notice.** `POST /system/deal-link-notices` on estimai-api, service JWT only:
  - scope `deal-link-notices.send`, `sub` must be `system:crm-api`, `aud = SERVICE_AUDIENCE`;
  - copied from crm-api's `systemAuth.middleware.ts` (no workspace, ADR 20260703-estimai-api-bun-hono-typescript).
  - Body (strict, nothing else accepted):
    ```json
    { "estimateId": "…", "dealId": "…", "event": "linked" | "unlinked", "at": "<ISO 8601>" }
    ```
  - Answers **204** in every applied/ignored case, including an unknown estimate (it may
    have been deleted in EstimAI). It answers 400 for a malformed body, and 401/403 for the
    credential.
- **Ordering (AC-3.6).** The notice is applied in one conditional `updateMany` (no
  read-then-write):
  - it applies only when `crmLinkAt IS NULL OR at > crmLinkAt` — an older notice changes
    nothing;
  - with an equal `at`, `unlinked` wins;
  - a repeat is a no-op;
  - `unlinked` clears `crmDealId` only when it equals the notice's `dealId`, so an unlink of
    a deal the estimate is no longer linked to never removes the current link.
  - Timestamps rather than a sequence number: every `at` comes from crm-api's one clock, and
    a link has at most two events today (the CRM never relinks an existing estimate — a new
    request creates a new estimate, specs/20261101-crm-sales-flow AC-3.1).
- **Senders in crm-api.** `src/estimates/estimate.routes.ts`:
  - after `POST /deals/{id}/estimate` commits, send `linked` (AC-3.4);
  - after `DELETE /deals/{id}/estimate` commits, send `unlinked` (AC-3.5).
  - "The deal is deleted" (spec AC-3.5) has no code path: crm-api has no deal deletion
    (every FK to `deal` is `Restrict`, no `DELETE /deals/{id}`). The sender is therefore
    complete with link and unlink; a future deal deletion must send `unlinked`. This is
    recorded in the ADR.
- **Client.** `crm-api/src/lib/estimaiNotices.ts`, the same shape as
  `estimai-api/src/lib/crmNotices.ts`:
  - it never throws; on a 401 it retries once with a fresh token; it logs ids/status only;
  - its credential is crm-api's existing service client (`SERVICE_CLIENT_ID/SECRET`) plus
    the new scope;
  - it posts to the new optional `ESTIMAI_INTERNAL_URL` (Railway private network, like
    `CRM_INTERNAL_URL`). Unset, it is a no-op logged once at startup.
- **Delivery: best effort** (the spec's open question, settled here). The badge is
  informational; a lost notice is repaired by re-running the backfill. An outbox
  (ADR 20261104-meeting-host-contract-resolve-and-notices's shape) was rejected: it adds a table and a retry loop for a badge.
- **Backfill (AC-3.7).** `crm-api/scripts/backfill-estimate-links.ts`:
  - dry run by default; `--apply` sends a `linked` notice for every
    `deal_estimate` with `estimateId <> ''`, with `at = requestedAt`;
  - safe to re-run, because the notice is idempotent and ordered by `at`;
  - it is also the repair for a lost notice.
- **Rejected alternatives** (ADR candidate B):
  - The CRM passes `dealId` when it creates the estimate with the user's JWT. That is a
    user-asserted field: any EstimAI user could badge any estimate, and unlink would still
    need a push.
  - estimai-ui asks crm-api per row. Only CRM users would see anything, which breaks AC-3.1
    for a technician without the CRM, and it adds a cross-app call on every list render.
- **UI.** The list item carries `crmDealId: string | null`.
  - The badge links to `/crm/deals/:id` through `navigateSuite` only when
    `usePermissions()` holds `(crm, access)` (AC-3.2).
  - Without it, a plain `Badge`. The deal's title is never shown, since it is not known
    (AC-3.3).

### UI (estimai-ui)

- **`EstimatesPage`.**
  - Two selects in a filter row. "Whose" is rendered only when `usePermissions()` holds
    `(estimate, read-all)`; it is a UI convenience, and the server is the gate.
  - The state lives in the route's search params (`/estimates?whose=all&status=closed`,
    TanStack `validateSearch`). The last choice is mirrored to `sessionStorage` (wrapped in
    try/catch), so returning from an estimate without params restores it (AC-2.6).
  - Row badges: Closed (`StatusBadge`), Deal (US-3), and for oversight rows the owner
    identity (already rendered for shared rows).
  - Delete stays owner-only. Open stays for every row.
- **`EstimatorContext`.**
  - `canChangeLifecycle = access === 'owner' || access === 'editor'`, so an `oversight`
    caller is read-only, like a viewer.
  - The collaborators chip is hidden for `oversight` (the collaborators API is unchanged, so
    it would 404). The close/reopen button is not shown for oversight. Exports (XLSX/PDF) run
    client-side from the loaded document and stay available (AC-1.4).
- **Copy.** All copy goes in `strings.ts`, `en` + `it` (parity test).

### ADRs

- `docs/adr/20261108-estimai-oversight-permission-amends-0036.md` — candidate A.
- `docs/adr/20261108-crm-pushes-deal-links-to-estimai.md` — candidate B.

### Decisions on the design's gaps (2026-11-09, taken by Claude while the owner was away — review)

The owner asked that tasks and implementation proceed without further input; these settle
design.md § gaps and are flagged for the owner's morning review.

- **Permissions not yet loaded (gap 1).** As design.md F2: the "Whose" select renders once
  `usePermissions()` holds `(estimate, read-all)`. Once permissions have loaded without it, a
  `whose=all` from the URL or sessionStorage is dropped by a replace-navigation. A request
  sent before that point is gated by the server, and a 403 shows the design's "Show my
  estimates" panel.
- **Owner on own rows (gap 2).** No API change. In **All**, a row with `access: "owner"`
  shows "You" where other rows show the owner's identity, which satisfies AC-1.3.
- **Empty Mine/Open (gap 3).** The empty state keeps its New estimate / Load example
  actions, with copy that no longer claims "you have never created one". No extra count call.
- **Estimate route errors (gap 4).** The `/estimates/$estimateId` loader still redirects to
  the list on 404. Every other failure (503 `authz_unavailable` on an oversight open, network,
  500) is rethrown and rendered by the route's `errorComponent`: a `StatePanel` with Retry
  (`router.invalidate()`) and a link back to the list. This replaces today's silent
  redirect, so AC-1.7's 503 is visible. It supersedes design.md F3's "redirect with a notice"
  (G4): an error page needs no message passed through the router.
- **Author auto-fill (gap 8).** The `EstimatorApp` effect that backfills `author` from the
  session must not run when the editor is read-only for any reason (`!canEdit`: viewer,
  oversight, closed), so an admin's view never marks the document dirty.
- **UI beyond the ACs (gap 6).** Accepted: the dynamic heading, the Oversight badge, the
  oversight banner, the 403 panel and the empty-state matrix are the minimum UI the ACs need
  to be legible.
- **Library candidates (gap 5).** Stay app-level in this feature. `DealBadge` and
  `EstimateFilters` live in `estimai-ui`, and a second consumer moves them into `@operai/ui`.
  The Deal badge uses an existing non-money icon (see design.md); no new library icon.

## Data model

estimai-api, one migration (`prisma/migrations/<ts>_estimate_crm_link/`):

```prisma
model Estimate {
  // …
  crmDealId  String?    // the CRM deal this estimate belongs to; set/cleared only by crm-api's notice
  crmLinkAt  DateTime?  // CRM instant of the last applied link notice (ordering, AC-3.6)
  @@index([closedAt])
}
```

No other schema changes. `closedAt` already exists; `auth`'s catalog is code + seed (no
migration); crm-api has no schema change.

## API contracts

### estimai-api

`GET /estimates?whose=mine|all&status=open|closed` (both optional; defaults `whose=mine`,
`status` absent = both)

- 200 → `EstimateListItem[]`, newest first, each item
  `{ id, name, author, updatedAt, access: "owner"|"editor"|"viewer"|"oversight", owner, closedAt, crmDealId }`
  - `whose=all` returns every estimate. A row the caller owns or collaborates on carries
    that level; any other row is `oversight`.
- 400 for an unknown `whose`/`status` value.
- 403 `{ code: "oversight_required" }` for `whose=all` without `estimate:read-all`.
- 503 `{ code: "authz_unavailable" }` for `whose=all` when `auth` fails.

`GET /estimates/{id}`

- 200 as today for owner/collaborator.
- 200 with `access: "oversight"` and no `collaboratorCount` for a permission holder with no
  relationship.
- 404 when there is no relationship and no permission.
- 503 `{ code: "authz_unavailable" }` only on the oversight fallback.

`PUT`, `DELETE`, `POST …/close`, `POST …/reopen`, `/collaborators*` on an estimate reached
only through oversight

- 403 `{ code: "oversight_read_only" }`.
- Everything else is unchanged (404 for a stranger, 403/409/428 as today).

`POST /system/deal-link-notices` (service JWT, scope `deal-link-notices.send`, sub `system:crm-api`)

- body `{ estimateId: string(1..64), dealId: string(1..64), event: "linked"|"unlinked", at: ISO 8601 }` (strict)
- 204 — applied, ignored as older or a repeat, or unknown estimate.
- 400 — malformed body.
- 401 — missing or invalid credential.
- 403 — wrong scope or sub.

### auth

- `catalogs/estimai.ts`: `estimate` resource gains `{ key: "read-all", label: "Read every estimate", supportedConditions: [] }`.
- `seed.ts`: `ensureGrant(adminRole.id, "estimate", "read-all")`. A seed contract test pins
  "admin only" (AC-1.8).
- `serviceClients.ts`: `KNOWN_SERVICE_SCOPES` adds `deal-link-notices.send`. The production
  `SERVICE_CLIENTS` adds it to the `crm-api` entry (a deploy step, after auth is live).

### env-doctor manifest

- crm-api: `ESTIMAI_INTERNAL_URL` (optional; consumer of estimai-api's private URL).
- estimai-api: `SERVICE_AUDIENCE` (optional; required for the notice route — unset = the
  route refuses every call, fail closed). It must differ from `AUTH_AUDIENCE`.
- auth `SERVICE_CLIENTS`: `crm-api` scope set includes `deal-link-notices.send`.

## Test strategy

| AC | Level | Test |
|---|---|---|
| AC-1.1 | component | `EstimatesPage.test.tsx`: with `(estimate, read-all)` in mocked `usePermissions`, "Whose" shows Mine (selected) and All |
| AC-1.2 | component + integration | without the permission the control is absent; `estimates.routes.test.ts`: `whose=all` → 403 `oversight_required` |
| AC-1.3 | integration + component | `whose=all` returns a stranger's estimate as `oversight` with owner, `updatedAt`, `crmDealId`; the page renders those rows |
| AC-1.4 | integration + component | GET by id → 200 `access:"oversight"`; PUT/DELETE/close/reopen/collaborators → 403 `oversight_read_only`; `EstimatorApp` test: read-only, no close/collaborators, export buttons present |
| AC-1.5 | integration | an admin who is an editor gets `access:"editor"` and can PUT |
| AC-1.6 | integration | resolver mock answers without the permission on the next epoch → `whose=all` 403, GET by id 404 |
| AC-1.7 | integration | resolver mock fails → `whose=all` 503, oversight GET 503, own/shared GET and `whose=mine` list 200 with no resolver call |
| AC-1.8 | unit (auth) | seed contract test: `estimate:read-all` held by `admin` and no other seeded role |
| AC-2.1 | component | Status control with Open default, Closed option, combinable with Whose (query string carries both) |
| AC-2.2 | integration + component | `status=open` excludes a closed estimate for owner and collaborator; `status=closed` includes it; row shows the Closed badge |
| AC-2.3 | integration | reopen → the estimate is back in `status=open` for owner and collaborator |
| AC-2.4 | component | an estimate opened from Closed is read-only and an editor sees Reopen (existing lifecycle tests extended) |
| AC-2.5 | integration | an estimate closed before the change (row with `closedAt` set, no new columns) is in `status=closed` |
| AC-2.6 | component | search params drive the selects; navigating to `/estimates` with no params restores the last choice from sessionStorage |
| AC-3.1 | component | a row with `crmDealId` shows the Deal badge under every Whose/Status combination |
| AC-3.2 | component | with `(crm, access)` the badge is a link calling `navigateSuite('/crm/deals/<id>')`; without it, not a link |
| AC-3.3 | contract | `EstimateListItemSchema` has `crmDealId` only; `deal-link-notices` body is strict (an extra field → 400) |
| AC-3.4 | integration (crm-api) | `POST /deals/{id}/estimate` sends one `linked` notice with the new estimate id, deal id and time (injected client) |
| AC-3.5 | integration (both) | crm-api unlink sends `unlinked`; estimai-api applies it → `crmDealId` null in the next list |
| AC-3.6 | integration (estimai-api) | repeat → no change; older `at` → ignored; unlinked then late linked → stays unlinked; equal `at` → unlinked wins; unlink of a different deal → link kept |
| AC-3.7 | integration (crm-api) | backfill dry run sends nothing; `--apply` sends one `linked` per linked deal; a second run changes nothing in estimai-api |
| AC-3.8 | integration (crm-api) | notice client failing (network, 500, 401 twice) → link/unlink still 2xx and committed |

Plus:
- `systemAuth` tests in estimai-api: wrong aud, wrong scope, wrong sub, user JWT,
  `SERVICE_AUDIENCE` unset → refused;
- auth `serviceClients` test for the new scope;
- `catalogGaps` parity for the new strings.

The e2e journey (shell/e2e) is **one** spec, `estimate-oversight.spec.ts`: an admin opens
All, opens a stranger's estimate read-only, then switches to Closed. The deal badge is
covered at integration level, because the e2e stack has no crm-api → estimai-api service
credential.

## Risks

- **`auth` deploy order.** crm-api's token request fails until auth knows
  `deal-link-notices.send`, and setting `SERVICE_CLIENTS` before the new auth is live crashes
  auth (seen 2026-11-07).
  - Mitigation: ship auth first, then set the variable, then deploy crm-api; run the
    backfill last.
  - Early check: `env-doctor --env production`.
- **Clock-based ordering.** Two crm-api replicas with skewed clocks could reorder a
  link/unlink pair.
  - Mitigation: crm-api runs one replica today. A link and its unlink are user actions
    seconds or days apart; the equal-time rule favours unlink.
  - The ADR names "a second crm-api replica or a relink path" as the trigger to move to a
    per-link sequence.
- **Oversight list size.** `whose=all` returns every estimate unpaginated (the spec excludes
  paging).
  - Early check: the count of estimates in production (tens today).
  - The ADR records 500 as the trigger to paginate.
- **Write-route guard calling `auth`.** Adds an `auth` round trip only on the stranger path
  (a would-be 404), never on the owner/collaborator path. Early check: the integration
  test asserts no resolver call on the owner path.
- **Import offer regression.** If the UI's list fetch were reused by `useImportOffer` with
  `status=open`, closed estimates would be re-offered.
  - Mitigation: the import offer calls the list without `status`.
  - A test in `ImportOfferModal.test.tsx` pins it.

## Security

**YES.** This is an authorization change in a resource server: a new role-based read across
every user's records, plus a new service-to-service write route with a new scope. The
OWASP pass covers:
- **A01:** oversight read-only on every write route, no existence leak to strangers, and
  `whose=all` gated server-side.
- **A07:** service JWT aud/scope/sub pinning, and a user JWT refused on `/system`.
- **A04:** fail-closed on `auth` outage for the oversight paths.
- **A09:** notices log ids only, never tokens.

## ADR candidates

- **A — estimai-api enforces one catalog permission, read-only oversight (amends 0036/0037).**
  - Chose a new unconditioned `estimate:read-all`, resolved live and failing closed only on
    the oversight path, with the wire-only access value `oversight`. Writes answer 403
    `oversight_read_only`.
  - Rejected: reusing `estimate:view` (declared conditions); `requireAdmin`; admin as
    implicit editor; making every estimai-api route authorization-enforcing.
- **B — the CRM pushes deal links to EstimAI (mirror of 0073).**
  - Chose a service-JWT notice `{estimateId, dealId, event, at}` with scope
    `deal-link-notices.send`, ordered by the CRM instant with unlinked winning ties, best
    effort, and a re-runnable backfill as the repair.
  - Rejected: `dealId` asserted by the user on create; estimai-ui querying crm-api; an outbox.
