# 0086 — System endpoints limit each verified service, and count invalid credentials per source only

**Date:** 2026-11-12  
**Status:** Accepted  
**Deciders:** Matteo Codogno (owner of specs/029 push notifications)  
**Project:** Operai

---

## Context

`auth` exposes two internal endpoints that every backend service calls: `POST /system/service-token` (ADR-0044/0049, a scoped service JWT) and `POST /system/users/contact` (ADR-0056, a user's address and name). Both were limited by one address-keyed bucket of 20 requests per 10 minutes. On Railway's private network no forwarded address reaches `auth`, so every service looked like the same "direct" caller and the whole suite shared one bucket. specs/029 made notify-api look up a contact on every push, and the QE reproduced the starvation live: lookups 20 to 30 failed with 429 and push and email notices with them (specs/029 QE report, D-1). The limit exists to stop credential guessing and runaway loops, and it was keyed by a value that the people it was meant to bound do not own.

## Decision

We will verify the credential first, then consult exactly one count. A valid credential is counted only against its own calling service: 300 service-token requests and 600 contact lookups per 10 minutes, each configurable. An invalid credential is counted only against the source address, 20 per 10 minutes, one counter shared by both endpoints. Both refusals are one byte-identical 429 with a fixed `Retry-After` equal to the window length. The `SERVICE_TOKEN_RATE_*` variables are retired.

The governing rule is: **a rate limit is keyed by the identity it is meant to bound, and a credential is verified before any count is consulted.**

## Failure shape

**A limit that protects one party's volume or failures is keyed by something the party does not own, and it is consulted before that party's identity is known. The cost of one party's traffic, or of one party's mistakes, is then charged to every other party that shares the key.** The shared key is usually a network position (the same address for every caller inside one private network) or a constant. A refusal is then a signal about the wrong subject: a valid party is refused because of another party's conduct, and the refused sender can read, from the refusal, something about the bucket's history rather than about its own credential.

The same shape appears in its mirror-image positions:

- **Count before verification versus after.** A count consulted before the credential is checked lets invalid traffic starve valid traffic. The same count consulted after verification, keyed by the verified identity, charges only that identity. The symmetric case is a count that a *valid* request is allowed to write, or a valid request refused by a count that only invalid requests should feed.
- **Claimed identity versus verified identity.** A key taken from something the sender wrote (a client id in the body, a header, a token claim read without verifying it) is the sender's to choose. Keying a pre-verification count by it lets anyone lock out a service by guessing its name. The same mistake in the inbound direction: trusting a forwarded header or a socket address to tell callers apart on a network the callers share.
- **Inbound and outbound.** A service that calls a shared endpoint is one of the parties sharing that endpoint's bucket. A burst in its own fan-out (one lookup per push, per recipient, per device) is charged to every other caller. The caller side needs its own bound, a memo or single-flight, that is not the callee's problem to enforce.
- **Refusal answer.** A refusal whose status, body, headers or timing depend on which counter refused, or on how full it is, tells the sender whether its credential was valid. `Retry-After` taken from a bucket's remainder is the same oracle, in a header. The refusal must be a function of the path alone.
- **Counted by refusals.** A refused attempt that is recorded extends its own refusal, so a retrying client never gets out. The symmetric case is a window that a refusal cannot end.
- **New endpoint on the same service.** Any new `/system/*` route on `auth` inherits this rule. The place it goes wrong is a new route that copies the old address-keyed middleware ahead of its verification.

Recognise it anywhere by: a rate limiter, lockout or quota on a shared service whose key is an address, a header, a claimed id or a global constant; a check placed ahead of signature or secret verification; a counter whose key carries no identity while the thing it bounds is per caller; a 429 whose headers or body vary with the bucket; a shared bucket that two or more independent callers draw from.

## Options considered

### Option A — Verify first; count valid requests per verified service and invalid requests per source address (chosen)

Described above. Valid credentials are bounded by their own service's allowance, which covers the suite's busiest case (100 notifications in 10 minutes, AC-7.7) with room to spare. Invalid credentials are bounded by their source, which is the party that is guessing.

**Pros:**
- A service's volume can refuse only that service's calls
- A flood of invalid requests, from any source, cannot refuse a valid credential (AC-7.5)
- No caller-written value decides a count: the valid count is keyed by the verified `sub` or the verified client id, and the invalid count by the only key available before verification
- One refusal shape means no sender learns whether its credential was valid (AC-7.6)
- No endpoint, scope or credential format changes; callers do not change how they call `auth` (AC-7.8)

**Cons:**
- A stolen service secret can mint 300 tokens per 10 minutes instead of 20 (R15)
- Invalid requests still cost verification work, because a valid credential must be recognised from any source; the count cannot reduce it (R12)
- The limiter is per process: a second `auth` instance doubles every allowance and the invalid count (R17)

### Option B — A per-address guard ahead of verification (rejected)

The old shape. On the private network every service is the same address, so any twenty invalid credentials, from anywhere, refuse every valid caller. This is the failure observed in specs/029 D-1.

### Option C — Raise the address limit (rejected)

Still one bucket for the whole suite. One consumer still starves the others, and a flood still refuses valid credentials. It moves the threshold and keeps the shape.

### Option D — Trust forwarded headers or socket addresses to tell services apart (rejected)

On the private network a caller writes its own forwarded header, and the socket address says nothing about which service sent the request. Neither is an identity, and both depend on how the platform is deployed.

### Option E — Key the pre-verification count by the claimed client id (rejected)

Lets anyone lock a service out by its guessable name, because the count fills before any secret is checked. The client id is a name, not a credential.

### Option F — Return `Retry-After` from the refusing bucket's remainder (rejected)

A sender that retries at the advertised time learns from the timing whether its counter was the one that refused. That makes the refusal an oracle on validity. A fixed window length is pessimistic and carries no information.

### Option G — No allowance for valid credentials (rejected)

A runaway service then hammers the signer and the database with no bound, and the refusal that stops it would also stop every legitimate call from that service.

## Consequences

**Positive:**
- A service's volume, runaway loop or burst (push lookups, email notices) cannot refuse another service's internal call
- Invalid-credential floods are refused from their own source, and valid credentials keep working during one
- Refusals reveal nothing about credential validity or other services' usage
- The rule covers every future `/system/*` route by default

**Negative / trade-offs:**
- Verification work per invalid request is no longer throttled by the count. It must be kept cheap and I/O-free: 4 KiB body cap, 4 096-character token cap, a cached key set (a re-read only for an unknown `kid`, at most once per 30 seconds), no database, no signer
- Invalid requests from a shared network are one bucket per address, so an address that is not distinct (the private network, R13) can make a legitimate caller see the 429 for an invalid request before its own twentieth. This never touches a valid credential
- Memory: one key per configured service client, plus the invalid-credential map, capped at 50 000 keys with an overflow key past the cap (R13)
- Logging is bounded: below the limit each invalid request logs as before; from the limit on, one line per source key per window; no address, unverified client id, secret or token is logged

**Risks:**
- **R15 — a stolen service secret mints up to 300 tokens per 10 minutes instead of 20.** A stolen secret is already full compromise of that service's scopes for as long as it is valid (5-minute tokens, re-mintable), and the address limit never stopped it. Mitigation: rotate the secret (infra runbook).
- **R12 — verification flood.** Residual CPU cost per invalid request is a platform concern, as for any public route. To be confirmed by the owasp-reviewer.
- **R13 — spoofed forwarded address on the private network.** Doing so gains no work reduction and cannot affect a valid credential; the 50 000-key cap bounds memory.
- **R14 — a legitimate burst above a service's own allowance.** Best effort by spec: the email notice or push is `failed` and logged. Raise `USERS_CONTACT_SERVICE_LIMIT` per environment without a code change.
- **R16 — the cached key set misses a new signing key.** A `kid` not in the cache triggers a re-read, at most once per 30 seconds. A token refused in that window is answered 401 and counted as invalid once; the notify-api client retries once with a fresh token.
- **R11 — rollout order.** `auth` must ship before environments rely on the new behaviour; an environment that still runs the old address rule or a leftover `SERVICE_TOKEN_RATE_*` override is caught by the startup warning and env-doctor (`FORBIDDEN_VARS`). The retired variables are ignored, not reused under a new meaning, because an override sized for the old rule would silently cap a service below its allowance.
- **R17 — per-process limits.** `auth` runs one instance today. The `RateLimiter` interface is the seam for a shared store if a second instance is ever added.

## Amends

- **ADR-0044** — the service-token limit is no longer one address-keyed bucket. It is one allowance per calling service whose credential verified, and an address-keyed count only for invalid credentials, shared with the contact lookup.
- **ADR-0056** — the contact lookup reuses the same credential gate: a per-service allowance for valid credentials, the shared invalid-credential count otherwise.

## Compliance notes

- GDPR / data-protection impact: none — no new personal data is stored or released. The invalid-credential counter holds source addresses in process memory only, capped and unlogged; the contact lookup still returns only what ADR-0056 already allows its scope holders to read
- Data residency: not applicable; no change to where data is processed or stored
- Audit trail: not required; rate-limit refusals are operational signals, logged without identities

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
