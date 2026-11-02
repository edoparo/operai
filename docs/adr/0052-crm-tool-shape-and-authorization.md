# 0052 — The CRM is a sixth tool (`crm-api` + `crm-ui`) whose reads are open to every `crm:access` holder and whose deal writes are entity-scoped, with a 403 (not 404) out of scope

**Date:** 2026-11-01
**Status:** Accepted (taken autonomously at the product owner's request — review before merge, see specs/017-crm/decisions.md)
**Deciders:** wellD
**Project:** Operai

---

## Context

wellD wants a CRM inside Operai (specs/017-crm): companies, their people (contacts), sales
opportunities (deals) moving through a pipeline, and the activity log of the relationship,
including follow-up tasks. The suite has a settled shape for a tool that owns data — a
federated remote mounted by the shell (ADR-0006), a Bun + Hono + Prisma resource server with
its own logical database (ADR-0003/0005), app access gated by an `(appId, "access")` grant
(ADR-0007) — and two precedents for authorization inside a tool: refund-api and inventory-api,
both authorization-enforcing (ADR-0014) and entity-scoped (ADR-0015), both answering 404 for a
record outside the caller's scope because the record is not readable to them.

The CRM differs on one point that decides the rest: a client relationship is team knowledge.
A consultant of wellD IT working for a client that wellD CH invoices must see that client, its
people and its open opportunities. What must be controlled is who commits the company to
figures (deals), and who may destroy personal data.

## Decision

1. **Shape.** A new service pair, `crm-api` (port 8084, logical DB `crm`, Railway EU) and
   `crm-ui` (remote `crm`, port 5179, exposes `./App` and `./version`), mounted by the shell at
   the gated `/crm/$` route. No object storage and no notify-api calls in v1.
2. **Catalog `crm`** with three permissions:
   - `crm:access` — the tool, and everything a team member does: read every record, create and
     edit companies and contacts, log activities and tasks;
   - `deal:manage` — create, edit and move deals, supporting the `entity` condition (ADR-0015);
   - `contact:erase` — the irreversible deletion of a contact (GDPR art. 17), unconditioned.
   Seeded: `admin` all three unconditioned; a new system role `sales` with `crm:access` and
   entity-conditioned `deal:manage`; `employee` nothing.
3. **crm-api is authorization-enforcing** (ADR-0014): live `/authz/resolve`, `(sub, perm_epoch)`
   cache, fail closed with 503. Every route requires `crm:access`.
4. **Denials.** No capability → 403. A `deal:manage` holder writing a deal whose entity — current
   or requested — is outside their scope → **403 `out_of_scope`**. Unknown id → 404. This is
   ADR-0037's "a relationship exists but the level is insufficient" branch: the deal is readable
   by the same caller, so a 404 would contradict the read they just made.
5. **Shared records are written with optimistic concurrency** (ADR-0038's posture): integer
   `version`, `ETag`, required `If-Match`, 428 / 409 `version_conflict`, on companies, contacts
   and deals. Activities are exempt: only their author edits them.
6. **People are ids**, names resolved live from `/authz/users/identities` and failing soft
   (ADR-0039); assigning an owner or assignee requires the id to be an active user and fails
   closed (503) when `auth` cannot answer.

## Alternatives considered

- **Entity-scoped reads, 404 out of scope (the refund/inventory model).** Rejected: it would hide
  a shared client from half the people who work for it, the opposite of why a CRM exists.
- **One permission for everything.** Rejected: deal figures commit the company and are managed
  per legal entity like every other money surface in the suite.
- **Per-record ACLs (ADR-0036).** Rejected: that primitive is for a document an owner shares; a
  team CRM is shared by default.
- **CRM tables inside an existing service (estimai-api).** Rejected: a different domain with its
  own data-protection profile (third-party personal data) and deploy cadence.

## Consequences

- A reader of the CRM sees every deal value. If wellD later needs private deals, that is a new
  read condition and revisits point 4 (a 404 becomes correct for unreadable deals).
- Contacts are third-party personal data held by Operai for the first time; erasure exists from
  day one, and nothing logs bodies or query strings (search terms are names).
- `crm-api` has a hard runtime dependency on `auth` for every request (ADR-0014's accepted
  trade-off), and for every owner/assignee write.
- Notifications (task assigned to someone else) are the first follow-up; they need a
  `SERVICE_CLIENTS` entry and a scoped credential (ADR-0049), not done unattended.
