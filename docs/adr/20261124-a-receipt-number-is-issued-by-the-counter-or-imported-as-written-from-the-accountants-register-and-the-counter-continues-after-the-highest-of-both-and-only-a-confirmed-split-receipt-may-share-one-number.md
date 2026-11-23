# 20261124 — A receipt number is issued by the counter or imported as written from the accountant's register, the counter continues after the highest of both, and only a confirmed split receipt may share one number

**Date:** 2026-11-24  
**Status:** Accepted — approved plan of specs/20261124-receipt-numbers-from-the-register (approved 2026-11-24 under the owner's choice of an unattended overnight run; review on the owner's return); decisions D4, D5, D6 and D7 of the plan. Plan ADR candidate A1. Amends ADR 20261118-receipt-numbers-come-from-a-row-locked-per-employee-and-year-counter-inside-the-approval-transaction-and-are-immutable-in-the-database (an amendment note is added there; its decision is not edited).  
**Deciders:** Matteo Codogno (product owner), by choice of the unattended run; the architect proposed it in the plan  
**Project:** operai  
**Relates to:** ADR 20261118-receipt-numbers-come-from-a-row-locked-per-employee-and-year-counter-inside-the-approval-transaction-and-are-immutable-in-the-database (counter, guard, baseline table), ADR 20261118-accounting-classification-is-live-until-approval-then-frozen-and-changing-it-afterwards-needs-request-reclassify-and-is-refused-by-the-database-once-paid (copies written in the same UPDATE as the number, IS-1), ADR 20261119-data-that-moves-from-one-service-to-another-before-the-release-moves-by-an-additive-migration-that-carries-what-the-source-keeps-and-drops-what-moved-and-an-applied-migration-is-never-edited (the migration is new and never edits an applied one).

---

## Context

Before Refund, accounting numbered receipts by hand in a register (`Recap_RS_2026`) and people already quote those numbers. 20261118 let the release backfill every pre-release line from Refund's own counter, which would give a receipt a second number that disagrees with the paper one, and would start new numbers from a hand-supplied list that the register can contradict. The spec asks that a pre-release line take the paper number where the register has one, that a receipt split over two lines keep one number, and that new numbers continue after everything already issued. Production has no numbered line, no counter row and no baseline row, so the change is safe to make now; dev and test databases do have numbered lines.

## Decision

We will record how each number came to be (`receiptOrigin`: `issued` by the counter, `paper`, or `paper_split` for a confirmed split) and store an imported number **as written** (trimmed, upper-cased, never re-padded), make uniqueness the 4-column key (owner, year, seq, `receiptSplitPart`) with a deferred database trigger that keeps a split group to one number, one date and all `paper_split`, and start each employee's 2026 counter after the **maximum of the offsets row, the register and the imported numbers**, written through the existing `receipt_number_baseline` row.

1. **Origin and split part.** Migration `20261124090000_receipt_numbers_from_register` adds `receiptOrigin` and `receiptSplitPart` to `refund_line`, backfills existing numbers as `issued` / 1, and adds CHECKs: all three receipt fields are set or none; origin is one of the three; part is 1, or 2 and up only for `paper_split`; the seq is 1 to 99999 for `issued` and **0 to 99999 for paper** (the register has `…/000` entries); the text matches `^[A-Z]{2,3}[0-9]{2}/[0-9]{1,5}$` (a 2- or 3-letter prefix, see ADR 20261124-a-receipt-code-per-employee-overrides-the-derived-initials-for-new-numbers-only-is-stored-as-a-unique-current-row-with-an-append-only-history-and-is-managed-by-its-own-capability).
2. **Stored as written, year is the expense year.** The text is the paper text; `receiptYear` is the **expense year** and `receiptSeq` the paper sequence, not the year digits of the paper number. A paper number is imported only for a line whose expense year is 2026 (D6) and only if it appears on a register row mapped to the **same employee** (D7). Lines of other years take a new number.
3. **Uniqueness is (owner, year, seq, splitPart).** The new unique index is created before the old (owner, year, seq) index is dropped, in one transaction. Uniqueness is on the **sequence**, not the text, so `LG25/003` and `LG26/003` on two 2026 lines of one employee collide, as the counter's own seq invariant requires.
4. **A split is explicit and checked.** Lines of one receipt may share a number only as `paper_split` with parts 1, 2, and so on. A deferred constraint trigger (checked at COMMIT, because the group is written in one transaction) requires, for every member, a part-1 member, all members `paper_split`, one `receiptNumber` and one expense date. A group of one line is valid. **A number issued by the counter is never shared.** The release validates splits before writing; the trigger is the backstop.
5. **Guard v3.** `refund_line_accounting_guard` is replaced (`CREATE OR REPLACE`) with the two new columns added to the frozen set: after a number exists, none of the seven receipt columns changes and the line cannot be deleted.
6. **The counter continues after everything issued.** The 2026 baseline per employee is the maximum of: the `--offsets` row (now optional), the sequences of **every register row mapped to the employee, paired or not** (a number of another year counts when its date is in 2026, missing or unreadable, and not when the date is readable and outside 2026; seq 0, empty and malformed count for nothing), and the sequences of the numbers imported on 2026 lines. It is written as one `receipt_number_baseline` row per email when it is at least 1 and not already the latest value, and the existing counter-creation path does the rest, so the first new number is baseline + 1 whether the release or a later approval issues it, and for employees not yet in Refund. Paper numbers below the baseline that no line took are never issued. Other years have no baseline and start at 001.
7. **Audit.** `receipt_number_assigned` gains `origin` and, for paper, `registerRows` (sheet row positions only, never register content) and `splitPart`.

## Failure shape

**An identifier that people already quote is given a second authority.** Two issuers (a person with a register, a program with a counter) now hand out values from one space, and the newer one either continues from a point that ignores what the older one wrote, or rewrites what the older one wrote into its own shape, or forgets which of the two a given value came from. The result is a value issued twice, or a value that no longer matches the paper that was quoted. A second form: the one place where a value is legitimately shared (one document on two rows) is handled by exempting those rows from the uniqueness rule, so nothing then stops a shared value that is *not* that document.

Where else this shape can appear, including the mirror-image positions:

- **Import and issue.** The importer must not collide with what the issuer will issue next, and the issuer must start after what the importer brought. Check both directions: a value imported *above* the counter, one imported *below* it, and one imported for a person who has no counter yet.
- **Old system and new system, any identifier.** Invoice, ticket, batch or file numbers adopted from a spreadsheet, a former tool or another service. The continuation point is the maximum over *everything* the old system holds, including rows nobody matched to a record, doubtful ones and other-period ones, because a gap is harmless and a repeat is not.
- **Store and display.** A value kept as the source wrote it, with the structured parts (year, sequence) kept next to it in the columns the constraints use. A re-padded or re-derived text is no longer the thing people quote; a constraint on the text alone is weaker than one on the sequence the issuer relies on.
- **Share and own.** Any rule that says "never two rows with this value" and has one legitimate exception must express the exception as data the database can check (part number, group integrity), not as an exclusion from the rule. The same applies to a "soft delete", "archived" or "split" flag in a unique index.
- **Reading and writing the origin.** Every reader (export, batch PDF, review) must tolerate a value that did not come from the counter (seq 0, a prefix of another length, a shared number listed once) and every writer must say which origin it is.

## Options considered

### Option A — Origin column, text as written, 4-column key, deferred group trigger, baseline from the maximum of all sources (chosen)

Described above.

**Pros:**
- The number accounting quotes is the number Refund shows, byte for byte
- A split is the only way to share a number, and the database says so
- One counter-creation path serves release, approval and employees not yet in Refund
- A wrong-year or seq-0 paper number can be kept without entering the 2026 counter's range

**Cons:**
- A new column pair, five CHECKs, an index swap and a deferred trigger to maintain (the drift tests pin the hand-written SQL)
- The trigger raises only at COMMIT, so a violation is reported late (the release validates first)
- Uniqueness on the sequence refuses two paper numbers of different year digits with the same seq; a person must decide such a line

### Option B — Re-pad the paper text and store the number's own year digits (rejected)

**Pros:**
- Uniform text and year

**Cons:**
- The stored text is no longer "as written"
- A wrong-year number would leave the 2026 sequence and could be repeated by a 2025 counter

### Option C — A partial unique index that excludes split lines (rejected)

**Pros:**
- Simple SQL

**Cons:**
- Split lines become unconstrained and could share an issued number, or any other number

### Option D — Create counters directly in the release (rejected)

**Pros:**
- No baseline round trip

**Cons:**
- A second path next to the counter-creation one, and it misses employees who are not yet in Refund

## Evidence

- Planned, not yet implemented at the time of writing: a migration test on a database with numbered lines (backfill, CHECKs, index swap); one db test per trigger violation at COMMIT; the release's assertion that every pre-release line carries exactly one number and each counter's `lastSeq` equals baseline + new lines. Update this section when the implementation lands.

## Consequences

**Positive:**
- Accounting's paper numbers survive into Refund and the export unchanged; new numbers cannot repeat them
- A split receipt shows one number on its lines, once in the batch PDF's list

**Negative / trade-offs:**
- Two kinds of number in one column; every new reader of `receiptNumber` must accept both
- Applied migrations stay untouched, so the guard and index are replaced by a new migration rather than edited

**Risks:**
- **A wrong worker-to-employee mapping** makes an employee's new numbers start below their paper numbers (plan R3). Mitigation: the report lists employees with lines and no worker, and offsets differing from the register maximum; the index stops an exact repeat.
- **Hand numbering continues after the export** (plan R5). Mitigation: take the export on release day and stop hand numbering from the release; a process matter.
- **The index swap** (plan R4). Mitigation: no numbered line in production; new index first, in one transaction.

## Escalation triggers

- A second numbered document type, or a year other than 2026 needing a baseline: this decision (and the baseline CHECK) is reopened.
- A number that must be shared by something other than a split receipt: the exception is a new decision, not a widening of `paper_split`.

## Compliance notes

- GDPR / data-protection impact: low. The register's worker names are read by the release script and never stored; the database gains the paper number, its origin and sheet row positions on the line, of the same kind as the receipt number already stored with the owner's user id.
- Data residency: no change.
- Audit trail: required. One `receipt_number_assigned` row per number, cause `release`, actor `system:accounting-release`.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
