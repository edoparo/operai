# 20261118 — Something the system must do on a schedule runs in the service that owns the record, claimed before it acts: assignment reminders

**Date:** 2026-11-18  
**Status:** Accepted  
**Deciders:** Matteo Codogno (owner): "Se un employee non conferma la ricezione del materiale entro 24 ore dobbiamo mandare una mail ogni settimana fintanto che non conferma o rifiuta. Da gui deve essere possibile forzare l'invio di un reminder." Built directly on `main`.  
**Project:** Operai  
**Relates to:** ADR 20260714-invitation-lifecycle-derived-expiry-state (no cron for derived state), ADR 20261104-durable-job-runner-work-queued-state-derived (meetings' runner), ADR 20261101-notify-api-resolves-email-notice-address-from-auth (email notices), ADR 20261013-all-notify-callers-scoped-credentials-shared-token-retired (one scope per capability).

---

## Context

An employee who is offered a device must confirm or decline it (specs/20261006-hardware-inventory US-2). Some never answer, and the register then shows the device in stock while it sits on their desk. The owner wants:

- a reminder by email when an offer is still pending 24 hours later, then one every week until it is answered;
- a way for an inventory manager to send one now.

The suite forbids a cron or a sweep for **derived state** (ADR 20260714-invitation-lifecycle-derived-expiry-state): expiry and similar facts are computed on read. A reminder is not a state. It is an **action toward a person** that must happen even when nobody reads anything, so it needs something that runs on time. inventory-api has no scheduler, Railway has no cron declared for it, and the service runs as one replica (`.railway/railway.ts`).

## Decision

1. **The clock is derived; only the last sending is stored.**
   - `assignment.lastReminderAt` and `reminderCount` are the only new state.
   - "Due" is computed on every tick and on every read (`reminderClock.ts`, pure, shared by the scheduler and the asset view): the first reminder is due 24 h after the offer, then 7 days after the last one.
   - A forced reminder counts as one and restarts the week.
   - An answered or cancelled assignment is never due.
2. **An in-process tick in inventory-api** (`startReminderScheduler`, every 15 minutes, `unref`'d, one tick at a time per process):
   - It is off under `NODE_ENV=test` and with `ASSIGNMENT_REMINDERS=off`.
   - At most 200 reminders go out per tick, and one failing reminder never stops the others.
   - A tick missed while the service was down only delays reminders: the next tick sends whatever is due.
3. **Claimed before sent, given back on failure.**
   - Each reminder is claimed with a compare-and-set on `lastReminderAt`, against the value it was read with. Two ticks, two replicas, or a tick racing a forced send can never send the same reminder twice.
   - The push goes after the claim.
   - When notify-api does not take it, the claim is given back with the reverse CAS (only if it is still ours) and the next tick retries.
   - When the push succeeded, the history records `assignment_reminded` (actor `system:reminders`, or the manager).
   - If that history write fails, the claim is given back too, so the record and the clock never disagree. The cost is a possible duplicate reminder, never a silent gap.
   - A process killed between claim and push loses that one reminder until the next week. It never sends two.
4. **The reminder is a notify-api email notice.**
   - It goes through `POST /system/notifications` with `email: true` (in-app plus email; notify-api resolves the address from `auth`), in the branded `notification_notice` template, linking to `/devices`.
   - inventory-api's service client therefore gains the scope `emails.send` (env-doctor's `requiredScopes`, the production `SERVICE_CLIENTS` template).
   - inventory-api never learns an address.
5. **Forced reminder:** `POST /assignments/{id}/remind`.
   - It needs `asset:manage` over the asset's entity (404 out of scope).
   - It is refused with 409 `assignment_not_pending`, or with 409 `reminder_too_soon` plus `retryAfterSeconds` within an hour of the last reminder (a guard against double clicks and spam).
   - It answers 502 `reminder_not_sent` when notify-api did not take it; nothing changes in that case.
   - It returns the asset, whose `pendingAssignment` now carries `reminderCount`, `lastReminderAt` and `nextReminderAt`.

## Consequences

- An unanswered offer is chased without anyone remembering to. The UI shows how many reminders went out and when the next one is due, and the history shows each one.
- **Deploy order:** grant `emails.send` to `inventory-api` in `auth`'s `SERVICE_CLIENTS` BEFORE (or with) the inventory-api deploy. Until then every reminder is refused by notify-api (403), given back and retried every 15 minutes: nothing is lost, the log repeats.
- A second replica of inventory-api would be safe (the claim), but would also tick twice as often for nothing. Keep one.

## Rejected

- **A Railway cron service calling an internal route.** It is a second deployable and a second credential, and it would need an internal route guarded by a new scope, for a 15-minute loop that the owning service can run itself.
- **Reminders queued as jobs at offer time** (meetings' durable runner). A future job per week per offer encodes the schedule in rows that must be cancelled on every answer. The derived clock needs nothing cancelled.
- **Sending first and recording after, with no claim.** Two ticks could both send.
- **notify-api scheduling the reminders.** It would have to know assignments; the record's owner decides when it is due.
- **An email without the in-app notification.** The employee who opens Operai should see it too, and a notice carries both.

## Revisit when

- inventory-api runs more than one replica.
- Reminders need per-person preferences, quiet hours or a stop after N reminders.
- A second service needs a scheduled action: then extract the claim-tick into a shared pattern.
