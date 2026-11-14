# 20261101 — `app-access-check` also answers by user id, and the directory can be filtered by app: amends ADR 20260807-third-party-app-access-decision-endpoint-forwarded-jwt and ADR 20261006-user-directory-endpoint-capability-gated for `crm-api` and the CRM pickers

**Date:** 2026-11-01
**Status:** Accepted (specs/20261101-crm-sales-flow, US-1/US-2)
**Deciders:** wellD
**Project:** Operai

---

## Context

Specs/018 lets a CRM record name a person from the suite (an owner, an assignee, a technical
contact for a deal). `crm-api` stores only `auth` user ids, never emails. Two things follow.

1. `POST /authz/app-access-check` (ADR 20260807-third-party-app-access-decision-endpoint-forwarded-jwt) is keyed by exact email. `crm-api` has an id and
   must ask "may this id use the CRM?" before accepting it; it would otherwise have to fetch an
   email it does not keep.
2. The owner and assignee pickers (ADR 20261101-user-directory-gate-widened-to-deal-manage) must offer only people who can actually open the
   CRM. `GET /authz/users/directory` returns every active user, so the UI would list people who
   would then be rejected on save.

## Decision

**`POST /authz/app-access-check` accepts `{ appId, email }` or `{ appId, userId }`, exactly one**
(both or neither is 400). Everything else is ADR 20260807-third-party-app-access-decision-endpoint-forwarded-jwt unchanged: the limiter is consumed before
the caller gate, the caller must hold `(appId,"access")` and not be soft-deleted (403
`app_access_required`), the negative body is the byte-identical `{ "eligible": false }`, and the
response-time floor applies to every negative. The `userId` probe is one query,
`id = $1 AND "deletedAt" IS NULL`, so "unknown id" and "soft-deleted" are the same zero-row
outcome, followed by the same eligibility resolution as the email path (one resolver call on
every path). Positive answer: `{ "eligible": true, "userId" }`.

**`GET /authz/users/directory` takes an optional `?appId=<id>`** (same regex as app-access-check;
invalid is 400). When present, only active users holding `(appId,"access")` are returned. The
gate, the `{id,name,email,entity}` shape, the sort, the rate limit and `Cache-Control: no-store`
are unchanged. An unknown `appId` matches nobody and yields an empty list, not an error.
Resolution uses the per-user resolver in a concurrent loop over the active roster: acceptable at
wellD's size (the endpoint is already unpaginated on that premise, ADR 20261006-user-directory-endpoint-capability-gated); a batch resolver is
the escalation if the roster grows.

## Why this does not widen anything

- The id probe adds no new fact. The caller still must hold the app's access, the answer is still
  a decision with indistinguishable negatives, and an id is no easier to enumerate than an email
  (user ids are random, not guessable) while the rate limit still applies.
- The directory filter does not widen the audience: the gate is the same allowlist
  (`asset:manage`, `deal:manage`), and the filter can only shrink the output. A holder learns
  strictly less than from the unfiltered list.

## Alternatives considered

- **`crm-api` stores emails to reuse the email probe.** Rejected: a second copy of personal data
  that goes stale (ADR 20260807-live-identity-resolution-by-id-fail-soft).
- **A new endpoint for the id probe.** Rejected: duplicates the caller gate, limiter and timing
  equalisation, which must stay in one place.
- **Filter client-side by probing each user.** Rejected: N rate-limited calls from the browser.

## Consequences

- ADR 20260807-third-party-app-access-decision-endpoint-forwarded-jwt and ADR 20261006-user-directory-endpoint-capability-gated are amended, not superseded; their properties hold for the new inputs.
- Tests: `auth/src/auth/appAccessCheck.routes.test.ts` (eligible by id, three identical
  negatives, xor 400, gate 403) and `auth/src/auth/directory.routes.test.ts` (filtered list,
  unknown appId empty, invalid 400).
