# 0087 — A per-event liveness answer is reused for 30 seconds, found only, counted from when it was asked

**Date:** 2026-11-12  
**Status:** Accepted  
**Deciders:** Matteo Codogno (owner of specs/029 push notifications)  
**Project:** Operai

---

## Context

specs/029 sends a Web Push message to every device of a recipient, but only if that recipient is still active (AC-5.2). notify-api asks auth whether the user is active with `POST /system/users/contact` (ADR-0056), and before this decision it asked on every raised notification. That call is limited per calling service (ADR-0086, 600 lookups per 10 minutes for `system:notify-api`). `POST /notifications` (self-raise, specs/005) has no rate limit, so one employee looping it against themselves could spend the whole allowance and stop push and email notices for everyone. The bound the suite already accepts for "deactivated, now refused" at its authorization-enforcing servers is 30 seconds (ADR-0014's resolve cache, ADR-0012 amendment M2), and AC-5.2 was amended to that bound on 2026-11-12.

## Decision

We will let notify-api's **push** channel reuse a `found` answer from `POST /system/users/contact` for 30 seconds per user, counted from the moment the lookup request was **sent**, and share one in-flight lookup between concurrent checks for the same user. `inactive` and `failed` answers are never reused. The **email** channel keeps a fresh lookup on every send, unchanged from ADR-0056. This amends ADR-0056 for push only.

## Failure shape

**A check that is paid for per event, drawn from a budget that other work also depends on, will be spent by whichever party produces the most events. And an answer kept to save that cost will outlive the bound the check exists to enforce, unless its lifetime is measured from the moment the question was asked and only the answer that grants the thing is kept.** The first half is a volume problem: the cost is multiplied by the number of raises, not by the number of people affected, so one producer can starve every consumer of the budget. The second half is a staleness problem: a memo is only as correct as its clock. A lifetime that starts when the answer arrives lets a lookup that was in flight across a change report a state that is already old; a memo that also stores a negative answer turns one transient failure into a standing refusal, or stores a "still allowed" that the change has already withdrawn.

The same shape appears in its mirror-image positions:

- **Budget spent by volume, read side and write side.** Any limiter whose key is the thing being checked (a recipient, a user, a document) and whose cost is per event: a loop of reads from one client, a loop of writes that each trigger a lookup, a poll that re-asks on every render. The mirror of "one employee's self-raise drains the shared lookups" is "one dashboard tab drains the shared directory lookups".
- **Shared allowance across consumers.** When two or more consumers draw on the same allowance, the bound that protects one is the bound that starves the other. Check every new consumer of a shared lookup, endpoint or limiter for whether its volume is caller-controlled.
- **Memo lifetime, clock start.** A cache whose TTL starts at response receipt, rather than at request send, on any path where the answer can change while the request is in flight: revocation, deletion, rotation, a grant change. The mirror is a client-side cache of an authorization answer, and a server-side memo of a token's validity.
- **Memo content, answer kind.** Only the answer that grants the thing may be kept. A cached refusal, a cached error or a cached "unknown" converts a transient fault into a long one. The mirror is a retry or fallback path that stores the failure it was meant to recover from.
- **Symmetric paths that must not inherit the memo.** The same `userContact` client serves push (memoised) and email (fresh, ADR-0056). A later change that routes a third path through the memo, or hoists the memo into the client, silently changes the freshness of a path whose spec demands a fresh answer. Recognise it by a shared client with a new caller that was not named in the decision.

Recognise the shape anywhere by: a per-event call to a service that also serves other callers under one quota; a cache or memo whose expiry is computed from `Date.now()` after an `await`; a stored value that is not a positive grant; and a "can I do this?" answer reused for longer than the spec's revocation bound.

## Options considered

### Option A — Memo the `found` answer for 30 s per user, counted from send, single flight, push only (chosen)

Described above. The memo holds the user id and an expiry, never the address or name. Entries exist only for users auth reported as found, so the map is bounded by the number of active users; expired entries are dropped on access. notify-api runs one instance (ADR-0008), so the in-process memo is coherent.

**Pros:**
- Bounds the cost per recipient: one employee looping self-raise costs at most 20 lookups per 10 minutes, so no one can drain the allowance for everyone
- The staleness bound is the one the suite already accepts for revocation (ADR-0014, ADR-0012 M2), and AC-5.2 states it
- Counting from send closes the in-flight gap: a lookup sent before a deactivation cannot extend the bound past 30 s
- Storing only positive answers means a transient auth failure is retried by the next notification, not remembered
- Email notices keep their fresh-lookup guarantee, so ADR-0056's "a deactivated user stops receiving email at once" still holds

**Cons:**
- A deactivated user can receive a push for up to 30 s after deactivation (AC-5.2 allows this)
- The memo is in-process: a restart empties it, which costs one lookup per user and nothing else
- Two code paths share one client, so the rule "push memoised, email not" has to be kept in the code and in the tests

### Option B — Memo in notify-api alone, auth unchanged (rejected)

**Pros:**
- No change to auth

**Cons:**
- Each recipient still costs at least one lookup per window whenever the memo TTL is at most the window: 21 recipients with devices in 10 minutes exhaust the 20-per-address allowance that auth had at the time
- Only the auth-side per-service limits (ADR-0086) make the memo sufficient, so the memo cannot ship alone

### Option C — A long TTL, hours (rejected)

**Pros:**
- Fewer lookups, even with a looping sender

**Cons:**
- A "still active" answer kept for hours is exactly what AC-5.2 forbids: a deactivated user keeps receiving pushes for the whole TTL

### Option D — A dedicated `POST /system/users/active` returning a boolean, with a new scope (rejected)

**Pros:**
- Data-minimal: push does not need the address or name

**Cons:**
- Adds a scope and a production `SERVICE_CLIENTS` change, with the deploy-order hazard that an unknown scope stops auth (ADR-0076)
- Adds a second fact endpoint about people, and the same limiter problem remains, so it does not replace the memo
- Trigger to build it: a second consumer that needs liveness only (ADR-0012's named resource-server liveness check)

### Option E — auth pushes deactivations to notify-api, and notify-api drops the per-send check (rejected)

**Pros:**
- No lookup per notification at all

**Cons:**
- A lost message leaves a deactivated user receiving pushes indefinitely, unless notify-api gets an outbox and retries (the ADR-0059 machinery) for a single event type
- Putting notify-api in the delete cascade makes deleting a user depend on notify-api being up, which ADR-0012 refused ("resource servers do nothing at delete time")

### Option F — Look up only when a user's devices are older than N (rejected)

**Pros:**
- Cheap to implement

**Cons:**
- Device age says nothing about when the user was deactivated, so the bound is not the one AC-5.2 states

## Consequences

**Positive:**
- One recipient cannot exhaust notify-api's lookup allowance; the worst case is 20 lookups per recipient per 10 minutes
- The push staleness bound equals the suite's accepted revocation bound and is tested with an injected clock, including a lookup in flight across a deactivation
- Concurrent pushes to one user share one lookup (single flight), so a burst costs one call

**Negative / trade-offs:**
- Push and email now behave differently for a deactivated user (up to 30 s versus at once); this is deliberate and documented in ADR-0056's amendment
- The memo is one more piece of state in notify-api, bounded by the active-user count and dropped on restart

**Risks:**
- **A memo keyed or cleared incorrectly keeps a revoked user.** Mitigation: the memo stores only `found`, measures from send, and the test "a lookup sent at d − 5 s, answered at d + 2 s" is part of the acceptance suite. A future change that caches `inactive` or `failed` must revisit this ADR.
- **A future consumer reuses the memo for a different bound.** Mitigation: the memo lives in the push activity check (`notify-api/src/push/activityCheck.ts`), not in the shared client; the email path must keep calling the client directly.
- **The memo hides an auth outage.** It does not: a memo entry expires after 30 s and an `inactive` or `failed` answer is never stored, so an outage stops pushes within 30 s, failing closed.

## Compliance notes

- GDPR / data-protection impact: low — the memo holds a user id and an expiry in process memory, never an address, a name or a delivery log; nothing is written to the database or to logs
- Data residency: compliant — in-process memory on the EU notify-api deployment; no new processor
- Audit trail: not required; the memo is a performance and fairness control, not a business record. The liveness decision it shortens is recorded through notify-api's existing `email_delivery` and the push send outcome, which are unchanged

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
