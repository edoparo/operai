# 0082 — Caller-chosen ids replace cross-service transactions: every write that used to share a crm-api transaction becomes an idempotent call to activities-api

**Date:** 2026-11-10  
**Status:** Accepted (specs/028 plan gate)  
**Amended:** 2026-11-11 — security review round 1 (§ Amendment 2026-11-11 and known residuals); 2026-11-11 — implementation drift found by the eval (§ Amendment 2026-11-11 — implementation drift); 2026-11-11 — no database key guards a future company or deal deletion (§ Amendment 2026-11-11 — implementation drift, "Deletion guard")  
**Deciders:** Matteo Codogno (owner), specs/028 plan gate  
**Project:** Operai  
**Relates to:** [ADR-0081](0081-activities-service-access-delegated-to-host.md), [ADR-0073](0073-estimai-closes-the-estimate-crm-follows.md), [ADR-0076](0076-crm-pushes-deal-links-to-estimai.md), [ADR-0059](0059-meeting-host-contract-resolve-and-notices.md), [ADR-0044](0044-scoped-service-jwt-fourth-notify-caller.md), [ADR-0049](0049-all-notify-callers-scoped-credentials-shared-token-retired.md)

---

## Context

Until specs/028, crm-api wrote `activity`, `activity_participant`, `task_blocker` and
`meeting_host_state` in the same PostgreSQL transaction as the change that caused them. Activities
move to activities-api (ADR-0081), so four flows that used to be one commit become a call to another
service, and a fifth loses its database guard:

1. **Estimate request** creates a task in the same transaction that stores `deal_estimate.taskId`.
2. **Estimate override note** writes a `note` activity beside the admin's override.
3. **Estimate unlink** deletes the open task.
4. **EstimAI close/reopen notice** completes or reopens that task under the `deal_estimate` row lock
   and its `estimaiVersion` guard (ADR-0073).
5. **Meeting-host notices** mirror a `meeting` activity, guarded by `meeting_host_state.lastSeq`
   (ADR-0059).
6. **Contact erase** removes references to the contact. Today this is implicit, through a foreign key
   with `ON DELETE SET NULL` on `activity.contactId`.

A distributed transaction is not available across Bun services sharing one Postgres server, and a
GDPR erasure must be provable, so "eventually" is not acceptable for it. The CRM has no outbox and
no queue.

## Decision

We decided that **the caller chooses the identity of every cross-service write, and every such write
is idempotent by that identity**. crm-api calls activities-api `/system/v1/*` with its service JWT
(`sub="system:crm-api"`, `aud=SERVICE_AUDIENCE`, new scope `activities.write`, ADR-0044/0049). Per flow:

- **Create (1, 2).** crm-api generates the activity id (cuid; implemented as a UUID v4, see
  § Amendment 2026-11-11 — implementation drift) before any write. It calls
  `PUT /system/v1/activities/{id}`, which creates the row if absent and never overwrites (201 created,
  200 already present), and only then commits its own row. If the PUT fails, the request fails with
  503 and the EstimAI estimate is deleted as today. If the commit fails after a successful PUT, crm-api
  calls `DELETE /system/v1/activities/{id}` as compensation and logs the failure if the compensation
  also fails.
- **Delete (3).** `DELETE /system/v1/activities/{id}?onlyIfOpen=true` runs **before** the CRM
  transaction. A failure answers 503 and changes nothing. Absence is 204, so repetition is harmless.
- **Completion (4).** Inside the existing lock, crm-api calls
  `POST /system/v1/activities/{id}/completion {completed, at, byUserId, seq}`, where `seq` is the
  estimate's `estimaiVersion`. activities-api stores `completionSeq` per activity and applies a call
  only if `seq` is greater than the stored value. Duplicates and reordered notices are no-ops. A
  completion that frees dependent tasks triggers their notices from activities-api.
- **Meeting mirror (5).** The `seq <= lastSeq` guard **moves with the data** into activities-api
  (`meeting_mirror_state`), so the guard and the activity write commit in one transaction on the
  side that owns both. crm-api keeps the validation it does today (notice and deal), forwards
  `{noticeId, seq, event, meeting, deal{id, companyId}}`, and relays activities-api's `{applied}`. If
  activities-api is unavailable, crm-api answers 503 and meetings-api's outbox retries (ADR-0059).
- **Erase (6).** crm-api calls `POST /system/v1/contacts/{contactId}/erase` **before** deleting the
  contact. The call sets `contactId = NULL` on every activity that references the contact and is
  idempotent. If it fails, crm-api answers 503 `activities_unavailable` and the contact is unchanged.

**Rule for future deletions.** Any new path that deletes or moves a company or a deal in crm-api
must call activities-api first, with the same kind of call as above, fail closed, and delete only
after the call succeeds, as the contact erase does. Today the CRM deletes neither. No database key
backs this rule: activities live in activities-api's own database, and `activity.hostId` and
`activity.dealId` are opaque text with no foreign key to crm-api (see § Amendment 2026-11-11 —
implementation drift, "Deletion guard"). A deletion that skips the call orphans activities silently.
A future deletion or move must therefore add an explicit erase or reassign call ordered before the
crm-api delete, and a test in crm-api that stubs activities-api and fails if the call is skipped or
ordered after the delete, or if a failed call leaves the record deleted.

**Rejected:**
- **A crm-api outbox for every flow.** It adds a queue to a service with none. It also cannot make an
  erasure hold: the erase would be eventual.
- **Best-effort erase.** A GDPR erasure that may silently not happen cannot be shown to have
  happened. The erase is ordered before the delete and fails closed instead.
- **Keeping `meeting_host_state` in crm-api.** The guard would commit in a different place from the
  activity it protects. A forward that fails after the guard advanced would then lose the change for
  good.
- **A distributed transaction or two-phase commit.** Neither Bun service nor the shared Postgres
  server coordinates across services, and the participants would be a service and a database that
  this suite does not run as one system.

## Failure shape

**A single step that used to be atomic is split across two places, so that a crash, a timeout or a
repeat leaves one side done and the other not, and the side that is not done is the one a person
relies on.** This is a failure of the boundary, not of either service: the first write succeeds and
the second is lost, or the second succeeds on a retry that the first did not expect, or the
protection of a record (a guard, a lock, a deletion promise) commits somewhere other than the record
it protects.

Where else this shape can appear, including mirror-image positions:

- **Create and delete.** A create whose commit can fail after the call succeeded needs a compensating
  delete, and that delete can fail too. Look for any "call, then commit" or "commit, then call" pair
  that crosses a service, and ask what the orphan is and who finds it.
- **Delete before and delete after.** A deletion that must be visible to another service goes first
  when the other service's refusal must stop it (erase), and after when a success must not be undone
  by a later failure. Pick the order from which failure is acceptable, and write it down.
- **Guard and write.** An ordering or dedup guard (a sequence, a version, a last-seen id) must commit
  in the same transaction as the write it protects. A guard kept in a different service, or in a
  different table that commits separately, advances on a failed forward and drops the change.
- **Inbound and outbound.** The receiver's guard makes repetition and reordering harmless. The
  sender's retry makes loss survivable. Each side needs both: a sender without an idempotent receiver
  duplicates effects, a receiver without a sender that can retry loses them. The same rule holds
  whether the caller is a user, a service or an outbox.
- **Best effort and fail closed.** A notice may be best effort only if an admin can repair its
  absence through a separate path. A promise that must hold (an erasure, a removal of access) fails
  closed: the caller sees 503 and the first step is not taken.
- **Lock held across a call.** A row lock taken in a database transaction and held across a network
  call to another service makes every other writer of that row wait for the other service. Look for
  it wherever a lock and a call appear in the same block.

Recognise the shape in any future flow that replaces a database transaction with a cross-service
call: name the identity the caller chooses, the compensation, the guard and where it commits, the
order of the destructive step, and what a repeated or lost message leaves behind.

## Options considered

### Option A — caller-chosen id, idempotent PUT, compensation, guard moved with the data (chosen)
**Pros:** every call can be repeated; the id is known before the first write, so compensation is
possible; each guard commits with the write it protects; erasure is ordered and provable; no new
queue in crm-api.
**Cons:** more calls on the request path (a 503 for every flow when activities-api is down); a
compensating delete that can fail leaves an orphan the logs must reveal; the estimate notice holds a
database lock across a network call.

### Option B — crm-api outbox for every flow
**Pros:** delivery is guaranteed; the request path does not depend on activities-api being up.
**Cons:** a queue, a retry loop and a dead-letter state added to a service that has none; erasure
becomes eventual, which fails the GDPR requirement. Rejected.

### Option C — two-phase commit or a distributed transaction
**Pros:** atomic on paper.
**Cons:** the suite has no coordinator and no shared transaction manager across Bun services; this
would be a larger system than the four flows it serves. Rejected.

### Option D — keep the guard and the mirror in crm-api
**Pros:** no change to the meeting-host path; the guard stays beside the CRM rules.
**Cons:** the guard commits separately from the activity it protects, so a failed forward advances
it and the change is lost. Rejected.

### Option E — best-effort erase
**Pros:** the request never waits on another service.
**Cons:** an erasure that silently did not happen cannot be proved. Rejected.

## Consequences

**Positive:**
- No flow writes activity state in a place its guard cannot see; every guard commits with its write.
- Repeated, lost and reordered calls are harmless for every flow except a deliberate override by an
  admin.
- An erasure either completes before the contact is deleted or does not happen at all, and the
  response reports how many activities were unlinked.

**Negative / trade-offs:**
- Estimate requests, notes, unlinks and erasures answer 503 whenever activities-api is down.
- A failed compensating delete leaves an orphan activity with no link from a deal estimate. It is
  logged, not repaired; the ids are known from the log.
- The estimate close/reopen notice holds the `deal_estimate` row lock across one network call. A slow
  activities-api stalls other notices for that same deal until the call returns or times out.

**Risks:**
- A deploy in the wrong order (crm-api calling `/system/v1` before activities-api grants the scope
  or is live) turns the flows into 503s. The migration order is fixed in specs/028 and ADR-0083.
- **Known pre-existing drift, kept as-is (spec: no CRM rule changes):** a contact moved to another
  company leaves its activities under the old company. A mirrored meeting activity edited by hand onto
  another deal is missed by a later `unlinked`. Neither is fixed by this decision.
- Escalation triggers: a second caller of `/system/v1` activities routes; a flow that cannot choose its
  id before the write (an id assigned by the database); an erasure that spans more than one service.
  Any of these revisits this ADR, because the compensation and ordering rules above assume a single
  caller that owns the id.

## Compliance notes

- GDPR / data-protection impact: **medium.** Contact names and free-text activity bodies cross the
  new CRM-to-activities-api boundary, and erasure becomes cross-service. The ordering (erase the
  references, then delete the contact) and the fail-closed answer are what make the erasure provable.
- Data residency: compliant. activities-api runs on Railway EU with its own logical database; no new
  processor is introduced.
- Audit trail: not required by this ADR. The erase response reports the number of activities
  unlinked.

## Amendment 2026-11-11 — security review round 1: the erasure guard, and known residuals

The decision above is unchanged. The OWASP review of specs/028 found that flow 6 had kept the
**order** of the erasure but not its **atomicity**, and that the compensations of flows 1–3 leave
residuals this ADR named only in part. Both are recorded here; the plan
(`specs/028-activities/plan.md`, § Amendments 2026-11-11) carries the contracts and tests.

### Erase (6): the guard moves with the data

In crm-api the erasure was atomic because a foreign key did it: `ON DELETE SET NULL` on
`activity.contactId` meant no transaction could commit a reference to a contact at the instant it
was deleted. Moving the data removed the key, and with it that guarantee. activities-api checks a
`contactId` against the host's `resolve` **before** its own transaction, so a create or PATCH whose
check passed just before an erase could commit **after** the sweep and re-link a contact crm-api
then deletes — an erasure reported as done that left a reference behind.

This is the "guard and write" line of the failure shape applied to erasure: the protection (no new
reference to an erased contact) must commit in the same place as the data it protects. It now
does:

- activities-api keeps an `erased_contact(contactId PK)` **tombstone**. It holds only the CRM's
  opaque id — no name, address or timestamp — which resolves to nothing once the contact is
  deleted, so the guard keeps no personal data. Rows are never removed.
- The erase runs in **one** activities-api transaction: `pg_advisory_xact_lock(hashtextextended(
  'contact:' || contactId, 0))` → insert the tombstone (if absent) → null every `contactId` equal
  to it.
- Every write that **sets** a `contactId` (create, PATCH, the one-off import) takes the same lock
  in its transaction and reads the tombstone **after** the lock is held; if present it refuses
  (422 `contact_not_in_company` on the user routes; reported with a non-zero exit in the script).
  The lock serializes the two, so either the write commits first and the sweep nulls it, or the
  erase commits first and the write is refused.
- crm-api's side is unchanged: sweep first, then delete; a sweep that fails is 503
  `activities_unavailable` and nothing is deleted.

Rejected for this fix: re-checking with the host inside the transaction (a network call under a
lock on every activity write, and the host's "no" is still not committed with our write);
sweeping again after crm-api's delete (a second call that can fail too, and the window stays open
between the delete and the second sweep); a foreign data wrapper or cross-database key (the
services' databases are deliberately separate, ADR-0081).

### Known residuals (accepted, 2026-11-11)

Each is a case where one side of a compensated pair committed and the other did not. None is
repaired automatically today; each is either logged or visible to the person who acted.

1. **Erase half-done.** The sweep commits and crm-api's contact delete then fails. The contact
   still exists in the CRM, its activity links are gone, and new links to it are refused until the
   erase is retried — which is idempotent on both sides (`{unlinked: 0}`, then the delete). The
   person sees the failed erase. Accepted: an erasure the user asked for that half-ran is closer to
   what they asked than a reference that outlives it. This narrows the Consequences line "an
   erasure either completes before the contact is deleted or does not happen at all": the
   activities side may complete without the CRM side; the reverse cannot happen.
2. **Override note without its override (flow 2).** The note's PUT lands, the override transaction
   fails, and the compensating DELETE fails too. The deal's timeline shows an override that was
   never recorded. Logged only.
3. **Late PUT after its compensation (flows 1, 2).** A PUT that timed out on crm-api's side lands
   in activities-api **after** crm-api's compensating DELETE (absent → 204) has run. The task or
   note remains with no `deal_estimate` link: an orphan. The existing "failed compensating delete
   leaves an orphan" line under Consequences covers only the case where the DELETE itself fails;
   this one leaves no failure in any log.
4. **Unlink without its transaction (flow 3).** The open task is deleted before the transaction,
   and the transaction then fails. The link stays, pointing at a task that no longer exists. It
   self-heals: a later close/reopen notice on the missing task answers `applied: false` and the
   CRM's own state still moves, and a retried unlink finds the task absent (204) and completes.

**Mitigation direction, not implemented now:** record-first ordering for the override — commit the
override, then PUT the note under the id chosen before the commit, retrying under the same id (the
note can then be late, never false), which removes residual 2; and an **idempotent reconciliation
script** in crm-api, dry-run by default and re-runnable (the shape of
`crm-api/scripts/backfill-estimate-links.ts`), that lists crm-hosted estimate tasks and notes with
no matching `deal_estimate` and `deal_estimate.taskId` values with no task, which finds residuals
2–4 (residual 3 is otherwise invisible: no log line records it). Building either is a follow-up
with its own plan amendment.

## Amendment 2026-11-11 — implementation drift: the id format, the completion's labels, the lock's bound

The decision is unchanged. The specs/028 eval (`specs/028-activities/eval-report.md`, spec
fidelity, findings 1a–1c) found three ways the implementation differs from what this ADR and the
plan said. Two are recorded as they are built. The third is a defect fixed in the code, and its
bound is written down here. The contracts are in `specs/028-activities/plan.md` (§ Amendments,
2026-11-11, eval drift).

### Ids: any opaque id, and crm-api picks a UUID

The rule this ADR rests on, that **the caller chooses the identity**, never depended on the
format. It needs an id the caller holds before its first write, and one no other writer can pick.
What was built:

- **activities-api checks no format.** Every route accepts any id of 1–64 characters without a NUL.
  Rows it creates itself (user creates, the meeting mirror) get Prisma's cuid. Rows imported from
  crm-api keep their cuids unchanged.
- **crm-api's caller-chosen ids are UUID v4** (`crypto.randomUUID()`), not cuids. This covers the
  estimate task (flow 1) and the override note (flow 2). The choice was made in implementation and
  stands. In crm-api a cuid exists only as Prisma's column default, applied inside a `create`, so
  producing one before the write would need a new dependency. `crypto.randomUUID()` is built into
  Bun.
- A UUID (36 characters) can never equal a cuid (25 characters), so a caller-chosen id cannot
  collide with a row activities-api created. If one ever did, create-if-absent answers 200
  `created: false` and overwrites nothing.

Escalation trigger, added to the ones above: a receiver that starts **interpreting** ids (parsing,
ordering by them, deriving a time from them). Every caller's format would then become part of the
contract.

### Completion (4) carries the labels of the notice it triggers

`POST /system/v1/activities/{id}/completion` takes an optional
`context {companyName, dealId | null, dealTitle | null}`. The object is strict. Each label is 1–200
characters with no NUL, and `dealId` and `dealTitle` are both set or both null. Any 422 applies
nothing. The field exists because a completion on this route arrives with no user JWT, so
activities-api cannot ask the host as the caller (ADR-0081) and holds no CRM data to name the
company or deal in the "You can go ahead" notice that the CRM's copy requires (specs/028 US-1).

The field follows a rule that applies beyond this route: **a caller-asserted label may travel with
an idempotent call only as display text. The receiver bases every decision on its own rows.** The
`seq` guard, the row lookup, the choice of recipient and the link all ignore `context`. The deal
title is used only when the freed task's **stored** `dealId` equals `context.dealId`. Otherwise the
notice shows the company, or "—" when there is no context. A wrong `context` can therefore
mislabel one notice and do nothing else. This is acceptable because its only sender
(`system:crm-api`, `activities.write`) can already write any CRM activity. If a future field on a
system call were read for a decision, it would no longer be a label and would revisit this ADR.

Known narrowing, reported as a spec finding: crm-api named **each** freed task's own deal. The
context names only the completed task's deal, so a freed task on another deal of the same company
is labelled with the company.

### The lock held across a call now has a number

Consequences state that the estimate notice holds the `deal_estimate` row lock across one network
call. Until now its length was a client default of 4 s per attempt. With one retry after a 401 and
a token exchange before each attempt, that could exceed 8 s. The plan promised 2 s. The bound is
now:

- **2 s per attempt** for the completion call made under the lock.
- **At most one retry,** after a 401, with the cached service token dropped and minted again.
- **A 4 s budget for the whole call,** including the token exchange and the retry. No attempt
  starts once the budget is spent, and an attempt gets only what is left of it.

So a call holds the lock for at most about 4 s, plus the transaction's own statements. Calls made
outside a lock keep the client default.

When the call fails, crm-api answers 503 and rolls back. A completion is never compensated: its
`seq` makes it safe to repeat, and the admin override (ADR-0073) is the repair. This adds a fifth
residual to the list above:

5. **Completion applied, CRM rolled back.** The call times out in crm-api after activities-api has
   already applied it. The task is done, while `deal_estimate` keeps its old version and state. A
   redelivery of the same version answers `applied: false`, and the CRM state then moves (crm-api
   does not hold its state back on `applied: false`). Without a redelivery, which the best-effort
   sender does not make, the admin override repairs it. The shorter bound makes this residual
   somewhat more likely than the 4 s timeout did. That is the accepted price of holding the lock
   for less time.

### Deletion guard: no database key exists (2026-11-11)

Found by the architect review of specs/028. Consequences and § Rule for future deletions once
implied that the foreign keys from activities to companies and deals were `ON DELETE RESTRICT`, so a
future company or deal deletion would fail loudly. That is not what was built. `activities-api`
keeps `activity.hostId` and `activity.dealId` as opaque text, with no foreign key, because
companies and deals live in crm-api's database (ADR-0081). The only keys in that database are the
cascades of `activity_participant` and `task_blocker`, and `erased_contact` is a tombstone. The
guard for a future deletion is therefore the call to activities-api, not a database constraint.
The rule itself is unchanged. Nothing is exposed today, because the CRM deletes neither companies
nor deals (specs/028 Non-goals).

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
