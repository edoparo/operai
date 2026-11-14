# 20261108 — Read-only oversight of every estimate is one catalog permission, resolved live only on the oversight path: estimai-api asks `auth` once, and only when the record has no owner or collaborator relationship

**Date:** 2026-11-08
**Status:** Accepted (specs/20261108-estimate-list-oversight US-1; amends ADR 20260807-record-level-acl-resource-server-owned-access-primitive and ADR 20260807-denial-taxonomy-shared-records-403-vs-404)
**Deciders:** wellD
**Project:** Operai

---

## Context

ADR 20260807-record-level-acl-resource-server-owned-access-primitive made estimai-api's record access ownership or a collaborator row, resolved locally, and
deliberately kept it out of the ADR 20260716-refund-api-authorization-enforcing-resource-server authorization-enforcing model so an owner or collaborator
keeps working through an `auth` outage. It named its own gap: "an admin wanting to see every
estimate regardless of grants has no path", and said a future feature would layer an explicit
estimai-api-side check against a resolved permission on top of the ACL, never instead of it.

specs/20261108-estimate-list-oversight is that feature. A person with oversight must list every estimate in the suite and open
one they neither own nor collaborate on, read-only. ADR 20260807-denial-taxonomy-shared-records-403-vs-404's taxonomy answers a caller with no
relationship at all with 404; the spec asks that same caller, when holding oversight, to get the
estimate on a read and 403 on a write. EstimAI's declared `estimate:view` action carries
ownership/entity/department conditions that estimai-api has never evaluated.

## Decision

We decided that estimai-api enforces exactly ONE catalog permission, `estimate:read-all`, for
read-only oversight:

- **Permission.** A new action `estimate:read-all` in `auth`'s estimai catalog, `supportedConditions: []`,
  seeded to `admin` only (a seed contract test pins "held by `admin` and no other seeded role").
- **Resolved live, on the oversight path only.** estimai-api calls `auth GET /authz/resolve` with the
  caller's own JWT (ADR 20260716-refund-api-authorization-enforcing-resource-server, no new credential). Only a refusal is cached, by `(sub, perm_epoch)`
  with a 30 s backstop; a grant is asked for every time, so a revocation applies on the next request
  even on a token that still carries the old epoch (amended 2026-11-09 after the security review: a
  cached grant kept a revoked holder reading for up to 30 s).
  It is consulted only for `GET /estimates?whose=all` (403 `oversight_required` without the
  permission, 503 `authz_unavailable` if `auth` fails) and for `GET /estimates/{id}` when
  `resolveAccess` returned no relationship (200 with `access: "oversight"` with the permission,
  404 without). Own and shared estimates never call `auth`, so they survive an `auth` outage.
- **Writes stay refused.** For `PUT`, `DELETE`, close, reopen and the collaborators routes, an
  oversight-only caller gets 403 `oversight_read_only`. The guard runs only on the would-be-404
  stranger path; if `auth` fails there the answer is 404 (refused either way, no existence leak).
- **`oversight` is a wire value only.** Never stored, never a collaborator level, never accepted by
  the collaborators API.
- **An existing level always wins.** When `resolveAccess` returns owner/editor/viewer, that applies;
  oversight is only a fallback. `resolveAccess` itself is unchanged.

## Failure shape

**A privileged reader's path quietly becoming the path everyone depends on, or a read privilege
quietly becoming a write one.** Two mistakes live here. First, a dependency on a remote authority
added for a rare caller is wired into the common path, so ordinary users of their own data now fail
when that authority is down. Second, a capability granted for looking is honoured by code that was
written for "no relationship means not found", so a stranger-with-privilege is treated as an
owner, or a refusal for a privileged caller leaks (404 vs 403) what a stranger must not learn.

Where else the shape can appear, including mirror-image positions:

- **Read and write.** Oversight widens reads only; every write route must still refuse, and must do
  so with the answer that leaks least (the 403 for a holder, the 404 for everyone else, 404 again if
  the check itself cannot be made). A new write route added later is covered only if it goes through
  the same guard.
- **Fast path and escalated path.** The remote lookup happens only on the path the caller asked for or
  that would otherwise be a refusal. Recognise a regression by a new `auth` call on a route a plain
  owner or collaborator uses.
- **Fail-open and fail-closed.** Asking for the privileged view fails closed (503); falling back from
  an owned record to the privilege check is never reached when a relationship exists. A failure on
  the guard must never turn into a grant.
- **Stored and derived.** A privilege that exists only for the length of a request must not be
  written down as a role on the record (a collaborator level, a flag); the next reader would
  honour it after the grant is withdrawn.
- **Any other tool** that adds "see everything" for an auditor meets the same questions: where is it
  consulted, what does it do to writes, what does it do when its authority is down.

## Options considered

### Option A — One unconditioned catalog permission, resolved live on the oversight path only (chosen)
Described above.

**Pros:** Composes with the ACL as ADR 20260807-record-level-acl-resource-server-owned-access-primitive predicted, layered on top and not instead of it;
can be granted to an auditor without making them admin, and shows up in the Admin UI's role
composer (ADR 20260713-authz-hand-rolled-rbac-abac-epoch-claims); revocation is immediate through `perm_epoch`; the common path gains no
dependency on `auth`.
**Cons:** estimai-api now has one authorization-enforcing path, with its own resolver client and
cache beside its bespoke ACL; two more denial codes and a wire-only access value to maintain.

### Option B — Reuse the declared `estimate:view` (rejected)
**Pros:** no new catalog entry.
**Cons:** it declares ownership, entity and department conditions; estimai-api would have to
evaluate them, or silently treat a conditioned grant as global.

### Option C — A `requireAdmin` role-name check (rejected)
**Pros:** no catalog change; the middleware exists.
**Cons:** cannot be granted to an auditor without making them admin; bypasses the catalog the Admin
UI composes roles from (ADR 20260713-authz-hand-rolled-rbac-abac-epoch-claims).

### Option D — Admin as an implicit editor (rejected)
**Pros:** no new denial code.
**Cons:** the owner chose read-only oversight; it would hand every admin write access to every
estimate.

### Option E — Make every estimai-api route authorization-enforcing (rejected)
**Pros:** one uniform model, as in refund-api (ADR 20260716-refund-api-authorization-enforcing-resource-server).
**Cons:** own estimates would depend on `auth` availability, losing the no-hard-dependency property
ADR 20260807-record-level-acl-resource-server-owned-access-primitive recorded so nobody "fixes" it by analogy.

## Consequences

**Positive:**
- Oversight exists without touching the availability of anyone's own or shared estimates.
- The grant is a catalog row an admin can give to or take from a role, with immediate effect.

**Negative / trade-offs:**
- **Amends ADR 20260807-record-level-acl-resource-server-owned-access-primitive:** estimai-api is still not an authorization-enforcing resource server, with this
  single exception. A future contributor must keep it to one permission on one path.
- **Narrows ADR 20260807-denial-taxonomy-shared-records-403-vs-404:** "no relationship at all is 404" holds for a caller without the permission. A
  holder gets 200 on a read and 403 `oversight_read_only` on a write, which tells a holder that the
  estimate exists; they are entitled to know it.
- `GET /estimates?whose=all` is unpaginated; it is fine at today's size.

**Risks:**
- A new write route skips the `oversight_read_only` guard and answers 404 to a holder. Harmless to
  security, wrong for the UI; covered by a test per write route.
- **Escalation trigger:** a write capability for oversight, a conditioned (entity or department)
  oversight, or the `whose=all` list exceeding about 500 estimates revisits this ADR.

## Compliance notes

- GDPR/nLPD impact: medium. Estimates contain client and project data; holders of the permission can
  read all of it. Only `admin` holds it by seed, and it is revocable at once.
- Data residency: unaffected; no new data flow, the `auth` call is between EU services.
- Audit trail: not added. Oversight reads are not recorded beyond ordinary request logs.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
