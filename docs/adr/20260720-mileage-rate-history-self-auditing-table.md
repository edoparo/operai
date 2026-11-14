# 20260720 — Mileage rate history as its own append-only, self-auditing table: direct extension of ADR 20260716-immutable-financial-audit-trail-refund's immutability mechanism, no separate audit table

**Date:** 2026-07-20
**Status:** Accepted
**Deciders:** wellD
**Project:** Operai

---

## Context

US-4/US-5 of `specs/20260720-mileage-rate` require that every mileage-rate entry be **append-only** —
once saved, it can never be edited or deleted through the UI or its underlying API, by any user
including an admin (AC-4.7) — and that every entry be **auditable**: an audit record capturing
the actor, timestamp, entity, value, and `valid-from` date, itself immutable (AC-5.1/5.2), with a
chronological history viewable per entity (AC-4.1/AC-5.3). The spec ties both requirements
explicitly to the suite's existing immutable-audit posture: ADR 20260716-immutable-financial-audit-trail-refund (refund-api's
`RefundAuditEntry`, a dedicated append-only table made physically immutable by a database-level
`BEFORE UPDATE/DELETE` trigger, combined with `onDelete: Restrict` retention) and ADR 20260719-refund-batch-audit-trail-extension (that
mechanism's first reuse, extending the same table in place for batch-scoped audit actions).

A mileage rate entry, unlike every event ADR 20260716-immutable-financial-audit-trail-refund/ADR 20260719-refund-batch-audit-trail-extension already cover, is **not scoped to a
`RefundRequest`** — `RefundAuditEntry.requestId` is a non-null foreign key, and a rate entry
records a policy change for an *entity*, not an event on a specific request. It therefore cannot
be written as a row in the existing table without either making `requestId` nullable (weakening a
constraint every other row in that table currently relies on) or otherwise forcing a
non-request-scoped concept into a schema shaped for a different one. Separately, every field
AC-5.1 requires an audit entry to capture (actor, timestamp, entity, value, `valid-from`) is
*already* exactly the set of fields a rate entry itself must record to do its own job (US-2's
resolution needs entity/value/validFrom; US-4's management screen needs actor/timestamp to
display history) — raising the question of whether a rate entry needs a companion audit row at
all, or can be its own complete audit record.

## Decision

We will add a new, dedicated `MileageRate` table in refund-api's database, made append-only by
the **same** database-level `BEFORE UPDATE/DELETE … RAISE EXCEPTION` trigger pattern ADR 20260716-immutable-financial-audit-trail-refund
established for `RefundAuditEntry` — and the `MileageRate` row itself **is** the complete audit
record; no separate `MileageRateAuditEntry` table is introduced.

1. **`MileageRate` is its own table**, not a row shape squeezed into `RefundAuditEntry` — carrying
   `entity`, `currency` (server-derived from `entity`), `ratePerKmMicros`, `validFrom` (date-only,
   may be past/present/future — AC-4.8), `createdByUserId`, `createdByEmail`, and `createdAt`. It
   is indexed on `(entity, validFrom)` for effective-rate resolution and `(entity, createdAt)` for
   chronological history/audit listing.
2. **Append-only, enforced at the database, not merely by an absent route.** The migration adds a
   `mileage_rate_immutable()` function that `RAISE EXCEPTION`s, wired as
   `mileage_rate_no_update`/`mileage_rate_no_delete` `BEFORE` triggers — the identical mechanism
   already proven for `refund_audit_entry`, copied verbatim rather than reinvented. No update or
   delete route is ever written for this model at the application layer either; the two are
   deliberate defense-in-depth, exactly as ADR 20260716-immutable-financial-audit-trail-refund already reasoned for the audit table.
3. **The row IS the audit trail — no separate audit table.** Every field AC-5.1 requires (actor,
   timestamp, entity, value, `valid-from`) already lives directly on the `MileageRate` row. A rate
   entry is never edited or superseded in place — a policy change is always a new row with its own
   `valid-from` — so the append-only table of rate entries *is* the complete, immutable change
   history. AC-5.3's "chronological list of every rate change" is exactly
   `SELECT … WHERE entity=… ORDER BY createdAt`; AC-4.1's "full history per entity" is the same
   query. No `RefundAuditEntry` rows are written for rate changes — that table remains scoped
   entirely to request-level events (ADR 20260716-immutable-financial-audit-trail-refund) and batch-level events (ADR 20260719-refund-batch-audit-trail-extension), neither of which
   fits a non-request-scoped policy change.
4. **`RefundLine` gains a soft-provenance FK, not a copy of the rate data.** The three new
   nullable snapshot columns on `RefundLine` (`appliedRateMicros`, `appliedRateValidFrom`,
   `appliedRateEntryId`) include a real foreign key (`appliedRateEntryId → MileageRate.id`,
   `onDelete: Restrict`) back to the specific entry that produced a line's frozen amount — kept
   consistent with the append-only posture: a `MileageRate` row that any line references can never
   be deleted, and `MileageRate` rows are never deleted in the first place.
5. **Backdated `valid-from` is allowed and does not require special handling.** Because resolution
   is always derived-on-read against `validFrom ≤ date` (ADR 20260714-invitation-lifecycle-derived-expiry-state, ADR 20260720-mileage-rate-model-snapshot-admin-ui-composition), a past-dated entry
   simply becomes part of the resolvable history the moment it is inserted — no backfill, no
   reconciliation pass, and it never disturbs an already-snapshotted line (AC-4.8).

## Options considered

### Option A — Dedicated `MileageRate` table, same DB-level immutability trigger as `RefundAuditEntry`, the row doubles as its own audit record (chosen)

Described above.

**Pros:**
- Reuses a proven mechanism verbatim — the exact trigger shape and defense-in-depth reasoning
  ADR 20260716-immutable-financial-audit-trail-refund already established and ADR 20260719-refund-batch-audit-trail-extension already validated on its first reuse — rather than
  inventing a third immutability approach in the same codebase
- No duplication between "the config" and "the audit record of the config" — a single append-only
  row serves both purposes, so there is no risk of the two drifting apart or requiring a join to
  reconcile
- `SELECT … ORDER BY createdAt` answers both AC-4.1 (management history) and AC-5.3 (audit
  history) with the identical query — no separate audit-read path to build or keep in sync
- Establishes a second, independent validation of ADR 20260716-immutable-financial-audit-trail-refund's own stated intent — "the pattern for
  future financial/governance records in the suite" — this time for a **non-request-scoped**
  record, broadening the pattern's proven applicability beyond ADR 20260719-refund-batch-audit-trail-extension's request/batch-scoped
  reuse

**Cons:**
- A second table in refund-api now carries its own hand-authored raw-SQL trigger definition,
  copy-pasted from (not shared with) `refund_audit_entry`'s — two trigger functions to keep
  mentally aligned rather than one, with no code-level mechanism ensuring they stay in sync if one
  is ever revised
- No remediation path exists for a genuine data-entry mistake (e.g. a typo'd rate) short of a
  manual, out-of-band database intervention that explicitly bypasses the DB-level protection —
  the same accepted cost ADR 20260716-immutable-financial-audit-trail-refund already named for audit entries, now also true of the rate data
  itself, not just its history

### Option B — Extend `RefundAuditEntry` in place, as ADR 20260719-refund-batch-audit-trail-extension did for batch actions (rejected)

Add a `mileage_rate` `AuditAction` value and reuse the existing table, writing one row per rate
addition.

**Pros:**
- Zero new tables or trigger definitions — the exact reuse pattern ADR 20260719-refund-batch-audit-trail-extension already established
  for batch-scoped events

**Cons:**
- `RefundAuditEntry.requestId` is a non-null foreign key to `RefundRequest` — a rate entry has no
  request to attach to, forcing either a schema-weakening nullable `requestId` (undermining every
  existing row's assumption) or an artificial dummy association with no domain meaning
- Would still require a *second*, separate place to hold the actual rate data for resolution
  (entity, `ratePerKmMicros`, `validFrom`) — `RefundAuditEntry` was never designed to be resolved
  against for `km × rate` computation, only read as a governance log — so this option does not
  actually avoid a second table, it only avoids one for the audit half while still needing one for
  the config half, reintroducing the exact drift risk Option A avoids
- Rejected: does not fit the domain shape, and does not eliminate a second table in practice

### Option C — Two tables: a mutable-looking `MileageRateConfig` (current value only) plus a separate `MileageRateAuditEntry` history table (rejected)

Keep only the currently-effective rate as a small, "latest wins" config row per entity, with a
separate append-only table recording every historical change for audit purposes.

**Pros:**
- A "what's the rate right now" query would be a single-row lookup rather than a
  latest-`validFrom`-≤-today scan

**Cons:**
- Directly contradicts AC-2.1's resolution rule, which is not "the current rate" but "the rate in
  effect for a given historical **date**" — a submitted line's effective rate at its own expense
  date, which may not be today's current rate, must remain resolvable; a "current value only"
  config table cannot answer that without the full history anyway, making the "config" table pure
  redundant duplication of data the audit table must already hold in full
- Introduces exactly the kind of split-source-of-truth risk (config row vs. audit row drifting)
  Option A's single-table design avoids entirely
- Rejected: adds a table and a synchronization concern for a query-performance benefit the actual
  resolution requirement (by arbitrary date, not "current") doesn't allow to be realized

### Option D — Soft-delete/versioning for rate entries, mirroring `specs/20260713-user-invitations`'s `User` soft-delete (rejected)

Give rate rows a `supersededAt`/`deletedAt` column instead of a hard database-level write-block.

**Pros:**
- Reuses a pattern the suite already has elsewhere (soft-deleted `User`) rather than introducing a
  new immutability mechanism

**Cons:**
- Soft-delete still permits an `UPDATE` (setting the soft-delete column) and, depending on
  implementation, other columns alongside it — AC-4.7/AC-5.2 require a rate entry can **never** be
  edited or deleted, a strictly stricter bar than "hidden but technically still mutable"
- Soft-delete fits `User` specifically because a user's *other* fields legitimately keep changing
  after deletion (specs/20260713-user-invitations) — the opposite of what a financial policy record needs; this is the
  identical reasoning ADR 20260716-immutable-financial-audit-trail-refund already used to reject the same option for `RefundAuditEntry`
- Rejected: does not meet AC-4.7/AC-5.2's immutability bar, for the same reason ADR 20260716-immutable-financial-audit-trail-refund already
  established

## Consequences

**Positive:**
- AC-4.7 and AC-5.2's "immutable even to admin" both hold at the strongest available layer (the
  database itself), identically to how ADR 20260716-immutable-financial-audit-trail-refund already secured `RefundAuditEntry` — a direct-SQL
  access attempt fails the same way an API call would
- No config/audit drift is possible, because there is exactly one row per rate change and it
  serves both purposes — a future reader never has to reconcile "what the rate was" against "what
  the audit log says the rate was"
- Validates ADR 20260716-immutable-financial-audit-trail-refund's own explicit design intent — a reusable pattern for future
  financial/governance records — on a genuinely different shape of record (non-request-scoped)
  than ADR 20260719-refund-batch-audit-trail-extension's first reuse, strengthening confidence the pattern generalizes

**Negative / trade-offs:**
- A second hand-authored trigger definition exists in the codebase, parallel to but not shared
  with `refund_audit_entry`'s — a future revision to one must be deliberately checked against the
  other, since nothing enforces they stay identical
- No correction path for a rate-entry mistake exists short of an out-of-band database
  intervention that explicitly bypasses the protection this ADR just established — accepted, for
  the same reason ADR 20260716-immutable-financial-audit-trail-refund already accepted it for audit entries: a correction is always a new,
  forward-dated entry, never an edit
- Every past rate entry is retained forever, with no operational cap — an accepted trade-off given
  the suite's existing indefinite-retention posture for financial/governance records (ADR 20260716-immutable-financial-audit-trail-refund)

**Risks:**
- **Migration trigger portability.** The raw-SQL trigger must survive `prisma migrate` on the
  EU-region Postgres exactly as `refund_audit_entry`'s already does. Mitigation: copy the proven
  trigger shape verbatim rather than reimplementing it, and cover it with the same class of
  direct-SQL adversarial test ADR 20260716-immutable-financial-audit-trail-refund already established (`db.*-immutability` test), mirrored
  for `mileage_rate`.
- **Seed grant enables any `admin`/`refund-admin` to write new history.** Mitigated by the
  immutability guarantee itself — no admin can rewrite or delete a past entry, only ever append a
  new one whose effect is bounded by derived-on-read resolution (a future-dated entry cannot
  retroactively apply, a backdated entry cannot disturb an already-snapshotted line, ADR 20260720-mileage-rate-model-snapshot-admin-ui-composition).
- **Two independently-maintained trigger definitions in one database** raises the chance a future
  schema change updates one and forgets the other. Mitigation: both are covered by dedicated,
  explicitly-named adversarial tests (not just "no route exists" coverage), so any accidental
  weakening is caught by the test suite rather than discovered in production.

## Compliance notes

- GDPR/nLPD impact: low — a `MileageRate` row records the actor's `userId`/`email` alongside a
  policy value (a per-km rate) and a date, necessary for governance/accountability of a financial
  policy change; no special-category data is introduced beyond what `RefundAuditEntry` already
  established as acceptable for the same purpose (ADR 20260716-immutable-financial-audit-trail-refund).
- Data residency: unaffected — `MileageRate` lives in refund-api's existing EU-region PostgreSQL
  database (ADR 20260716-eu-object-storage-refund-attachments's deployment posture), the same database `RefundAuditEntry` already lives in.
- Audit trail: this ADR **is** the audit-trail decision for mileage-rate changes — a self-auditing
  table, not a companion audit table — distinct from, and not a replacement for, ADR 20260716-immutable-financial-audit-trail-refund
  (request-level audit) or ADR 20260719-refund-batch-audit-trail-extension (batch-level audit), neither of which this feature's rows are
  written into.

This decision **extends** ADR 20260716-immutable-financial-audit-trail-refund (same database-level immutability mechanism, `onDelete:
Restrict` retention discipline, reused verbatim rather than reimplemented) and ADR 20260719-refund-batch-audit-trail-extension (the
suite's first reuse of that mechanism for a non-request-scoped record type, following ADR 20260719-refund-batch-audit-trail-extension's
precedent of extending-not-duplicating wherever the existing shape actually fits — here it does
not fit `RefundAuditEntry` directly, so a sibling table with the identical mechanism is used
instead). It supplies the persistence layer ADR 20260720-mileage-rate-model-snapshot-admin-ui-composition's rate model reads from and writes to, and
stores the numeric representation defined in ADR 20260720-mileage-rate-money-precision-integer-micros.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
