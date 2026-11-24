# 20261124 — A one-off release that needs human judgement runs as propose, then confirm, then run, and the confirmation is a file bound to its inputs and refused when they changed

**Date:** 2026-11-24  
**Status:** Accepted — approved plan of specs/20261124-receipt-numbers-from-the-register (approved 2026-11-24 under the owner's choice of an unattended overnight run; review on the owner's return); decisions D2, D3, D9, D10, D11 and D15 of the plan. Plan ADR candidate A4. It generalises the 20261118 SO-13 and 20261119 T84 conventions for future operator migrations.  
**Deciders:** Matteo Codogno (product owner), by choice of the unattended run; the architect proposed it in the plan  
**Project:** operai  
**Relates to:** ADR 20261118-receipt-numbers-come-from-a-row-locked-per-employee-and-year-counter-inside-the-approval-transaction-and-are-immutable-in-the-database (the release, its gate, its report and exit statuses; amended 2026-11-24), ADR 20261119-data-that-moves-from-one-service-to-another-before-the-release-moves-by-an-additive-migration-that-carries-what-the-source-keeps-and-drops-what-moved-and-an-applied-migration-is-never-edited, ADR 20261124-operator-data-imports-read-the-source-workbook-directly-with-an-in-house-dependency-free-xlsx-reader-that-refuses-what-it-does-not-understand-and-quotes-no-cell (the reader).

---

## Context

The release must pair each pre-release line with the accountant's register rows, and some pairings are not mechanical (an amount that differs, several candidate rows, a worker spelled differently, a split receipt). The spec says nothing is written until a person has confirmed the pairing, that a changed register or changed lines must not reuse an old confirmation, and that the run is safe to repeat. The release runs once, on production, from an operator's machine, and the report must not hold personal data.

## Decision

We will run the release as **three steps with one command** — propose, check, run — where the person's decisions live in an **operator file outside the repository** (a CSV decided in Excel) that is **bound to its inputs by fingerprints** and refused as stale when they changed, where the real run accepts only records marked `confirmed`, and where the real run is **idempotent once completed**.

1. **Propose.** `--dry-run --register <xlsx> --propose <csv>` reads Accounting and auth, reads the workbook, pairs lines by (employee, expense date, amount) deterministically (same inputs, same output) and writes the pairing file with `O_EXCL` and mode 0600 (an existing path is refused, so a decided file is never overwritten). It writes nothing to any database and prints a report with no personal data.
2. **Confirm.** A person maps every worker (an employee id, an email or `not-operai`), decides every doubtful line (`paper` + number, `new` or `split` + group), acknowledges malformed and worker-less rows, and sets every `worker`, `line` and `row` record to `confirmed`. **Exact matches are pre-filled and still need one confirmation.** The reader tolerates what Excel does on save (delimiter, BOM, case); ids and fingerprints are protected as text (`sha256:` prefix).
3. **Check.** `--dry-run --register <xlsx> --pairing <csv>` runs the whole release in a transaction that is rolled back, so the numbers printed are the real ones and there is no second implementation to drift. It ends with the status the real run would end with.
4. **Bound to inputs.** The file carries the SHA-256 of the workbook and a digest of the sorted pre-release line list. A different workbook or different lines is **exit 7, stale**: run the proposal again. Earlier decisions are never carried into a new proposal.
5. **The file is not trusted for what the machine can compute.** The report lists every line whose decision differs from the proposal **recomputed** from the workbook and the database, never from the file's own `proposed` columns, which a person could edit.
6. **Exit statuses per refusal family.** 0 done, or dry run done, or already completed; 1 any other failure; 2 Accounting unreadable; 3 retired and never reused; 4 auth unreadable; 5 an input not given (a real run with no register or no pairing, or a dry run without its mode); 6 an input unreadable or malformed; 7 stale; 8 the pairing is not fully decided or is inconsistent; 9 a new number would go to an employee who shares a prefix and has no receipt code. Every refusal writes nothing.
7. **Idempotent when completed.** The marker is read first, before any input: if the release was completed, print so and exit 0 with no read and no write, whatever the inputs (a `--propose` path inside a git worktree included, see decision 8). It is read again after the advisory lock. This keeps the e2e global setup idempotent. Only argument parsing comes before it (a usage error is exit 1).
8. **No personal data in output.** People are named only as `<prefix> · <id8>`; `--show-emails` is removed (refused as an unknown argument, naming the reason); failures use the `describeReleaseFailure` rule; and `.gitignore` covers `**/*pairing*.csv`, `**/Recap_RS*` and `**/accounting-release*.csv`. **Amendment 2026-11-24 (security fix round L-1, `4010237d`; order fixed after eval round 1, plan § Fix rounds):** the file the command **writes** is refused, not warned about: a `--propose` path inside a git worktree is exit 1, with nothing else read and nothing written. The refusal runs right **after** the completed-release marker of decision 7, so on a released database the same command exits 0 "already completed". The paths that are only **read** (`--register`, `--pairing`, `--offsets`) still get a warning on stderr when inside a git worktree, and the run goes on.
9. **The e2e setup follows the same procedure** on a committed header-only fixture: propose, rewrite `proposed` to `confirmed` in the setup's own code, fail naming the command if anything is `unresolved`, run.

## Failure shape

**A decision that a person made about one state of the world is applied to another, or is assumed rather than recorded, or its absence is read as consent.** A confirmation made against last week's register is used on this week's; a machine's proposal is treated as agreed because nobody objected; a preview shows numbers produced by different code than the run; a step run twice does its work twice; and the report that proves what happened also leaks who it happened to.

Where else this shape can appear, including the mirror-image positions:

- **Proposal and confirmation.** Any "the system suggests, a person approves" step: approval must be an act recorded in the file or row (here, `confirmed`), and a pre-filled suggestion is still not an approval. Silence, a blank, a default or a missing file is a refusal, not a yes.
- **Confirmed against what.** An approval of a plan, a diff, a migration or a payment run must name the inputs it was made against (fingerprints), and a changed input must make it stale, in both directions: changed data under an old approval, and an old file under new data.
- **Preview and real.** A dry run must go through the same code and the same transaction as the real run, rolled back, not through a parallel implementation. The mirror: a real run must not accept inputs the preview never saw.
- **Run once and run again.** A one-off needs a persisted "done" check first, so a retry, a second operator or a setup script is harmless; a half-done state is impossible because everything is in one transaction.
- **Trusting the edited artefact.** A file a person edits can be edited wrongly or maliciously; recompute what can be recomputed and compare, and refuse the rest by named family.
- **Output as a leak.** A report, a log line, an exit message or a stack trace in a migration tool is an output channel like any response body; it carries identifiers only.
- **Exit codes.** A number shared by two different meanings (an old "missing list" and a new "not decided") misleads the operator and the wrapper script; retire a status, never reuse it.

## Options considered

### Option A — Propose, confirm, run with a fingerprinted operator file (chosen)

Described above.

**Pros:**
- Nothing is written until a person has decided, and a changed input cannot reuse a decision
- Accounting works in Excel and keeps the confirmed file and report as its own record
- The preview is the real transaction, rolled back, so its numbers are the real ones
- One status per refusal family tells the operator what to do next

**Cons:**
- Three runs and a manual step; 11 or more doubtful lines to decide while approvals stay blocked (plan R10, accepted by the spec)
- A file round trip through Excel can mangle it (plan R6; mitigated by a tolerant reader and text-protected ids)

### Option B — JSON decisions file (rejected)

**Pros:**
- Exact types

**Cons:**
- Accounting cannot edit it comfortably

### Option C — Implicit acceptance of exact matches (rejected)

**Pros:**
- Fewer rows to confirm

**Cons:**
- The spec says a number is taken because the file confirms it; silence would be consent

### Option D — Carry earlier decisions into a new proposal after a stale refusal (rejected)

**Pros:**
- Saves typing

**Cons:**
- Silently reuses decisions made against another register

### Option E — A UI for the pairing (rejected)

**Pros:**
- Friendlier

**Cons:**
- A spec non-goal; a UI for one run

### Option F — A pure simulation as the check mode (rejected)

**Pros:**
- No transaction needed

**Cons:**
- Two implementations of numbering that could drift

## Evidence

Implemented (updated 2026-11-24; QE verdict PASS in `specs/20261124-receipt-numbers-from-the-register/qe-report.md`, a QE re-run after the fix rounds is pending):

- Deterministic proposal: `scripts/release/pairing.test.ts` "the same inputs in any order give the identical proposals, groups and ids"; `scripts/accounting-release.production-shape.test.ts` "a second propose gives the same proposal (deterministic)".
- Pairing-file round trip: `scripts/release/pairingFile.test.ts` "round-trips what the writer wrote", "reads an Excel-style re-save: `;` delimiter, CRLF, no BOM, quotes dropped, lower-case headers and enums, short rows", "reads a tab-delimited file with the columns in another order…"; fingerprints as text, "holds the fingerprints as text with the sha256: prefix…".
- Confirmation, not silence: `scripts/release/pairingFile.test.ts` "the validator (AC-2.4, AC-2.6)"; `scripts/accounting-release.run.test.ts` "AC-1.3 amount differs: unresolved, refused with 8 naming the line, and taken once a person confirms the paper number".
- Exit statuses: `scripts/accounting-release.cli.test.ts` "the refusal families, each with a status of its own and nothing written" (exit 7, 8, 9 and "the matrix: every family ends with its own status, and the footprint of every refund table is as it was"), "(AC-2.8) a real run with no --register or no --pairing … is exit 5", "an unreadable workbook, a missing sheet … are exit 6"; staleness also in `scripts/accounting-release.run.test.ts` "AC-2.7 a workbook that differs by one byte of content is stale (7)…" and `scripts/accounting-release.qe.test.ts` "the stale check covers the sheet (AC-2.7)".
- Step 0: `scripts/accounting-release.cli.test.ts` "(AC-5.3, D11) after completion ANY inputs exit 0 'already completed', ask nobody and write nothing"; `scripts/accounting-release.run.test.ts` "a rerun after completion (AC-5.3)".
- Decision 8 (L-1): `scripts/accounting-release.cli.test.ts` "(L-1) --propose inside a git worktree is REFUSED with exit 1: nothing is read from Accounting or written, the file is not created" and "a register or offsets path inside a git worktree prints a warning on stderr…; the run goes on". The test that pins the order (a released database exits 0 with such a path) lands with the marker-order fix (task T36).
- No personal data in output: `scripts/accounting-release.privacy.test.ts` "every mode and every refusal of one release, from the first proposal to the rerun after completion", "(I-4) a refusal inside the transaction names the employee as `<prefix> · <8>`…"; `scripts/release/report.test.ts` "privacy by construction (AC-5.6)"; `scripts/release/pairingFile.test.ts` "(L-2) neutralises the shape of a register row and the currency…".
- Preview equals real: `scripts/accounting-release.run.test.ts` "AC-2.9 and AC-5.5 the check writes nothing and reports exactly the numbers the real run then writes, line by line"; recomputed proposal: "AC-2.4 the report lists a changed exact match, compared with the proposal RECOMPUTED…".
- The e2e global setup run twice: written (`shell/e2e/global-setup.ts`; `shell/src/e2eGlobalSetup.test.ts` covers its local-database guard, I-9) but **not yet executed**; the live run is owner task T32.

## Consequences

**Positive:**
- Reusable pattern for the next operator migration that needs a person's judgement
- The archive of the confirmed file and the report gives accounting a record outside Operai

**Negative / trade-offs:**
- More moving parts than a script that guesses; every run needs its file

**Risks:**
- **Codes change between the check and the real run** (plan R7). Mitigation: the real run reads codes in its own transaction and prints every number; the runbook freezes code edits between the steps.
- **The e2e or local setup breaks** because the real run needs a register and a pairing file (plan R8). Mitigation: the committed header-only fixture; released databases exit 0 at step 0.

## Escalation triggers

- A second operator migration of this kind: extract the fingerprint-and-confirm helpers (`operatorFiles.ts`, `pairingFile.ts`) into a shared module and keep the statuses per family.
- A decision that must be taken by someone who has no access to the operator machine: the file medium is reopened (a UI, with its own authorisation decision).

## Compliance notes

- GDPR / data-protection impact: low. The pairing file holds employee names and expense data on an operator's machine, mode 0600, outside any git worktree, and is archived by accounting and deleted locally after the run; the report and every output name people only as `<prefix> · <id8>`.
- Data residency: no change.
- Audit trail: required for the writes (one `receipt_number_assigned` per number, actor `system:accounting-release`); the confirmed file and report are archived by accounting.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
