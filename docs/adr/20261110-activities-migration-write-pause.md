# 20261110 — CRM activities move to activities-api by expand → copy under a short announced write pause → contract, and the copy is trusted only when it accounts for every record

**Date:** 2026-11-10  
**Status:** Accepted  
**Deciders:** Matteo Codogno (owner; accepted the announced pause at the specs/20261110-activities spec gate: "a short announced pause is accepted")  
**Project:** Operai

---

## Context

specs/20261110-activities moves CRM activities, their participants, their "blocked by" links and the meeting host state out of `crm-api`'s tables into the new `activities-api`, which then serves both the CRM and Projects. The data is small: a handful of activity records and very few users, so a pause in writes is cheaper than any code that keeps two copies in step. ADR 20261013-all-notify-callers-scoped-credentials-shared-token-retired showed that a push to `main` redeploys every Railway service in no guaranteed order, so the deploy sequence itself is part of the design, not an afterthought.

## Decision

We will move the activities in three phases, with a write pause between expand and contract, and we will lift the pause only when the copy has accounted for every record:

1. **Expand.** Deploy `auth` first (new scope `activities.write` and the client `activities-api`; an unknown scope stops `auth`). Then deploy `activities-api` with `ACTIVITIES_MAINTENANCE=true`, so every non-health route answers 503 `maintenance`, and deploy projects-api's host endpoint.
2. **Switch.** Deploy `crm-api` (new code; the old CRM activity tables are still present and are read only by the copy script), then `shell`, `crm-ui` and `projects-ui`. The CRM shows "activities unavailable" (AC-1.5, AC-2.5). The pause also hides the Railway/Vercel order-of-deploy gap, because no write can reach either side while the flag is set.
3. **Copy.** Run `activities-api/scripts/import-crm-activities.ts [--apply]` with `CRM_DATABASE_URL` and `DATABASE_URL` set in the environment only (amended 2026-11-11, security review L4: a URL on the command line reaches the process list and shell history). It is dry-run by default. It preserves ids and timestamps (raw insert, so `updatedAt` is not reset) and sets `hostApp=crm`, `hostType=company`, `hostId=companyId`. It writes with `createMany` and `skipDuplicates` keyed by id. It compares every pre-existing target row field by field and reports differences. It prints found / inserted / already present / mismatched for each table: activity, activity_participant, task_blocker, and meeting_host_state (copied to meeting_mirror_state). Because ids are kept, `deal_estimate.taskId` and the meeting links keep working.
4. **Unpause.** Set `ACTIVITIES_MAINTENANCE=false` only when the report shows 0 mismatches and found = present for every table.
5. **Contract, in a later push.** A `crm-api` Prisma migration drops `task_blocker`, `activity_participant`, `activity`, `meeting_host_state` and the `ActivityType` enum. It is never in the same push as the switch.

The copy is re-runnable (AC-2.2): a second run inserts nothing and changes nothing.

## Failure shape

**A record is declared moved by the act of running a copy rather than by a count that proves every record arrived, and the source is then removed on the strength of that declaration.** Nothing in the copy itself shows that a row was skipped, mangled or left behind, so the only witness is the one the copy is not allowed to be.

The same shape appears in its mirror-image positions:

- **Copy and delete.** The moment the source is dropped is the moment the copy becomes the only record. Any removal (a contract migration, a truncate, a "cleanup" in the switch push) must wait for an accounted-for report, not for the copy's exit code.
- **Run and re-run.** A second run of a move must be a no-op. A re-run that updates an existing target row silently overwrites a value that may have changed since the first run; pre-existing rows are compared, not trusted.
- **Writes on either side during the move.** Writes that land on the source after the copy read it, or on the target before the copy has written the old rows, are the divergence no count will show. Recognise it by asking which side accepts writes right now, and whether any caller can reach the other side.
- **Deploy order.** When two services are switched by separate pushes or by an unordered redeploy, one side can run new code against data the other has not moved yet (the same gap as ADR 20261013-all-notify-callers-scoped-credentials-shared-token-retired's multi-push rollout). A flag that only one side honours is that gap in another form.
- **Undo.** Before the contract step, the source is still the intact fallback; after it, the move is one-way. A design whose undo path is not written down is a design where the first failed copy becomes a data loss.

Recognise it anywhere by: a "moved" or "migrated" claim with no found-versus-present count; a drop or delete in the same deploy as the switch; a pause lifted without the report in hand; a write path that a maintenance flag does not cover.

## Options considered

### Option A — Expand → copy under a short announced write pause → contract, copy trusted only on a full count (chosen)

**Pros:**
- One copy, one source of truth at every instant: nothing is written on either side during the copy, so there is nothing to reconcile
- The report is the witness the copy cannot be to itself: found, inserted, present and mismatched per table, with unlisted failures refused
- The source stays intact until a separate, later push removes it; the undo is "keep the CRM tables"
- Dry-run default and re-runnable, the same posture as the inventory legacy import (specs/20261006-hardware-inventory) and the refund and CRM backfills

**Cons:**
- CRM users cannot record or change activities for the length of the pause
- The operator needs credentials for the CRM database for the window of the copy
- Two deploy pushes plus a later contract push, each a manual, ordered step

### Option B — Dual write during a transition (rejected)

**Pros:**
- No pause; both services keep working while the data moves

**Cons:**
- Code that exists for minutes, for a handful of records and users, with its own consistency bugs (which write wins, what a half-failed double write leaves)
- Every activity write path needs two targets and a reconciliation, then the code is deleted: more risk than the move it protects

### Option C — Change data capture or logical replication (rejected)

**Pros:**
- Continuous copy with no pause

**Cons:**
- Infrastructure (replication slots, a connector, its monitoring) for a one-off move of a few records

### Option D — Drop the CRM tables in the switch push (rejected)

**Pros:**
- One fewer push; no contract step to remember

**Cons:**
- Nothing leaves the CRM until the copy is accounted for (AC-2.3); dropping in the switch removes the fallback before anyone has checked the copy

## Consequences

**Positive:**
- Every moved record is either counted in the report or the move is refused; a mismatch stops the unpause rather than being fixed silently
- The pause makes the deploy order safe by construction: no caller can write to a side that is not yet ready
- The copy script's pattern (dry run, id-keyed, field-by-field comparison, per-table report) is reusable for the next one-off move in the suite

**Negative / trade-offs:**
- A short, announced loss of write access for CRM activities
- The contract push is deliberately delayed, so the old tables stay in the CRM database until it lands

**Risks:**
- **Writes to the moved tables during the copy.** Meeting host notices (ADR 20261104-meeting-host-contract-resolve-and-notices) write the host state that the copy reads (`meeting_host_state`). Before step 3, confirm that crm-api holds or refuses those writes while the copy runs; a write after the copy's read is missed and no count will show it. This is an open point to close in the switch step, not one this ADR resolves.
- **Notices lost during the pause.** A linked or changed host notice that fails during the pause is retried by hand (ADR 20261104-meeting-host-contract-resolve-and-notices); the operator must check for such notices after unpausing.
- **A mismatch found.** The unpause does not happen; the decision goes back to the owner. The script must not repair a mismatched row itself.
- **Pause overrun.** `ACTIVITIES_MAINTENANCE` is a manual variable; a failed copy that is not re-run leaves the pause in place. The announced window must have an owner who can end it.
- **Revisit trigger.** Any future move of a table with many records or users who cannot accept a pause: then dual write or a backfill with a catch-up is the path, and this ADR does not apply.

## Compliance notes

- GDPR / data-protection impact: medium — activity text and participant details are personal data about CRM contacts and users. The copy stays inside the suite's own databases: it reads the CRM database and writes the activities database directly, and must not write a dump, file or third-party copy. The report prints counts, ids and reasons only, never activity text or addresses.
- Data residency: compliant with the required jurisdiction, provided both databases are in an EU region and the operator's connection to them is the one the deploy uses.
- Audit trail: not required by this ADR. The printed report of the copy run (per-table counts, mismatches) is kept with the release notes as the record that the move was accounted for.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
