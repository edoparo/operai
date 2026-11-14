---
spec: 20261110
status: approved
approved: 2026-11-10
amended: 2026-11-11
---

# Plan: Activities — one place for CRM and project activities and tasks

## Architecture

### Components

| Component | Change |
|---|---|
| `activities-api/` (new) | Bun + Hono + `@hono/zod-openapi` + Prisma 7, port **8087**, DB `activities`, Railway EU. Owns `activity`, `activity_participant`, `task_blocker`, `meeting_mirror_state`. JWKS resource server (ADR 20260703-jwt-resource-server-remote-jwks/0010, `AUTH_AUDIENCE`). No permission catalog of its own: every access decision comes from the host (below). Notify caller as `system:activities-api` (ADR 20261013-all-notify-callers-scoped-credentials-shared-token-retired). |
| `crm-api` | Gains the activity-host endpoint (`POST /activity-host/v1/resolve`). Loses `src/activities/`. Estimate request/override/unlink, estimate notices, meeting-host notices and contact erase call `activities-api` `/system/v1/*` with its service JWT (new scope `activities.write`). `meeting_host_state` moves out. |
| `projects-api` | Gains the activity-host endpoint for `project`. Nothing else: projects-api never stores tasks. |
| `auth` | New scope `activities.write` in `KNOWN_SERVICE_SCOPES` (granted to `crm-api`); new service client `activities-api` (`notifications.push emails.send` — `task_assigned` and `task_unblocked` are email notices, AC-6.1/6.3 and the CRM's unchanged 017 copy, and notify-api refuses `email: true` without `emails.send`, ADR 20261101-notify-api-resolves-email-notice-address-from-auth; amended 2026-11-11). |
| `notify-api` | *(amended 2026-11-11)* `ORIGIN_APPS` (`src/notifications/notifications.schemas.ts`) gains `projects`; `SERVICE_ORIGIN_BINDINGS` (`src/system/systemAuth.middleware.ts`) gains `"system:activities-api": ["crm", "projects"]` (ADR 20261013-all-notify-callers-scoped-credentials-shared-token-retired: an unbound `system:*` client may raise nothing); `system:crm-api` keeps `["crm"]`; the email footer map `ORIGIN_APP_LABELS` (`src/system/emailTemplates.ts`) gains `projects: "Projects"`. No migration: `originApp` is a `String` column, the closed set lives at the zod boundary. See § Notifications. |
| `shell` | `getActivitiesApiBaseUrl()` (`VITE_ACTIVITIES_API_URL`), trusted origin, CSP `connect-src`. *(amended 2026-11-11)* `NotificationOriginApp` in `src/lib/notifications.ts` gains `'projects'` — a wire-type mirror only: neither the SSE manager nor `ToastHost` branches on `originApp`, and every `/system/notifications` row is `toastWorthy:false` (`notify-api/src/system/notifications.routes.ts`), so an activities notice never toasts; it bumps the bell's unread count like any other. |
| `notify-ui` | *(amended 2026-11-11)* `NotificationOriginApp` (`src/lib/severity.ts`) gains `'projects'`; `src/strings.ts` `originApps` gains `projects` in `en` (`Projects`) and `it` (`Progetti`, the shell's `tools.projects` words) — the origin tag on each `/notify` row. A click follows `link.href` through `navigateSuite`, never `originApp`, so nothing else changes. |
| `operai-ui` | New shared `TaskRow` and `PersonChips` (story + test), adopted by both apps (owner, 2026-11-10). |
| `crm-ui` | `lib/activitiesApi.ts` replaces the seven activity functions of `lib/crmApi.ts` (same view shape, so `ActivityTimeline`, `ActivityItem`, `ActivityFormDialog`, `TasksPage` change only their import and the "unavailable" state of AC-1.5); `ActivityItem` renders through `TaskRow`; `lib/errors.ts` reads the Problem `code` so `host_unavailable`/`maintenance` are not shown as an authorization outage (design G7, same change in projects-ui). |
| `projects-ui` | Tasks card on `ProjectDetailPage`, task dialog (assignee, due date, blockers, participants), **My tasks** page at `/projects/tasks` with the **Pre-sales** badge; strings namespace `tasks`. |
| tooling | compose, `mise.toml` (dev, dev:web, dev:preview, db:migrate), `infra/check.sh`, env-doctor manifest + templates (`SERVICE_CLIENT_LINKS` gains `{ caller: "activities-api", requiredScopes: ["notifications.push", "emails.send"] }`; crm-api's entry gains `activities.write`), `lerna.json`, `AGENTS.md`, changeset, `scripts/check-shared-copies.ts` (activities-api gets the `serviceToken.ts` / guards shared copies). Railway/Vercel/DNS via the `provision-tool` skill. |

### Access: delegated to the host, asked as the caller

`activities-api` follows ADR 20261104-meeting-host-contract-resolve-and-notices's rule — a "may this user…" question is asked **as the user** —
and its host registry is data, never a branch (meetings-api `hosts/registry.ts` shape):

```ts
type ActivityHost = {
  app: "crm" | "projects"; entityType: "company" | "project"; kind: "pre_sales" | "operational";
  baseUrl: string;                  // CRM_API_URL / PROJECTS_API_URL
  accessAppId: "crm" | "projects";  // auth app-access-check for participants / CRM assignees
  types: ActivityType[];            // crm: all five; projects: ["task"]
  editBy: "author" | "manager";     // crm: author (017 AC-4.2); projects: manager (028 AC-3.2)
  completeBy: "reader" | "assignee_or_manager"; // crm: any reader (AC-4.3); projects: AC-3.3
  assignees: "app_users" | "host_list";         // crm: any CRM user; projects: PM + team (AC-3.1)
  links: { list: string; item: (a) => string }; // hrefs for notifications
}
```

Every route that touches an activity resolves its host entity through `resolve` with the caller's
`Authorization` header (2 s timeout, `redirect:"error"`, batches of 25, never cached — copied from
`meetings-api/src/hosts/client.ts`). Timeout, non-2xx, malformed or incomplete answer →
**503 `host_unavailable`** (fail closed, AC-8.2). An entity the host reports `missing` or not
readable → **404**, byte-identical to a nonexistent activity (AC-8.3).

Rejected alternatives (→ [ADR 20261110-activities-service-access-delegated-to-host](../../docs/adr/20261110-activities-service-access-delegated-to-host.md)):
- **Each tool keeps its own task tables** (CRM as today, projects-api its own): the two drift, and
  My tasks across tools needs a cross-service join anyway.
- **crm-api owns activities and projects-api calls it**: makes the CRM a dependency of delivery
  work and of people without `crm:access` (OPS, specs/20261103-projects D13).
- **An `activities` catalog in auth** (`activity:read/manage`): duplicates rules that already live
  in each host (`crm:access`, entity-scoped `project:manage`) and drifts from them.
- **Hosts proxy activities-api** (UI → crm-api → activities-api): every host re-implements the same
  routes; rejected by the user (spec Constraints).

### Replacing same-transaction couplings (→ [ADR 20261110-caller-chosen-ids-replace-cross-service-transactions](../../docs/adr/20261110-caller-chosen-ids-replace-cross-service-transactions.md))

Today four CRM flows write `activity` inside a crm-api transaction. They become calls whose
**identity is chosen by the caller** so every call is idempotent and compensable:

1. **Estimate request** (`estimate.routes.ts` request): crm-api generates the task id first
   (a UUID v4 from `crypto.randomUUID()`, not a cuid — *amended 2026-11-11*, § Data model, Ids),
   `PUT /system/v1/activities/{id}` (create-if-absent), then commits `deal_estimate.taskId`. Put
   fails → the EstimAI estimate is deleted as today and the request fails 503; commit fails →
   `DELETE /system/v1/activities/{id}` (compensation, logged if it fails). AC-1.2.
2. **Estimate override note**: same pattern with a `note`.
3. **Estimate unlink**: `DELETE /system/v1/activities/{id}?onlyIfOpen=true` **before** the
   transaction; failure → 503, nothing changed.
4. **EstimAI close/reopen notice** (`estimateNotices.routes.ts`): under the existing
   `deal_estimate FOR UPDATE` lock and version guard, crm-api calls
   `POST /system/v1/activities/{id}/completion {completed, at, byUserId, seq: estimaiVersion, context?}`
   **inside** the transaction; activities-api applies it only if `seq > completionSeq`
   (stored per activity), so duplicates and reordering are no-ops (AC-1.3). Unavailable → crm-api
   answers 503 and estimai-api's best-effort sender logs it; the CRM's admin override stays the
   manual repair (ADR 20261105-estimai-closes-the-estimate-crm-follows). The call is bounded because it runs under the row lock: 2 s per
   attempt, one 401 retry, 4 s in all (*amended 2026-11-11*, § Risks). activities-api sends
   `task_unblocked` for tasks this completion frees, labelled from the optional `context` crm-api
   sends with a completion (*amended 2026-11-11*, § System routes, Completion `context`).
5. **Meeting mirror** (`meeting-host/notices.routes.ts`): crm-api keeps validating the notice and
   the deal, then forwards `{noticeId, seq, event, meeting, deal: {id, companyId}}` to
   `POST /system/v1/meeting-mirror`. The `seq <= lastSeq` guard **moves with the data** into
   activities-api (`meeting_mirror_state`), so the guard and the write commit together. crm-api
   relays activities-api's `{applied}`; activities-api unavailable → 503, and meetings-api's outbox
   retries (ADR 20261104-meeting-host-contract-resolve-and-notices). AC-1.4.
6. **Contact erase** (`contacts.routes.ts` erase): crm-api calls
   `POST /system/v1/contacts/{contactId}/erase` (sets `contactId = NULL` everywhere, idempotent)
   **before** deleting the contact; failure → 503 `activities_unavailable`, contact unchanged.
   AC-8.4. *(amended 2026-11-11, security review round 1)* The erase also leaves a
   **tombstone** in activities-api, and every write that sets a `contactId` checks it under the
   same per-contact lock, so a write whose host check passed just before the erase can no longer
   re-link the contact after the sweep (what the former `ON DELETE SET NULL` foreign key gave
   for free). The guard commits with the data it protects (ADR 20261110-caller-chosen-ids-replace-cross-service-transactions amendment). § Data model,
   § System routes.

Rejected: a crm-api outbox for every flow (adds a queue to a service with none, and erase cannot
be eventual); best-effort erase (a GDPR erasure must be provable); keeping `meeting_host_state`
in crm-api (the guard would commit separately from the write and a failed forward would advance
it, losing the change).

### Migration: expand → copy (short write pause) → contract (→ [ADR 20261110-activities-migration-write-pause](../../docs/adr/20261110-activities-migration-write-pause.md))

The owner accepted a short announced pause (AC-2.5). Order of deploys:

1. **Expand.** Deploy `auth` (new scope + client) first — an unknown scope stops auth (ADR 20261108-crm-pushes-deal-links-to-estimai
   note). Then `activities-api` with `ACTIVITIES_MAINTENANCE=true` (every non-health route →
   503 `maintenance`), and `projects-api` with its host endpoint. Deploy `notify-api` in this
   step too *(amended 2026-11-11)*: additive (a wider enum, a new binding), harmless with no
   caller, and it must be live before step 4, the first moment activities-api writes and so
   pushes.
2. **Switch.** Deploy `crm-api` (new code, CRM tables still present, read-only for the script),
   `shell`, `crm-ui`, `projects-ui`, `notify-ui`. The CRM shows "activities unavailable"
   (AC-1.5/2.5). (An older notify-ui shows the raw id `projects` as the origin tag — degraded,
   never broken, `originAppLabel` falls back to the id.)
3. **Copy.** `activities-api/scripts/import-crm-activities.ts [--apply]`, with both database
   URLs in the environment only — `CRM_DATABASE_URL` (source) and `DATABASE_URL` (target), set
   for that one shell — never as command-line flags *(amended 2026-11-11, security review round 1,
   L4: a URL on the command line carries the database password into shell history and the
   process list; the script no longer accepts `--crm-database-url`/`--database-url`; runbook in
   `infra/README.md` § Activities migration)*. It reads crm `activity`, `activity_participant`,
   `task_blocker`, `meeting_host_state`; writes them
   with the same ids, timestamps (`createdAt`, `updatedAt` via raw insert) and
   `hostApp='crm', hostType='company', hostId=companyId`; `createMany skipDuplicates` keyed by id;
   compares every pre-existing target row field by field and reports differences; prints found /
   inserted / already-present / mismatched per table. Dry-run by default. AC-2.1–2.4.
4. **Unpause.** `ACTIVITIES_MAINTENANCE=false` once the report shows 0 mismatches and found =
   present. Then assign one test task in each host to a second person and check it reaches
   their `/notify` (origin "CRM" / "Projects"). notify-api's `caller=system:activities-api`
   line alone does not prove it — the middleware logs it before the route's 400/403 — and the
   push is best effort, so a refusal is otherwise invisible.
5. **Contract** (separate later push): crm-api Prisma migration dropping `task_blocker`,
   `activity_participant`, `activity`, `meeting_host_state` and the `ActivityType` enum. Never in
   the same push as step 2 (AC-2.3: nothing leaves the CRM until the copy is accounted for).

Rejected: dual write during a transition (code that exists for minutes, for a handful of records
and users); CDC/logical replication (infrastructure for a one-off).

## Data model

`activities-api/prisma/schema.prisma`:

```prisma
enum ActivityKind { pre_sales operational }
enum ActivityType { note call meeting email task }
enum HostApp      { crm projects }

model Activity {
  id                String       @id @default(cuid())   // own creates; imported and caller-chosen ids kept as given (see Ids)
  kind              ActivityKind
  type              ActivityType
  hostApp           HostApp
  hostType          String       // "company" | "project" (CHECK)
  hostId            String
  contactId         String?      // crm only (CHECK)
  dealId            String?      // crm only (CHECK)
  subject           String       // ≤ 200
  body              String?      // ≤ 10000
  occurredAt        DateTime
  authorUserId      String
  dueDate           DateTime?    @db.Date
  assigneeUserId    String?
  completedAt       DateTime?
  completedByUserId String?
  completionSeq     Int?         // last system completion applied (estimate notices)
  meetingId         String?      @unique
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt
  blockedBy    TaskBlocker[] @relation("BlockedTask")
  blocks       TaskBlocker[] @relation("BlockerTask")
  participants ActivityParticipant[]
  @@index([hostApp, hostType, hostId, occurredAt])
  @@index([contactId])
  @@index([dealId])
  @@index([assigneeUserId, completedAt])
  @@map("activity")
}
model ActivityParticipant { activityId, userId, createdBy, createdAt — identical to crm-api; @@index([userId]) }
model TaskBlocker        { blockedId, blockerId, createdBy, createdAt — identical to crm-api }
model MeetingMirrorState { meetingId @id, lastSeq Int, updatedAt }
model ErasedContact      { contactId String @id  @@map("erased_contact") }   // amended 2026-11-11
```

*(amended 2026-11-11, eval drift)* **Ids.** `activity.id` is text and activities-api checks no
format: every route takes any id of 1–64 characters without a NUL (`idText()` in
`src/lib/http.ts` — user route params, blocker ids, the system routes' path ids and the
completion `context.dealId`). Three kinds of id share the column:

| Where the row comes from | Id | Source |
|---|---|---|
| The one-off import of the CRM's activities | the CRM's cuid, unchanged (AC-2.1) | `scripts/import-crm-activities.ts` copies `id` verbatim |
| Created by activities-api (user `POST /activities`, the meeting mirror's create) | cuid (Prisma `@default(cuid())`, 25 characters) | the column default |
| Chosen by crm-api for `PUT /system/v1/activities/{id}` (estimate task, override note; ADR 20261110-caller-chosen-ids-replace-cross-service-transactions) | UUID v4 (36 characters) | `crypto.randomUUID()`, `crm-api/src/estimates/estimate.routes.ts` |

The third row is a decision taken in implementation (T12; neither the code nor the commit records
a reason). The plan said "cuid" as a description, not as a requirement: what ADR 20261110-caller-chosen-ids-replace-cross-service-transactions needs is an
id the caller holds before the first write and that no other writer can pick. In crm-api a cuid
exists only as Prisma's column default, applied inside a `create`, so it is not available before
the write without a new dependency; `crypto.randomUUID()` is built into Bun (122 random bits). The
decision stands. Consequences: nothing parses or interprets an id; `id` is only the last
tie-breaker of every list order (after `occurredAt`, `completedAt` or `dueDate`/`createdAt`), so the two formats change no order except between
rows with identical timestamps (deterministic and meaningless, as between two cuids); a crm-api
UUID can never equal an activities-api cuid (different lengths), so a system `PUT` cannot land on
an existing project activity — and if any id ever did exist, `PUT` answers 200 `created:false` and
writes nothing (create-if-absent, `hostApp = crm` only on the other system routes).

*(amended 2026-11-11, security review round 1, M1)* **`erased_contact` — the erasure guard.**
In crm-api the erasure was atomic: `activity.contactId` had a foreign key `ON DELETE SET NULL`, so
no write could commit a reference to a contact in the same instant it was deleted. Across two
services that atomicity is gone: activities-api checks a `contactId` through the host's `resolve`
(the contact belongs to the company) **before** its own transaction, so a create or PATCH whose
check passed just before an erase could commit after the erase's sweep and re-link a contact that
crm-api then deletes. The tombstone closes that window:

- One row per erased contact: `contactId` (the CRM's opaque id) and nothing else — no name, no
  email, no timestamp, no actor. Once crm-api has deleted the contact the id resolves to nothing,
  so the table holds no personal data. Rows are never deleted (CRM ids are never reused), no
  foreign key (the contact lives in another service).
- **One lock per contact:** `pg_advisory_xact_lock(hashtextextended('contact:' || contactId, 0))`,
  taken inside the transaction by the erase and by every write that **sets** a non-null
  `contactId` — user create (`POST /activities`), `PATCH /activities/{id}` and the import script.
  Writes that only clear it (meeting mirror's relink to another company) or never carry it (the
  system `PUT`, project tasks) take no lock.
- **Erase:** lock → `INSERT … ON CONFLICT DO NOTHING` into `erased_contact` → `UPDATE activity
  SET contactId = NULL WHERE contactId = $1` → commit. **Setting writes:** lock → the tombstone is
  read by a statement executed **after** the lock is held (READ COMMITTED gives that statement a
  fresh snapshot, so it sees an erase that committed while it waited) → present: refuse, nothing
  written → absent: write → commit. Both paths serialize on the lock, so either the write
  commits first and the erase's sweep nulls it, or the erase commits first and the write is
  refused. A tombstone read before the lock, or in another transaction, does not close the race.
- **Refusal:** user routes answer **422 `contact_not_in_company`** (`extras.field: "contactId"`),
  the same code and field as a contact the host does not return — the caller learns nothing it
  could not learn from the CRM (once the erase completes the contact is gone there too), and
  crm-ui already maps the code. The import script cannot answer 422: a source row whose `contactId` is tombstoned is reported as a mismatch, nothing is written and the
  exit code is ≠ 0 (the AC-2.3 rule). It cannot occur in the planned migration — activities-api
  is in maintenance until the copy is accounted for, so no erase can reach it — and is there so
  the script is not the one writer that ignores the guard.
- Lock collisions between different contacts (64-bit hash) only serialize two unrelated writes;
  they never refuse one.

Raw-SQL CHECKs in the init migration (the four CRM ones verbatim, plus):

```sql
CHECK (("hostApp" = 'crm' AND "hostType" = 'company' AND "kind" = 'pre_sales')
    OR ("hostApp" = 'projects' AND "hostType" = 'project' AND "kind" = 'operational'
        AND "type" = 'task' AND "contactId" IS NULL AND "dealId" IS NULL AND "meetingId" IS NULL))
CHECK ("blockedId" <> "blockerId")  -- task_blocker_not_self
```

Same-host blockers (AC-4.3) and no cycles stay application checks, as in crm-api.

## API contracts

Conventions: RFC 7807 errors; 422 validation with `extras.field` (crm-api `validationHook`); page =
`{items,total,page,pageSize}`, `pageSize` 1..100 default 25; `PersonRef =
{id,name|null,status}` resolved live, fail soft (ADR 20260807-live-identity-resolution-by-id-fail-soft). No If-Match (crm-api D-7 kept).

### Host contract (served by crm-api and projects-api)

`POST /activity-host/v1/resolve` — `[jwtMiddleware, authzMiddleware]`, caller's JWT, strict body:

```jsonc
// request
{ "entityType": "company", "ids": ["c1"],               // ≤ 25; may be [] = "may I read at all?"
  "related": { "contact": ["k1"], "deal": ["d1"] } }    // crm only, ≤ 100 each
// response
{ "reader": true,                                       // caller may read this host's activities
  "items": [{ "id": "c1", "state": "open" | "missing",
              "writable": true,                         // projects: false when closed/cancelled (AC-3.8)
              "label": "Acme SA", "href": "/crm/companies/c1",
              "may": { "write": true, "manage": true },
              "assignees": ["u1","u2"] }],              // projects only: PM + team
  "related": [{ "type": "deal", "id": "d1", "parentId": "c1", "label": "Website", "href": "/crm/deals/d1" },
              { "type": "contact", "id": "k1", "parentId": "c1", "label": "Ada Rossi", "href": "/crm/contacts/k1" }] }
```

- crm-api: `reader = may.write = may.manage = crm:access`; `missing` when the company does not
  exist; a related id not found is omitted (activities-api turns that into
  `contact_not_in_company` / `deal_not_in_company`, or `null` refs in views).
- projects-api: `reader = projects:access`; `may.manage = project:manage` covering the project's
  entity (`scopeFor`, same rule as `assertCanManage`); `may.write = may.manage`;
  `writable = state ∉ {closed, cancelled}` (crm-api: always `true`). activities-api refuses
  create/edit/reassign/delete on a non-writable host entity with 409 `host_read_only`; complete
  and reopen stay allowed (AC-3.8).
- An auth outage → 503 on the host → `host_unavailable` in activities-api.
- *(amended 2026-11-11)* **Only a 200 is an answer.** Any other status from a host — 401, 403,
  404, 400/422, 5xx — is `host_unavailable` (503) in activities-api, never domain input: a host
  validation error means activities-api sent a bad request, so it is never relayed as a 422 to
  the user. The status of a host's validation error follows that host's own convention
  (crm-api 422 with `extras.field`; projects-api 400 `validation_failed`, its `validationHook`);
  the "422 validation" convention above is activities-api's own, not the host contract's.
- *(amended 2026-11-11)* **`reader:false` alone decides.** When `reader` is false every entity
  is 404 (AC-8.3) and the response's `items`/`related` are ignored — not checked for
  completeness — so both shapes in use are valid: crm-api answers `{reader:false, items:[],
  related:[]}`, projects-api `{reader:false, items:[every id as {id, state:"missing"}]}`. The
  "incomplete answer → `host_unavailable`" rule (one item per distinct asked id) applies only
  when `reader` is true. `related` is optional in the response (projects-api never sends it;
  absent = `[]`), and `assignees` is read only from the projects host.
- *(amended 2026-11-11)* **`related` in the request** is crm-only in meaning, but projects-api
  accepts it (any keys, ≤ 100 ids each) and ignores it, so activities-api may send one body
  shape to every host. crm-api's `related` stays strict (`contact`, `deal` only).

### activities-api — user routes (JWT, `AUTH_AUDIENCE`)

| Route | Notes |
|---|---|
| `GET /activities?companyId=\|contactId=\|dealId=\|projectId=&type=&open=true&page&pageSize` | exactly one target (422 otherwise); order `occurredAt desc, id desc`; contact/deal targets resolve the companies of the matching rows |
| `POST /activities` | body = crm-api create body + `projectId` (exactly one of `companyId`/`projectId`); 422 `type_not_allowed` for a non-task on a project (AC-3.6); 422 `task_fields_on_non_task`, `contact_not_in_company`, `deal_not_in_company`, `blocker_is_self`, `blocker_not_in_host` (was `blocker_not_in_company`; crm-ui maps both), `owner_not_app_user` (was `owner_not_crm_user`), `assignee_not_on_project`; 403 `forbidden` without `may.manage` on projects (AC-3.2) |
| `PATCH /activities/{id}` | crm: 403 `author_only`; projects: 403 `forbidden` without manage; `blocker_cycle`; 409 `host_read_only`. The assignee is validated only when it **changes**: a PATCH that resends an unchanged assignee who has left the team is accepted (AC-3.7) |
| `DELETE /activities/{id}` | same gate as PATCH; 204 |
| `POST /activities/{id}/complete` / `/reopen` | crm: any reader; projects: assignee or manager, else 403 `forbidden`; 409 `task_blocked` `extras.blockers`; 422 `not_a_task` |
| `GET /tasks?kind=pre_sales\|operational\|all&projectId=&status=open\|done&assignee=me\|any\|<userId>&page&pageSize` | `projectId` lists one project's tasks (implies `kind=operational`, `assignee=any`) for the Tasks card (AC-3.4). Order: open → `dueDate asc NULLS LAST, createdAt asc, id asc`; done → `completedAt desc, id desc` (crm-api's order). | `me` = assignee or participant (017 AC-8.2). `kind=all` only with `assignee=me` (My tasks, AC-7.2). Response adds `"unavailable": ["crm"]` when a host could not be resolved and its items are left out (AC-7.5); a host whose `reader` is false contributes nothing (AC-7.4). `any`/`<userId>` require `reader` of the requested kind's host |
| `GET /tasks/assignees?kind=pre_sales\|operational` | distinct assignees (take 500), as today |

`ActivityView` = crm-api's view unchanged, plus `kind`, `project {id,name}|null` and
`may {edit, delete, complete}` computed per caller from the host answer and the registry rules
(author/manager, assignee, `writable`) — the UI never guesses (design G4). No server hrefs in
the view: the UIs build `/crm/...` and `/projects/...` links from ids (crm-ui's existing rule,
design G8). `company`/`contact`/`deal`/`project`
labels come from the resolve call; a ref the host no longer returns renders `name: null`.

### activities-api — system routes (service JWT, `aud=SERVICE_AUDIENCE`, scope `activities.write`, `sub` ∈ `["system:crm-api"]`; crm-api's `createSystemAuthMiddleware` copied as a shared copy)

```http
PUT    /system/v1/activities/{id}            { type, subject, body?, occurredAt, companyId, dealId?, authorUserId, assigneeUserId?, dueDate? }
       → 201 {id, created:true} | 200 {id, created:false} (already present) — never overwrites; {id} any 1–64-character id (§ Data model, Ids)
DELETE /system/v1/activities/{id}?onlyIfOpen=true  → 204 (absent is 204)
POST   /system/v1/activities/{id}/completion { completed, at, byUserId, seq, context? } → 200 {applied}
       context = { companyName, dealId | null, dealTitle | null }   // amended 2026-11-11
POST   /system/v1/meeting-mirror             { noticeId, seq, event, meeting{id,title,startsAt,creatorId}, deal{id,companyId} } → 200 {applied}
POST   /system/v1/contacts/{contactId}/erase → 200 {unlinked: n}
```

*(amended 2026-11-11, eval drift)* **Completion `context` — the labels of the notice it triggers.**
Added in implementation (388e611a) and recorded here.

- **Why.** US-1 / AC-1.1 keep the CRM's `task_unblocked` copy (specs/20261101-crm AC-6.3): "*<actor>*
  completed the last task this one was waiting on. Deal: *<title>*." on a deal, "Company:
  *<name>*." otherwise. A completion through the user route gets those labels from the host's
  `resolve`. A completion through this system route cannot: no user JWT reaches activities-api, so
  it cannot ask the host as the caller (ADR 20261110-activities-service-access-delegated-to-host), and it holds no CRM data. crm-api already holds
  the deal and its company when it applies an EstimAI close, so it sends their labels. Without the
  field the copy regressed (caught by the orchestrator in T12).
- **Shape and validation** (`activities-api/src/system/system.routes.ts`, `CompletionContext`).
  Optional. A strict object, so an unknown key is a 422. `companyName`: 1–200 characters, no NUL.
  `dealId`: an id (1–64 characters, no NUL) or `null`. `dealTitle`: 1–200 characters, no NUL, or
  `null`. `dealId` and `dealTitle` are both `null` or both set (otherwise 422 at `dealTitle`). A
  non-object is a 422. Every 422 refuses the whole call before the transaction, so nothing is
  applied and `completionSeq` does not move. crm-api clips both labels to 100 characters
  (`MAX_NAME`) before sending, and sends `context` only with `completed: true`, because reopening
  frees nothing (`crm-api/src/estimates/estimateNotices.routes.ts`).
- **Use: notice text only.** The completion's lookup, `seq` guard, update and `applied` answer
  never read it, and nor does the choice of recipient. For each task the completion frees
  (activities-api's own rows, `freedBy`):
  - a task of the completed task's company (its own `hostId` = the completed row's `hostId`) gets
    `companyName`;
  - it gets "Deal: *<dealTitle>*" only when its own stored `dealId` equals `context.dealId`, and
    "Company: *<companyName>*" otherwise;
  - with no `context`, or for a task of another company, the label is "—". Another company cannot
    occur, because blockers share a host (AC-4.3).

  The notice links to `/crm/tasks`, crm-api's fixed href for a task, and no link is built from
  `context`. The field is **content the caller asserts**. Only `system:crm-api` with
  `activities.write` can send it, and that caller can already write any CRM activity, so the field
  grants no authority. The worst a wrong `context` can do is mislabel one notice.
- **Known narrowing (reported to the owner as a spec finding, not decided here).** crm-api labelled
  each freed task with its **own** deal's title. `context` describes only the completed task's deal,
  so a freed task on a **different** deal of the same company now reads "Company: *<name>*." where
  it read "Deal: *<its title>*.". This happens only on the EstimAI-close path. User-route
  completions keep the full labels.

*(amended 2026-11-11, security review round 1, M1)* **Erase contract.** One activities-api
transaction: per-contact advisory lock → tombstone into `erased_contact` (if absent) → null every
`contactId` that equals it → commit; `unlinked` counts the rows nulled by **this** call, so a
repeat answers `200 {unlinked: 0}` and is the way to finish an erase that crm-api could not
complete. From the commit on, every write that sets that `contactId` is refused (§ Data model).
Failure → crm-api answers 503 `activities_unavailable` and deletes nothing (unchanged). The
order stays **sweep first, then crm-api deletes**: it is the order in which a refusal by
activities-api stops the erasure. Its one residual: the sweep commits and crm-api's delete then
fails — the contact still exists in the CRM, its activity links are gone, and new links to it are
refused (422 `contact_not_in_company`) until the erase is retried, which is idempotent on both
sides. A person finds out from the failed erase response; nothing repairs it automatically. Accepted
(§ Risks, ADR 20261110-caller-chosen-ids-replace-cross-service-transactions amendment): an erase the user asked for that half-ran is closer to what they
asked than a link that outlives it.

### Notifications (activities-api → notify-api `/system/notifications`, ADR 20261104-bilingual-system-notifications `it` copy)

`task_assigned` (email), `activity_participant_added` (in-app), `task_unblocked` (email) — the
two email kinds are sent with `email: true` (notify-api resolves the address, ADR 20261101-notify-api-resolves-email-notice-address-from-auth), which
needs the `emails.send` scope as well as `notifications.push` (amended 2026-11-11) — CRM
copy unchanged, `originApp:"crm"`, hrefs as today; project copy with `originApp:"projects"`,
href `/projects/<id>`. Fire-and-forget after the write, never throws (crm-api `announce`) — AC-6.4.

*(amended 2026-11-11)* **notify-api must accept them.** Before this amendment it refused every
push: `projects` fails the `ORIGIN_APPS` zod enum (400) and `crm` from an unbound
`system:activities-api` fails the origin binding (403); activities-api logs and the write stands,
so AC-6.1–6.3 would be silently unmet. Changes (files in § Components):

- `ORIGIN_APPS` += `projects` (this also lets a user's self-raise via `POST /notifications` carry
  `projects`; that path is self-only, ADR 20260716-system-notifications-cross-user-trigger, so it widens nothing).
- `SERVICE_ORIGIN_BINDINGS["system:activities-api"] = ["crm", "projects"]`. The origin is the
  tool the notice is about and opens (the `/notify` tag, the email footer), not the sender, so it
  follows the activity's host — `renderNotification` sets `originApp = target.host`.
- `system:crm-api` keeps `["crm"]`: after the move it still pushes its deal, estimate
  (request/override, estimate notices) and offer notices (`crm-api/src/lib/notify.ts`, called
  from `deals/`, `estimates/`, `offers/`); its activity pushes leave with `src/activities/` (T12).
  It never gets `projects`. No other principal gets `projects`: projects-api pushes nothing
  today, and when it does it gets its own row deliberately.
- notify-ui and the shell mirror the enum (§ Components); email footer "Sent by Operai Projects".

Rejected: a new `activities` origin (no tool by that name, the tag would not say where the task
lives, and the CRM notices would change, against AC-1.1); relaying pre-sales notices through
crm-api as `system:crm-api` (crm-api would push for records it no longer owns — the shape
ADR 20261110-activities-service-access-delegated-to-host rejected).

ADRs: **ADR 20261013-all-notify-callers-scoped-credentials-shared-token-retired is applied, not amended** — its binding table is code in notify-api, so a new
notify caller needs a notify-api row as well as the `auth` `SERVICE_CLIENTS` grant; this plan
named only the grant. This is the first principal bound to two origins and the first origin
(`crm`) with two principals; the rule "a principal raises only its bound origins" is unchanged.
**ADR 20261105-auth-pushes-admin-notifications's** "a new scope ships with its origin binding" is about a scope; activities-api gets
no new scope (`notifications.push`, `emails.send` exist), but the same discipline applies to a
new client: the grant and the binding ship together, notify-api first. Its "any other origin
revisits the ADR" concerns `system:auth` only and is untouched. No new ADR.

## Test strategy

Integration = Bun tests against Postgres (`activities_test`) with the host resolve stubbed by a
real Hono test host (the meetings-api `MEETINGS_TEST_HOSTS` pattern); e2e = Playwright in
`shell/e2e` with the whole stack.

| AC | Level | Test |
|---|---|---|
| 1.1 | integration + e2e | crm-api's `activities.test.ts`, `blockers.test.ts`, `participants.test.ts` ported to activities-api against a crm test host; existing CRM e2e (activities, tasks, blockers) stay green unchanged |
| 1.2 | integration | crm-api estimate request: put fails → no task, estimate deleted, 503; commit fails → compensating DELETE; success → open task assigned to technical contact |
| 1.3 | integration | completion endpoint: ready/reopen; `seq` equal/older → `applied:false`; crm-api notice route calls it inside the lock. *(amended 2026-11-11)* activities-api `system.test.ts`: `context` gives the deal title only to a freed task on the same deal, the company name otherwise, "—" without a context or for another company; every malformed context (unknown key, empty or > 200-character label, `dealId`/`dealTitle` without the other, non-object) → 422 with `completionSeq` unchanged. crm-api `lib/activities.test.ts`: the locked call's bound — each attempt gets 2 s, not the client default; the 401 retry and the token exchange count against the 4 s budget; no attempt starts once the budget is spent |
| 1.4 | integration | meeting-mirror: linked/changed/relinked/unlinked/deleted, duplicate and reordered `seq`; crm-api relays 503 when activities-api is down |
| 1.5 | component (crm-ui vitest) + e2e | timeline/Tasks render the unavailable state on 503 `host_unavailable`/`maintenance` (not the authz copy) while the rest of the page renders; CRM e2e and `ActivityItem.test.tsx` green after the `TaskRow` adoption |
| 2.1, 2.2, 2.4 | integration | import script on a seeded crm DB: every field equal, ids preserved, second run inserts 0; estimate task + meeting activity still driven by 1.3/1.4 after import |
| 2.3 | integration | mismatched pre-existing row → reported, exit ≠ 0; report counts |
| 2.5 | integration + manual runbook | `ACTIVITIES_MAINTENANCE=true` → every route 503 `maintenance`, health 200; runbook step in infra/README |
| 3.1–3.3, 3.6 | integration | projects test host: create/edit/reassign/delete with and without manage, out-of-scope entity 403, explicit assignee not PM/team 422, no assignee → author, assignee completes without manage, note on project 422, `may` flags match each case |
| 3.4, 3.5 | integration + e2e | ordering and `status` of `GET /tasks?projectId=`; a `projects:access`-only user reads; projects e2e: tasks card |
| 3.7 | integration | assignee removed from host `assignees` → task still listed and completable; PATCH resending the unchanged assignee accepted; reassigning to them refused |
| 3.8 | integration | closed/cancelled project (`writable:false`) → create/edit/reassign/delete 409 `host_read_only`, complete/reopen 200 |
| 4.1–4.3 | integration | blockers on project tasks (self, cycle, >10, delete removes); blocked → 409; pre-sales ↔ operational blocker → 422 `blocker_not_in_host` |
| 5.1, 5.2 | integration + component | participants need `projects` app access (app-access-check stub); view lists them |
| 6.1–6.3 | integration | notify stub receives kind/recipients/email flag/href/`it` copy for project tasks; actor excluded; env-doctor test: an `activities-api` client without `emails.send` fails `SERVICE_CLIENT_LINKS` |
| 6.4 | integration | notify down → write still 2xx |
| 6.1–6.3 (notify-api, amended 2026-11-11) | integration (notify-api `systemAuth.routes.test.ts`, `notifications.schemas.test.ts`, `emailTemplates.test.ts`) | `system:activities-api` raises `crm` and `projects` → 201, `refund`/`meetings`/`admin` → 403; `system:crm-api`, `system:meetings-api`, `system:inventory-api`, `system:refund-api`, `system:estimai-api`, `system:auth` and an unbound `system:projects-api` raising `projects` → 403, nothing persisted; `system:crm-api` still raises `crm` → 201; `projects` + `email:true` with both scopes → 201 with `emailStatus`; `ORIGIN_APPS` contains `projects`; footer reads "Sent by Operai Projects" |
| 6.1–6.3 (notify-ui, amended 2026-11-11) | component (notify-ui vitest: `NotificationItem.test.tsx`, `severity.test.ts`, `italian.test.tsx`) | a `projects` notification's origin tag reads "Projects", and "Progetti" under `<html lang="it">`; `ORIGIN_APP_LABELS` covers every `NotificationOriginApp`; catalog parity green |
| 6.1 (shell, amended 2026-11-11) | typecheck (`shell` `pnpm build`) | `NotificationOriginApp` includes `projects`. No ToastHost test: system notifications are never toast-worthy, so ToastHost has nothing to render for them |
| 6.1 (e2e, amended 2026-11-11) | e2e (`shell/e2e`, projects spec) | the PM assigns a project task to a team member → the member's `/notify` lists it with origin "Projects", and the row opens `/projects/<id>` |
| 7.1 | integration + e2e | `GET /tasks?kind=pre_sales` never returns operational; CRM Tasks page |
| 7.2, 7.3 | integration + e2e | `kind=all&assignee=me` mixes both in one order; badge visible; complete a pre-sales task from projects-ui, link opens `/crm/...` |
| 7.4 | integration | crm host `reader:false` → no pre-sales items; both non-reader shapes (`items:[]`, and every id `missing`) give the same result, never `host_unavailable` |
| 7.5 | integration + component | crm host down → operational items + `unavailable:["crm"]`; projects-ui shows the notice |
| 8.1 | integration | authorization matrix (host × rule × caller) over the assembled app, like `crm-api/src/matrix.test.ts` |
| 8.2 | integration | host timeout / 500 / 400 / 422 / 401 / malformed / incomplete (when `reader:true`) → 503 `host_unavailable`, nothing written |
| 8.3 | integration | missing vs unreadable host entity → byte-identical 404 |
| 8.4 | integration | crm-api erase: activities-api down → 503, contact still present; up → no activity references it. *(amended 2026-11-11, M1)* activities-api: after an erase, `POST /activities` and `PATCH /activities/{id}` with that `contactId` → 422 `contact_not_in_company` even while the stub host still returns the contact, nothing written; a PATCH that does not touch `contactId` still succeeds; a repeated erase → 200 `{unlinked:0}`, one tombstone row with only `contactId`; **race:** a create held after its host check (test hook between resolve and the transaction) while the erase commits → refused, and an erase started while a create holds the lock waits and then nulls it — in both orders no activity references the contact afterwards; the import script with a tombstoned source `contactId` → reported, exit ≠ 0, nothing written. crm-api: sweep succeeds and the contact delete fails → error answered, contact present, its links null; the retry completes the erase |

Host route guard matrices *(amended 2026-11-11)*: each host's `src/matrix.test.ts` asserts that
every user route without the module's access grant is 403; `POST /activity-host/v1/resolve`
answers 200 `reader:false` instead, so it is a **named exception** with its own assertion (401
without a token, 200 `reader:false` without the grant) — crm-api lists it beside
`/meeting-host/v1/resolve`, projects-api gives it the `host` need class. T12's changes to
`crm-api/src/matrix.test.ts` keep that exception; removing `src/activities/` must not remove it.

## Risks

| Risk | Mitigation / early check |
|---|---|
| Resolve latency on every request (two hops for CRM pages) | Batch per request (one resolve per distinct host entity set); measure in the CRM e2e; escalate to a short `(sub, perm_epoch)` cache only if p95 > 300 ms — recorded in ADR 20261110-activities-service-access-delegated-to-host |
| The estimate notice now depends on activities-api: a down activities-api makes the notice 503 | estimai-api already treats the push as best effort; the CRM admin override is the documented repair (ADR 20261105-estimai-closes-the-estimate-crm-follows); covered by test 1.3 |
| Existing gap: a contact moved to another company leaves activities that reference it under the old company (crm-api today, unchanged) | Out of scope (spec Non-goals: no CRM rule changes); listed in ADR 20261110-caller-chosen-ids-replace-cross-service-transactions as a known pre-existing drift |
| Mirrored meeting activity edited by hand onto another deal, then `unlinked` misses it (pre-existing) | Unchanged behaviour (AC-1.4 "exactly as before"); noted |
| Import timestamps: Prisma would reset `updatedAt` | Raw `INSERT` in the script; asserted by test 2.1 |
| Deploy order: auth must know `activities.write` before crm-api asks for it | Step 1 of the migration; env-doctor `SERVICE_CLIENT_LINKS` makes a missing grant a CI failure — including `emails.send` for `activities-api` (without it every email notice is refused by notify-api, the in-app row still written, and AC-6.1/6.3 silently half-met) |
| notify-api refuses activities-api's pushes until it knows `projects` and the `system:activities-api` binding, and the refusal is silent (best effort, the write stands, AC-6.4) *(amended 2026-11-11)* | notify-api deploys in migration step 1, notify-ui in step 2, both before step 4 (unpause), the first moment activities-api writes; step 4's check (a test task reaches the assignee's `/notify` in each host) proves it; tests in § Test strategy 6.1–6.3 (notify-api) |
| crm-ui and crm-api switch at different moments on Vercel/Railway | The pause covers it: activities-api is in maintenance until both are live; crm-ui handles 503 (AC-1.5) |
| The estimate notice holds the `deal_estimate` row lock across the call to activities-api. *(amended 2026-11-11, eval: the code had a 4 s timeout per attempt, so with the 401 retry and the token exchange the lock could be held for more than 8 s)* | One row per deal, and notices are rare. **The bound:** crm-api gives the completion call made under the lock its own limit (`LOCKED_CALL` in `crm-api/src/lib/activities.ts`). Each attempt gets **2 s**. There is **at most one retry**, after a 401: the cached service token is dropped and minted again. The whole call has a **4 s budget**, which includes the token exchange and the retry. An attempt gets only what is left of the budget, and none starts once it is spent. An activities call therefore holds the `deal_estimate` lock for **at most about 4 s**, plus the transaction's own statements. **On failure** (budget spent, timeout, network error, any non-2xx) the result is 503 `activities_unavailable`. The transaction rolls back (`estimaiVersion` does not advance and the CRM state does not move), the notice answers 503, and estimai-api's best-effort sender logs it (AC-1.3). The repair is the admin override (ADR 20261105-estimai-closes-the-estimate-crm-follows). Nothing is compensated, because a completion is made idempotent by its `seq`, not by a compensating call. AC-1.2's compensation (the DELETE) belongs to the estimate request, whose calls run outside any lock. **Residual:** a call that timed out in crm-api after activities-api had applied it leaves the task done while the CRM state did not move. A redelivery of the same version answers `applied:false` and moves the CRM state; without one, the admin override repairs it (ADR 20261110-caller-chosen-ids-replace-cross-service-transactions amendment, residual 5). Calls made outside a lock (`PUT`, `DELETE`, mirror, erase) keep the client default of 4 s per attempt. Tests: § Test strategy 1.3 |
| *(amended 2026-11-11, M1)* Contact erase lost its atomicity with the move (the `ON DELETE SET NULL` FK): a create/PATCH whose host check passed before the erase could commit a link after the sweep | `erased_contact` tombstone + per-contact advisory lock in activities-api, checked by every write that sets `contactId` (§ Data model); race test in 8.4. **Residual accepted:** sweep commits, crm-api's delete fails → the contact remains with no links and new links to it are refused until the erase is retried (idempotent); visible to the person as the failed erase |
| *(amended 2026-11-11, L3)* Compensation residuals in crm-api's estimate flows (ADR 20261110-caller-chosen-ids-replace-cross-service-transactions § Known residuals): (a) override note written, the override transaction **and** the compensating DELETE fail → the timeline shows an override that was never recorded; (b) a PUT that timed out lands **after** its compensating DELETE → an orphan task or note with no `deal_estimate` link; (c) unlink deletes the open task, then its transaction fails → the link stays without its task | Known, logged, not repaired now. (c) is self-healing: a later close notice on the missing task answers `applied:false` and the CRM's own state still moves; retrying the unlink finds the task absent (204) and completes. Direction, not implemented: record-first ordering for the override (commit the override, then PUT the note, retrying the note under the same id); an idempotent reconciliation script over `deal_estimate.taskId` ↔ crm-hosted tasks with no link, dry-run by default (the shape of `crm-api/scripts/backfill-estimate-links.ts`) |
| During the pause activities-api refuses meeting-mirror forwards (503): meetings-api retries `unlinked`/`deleted` until delivered, but `linked`/`changed` only manually (ADR 20261104-meeting-host-contract-resolve-and-notices) | Runbook step after unpause: list meetings-api's failed host notices of the pause window and retry them; the old `meeting_host_state` is frozen from the switch on, so the copy reads a consistent state (ADR 20261110-activities-migration-write-pause) |

## Security

**YES** — new authorization-enforcing path (delegated, fail closed), a new service-to-service
scope (`activities.write`) that can create, delete and complete activities, personal data
(contact names, free-text bodies) crossing a new service boundary, and a GDPR erasure that becomes
cross-service. Schedules an owasp-reviewer pass with QE. notify-api's origin binding gains one principal
(`system:activities-api` → `crm`, `projects`, amended 2026-11-11): the binding is what stops a
compromised activities-api from raising notices as Refund, Admin or Meetings, so the refusals are
tested (§ Test strategy) and are a review surface. *(amended 2026-11-11)* The completion
route's `context` puts text that crm-api asserts into notices and emails sent to a user. The text is
bounded and NUL-free, is rendered as plain text in notify-api's escaped templates, and is read for
nothing but the labels (§ System routes). Data residency: activities-api on Railway
EU, its own logical DB on the shared Postgres; no new processor.

## ADR candidates

- `docs/adr/20261110-activities-service-access-delegated-to-host.md` — shared service, host registry,
  resolve as the caller (rejected: per-tool tables, crm-api as owner, auth catalog, host proxy).
- `docs/adr/20261110-caller-chosen-ids-replace-cross-service-transactions.md` — idempotent PUT +
  compensation, completion `seq`, meeting guard moves with the data, fail-closed erase (rejected:
  outbox, best-effort erase, guard left in crm-api).
- `docs/adr/20261110-activities-migration-write-pause.md` — expand → copy under maintenance →
  contract (rejected: dual write, CDC).

## Amendments

- 2026-11-10, design stage (owner approved): `GET /tasks?projectId=` with due-date order and
  status (G1); unchanged-assignee PATCH accepted (G3); `may` flags in the view (G4); errors read
  the Problem `code` (G7); no server hrefs in views (G8); host `writable` + 409
  `host_read_only` for closed/cancelled projects (spec AC-3.8); shared `TaskRow`/`PersonChips`
  in `@operai/ui`, adopted by crm-ui now; project task assignee optional, default author
  (spec AC-3.1).

- 2026-11-11, implementation drift (verified against the code): (1) the `activities-api`
  service client holds `notifications.push emails.send`, not `notifications.push` alone — email
  notices (AC-6.1/6.3, the CRM's `task_assigned`/`task_unblocked`) need `emails.send` per
  ADR 20261101-notify-api-resolves-email-notice-address-from-auth and `notify-api/src/system/notifications.routes.ts`; env-doctor `SERVICE_CLIENT_LINKS`
  expects both (§ Components, § Notifications, Risks). (2) Only a host 200 is an answer; any
  other status is `host_unavailable`, and a host's validation status follows its own convention
  (crm-api 422, projects-api 400 `validation_failed`). (3) `reader:false` alone decides; a
  non-reader response's items are ignored, so crm-api's `items:[]` and projects-api's
  all-`missing` items are both valid. (4) projects-api accepts and ignores `related`. (5) Each
  host's `matrix.test.ts` names the resolve route as an exception (200 `reader:false`, not
  403). § Host contract, § Test strategy.
  (6) notify-api refused every activities-api push: `projects` was not in `ORIGIN_APPS` (400)
  and `system:activities-api` had no `SERVICE_ORIGIN_BINDINGS` row (403). notify-api gains the
  `projects` origin, the binding `["crm", "projects"]` (crm-api keeps `["crm"]`) and the email
  footer label; notify-ui gains the `projects` origin tag (en + it); the shell mirrors the type.
  notify-api deploys in step 1, notify-ui in step 2, both before unpause. ADR 20261013-all-notify-callers-scoped-credentials-shared-token-retired applied, not
  amended; ADR 20261105-auth-pushes-admin-notifications untouched; no new ADR. § Components, § Migration, § Notifications, § Test
  strategy (also: the 8.4 row moved back inside the table), § Risks, § Security.

- 2026-11-11, security review round 1 (owasp-reviewer findings, fixes implemented as stated):
  **M1** contact erasure lost the atomicity of the former `ON DELETE SET NULL` foreign key — a
  write whose host check passed just before an erase could re-link the contact after the sweep.
  activities-api gains the `erased_contact(contactId PK)` tombstone (opaque id only); the erase
  takes `pg_advisory_xact_lock(hashtextextended('contact:'||id,0))`, inserts the tombstone and
  nulls `contactId` in one transaction; create, PATCH and the import take the same lock and
  refuse a tombstoned contact (422 `contact_not_in_company`; the script reports and exits ≠ 0).
  Residual accepted: sweep committed, crm-api delete failed → links lost, contact kept, new links
  refused until the idempotent retry. ADR 20261110-caller-chosen-ids-replace-cross-service-transactions amended (the guard commits with the data it
  protects, applied to erasure). § Architecture (flow 6), § Data model, § System routes, § Test
  strategy 8.4, § Risks. **L3** compensation residuals in crm-api's estimate flows (override note
  without override; late PUT after its compensating DELETE; unlink's task gone with the link
  kept) recorded as known residuals with the mitigation direction (record-first override, an
  idempotent reconciliation script) — not implemented now. § Risks, ADR 20261110-caller-chosen-ids-replace-cross-service-transactions. **L1** the
  identities calls use `redirect:"error"` like `resolve`; **L2** a NUL in user text is refused
  with 422 and the `[uncaught]` log names the error and its code only, never the payload;
  **L4** the import script takes its database URLs from the environment only (§ Migration step
  3). No spec change; status stays approved.

- 2026-11-11, eval drift (spec-fidelity findings 1a–1c of `eval-report.md`, documents only).
  (1) The completion system route takes an optional `context {companyName, dealId|null,
  dealTitle|null}`. It is strict, with 1–200-character labels, no NUL, and the deal pair both or
  neither; a 422 applies nothing. It exists so the CRM's `task_unblocked` copy stays as it was
  (US-1), because activities-api cannot ask a host without a user JWT. It is caller-asserted text,
  used only for the notice's labels and never for a lookup, a guard, a recipient or an access
  decision. Known narrowing: a freed task on a different deal of the same company is labelled with
  the company, where crm-api named its own deal. This is reported as a spec finding (§ System
  routes). (2) Ids: activities-api accepts any 1–64-character id without a NUL. It generates cuids
  itself and keeps imported CRM cuids unchanged. crm-api's caller-chosen ids are UUID v4
  (`crypto.randomUUID()`), a decision taken in implementation (§ Data model, Ids; flow 1). (3) The
  completion call under the `deal_estimate` lock is bounded at 2 s per attempt, one 401 retry and a
  4 s budget including the token exchange. Failure rolls back and answers 503, with no
  compensation; the timeout-after-apply residual is recorded. The 4 s per-attempt timeout that the
  eval measured is a defect fixed in the code, not the design (§ Risks; flow 4). ADR 20261110-caller-chosen-ids-replace-cross-service-transactions amended
  (§ Amendment 2026-11-11, implementation drift). § Architecture (flows 1, 4), § Data model,
  § System routes, § Test strategy 1.3, § Risks. No new AC; status stays approved.

## Spec follow-up

specs/20261103-project-collaboration keeps US-2 (threads) and US-3 for threads only; its US-1 is replaced by a pointer to
specs/20261110-activities (done in the tasks stage, with a tasks re-sync for 027 if it has one).
