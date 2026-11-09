# 0076 — The CRM pushes deal links to EstimAI: crm-api tells estimai-api which deal an estimate belongs to

**Date:** 2026-11-08
**Status:** Accepted (specs/024-estimate-list-oversight, US-3)
**Deciders:** wellD
**Project:** Operai

---

## Context

specs/024 puts a "Deal" badge on the EstimAI estimate list. The link between a deal and an estimate
is owned by crm-api (`deal_estimate`, specs/018); estimai-api knows nothing of it. The badge needs
the deal id only: EstimAI must never learn the deal's title, company or amount (ADR-0054 keeps money
behind `deal:financials`). ADR-0073 built the opposite direction (estimai-api pushes a content-free
notice to crm-api); this is its mirror.

## Decision

We decided that crm-api pushes the link to estimai-api, as itself, and estimai-api stores only the deal id:

- **Route.** estimai-api `POST /system/deal-link-notices`, service JWT only (`aud=SERVICE_AUDIENCE`,
  new scope `deal-link-notices.send`, `sub` must be `system:crm-api`; a user JWT is refused). Strict
  body `{estimateId, dealId, event: "linked"|"unlinked", at}`. It answers 204 for applied, ignored
  and unknown-estimate cases (the estimate may have been deleted in EstimAI); 400 for a malformed body.
- **Storage and ordering.** `Estimate` gains `crmDealId` and `crmLinkAt`. One conditional update
  (no read-then-write) applies a notice only if `at > crmLinkAt` or `crmLinkAt` is null; with an equal
  `at`, `unlinked` wins; a repeat is a no-op; `unlinked` clears `crmDealId` only when it equals the
  notice's `dealId`.
- **Order by the CRM instant, not a sequence.** Every `at` comes from crm-api's one clock on one
  replica, and a link has at most two events: the CRM never relinks an existing estimate, a new
  request creates a new estimate (specs/018 AC-3.1).
- **Senders.** crm-api sends `linked` after `POST /deals/{id}/estimate` commits and `unlinked` after
  `DELETE /deals/{id}/estimate` commits. crm-api has no deal deletion (every FK to `deal` is
  `Restrict`, no `DELETE /deals/{id}`); any future deal deletion MUST send `unlinked`.
- **Best effort.** The client (`crm-api/src/lib/estimaiNotices.ts`) never throws, retries once on a
  401 with a fresh token and logs ids only. `ESTIMAI_INTERNAL_URL` is optional; unset, it is a no-op.
  `crm-api/scripts/backfill-estimate-links.ts` (dry run by default, `--apply`, `at = requestedAt`) is
  both the initial load and the repair for a lost notice; it is safe to re-run.
- **auth.** `deal-link-notices.send` joins `KNOWN_SERVICE_SCOPES`. Production `SERVICE_CLIENTS` adds
  it to crm-api only AFTER the new auth is live, because an unknown scope makes auth refuse to start.

## Failure shape

**A fact about one record asserted by someone who does not own it, or replicated by messages that
can be lost, repeated or reordered.** If the user's own request carries "this estimate belongs to
that deal", any caller can label any record; if a copy is kept by messages, the copy ends up in a
state the owner no longer has (a stale link shown after an unlink, or an old notice undoing a new one).

Where else this shape can appear, including mirror-image positions:

- **Who may assert.** The link is stated only by its owner (crm-api) over its own service credential,
  never by the follower's users: the same rule in both directions (ADR-0073 estimai-api to CRM, this
  ADR CRM to estimai-api).
- **Link and unlink.** An unlink is a separate event and needs its own push; a design that carries
  the fact only on create can never clear it. Clearing is conditional on the id, so a late unlink of
  an old target never removes the current one.
- **Order and repetition.** The follower applies a notice only if newer, in one conditional write;
  ties resolve to the removal, so a doubtful state errs towards showing nothing.
- **Loss.** A lost notice leaves the badge wrong until a re-run of the backfill; nothing else repairs it.
- **Deletion.** A new path that removes the owner's record (a future deal deletion) is an unlink and
  must send it.
- **Content.** The follower receives an identifier, never the owner's content, so it cannot leak what
  its users may not see.

## Options considered

### Option A — crm-api pushes a content-free notice with a scoped service JWT (chosen)
**Pros:** only the link's owner can state it; every EstimAI user sees the badge whether or not they
use the CRM; reuses the service-credential model (one scope per capability, ADR-0044/0049) and the
mirror of ADR-0073; no deal content crosses.
**Cons:** a new scope, a new variable (`ESTIMAI_INTERNAL_URL`) and a one-off backfill; a lost notice
is not retried.

### Option B — crm-api passes `dealId` on estimate creation with the user's JWT
**Pros:** no new route or scope.
**Cons:** the field is user-asserted, so any EstimAI user could badge any estimate; an unlink would
still need a push. Rejected.

### Option C — estimai-ui asks crm-api for each row at list render
**Pros:** no stored copy, no lost messages.
**Cons:** only CRM users would see the badge (a technician without the CRM would not), and it adds
a cross-app call on every list render. Rejected.

### Option D — an outbox with retries (ADR-0059's shape)
**Pros:** guaranteed delivery.
**Cons:** a table and a retry loop for an informational badge. Rejected.

## Consequences

**Positive:**
- The EstimAI list shows which estimates belong to a deal without learning anything about the deal.
- Out-of-order and repeated notices are harmless; one conditional update, no lock.

**Negative / trade-offs:**
- A lost notice leaves the badge missing or stale until the backfill is re-run. There is no outbox.
- Ordering by timestamp is correct only while there is one crm-api clock and at most two events per link.

**Risks:**
- Deploy order: the new auth must be live before production `SERVICE_CLIENTS` grants crm-api the new
  scope, or auth refuses to start. Until `ESTIMAI_INTERNAL_URL` is set, crm-api sends nothing.
- A future deal deletion that forgets to send `unlinked` leaves a badge pointing at a missing deal.
- Escalation triggers: a second crm-api replica or a relink path (move to a per-link sequence), deal
  content in the notice, or a need for guaranteed delivery (outbox, ADR-0059) revisits this ADR.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
