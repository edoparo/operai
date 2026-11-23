# 20261124 — A receipt code per employee overrides the derived initials for new numbers only, is stored as a unique current row with an append-only history, and is managed by its own capability

**Date:** 2026-11-24  
**Status:** Accepted — approved plan of specs/20261124-receipt-numbers-from-the-register (approved 2026-11-24 under the owner's choice of an unattended overnight run; review on the owner's return); decisions D8, D12 and D13 of the plan. Plan ADR candidate A2.  
**Deciders:** Matteo Codogno (product owner), by choice of the unattended run; the architect proposed it in the plan  
**Project:** operai  
**Relates to:** ADR 20261118-receipt-numbers-come-from-a-row-locked-per-employee-and-year-counter-inside-the-approval-transaction-and-are-immutable-in-the-database (initials are computed at numbering time and stored on the line; amended 2026-11-24), ADR 20260716-immutable-financial-audit-trail-refund and ADR 20260722-refund-settings-append-only-self-auditing-store (the change history), ADR 20260713-authz-hand-rolled-rbac-abac-epoch-claims and ADR 20260722-settings-catalog-permission-config-not-rate (a distinct catalog resource rather than a reuse of `settings:manage`), ADR 20261118-a-dialog-that-renders-its-own-form-is-mounted-beside-the-form-never-inside-it (the dialog).

---

## Context

A receipt number's prefix is two initials derived from the employee's name or email. Two employees can share them (two with "LC", two with "FR"), and the register's numbers then become ambiguous to the people who quote them. Accounting agreed on 2026-11-24 to give each such employee a **receipt code** of 2 or 3 letters (for example LCM/LCP and FRO/FRI) and to be able to set it in Refund. Numbers are immutable once issued (20261118), so a code can only affect numbers not yet issued.

## Decision

We will store a receipt code per employee in a **mutable current table with a unique code** (`receipt_code`) plus an **append-only change history** (`receipt_code_change`), read the employee's prefix **once per numbering call, inside the numbering transaction** (code if there is one, else the derived initials), never rewrite an issued number, and gate the three routes with a new catalog resource `receipt-code:manage`, seeded to `accounting` and `admin` only.

1. **Prefix.** `receiptPrefix(tx, owner)` is the current code, else `initials(name, email)`. `classifyAndNumber` reads it once per call, so all numbers of one approval share one prefix, the old or the new, never a mixture. The sequence is the counter's, independent of the prefix. An imported paper number keeps its text whatever the code.
2. **Shape.** 2 or 3 ASCII letters, validated on the trimmed input **before** upper-casing (so `ß`, which upper-cases to `SS`, is refused, as are `ÀB`, `A B`, `A1`, `A`, `ABCD`), and by CHECK in the database. An empty or null value clears. Saving the current value writes nothing.
3. **Set, change and clear** run in one transaction under `pg_advisory_xact_lock(hashtext('receipt-code:' || userId))`, so concurrent edits of one employee are serialised and `codeBefore` is exact. A code is refused (409) when another employee holds it or when another employee's issued or imported number already has that prefix. The unique index on `code` decides a race between two employees.
4. **History.** Every change writes one `receipt_code_change` row (before, after, actor) that cannot be updated or deleted (`accounting_history_immutable`). A cleared code is a deleted current row plus a change row.
5. **After the release, a shared prefix is not refused.** An employee who shares a prefix and has no code still gets numbers at approval; the Settings list flags them ("shares initials", a count, no name of the other employee). At the release itself, a new number for an employee in a shared pair with no code is refused (exit 9).
6. **Capability.** A new resource `receipt-code` with one action `manage` and no conditions, seeded by `seedReceiptCodeGrants()` to `accounting` and `admin` only, unconditioned, idempotent and never overwriting. **Not** to `refund-admin`: the spec says no other role, which departs from that role's "every refund capability" convention; an admin can grant it.

## Failure shape

**A label stamped into a permanent identifier is derived from data that is ambiguous or can change, and the fix for the ambiguity is applied backwards or twice.** The label is the same for two people, so the identifier no longer says whose it is; correcting it by editing the label rewrites identifiers that others have already quoted, or lets two parts of one operation read the label at different moments and stamp two of them on one document; a uniqueness check made before the write loses to a second writer.

Where else this shape can appear, including the mirror-image positions:

- **Set and clear.** Removing an override must go back to the derived value for *new* things only; clearing is not a rewrite of history, and the audit trail records both directions.
- **Derived and overridden.** Wherever a display or identifier prefix is computed (from a name, a team, a company) and an override is later added, the override applies from the moment it is read inside the transaction that uses it, never retroactively and never read twice in one operation.
- **Check and write.** An "is it in use" check followed by an insert is a race unless a unique index decides it. The accepted residual (a code set at the instant another employee's first number is derived to the same letters) must end in a flagged shared prefix, never in a duplicate identifier; uniqueness of the whole number stays per owner.
- **Whose permission.** A thing that belongs to a person (a code) needs a capability that is not entity-scoped, and a capability that reaches the same screen as another (general settings) must not be a way to obtain it; a new grant goes to named roles only, and the first user of the capability must not see a screen full of 403s.
- **Enumeration.** A refusal that says "in use" reveals that a value is taken and nothing about who holds it.

## Options considered

### Option A — Mutable current table with a unique code, append-only history, own capability (chosen)

Described above.

**Pros:**
- The database decides "one holder per code" with a plain unique index
- History cannot be altered; the current state is simple to read and to flag
- The prefix is read inside the numbering transaction with no new lock on approvals

**Cons:**
- Two tables; the current one is mutable on purpose, so its integrity rests on the history rows
- A shared prefix can be left after the release (flagged, not refused)

### Option B — Append-only only, current code = latest row (rejected)

**Pros:**
- One table, immutable

**Cons:**
- No unique index can express "the current code is unique"

### Option C — Record changes in `refund_audit_entry` (rejected)

**Pros:**
- Existing table

**Cons:**
- Its `requestId` is NOT NULL; a code belongs to a person, not a request

### Option D — Reuse `settings:manage` or a `request` action (rejected)

**Pros:**
- No new catalog entry

**Cons:**
- `settings:manage` is held by admin and refund-admin and not by accounting, and would hand accounting the distribution mailbox and defaults; a `request` action is entity-scoped while a code is per person

### Option E — An advisory lock on every approval to close the accepted race (rejected)

**Pros:**
- No shared prefix can arise

**Cons:**
- Serialises all approvals for a cosmetic case

## Evidence

- Planned, not yet implemented at the time of writing: unit table for the validator (`A`, `ABCD`, `A1`, `ÀB`, `A B`, `ßA`, ` lcx ` accepted as `LCX`); an int test that two concurrent employees setting one code yield exactly one success; a test that one approval stamps one prefix on all its numbers; auth seed tests for the grants. Update this section when the implementation lands.

## Consequences

**Positive:**
- Two employees with the same initials can be told apart on every new receipt
- Every code change is attributable and permanent

**Negative / trade-offs:**
- Old numbers keep their old prefix, so one employee can have two prefixes over time
- The release freezes code edits between its check and its run (plan R7)

**Risks:**
- **Auth live before codes are set.** refund-api before auth's seed means nobody holds the capability: routes answer 403 and the section is hidden; approvals are gated anyway. Holders may need a fresh session (new `perm_epoch`).

## Escalation triggers

- Codes needed for something other than the receipt prefix, or a code longer than 3 letters: the shape and the number's CHECK change together.
- A request to rewrite issued numbers: refused by 20261118; it is a separate decision with its own audit.

## Compliance notes

- GDPR / data-protection impact: low. The code is a short label tied to the owner's user id; the history holds the actor's user id and email, as the other append-only histories do. An erasure request needs an owner decision, as for the counter.
- Data residency: no change.
- Audit trail: required; `receipt_code_change` is append-only.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
