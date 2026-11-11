# 0081 — An activity's access is decided by the host that owns the entity, asked as the caller on every request: activities-api stores the records and holds no permission catalog of its own

**Date:** 2026-11-10  
**Status:** Accepted (decided by the owner, Matteo Codogno, at the specs/028 plan gate; extends ADR-0059's resolve pattern to a second consumer)  
**Deciders:** Matteo Codogno (owner), wellD  
**Project:** Operai

---

## Context

CRM activities and tasks (specs/017 US-4, US-6, US-8) and project tasks (specs/027 US-1, taken over
by specs/028) are one concept: an activity, pre-sales or operational, recorded by an Operai user.
Built twice, the two would drift in rules, look and behaviour, and a person working on both a deal
and a project would have two unrelated to-do lists. The two sets of rules are not ours to merge:
OPS (delivery) holds no `crm:access` and must not gain it, while CRM access and entity-scoped
project management already live, correctly, in crm-api and projects-api. specs/028 therefore needs
one store for activities that does not become a second owner of CRM or project authorization.

## Decision

We will keep every activity in one new backend-only service, `activities-api` (Bun + Hono + Prisma,
port 8087, logical database `activities`, Railway EU), and that service holds **no permission
catalog**. Every access decision about an activity is asked of the host the activity belongs to,
**as the caller**, through the host's `POST /activity-host/v1/resolve` with the caller's own JWT
forwarded verbatim (ADR-0059's rule, extended from meetings-api to a second consumer):

- **Hosts are registry data, never code branches.** Each host is one `ActivityHost` entry: `app`,
  `entityType`, `kind` (`pre_sales` | `operational`), `baseUrl`, `accessAppId`, the allowed activity
  `types`, `editBy` (`author` | `manager`), `completeBy` (`reader` | `assignee_or_manager`),
  `assignees` (`app_users` | `host_list`) and link builders. Production holds two entries: CRM
  (`company`, pre-sales: note, call, meeting, email, task) and projects (`project`, operational:
  task only).
- **The resolve call** (2 s timeout, `redirect: "error"`, batches of at most 25 ids, never cached,
  copied from meetings-api's `hosts/client.ts`) answers `reader`, per-item `state`, `may.write`,
  `may.manage`, and for projects the entity's `assignees`. Any timeout, non-2xx, malformed or
  incomplete answer, including an auth outage behind the host, is **503 `host_unavailable`**: nothing
  is read or written. An entity the host reports missing, or not readable to the caller, is a **404
  byte-identical to a nonexistent activity**.
- **Reads that span hosts** (`GET /tasks` for My tasks) call each host at most once per request. A
  host that cannot be resolved contributes **no items and is named** in the response
  (`unavailable: ["crm"]`); a host whose `reader` is false contributes nothing. The list does not fail
  as a whole.
- **Consumers call activities-api directly.** `crm-ui` and `projects-ui` reach it through
  `shell/session`'s `apiFetch`; neither the CRM nor projects-api proxies it. (Owner decision,
  specs/028 constraints.)
- **The system routes are a different principal.** Routes that crm-api calls with its service JWT
  (`/system/v1/*`, scope `activities.write`, `sub` allowlisted to `system:crm-api`) do not run the
  host question for the end user; the calling host has already made it, and the authority is the
  service's scope, not a user's rights. Their write pattern is recorded in its own ADR (ADR-0082).

## Failure shape

**A decision about a person being made with someone else's authority, and a copy of another
service's rules quietly becoming the rule.** The first: a store that answers "may this user see
this record?" for records it does not own, either with a credential that is not the user's (so the
answer describes the service's rights, not the user's) or from a list it keeps itself (so the answer
is as old as the last copy). The second: when the rules for "who may read, write, complete or
manage" are restated in a second service, they drift; the same person is refused in one place and
allowed in the other, and nobody notices until a record is changed by the wrong one.

Where else the shape appears, in the mirror positions:

- **Question and answer, read and write.** A list that spans owners (My tasks, a search, an export,
  a count) takes the same rule as a single read. A host that cannot answer must not be rendered as
  "no items": omitted items must be **named** as unavailable, as ADR-0074 requires for transcripts.
  A write must ask the same question with the same caller, not infer from the read.
- **Grant and display.** A lookup that decides whether the caller may act fails closed, as in the
  write and complete routes. The same host lookup used only for a label may degrade to a placeholder.
  Do not let a label lookup be the one that grants (a task shown is not a task completable), and do not
  let a grant lookup fall back to a cached "yes".
- **Service and user principals.** Any cross-service route that writes on the user's behalf must
  decide with the user's credential first. A route that writes as the service (system routes, a
  background job, a notice) is authorised by scope and `sub`, never by a user's reading of the host.
  Recognise a regression when a user route is served with a service token, or a system route starts
  asking the host "as whom?".
- **Existence and access.** A host's "missing" and "not yours" must produce the same answer from
  activities-api, or the id space becomes an oracle for other owners' records.
- **Store and rule.** Any new activity field, type or state that another host might need to see is
  a second copy of the host's data unless it is referenced by id and resolved live. Recognise it
  by asking, for each field: whose rule decides who may see it, and who answers when that owner is
  down?

## Options considered

### Option A — One activities-api; the host decides, asked as the caller on every request (chosen)
Described above.

**Pros:** one store, one set of activity rules and one UI shape for both tools; no permission
catalog to drift; the host's live authorization (`crm:access`, entity-scoped `project:manage`,
deactivation, a lost grant mid-session) applies to every activity read and write; OPS never needs
`crm:access`; the pattern is one already proven in meetings-api (ADR-0059), so a new host is a
registry entry plus one endpoint.
**Cons:** every activity route, and every CRM page that shows activities, adds one hop to a host
(two hops for CRM pages); a host outage refuses the activity reads and writes it governs; activities-api
is a JWKS resource server with no authorization of its own, so its correctness depends on each
host's resolve being right.

### Option B — Each tool keeps its own activity tables (rejected)
**Pros:** no cross-service hop; each tool owns its rules outright.
**Cons:** the two drift in rules, look and behaviour, which is what specs/028 exists to prevent;
My tasks across tools needs a cross-service join anyway, so the hop is paid regardless.

### Option C — crm-api owns activities; projects-api calls crm-api (rejected)
**Pros:** one fewer service; the CRM already has the tables.
**Cons:** makes the CRM a runtime dependency of delivery work and of every person without
`crm:access` (OPS, specs/025 D13); a project task would be governed by a CRM rule. The owner
rejected a CRM-owned store.

### Option D — An `activities` catalog in auth (`activity:read`, `activity:manage`) (rejected)
**Pros:** one catalog, one resolver, no host call on the path.
**Cons:** duplicates rules that already live in each host (`crm:access`, entity-scoped
`project:manage`) and drifts from them; a second answer to "may this person work on this company's
activity?" that auth cannot compute without the host's entity data (ADR-0007's catalog holds
conditions, not records).

### Option E — Hosts proxy activities-api (UI → crm-api → activities-api) (rejected)
**Pros:** the UI talks to one origin per tool; the host can add its own checks on the way through.
**Cons:** every host re-implements the same routes, filters and error shapes; a second rule set in
each proxy. Rejected by the owner (specs/028 constraints).

## Consequences

**Positive:**
- A pre-sales activity is governed by the CRM's rules and a project task by the project module's
  rules, with no copy of either in activities-api (AC-8.1).
- A host's rule change (a role, an entity scope, a deactivation) applies to activities on the next
  request, with no synchronisation.
- A third tool with activities is a registry entry and a resolve endpoint (ADR-0059's "no code
  change" property).
- My tasks works across tools without a join across databases.

**Negative / trade-offs:**
- Every activity read or write adds a host round trip; a CRM page makes two hops (the CRM's own
  and activities-api's call to the CRM's resolve).
- An outage of crm-api or projects-api refuses that host's activity reads and writes, and a My tasks
  list shows the host as unavailable.
- activities-api has no permission model to inspect in isolation: its authorization is the sum of
  its registry entries and the hosts' resolve answers. The matrix test (specs/028 AC-8.1) that drives
  every route against every host and caller is the only place that sum is checked.

**Risks:**
- **Resolve latency** on every request. Mitigation: one resolve per distinct host entity set per
  request. **Escalation trigger:** resolve p95 above 300 ms on CRM pages measured in the CRM e2e
  introduces a short cache keyed by `(sub, perm_epoch)`, and this ADR is amended then. The cache must
  not outlive a revocation, so it must be keyed on the epoch and never be a plain TTL on a grant.
- **A host that does not answer for days** shows as unavailable in My tasks and refuses activity
  writes for its entities. This is the intended fail-closed posture; it is not repaired by caching a
  grant.
- **A host's `resolve` answering too much** (a `may.write` true for a caller the host would refuse on
  the route itself) turns the host into a second source of truth that the activities-api route
  trusts. Each host's resolve must reuse the same guard functions as its own routes; the contract
  test for each host must cover both.
- **Contract versioning** is `activities host contract: 1`. A breaking change needs a v2 path,
  as for ADR-0059.
- **Second hub of records:** a future host that holds per-record access (a document shared with a
  list of people) does not fit this shape. Its trigger is in the revisit list below.

**Revisit when:**
- resolve p95 exceeds 300 ms on CRM pages (add the `(sub, perm_epoch)` cache, amend this ADR);
- a third host is added (confirm the registry shape and the resolve contract hold for it);
- a host whose access is per record rather than per entity is added (a per-record grant belongs to
  the host's data, and ADR-0036's pattern for shared records applies to that host, not to
  activities-api).

## Compliance notes

- **GDPR / nFADP impact: medium.** Activity bodies are free text and may name contacts; a new
  service boundary carries them. Contact names and bodies are read only after a live host decision,
  and the host answers no content of its own.
- **Data residency:** compliant. activities-api runs on Railway EU, in its own logical database on
  the suite's Postgres, and calls only EU suite services. No new processor.
- **Audit trail:** not required by this ADR. Activity changes are not recorded beyond ordinary request
  logs; a decision to add one belongs to specs/028's security review, not here.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
