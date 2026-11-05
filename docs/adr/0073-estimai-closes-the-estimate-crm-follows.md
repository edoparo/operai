# 0073 — The estimate is closed in EstimAI and the CRM follows: estimai-api pushes a notice to crm-api

**Date:** 2026-11-05
**Status:** Accepted (specs/018 AC-3.3, amended 2026-11-05)
**Deciders:** wellD
**Project:** Operai

---

## Context

specs/018 linked a CRM deal to an EstimAI estimate and let the technical contact (or an admin)
mark it `ready` with a button in the CRM. In use, salespeople saw the button and could mark ready
work they had not done, and the technician had to leave EstimAI to say they were finished. The
owner decided: the technician closes the estimate where they work, in EstimAI, and the CRM follows.
EstimAI had no "closed" state; an estimate was only a document (ADR-0004).

crm-api already calls estimai-api with the caller's own JWT (ADR-0036 lineage, no new trust). The
reverse direction did not exist: estimai-api had never called crm-api.

## Decision

We decided that:

- **EstimAI owns "closed".** `Estimate` gains `closedAt`/`closedByUserId`. Owner or `editor` close
  and reopen it with `POST /estimates/{id}/close|reopen`, `If-Match` required and the version bumped
  (ADR-0038). A closed estimate is read-only: `PUT` answers 409 `estimate_closed`; collaborators and
  deletion are unaffected.
- **estimai-api pushes, as itself.** After the change commits it sends crm-api
  `POST /system/estimate-notices` with `{estimateId, event: closed|reopened, version, at, byUserId}`
  and its scoped service JWT (`sub=system:estimai-api`, `aud=SERVICE_AUDIENCE`, new scope
  `estimate-notices.send`, ADR-0044/0049). The push is best effort: a failure never undoes the close.
- **crm-api applies, in order.** The route accepts only that principal with that scope (every other
  credential, including any user JWT, is the same 401). It locks the link row, ignores a notice whose
  version is not newer than the last applied (`deal_estimate.estimaiVersion`, reset when a new
  estimate is linked), and on `closed` sets `ready`, completes the request task, frees tasks that
  waited on it and notifies the requester and the owner; on `reopened` it reverses that and notifies
  the technical contact and the requester. An estimate it does not link is a quiet 204.
- **The CRM loses its own buttons.** `POST /deals/{id}/estimate/ready|reopen` and the "Mark ready" /
  "Reopen" buttons are removed. The admin's "Proceed without estimate" override stays.

## Failure shape

**Two copies of one state, where the second can be changed on its own.** When the same fact (here
"the estimate is finished") can be set in two places, the copies drift and each side's users trust
their own. A second shape is a state replicated by messages that can be lost, repeated or reordered.

Where else this shape can appear, including mirror-image positions:

- **Owner and follower.** The state is written only where the work happens (EstimAI); the follower
  (CRM) has no route that sets it, so it cannot disagree except by not having heard yet.
- **Order and repetition.** Every replicated state carries a monotonic version from the owner; the
  follower compares and writes under one lock, so a late or repeated notice is harmless.
- **Relink.** A follower that tracks versions must reset them when the thing it follows changes
  identity (a new estimate on the same deal), or the new one's first notices are ignored.
- **Loss.** A best-effort push can be lost (crm-api down at that moment). The follower then shows the
  previous state until the next notice; the admin override remains the way through.

## Options considered

### Option A — estimai-api pushes a content-free notice with a scoped service JWT (chosen)
**Pros:** the task closes and the requester is notified at once, whether or not anyone opens the
CRM; reuses the suite's service-credential model (one scope per capability); nothing from the
estimate's content crosses.
**Cons:** a new scope, a new variable on each side (`CRM_INTERNAL_URL`, `SERVICE_AUDIENCE` on
crm-api) and a call in a new direction; a lost notice is not retried.

### Option B — crm-api reads the estimate's state on view, as the caller
**Pros:** no new trust; no lost messages.
**Cons:** the task and the notification happen only when someone opens the deal, and only if that
person can open EstimAI. Rejected by the owner.

### Option C — Keep "Mark ready" in the CRM for the technician only
**Cons:** two places to say the same thing; the technician still leaves EstimAI. Rejected.

## Consequences

**Positive:**
- One place says an estimate is finished; the offer is generated from numbers that cannot change
  until someone reopens them.
- No CRM user can mark ready work they did not do.

**Negative / trade-offs:**
- A lost notice leaves the deal `requested` until the estimate is reopened and closed again, or an
  admin overrides the gate. There is no outbox.
- Three deploy-time settings: auth's `SERVICE_CLIENTS` entry for `estimai-api` gains
  `estimate-notices.send`, estimai-api gets `CRM_INTERNAL_URL`, crm-api gets `SERVICE_AUDIENCE`
  (env-doctor checks all three).

**Risks:**
- Deploy order: until all three are set, closing in EstimAI works but the CRM does not follow.
- Escalation trigger: a second follower of the estimate's state, a notice carrying content, or a
  need for guaranteed delivery revisits this ADR (outbox, as on the meetings branch's ADR-0059).

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
