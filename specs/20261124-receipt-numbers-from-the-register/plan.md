---
spec: 20261124
status: approved
approved: 2026-11-24
approved_note: "approved under the owner's choice of an unattended overnight run (2026-11-24); review on the owner's return"
---

# Plan: Receipt numbers from the accountant's register, and a receipt code per employee

The owner asked for an unattended overnight run and approves plans under that choice; this plan is
therefore `approved` as written, and every decision it takes is listed under **Decisions taken
unattended** so it can be reversed cheaply.

Planned against the code as it is on `refund/register-numbers` (7f1dfe25): Refund 0.4.0, the release
script of 20261119 T22/T63/T84 (`refund-api/scripts/accounting-release.ts`), `classifyAndNumber`
(`src/accounting/numbering.repo.ts`), the guard `refund_line_accounting_guard` v2
(`20261119120000_accounting_copies`) and the baseline table (`20261119200100_receipt_number_baseline`).
Production facts it relies on: the release has not run, no row exists in `receipt_counter` or
`receipt_number_baseline`, and no `refund_line` has a receipt number. Approvals answer 409
`accounting_release_pending` until the release completes, and keep doing so through this rollout.

## Architecture

### Shape in one paragraph

Everything lives in **refund-api** (release script, numbering, a receipt-code module and one
additive migration) and **refund-ui** (a Settings view). **auth** gains one catalog resource and its
seed grants. The release becomes a three-step operator procedure:

1. **Propose**: `--dry-run --register <xlsx> --propose <csv>` reads Accounting and auth as before,
   then reads the accountant's workbook directly. It pairs each pre-release line with register rows
   by (employee, expense date, amount), writes a proposed **pairing file**, prints a report that
   holds no personal data, and writes nothing to any database.
2. **Check**: a person decides the pairing file. `--dry-run --register <xlsx> --pairing <csv>` then
   validates it and runs the whole release in a transaction that is rolled back, so it prints the
   exact numbers.
3. **Run**: the same command without `--dry-run` does it for real, in one transaction.

Paper numbers are written on lines as **imported numbers**: the paper text, `receiptOrigin =
paper | paper_split`. New numbers come from the existing per-(employee, year) counter. That counter
now starts after max(offsets row, register maximum, imported numbers), written as the existing 2026
baseline row. The prefix of a new number is the employee's **receipt code** when there is one, else
the initials. The code is read inside the numbering transaction, both at approval and at the release.

### Components touched / added

**refund-api**

| File | Change |
|---|---|
| `prisma/migrations/20261124090000_receipt_numbers_from_register/` | NEW, additive-or-safe (§ Data model): two `refund_line` columns plus backfill, the unique index swapped for one that admits a confirmed split, guard v3, a deferred split-integrity trigger, `receipt_code` and `receipt_code_change`. |
| `src/accounting/receiptNumber.ts` | `formatReceiptNumber(prefix, year, seq)` accepts 2 or 3 letters (`^[A-Z]{2,3}$`). NEW `parseReceiptNumber(text)` → `{ prefix, yy, seq, text }` or `null`, using `^[A-Z]{2,3}\d{2}/\d{1,5}$` after trim + upper-case. NEW `RECEIPT_CODE_PATTERN`. `initials()` unchanged. |
| `src/accounting/receiptCode.repo.ts` / `.routes.ts` / `.schemas.ts` | NEW. List, set/change/clear and history of codes (§ API contracts). `receiptPrefix(tx, owner)` = current code, else `initials(name, email)`. Gated by `receipt-code:manage`. |
| `src/accounting/numbering.repo.ts` | `classifyAndNumber`: (a) the prefix comes from `receiptPrefix` and is read once per call, inside the transaction (AC-4.4, AC-4.10, AC-4.12); (b) NEW optional input `paper: Map<lineId, PaperAssignment>` (release only): those lines skip the counter and get the paper text, with their classification copies in the same single `UPDATE` (the IS-1 rule stays); (c) every numbered line writes `receiptOrigin` and `receiptSplitPart`; (d) the `receipt_number_assigned` detail gains `origin` and, for paper, `registerRows` (row positions only, AC-1.17). |
| `src/review/decide.repo.ts` | No logic change. The approval keeps calling `classifyAndNumber(cause: "approval")`, which now uses the code. |
| `src/requests/audit.ts` | Type of the `receipt_number_assigned` detail: `{ cause, receiptNumber, year, seq, origin: "new" \| "paper" \| "paper_split", registerRows?: number[], splitPart?: number }`. |
| `src/index.ts` (router mount) | Mount `receiptCodeRouter`. |
| `scripts/accounting-release.ts` | Rewritten orchestration and CLI (§ The release). It keeps: Accounting read first (exit 2), owner names (exit 4), defaults seeding, advisory lock, marker, the rollback-based dry run. |
| `scripts/release/types.ts` | NEW (design sync DS-10). The shared types of the release modules (`RegisterRow`, `PreReleaseLine`, `ReleaseEmployee`, `PairingProposal`, `PairingDecision`), so the reader, pairing, pairing-file and report work can proceed in parallel. Types only. |
| `scripts/release/xlsxReader.ts` | NEW. A dependency-free reader: ZIP (stored and deflate via `node:zlib.inflateRawSync`) plus minimal OOXML. Enough to read one sheet's cell values (§ Register export). |
| `scripts/release/registerExport.ts` | NEW. Sheet → `RegisterRow[]` (`position`, `worker`, `number`, `date`, `totalCents`), header detection, cell coercion, merged-cell propagation. Keeps nothing else. |
| `scripts/release/pairing.ts` | NEW, pure. Proposal algorithm (categories, splits, number-taken), worker → employee proposal, baseline computation (AC-3.1), shared-prefix analysis (AC-4.11). |
| `scripts/release/pairingFile.ts` | NEW, pure. Writes and reads the pairing CSV, plus the validator for AC-2.4, AC-2.6 and AC-2.7. |
| `scripts/release/report.ts` | NEW. The report (AC-2.2), privacy-safe by construction (§ Personal data). |
| `scripts/lib/operatorFiles.ts` | NEW. `pathInsideGitWorktree` (merged from `offsetsPathWarning` and `registerPathWarning`), `shapeOf`, `yearOfDate`, SHA-256 of a file, and `writeFileExclusive(path, 0600)`. |
| `scripts/receipt-baseline-from-register.ts` | Imports the moved helpers, no behaviour change. It drops out of the runbook. Deleting it is a later cleanup. |
| `src/test-support/registerWorkbook.ts` | NEW. Builds synthetic register workbooks with the existing deterministic writer `src/accounting/xlsx.ts`, with a deflate variant for the reader tests. All names are synthetic (`Worker Alpha`, …). |
| `src/batches/pdf.ts` | (design sync DS-7) The receipt-numbers cell of the batch PDF breaks a token wider than its column after the en dash (`LCX26/1000–` / `1002,`), so no token runs into the amounts. Nothing else changes. |
| `scripts/fixtures/synthetic-register-header-only.xlsx` | NEW, committed, no data: the header row only. Used by the e2e global setup. A test asserts its bytes equal the writer's output, which is deterministic. |

**refund-ui**

| File | Change |
|---|---|
| `src/pages/SettingsPage.tsx` | New section `receipt-codes` ("Receipt codes"), available with `receipt-code:manage`. `general` is offered only with `rate:read` or `settings:read`. That is unchanged for every user who reaches Settings today, but an accounting user with only the new capability no longer sees a General view full of 403s. |
| `src/pages/settings/ReceiptCodesSettingsView.tsx` | NEW. Mounts the card. |
| `src/components/settings/ReceiptCodesCard.tsx` | NEW. A table of employees: name (email beside it), code, prefix in use (code, or initials marked "from initials"), last number issued, last changed (DS-2), a "Shares prefix" badge (rule DS-8), and the row actions **Set code** / **Change**, **Clear** (its own `ConfirmDialog`, DS-3) and **History**. It follows the patterns of `ExpenseTypeDefaultsCard`. |
| `src/components/settings/ReceiptCodeDialog.tsx` | NEW. One text field (no `maxLength`, a–z upper-cased as typed, DS-3), client-side shape check, server errors mapped (422/409 on the field). No Clear inside it. Mounted beside the card (ADR 20261118-a-dialog-that-renders-its-own-form-is-mounted-beside-the-form-never-inside-it). |
| `src/components/ChangeHistoryDrawer.tsx` | (design sync DS-4) Two optional props, `loading?: boolean` and `error?: { message: string; onRetry: () => void }`, for a history fetched when the drawer opens. Existing callers are unchanged. |
| `src/lib/receiptCodesApi.ts` | NEW client. |
| `src/components/RefundShell.tsx` | The Settings nav entry also shows with `receipt-code:manage`. |
| `src/strings.ts` | EN + IT strings (parity test). |

**auth**

| File | Change |
|---|---|
| `src/authz/catalogs/refund.ts` | NEW resource `receipt-code` ("Receipt code"), one action `manage` ("Manage"), `supportedConditions: []`. |
| `src/authz/seed.ts` | NEW `seedReceiptCodeGrants()`: `ensureGrant(accounting, "receipt-code", "manage")` and the same for `admin`, unconditioned, idempotent, never overwriting. Called from `seed()` after `seedSettingsAdminGrants`. Not granted to `refund-admin` or any other role (AC-4.9, see D12). |

**shell/e2e**: `global-setup.ts` § release uses the three-step procedure on the committed header-only
fixture (§ Release, deploy order).

**infra/README.md**: § Accounting release runbook, steps 6 to 8 rewritten (§ Runbook changes).
`.gitignore`: add `**/*pairing*.csv` and `**/Recap_RS*`.

### The release, step by step

```
bun run accounting:release --dry-run --register <xlsx> --propose <out.csv> [--sheet 2026] [--offsets <csv>] [--defaults <json>]   # propose
bun run accounting:release --dry-run --register <xlsx> --pairing <in.csv> [--sheet 2026] [--offsets <csv>] [--defaults <json>]    # check
bun run accounting:release           --register <xlsx> --pairing <in.csv> [--sheet 2026] [--offsets <csv>] [--defaults <json>]    # real run
```

`--show-emails` is removed: AC-5.6 allows no email in any output. It is refused as an unknown
argument, naming the reason. `--offsets` becomes optional and complements the register (AC-3.1).

Order of the run, which matches the order of the exit statuses:

0. **Released already?** One read of the marker, before anything else. If it is there, print "the
   release was already completed on <date>: nothing to do" and **exit 0**, whatever the inputs: no
   read of Accounting, auth or the files, and no write (AC-5.3). This also keeps the e2e global setup
   idempotent.
1. **Accounting** read first, unchanged → exit 2 (AC-2.1, 20261119 AC-7.4).
2. **auth** for missing owner names, unchanged → exit 4. Names now also feed the worker proposal.
3. **Inputs present?** A real run with no `--register` or no `--pairing` → **exit 5**, "run the dry
   run first", nothing written (AC-2.8). A dry run needs `--register` plus exactly one of
   `--propose` and `--pairing` (else exit 5). Path warnings go to stderr when a file is inside a git
   worktree (AC-5.6).
4. **Inputs readable?** The workbook (zip/XML/sheet/header), the pairing file (format version,
   columns) and `--offsets` (the existing parser) → **exit 6** on any failure, with no cell quoted.
5. **Stale?** (`--pairing` only) The fingerprint of the workbook ≠ the file's `register`, or the
   digest of the current pre-release lines ≠ the file's `lines` → **exit 7** "stale: run the dry run
   again" (AC-2.7).
6. **Decided?** (`--pairing` only) The pure validator (§ Pairing file, validation) → **exit 8**,
   listing each problem by line id, worker id or row position (AC-2.6, AC-1.5, AC-1.13, AC-1.14).
7. **Transaction** (real run, or check-mode dry run that rolls back): `pg_advisory_xact_lock`, then a
   re-check of the marker (if it is now there: exit 0 as in step 0). Then, before the first write,
   the DB-dependent checks: the pre-release line set inside the transaction equals the file's
   (else exit 7), and the codes as read now plus the shared-prefix rule (AC-4.11, else **exit 9**).
   Then the writes:
   1. owner names;
   2. defaults;
   3. baseline rows: one per employee email whose computed baseline is ≥ 1 and differs from the
      latest row (§ Counter continuation);
   4. per employee, `classifyAndNumber(cause: "release", paper: …)`;
   5. assert that every pre-release line now carries exactly one number and that every counter's
      `lastSeq` is baseline + new lines (AC-1.2), else throw (rollback, exit 1);
   6. the marker.
8. **Report** to stdout; exit 0. In propose mode, the pairing file is written with `O_EXCL` and mode
   0600 (an existing path is refused, exit 1, so a decided file is never overwritten), and steps 5 to
   7 are skipped. The report's per-employee "first new number" is computed, not numbered.

**Exit statuses** (AC-5.1; 2, 3 and 4 keep their meaning):

| Status | Meaning | Written |
|---|---|---|
| 0 | done; or dry run done (propose: file written; check: the real run would succeed); or already completed | real run: everything; else nothing |
| 1 | any other failure (usage, a pairing path that exists, an internal assertion, DB error), rolled back | nothing |
| 2 | Accounting unreadable | nothing |
| 3 | *retired*: "the offsets list is missing". `--offsets` is optional now, so it is never produced, and it is never reused for another meaning | — |
| 4 | auth unreadable for the owner names | nothing |
| 5 | register export or pairing file not given (real run), or a dry run without its mode | nothing |
| 6 | an input unreadable or malformed (workbook, sheet, header, pairing format, offsets) | nothing |
| 7 | stale: the workbook or the pre-release lines are not those of the pairing file | nothing |
| 8 | the pairing is not fully decided or is inconsistent | nothing |
| 9 | a new number would go to an employee who shares a prefix and holds no receipt code | nothing |

A check-mode dry run ends with the status the real run would end with (the precedent of 20261118
SO-13's blocked dry run). A propose-mode dry run ends 0 once the file is written. Its report says
plainly that N decisions are open and that the real run would refuse with 8.

### Register export: read the `.xlsx` directly (decision D1)

**Chosen: the release reads the accountant's `.xlsx`**, sheet `2026` by default (`--sheet`). Only
four columns are read, found by header text in the first 20 rows (trimmed, case-insensitive):
`Worker`, `No.`, `Date`, `Total`. Any other column is never kept. The duplicate `Description`
header is irrelevant.

Why not a CSV the operator exports:
- The match keys are the expense date and the total **to the cent**. In the workbook they are typed
  (a date serial, a numeric `<v>`). A CSV export goes through the locale: on a Swiss or Italian Excel
  that means `;` delimiters, `14.03.2026`, `24,50`, `1'234.50`, `CHF 24.50`, and a re-typed number
  can lose its cents. Those are exactly the failure modes that would turn exact matches into doubts,
  or worse, into wrong matches.
- A CSV export is one more copy of a personal-data file on a laptop. It is also one more manual step,
  only for the active sheet, and with an encoding choice that affects worker names.
- The fingerprint should be that of the accountant's own artefact, the file accounting can archive.

Cost, accepted: an in-house reader of about 300 lines, with no new dependency (the project avoids
them). It mirrors the existing hand-written writer.
- **ZIP**: read the end-of-central-directory record (scan the last 64 KiB), the central directory, and
  local headers. Supported: method 0 and method 8 (`inflateRawSync` with `maxOutputLength`).
  Refused, with a named reason (exit 6): ZIP64, encryption, other methods, more than 10,000 entries,
  a compressed file larger than 20 MiB, an entry that inflates beyond 64 MiB, a CRC mismatch.
- **XML**: a small tokenizer by local name, which accepts both transitional and strict namespaces.
  A `<!DOCTYPE` is refused (XXE, entity expansion: the precedent of the FX parser). It decodes the
  five predefined entities and numeric character references, nothing else. Parts read:
  `xl/workbook.xml` (sheet name → `r:id`, `workbookPr/@date1904`), `xl/_rels/workbook.xml.rels`,
  `xl/sharedStrings.xml` (`<si>`: the `<t>` of all runs `<r>` concatenated, `<rPh>` ignored), and
  the one worksheet. Styles are not needed: the Date column is known to be a date.
- **Cells**: types `s`, `str`, `inlineStr`, `n` (default), `b`, `e` (error → unreadable), `d`. A
  formula cell uses its cached `<v>`. A formula with no cached value is unreadable, and the report says
  "save the workbook in Excel so it stores computed values".
- **Merged ranges** (`<mergeCell ref>`): the top-left value is propagated over the range, the way a
  person reads the sheet (a worker cell merged over several rows, for example).
- **Date**: a numeric serial (1900 system with the 1900-02-29 quirk, or 1904) → `YYYY-MM-DD`. A text
  cell is accepted as `YYYY-MM-DD`, `DD.MM.YYYY` or `DD/MM/YYYY`. Anything else is unreadable.
- **Total**: a numeric `<v>` is rounded half away from zero to cents **on its decimal string**,
  never through a float multiplication (`1.0049999999999999` → 1.00, `24.5` → 24.50). A text total
  is accepted after stripping a currency code, spaces and `'` thousands separators, with `.` or `,`
  as the decimal mark (one only). Anything else is unreadable.
- **No.**: trimmed and upper-cased. Empty → no paper number. A match of `^[A-Z]{2,3}\d{2}/\d{1,5}$`
  → a paper number. Anything else → malformed, kept as its shape only.
- **Position**: the sheet row number as Excel shows it (`R37`), the only register reference ever
  stored or printed.

Rejected: a CSV export, for the reasons above. Also rejected: accepting both xlsx and CSV, which
gives two parsers and two fingerprint semantics for one release that runs once. If the reader refuses
a real workbook, the remedy is to save it again as `.xlsx` in Excel, and the propose-mode dry run is
the early check, run days before the release (R1). Also rejected: an xlsx dependency (`exceljs`,
`xlsx`), because of supply chain and size for a one-off read.

### Pairing (decision D2)

Inputs: the pre-release lines (WellD CH, not rejected, request `approved` or `paid`, unnumbered: the
existing `legacyLineWhere`), the register rows, the worker mapping, the excluded employees, and each
employee's current code and derived initials.

**Employees.** The pairing file lists every employee known to Refund (distinct `ownerUserId`) as
`E1…En`, ordered by user id. **Workers** are the distinct normalised `Worker` texts (trim, collapse
whitespace, case-fold, strip diacritics), listed as `W1…Wm` in order of first appearance. The
proposal maps a worker to an employee when exactly one employee's current name has the same
normalised word set (word order ignored, so `Rossi Anna` = `Anna Rossi`). With none or several, the
worker is left unresolved (AC-1.14). A person maps a worker to an `E<n>`, to an email (an employee not
yet in Refund, or one whose email is one of an employee's request emails, which resolves to that
`E<n>`), or to `not-operai`. Mapping is by employee, never by prefix: two employees with the same
prefix keep separate rows and sequences.

**Per line**, among the rows of the line's employee (excluded employees have none):
- *candidates* = rows with a readable date equal to the line's expense date;
- an *exact candidate* = a candidate with a well-formed paper number and a total equal, in cents, to
  the line's `approvedTotalCents`, compared in the line's own currency (open-question fallback).

Categories, first that applies:

| Category | Condition | Proposal (`proposed`, `proposedNumber`) | Pre-filled decision / state |
|---|---|---|---|
| `outside_2026` | expense year ≠ 2026 (AC-1.16) | `new` | `new` / `proposed` |
| `no_counterpart` | no candidate (AC-1.8) | `new` | `new` / `proposed` |
| `row_without_number` | every candidate has an empty number (AC-1.13) | `new` | — / `unresolved` |
| `split_receipt` | AC-1.6: two or more lines of the same employee and date, each with exactly one exact candidate, rows distinct, all carrying the same paper number; or AC-1.7: no exact candidate, but two or more candidates with the same paper number whose totals sum to the line's total | `split`, that number, group `S<k>` | `split` / `proposed` |
| `exact` | exactly one exact candidate, and that row is the exact candidate of no other line (AC-1.1) | `paper`, its number | `paper` / `proposed` |
| `several_candidates` | two or more exact candidates; or the row is the exact candidate of two or more lines; or no exact candidate and two or more distinct paper numbers among the candidates (AC-1.4, AC-1.7) | — (numbers listed in `reason`) | — / `unresolved` |
| `amount_differs` | one distinct paper number among the candidates, no exact one (AC-1.3) | that number (shown, not taken) | — / `unresolved` |
| `total_unreadable` | the only numbered candidates have an unreadable total (AC-1.13 "not matched automatically") | — | — / `unresolved` |

An `exact` or `split` line is then **demoted** to doubtful (decision blank, `unresolved`, proposal
kept for reference) when:
- `wrong_year`: the number's `yy` ≠ the expense year's (AC-1.10);
- `sequence_000`: seq is 0 (AC-1.11; proposal changed to `new`, in its own list);
- `prefix_differs`: the prefix is none of: the employee's code, the derived initials, the prefix of
  another `exact`/`split` number of the same employee (AC-1.12);
- `number_taken`: the same number, or the same (expense year, seq), is proposed for two lines of the
  employee outside one split group (AC-1.5). The seq rule exists because the DB's uniqueness is on
  the sequence (D4): `LG25/003` and `LG26/003` on two 2026 lines of one employee collide.

Rows with a number but **no worker** (after merge propagation) are listed like malformed rows and
must be acknowledged: they could hide a higher number, and no employee's maximum would see them.

The proposal is deterministic for the same inputs: lines are sorted by (employee, date, createdAt,
id), rows by position, and groups are numbered in that order. A unit test proves it.

### Pairing file (decision D3)

A CSV (RFC 4180, UTF-8 with BOM so Excel opens the names correctly), written by the propose mode
and decided by a person, usually in Excel. The reader is tolerant of what Excel does on save: the
delimiter is detected (`,` `;` tab, as in `parseCsvRows`, which moves to `operatorFiles.ts`),
headers and enum values are case-insensitive, and date or amount columns are informational and never
validated. Fingerprints carry a `sha256:` prefix so that Excel can never read them as numbers.

One header for every record:

```
record,id,label,employee,expenseDate,amount,currency,category,reason,proposed,proposedNumber,decision,paperNumber,split,state,registerRows
```

| `record` | `id` | Used columns | Decision values |
|---|---|---|---|
| `meta` | `format` / `register` / `sheet` / `lines` / `builtAt` | `label` = value: `operai-pairing/1`, `sha256:<hex of the workbook bytes>`, `2026`, `sha256:<hex of the sorted "lineId\|date\|approvedTotalCents\|currency" list>`, ISO time | — (never edited) |
| `employee` | `E<n>` | `label` = `<prefix> · <user id 8>` and the name, `employee` = the email of the newest request | blank (included) or `excluded` (AC-1.15); no state needed |
| `worker` | `W<n>` | `label` = the worker text as in the register, `employee` = the proposed `E<n>` | `decision` = `E<n>` \| an email \| `not-operai`; `state` |
| `line` | line id | `label` = `<prefix> · <user id 8>`, `employee` = `E<n>`, `expenseDate`, `amount`, `currency`, `category`, `reason` (for example `amount differs: line 24.50, row R37 26.00, AB26/005`), `proposed`, `proposedNumber`, `split`, `registerRows` (`R37 R38`) | `decision` = `paper` \| `new` \| `split`; `paperNumber` (for paper/split); `split` = `S<k>` (for split); `state` |
| `row` | `R<n>` | `category` = `malformed` \| `no_worker`, `label` = the cell's shape (`AA99/9A`) | `decision` = `acknowledged`; `state` |

`state` is one of `proposed` (pre-filled by the machine), `unresolved` (a person must decide) and
`confirmed`. **The real run accepts only `confirmed`** on every `worker`, `line` and `row` record
(D3). Exact matches are pre-filled and need one confirmation, which in Excel is a fill-down. That is
deliberate: AC-1.1 and AC-1.3 say a number is taken because the file confirms it.

**Validation** (pure, `pairingFile.ts`; each problem is named by id; all problems are reported
together → exit 8):
- `format` unknown → exit 6. Missing or unknown meta → exit 6.
- Every current pre-release line has exactly one `line` record, and no record names a line that is
  not one (AC-2.6). This is a file problem, exit 8, when the `lines` digest still matches; a changed
  DB is stale, exit 7.
- Every record is `confirmed` (AC-2.6 "unresolved").
- `paper` / `split`: `paperNumber` parses, and it appears on at least one register row mapped to the
  line's employee (D7). The line's expense year is 2026 (D6). The employee is not excluded
  (AC-1.15).
- `split`: every line of the group has the same employee, the same expense date and the same
  `paperNumber`. A group of one line is valid (AC-1.7) and records origin "paper, split". `new` is
  never in a group (AC-1.6 "a new number is never shared").
- No `paperNumber`, and no (year, seq), on two lines of one employee outside one group (AC-1.5).
- Every worker is mapped or `not-operai` (AC-1.14). A worker mapped to an excluded employee is
  refused. Every `row` is `acknowledged` (AC-1.13).
- An `--offsets` row for an excluded employee is refused (AC-1.15: nothing counts toward its baseline).

The real run's report lists every `line` whose decision differs from the proposal **recomputed**
from the workbook and the DB, never from the file's own `proposed` columns, which a person could
edit (AC-2.4).

Rejected: JSON (exact, but accounting cannot edit it comfortably). Also rejected: carrying earlier
decisions into a new proposal after a stale refusal. It saves typing, but it would silently reuse
decisions made against another register. A new proposal starts clean (AC-2.7).

### Counter continuation (decision D5)

For each employee, the **2026 baseline** is the maximum of (AC-3.1):
- the `--offsets` row of any of the employee's emails;
- the register rows mapped to the employee, paired or not. Each row counts as follows:
  - `yy = 26`: seq;
  - `yy ≠ 26`: seq when the row's date is in 2026, missing or unreadable, and nothing when the date
    is readable and outside 2026 (the rule of `receipt-baseline:from-register`);
  - seq 0, an empty number and a malformed number count for nothing;
- the seq of every number imported for the employee on a 2026 line (seq 0 excluded).

The release writes it as **one `receipt_number_baseline` row** per employee email (the mapped email,
or the employee's newest request email for a Refund-known employee) when it is ≥ 1 and not already
the latest value. The existing counter-creation path in `classifyAndNumber` then does the rest. It
reads the baseline across every email the user id has used (N-01), so the first new number is
baseline + 1, whether it is issued by the release or by a later approval. That covers employees with
paper-only lines and register-only employees not yet in Refund (AC-3.4). Other years have no
baseline and start at `001` (AC-1.16, AC-3.5). Paper numbers below the baseline that no line took
are never issued (AC-3.6), because the counter only moves forward.

The report lists, per employee, as `<prefix> · <ref>`: the offsets value, the register maximum, the
imported maximum, the baseline and the first new number. It flags each employee whose offsets row
differs from the register maximum (AC-3.1), and each employee with pre-release lines and no mapped
worker (AC-3.4).

### Prefixes and receipt codes (decision D8)

- **Prefix of a new number** = the employee's current receipt code, else `initials(name, email)` as
  today. It is read **once per `classifyAndNumber` call**, inside the transaction (plain read: the
  committed value at that moment). So all numbers of one approval share one prefix, either the old
  or the new one, never a mixture (AC-4.10). The sequence is the counter's, independent of the
  prefix (AC-4.4, AC-4.6). Imported numbers keep their paper text whatever the code (AC-4.12).
- **Set/change/clear** runs in one transaction:
  - `pg_advisory_xact_lock(hashtext('receipt-code:' || userId))`, so concurrent edits of one
    employee are serialised and `codeBefore` is exact;
  - validation (AC-4.2);
  - "in use" checks (AC-4.3): another `receipt_code` row with the code, or a `refund_line` of
    another employee whose `substring("receiptNumber" from '^[A-Z]+')` equals the code;
  - upsert or delete of `receipt_code`, then one `receipt_code_change` row.
  The unique index on `receipt_code.code` decides a race between two employees (P2002 → 409, so
  exactly one succeeds).
- **Validation**: the trimmed input must match `^[A-Za-z]{2,3}$` **before** upper-casing (so `ß`,
  which upper-cases to `SS`, is refused, and so are `ÀB`, `A B`, `A1`, `A` and `ABCD`). An empty or
  `null` value clears the code. Saving the current value is a 200 that writes nothing (the defaults
  precedent).
- **AC-4.11 at the release** (inside the transaction, with the codes read there):
  - for every employee E: `prefixes(E)` = {code ?? initials} ∪ {prefixes of E's register rows
    (2026, well-formed)} ∪ {prefixes of E's paper decisions};
  - E is **in a shared pair** when some other employee F has `prefixes(F) ∩ prefixes(E) ≠ ∅`;
  - the dry run lists every such E with no code;
  - the real run refuses (exit 9) when a `new` decision belongs to an E whose **new-number prefix**
    (code ?? initials) is in `prefixes(F)` of another F, or when E is in a shared pair with no code.
    An E whose lines are all `paper` is not blocked.
  Every Refund-known employee takes part, plus register-only employees (with their register prefixes).
  The excluded test account takes part with its derived prefix and code, so it needs its own code
  (AC-1.15, open question 2).
- **After the release** an employee who shares a prefix and has no code is **not refused** at
  approval (open-question fallback). The Settings list flags them ("shares initials", a count, no
  name of the other employee), so accounting sees it.
- **Accepted race**: a code set at the very moment another employee's first number is issued with
  derived initials equal to that code. The AC-4.3 check runs before the other number commits. The
  outcome is a shared prefix, which the fallback allows and the list flags, never a duplicate
  number (uniqueness is per owner). An advisory lock taken by every approval to close it was
  rejected: it serialises all approvals for a cosmetic case.

### Existing ADRs this plan builds on

- 20261118-receipt-numbers-come-from-a-row-locked-per-employee-and-year-counter-… (amended by ADR
  candidate A1: imported numbers, the split exception, the 4-column index).
- 20261118-accounting-classification-is-live-until-approval-then-frozen-… (copies written in the
  same `UPDATE` as the number, IS-1).
- 20260716-immutable-financial-audit-trail-refund and
  20260722-refund-settings-append-only-self-auditing-store (`receipt_code_change` is an append-only
  self-auditing history, `accounting_history_immutable()` triggers).
- 20261119-data-that-moves-…-an-applied-migration-is-never-edited (the migration adds and replaces
  functions, and never edits an applied migration).
- 20260713-authz-hand-rolled-rbac-abac-epoch-claims and 20260722-settings-catalog-permission-config-
  not-rate (a distinct resource, not a reuse of `settings:manage`).
- 20261118-a-dialog-that-renders-its-own-form-is-mounted-beside-the-form-never-inside-it.

### Trade-offs: chosen vs rejected

| Topic | Chosen | Rejected, and why |
|---|---|---|
| Register input | `.xlsx` read directly (D1) | CSV: locale-formatted keys and a manual step. A library: a dependency. Both formats: two code paths for a single run. |
| Pairing medium | CSV decided in Excel, all records `confirmed` (D3) | JSON: not editable by accounting. Implicit acceptance of exact matches: AC-1.1 asks for a confirming file. A UI: a spec non-goal. |
| Imported number storage | Paper text (trim + upper), `receiptYear` = expense year, `receiptSeq` = paper seq (0 allowed), `receiptOrigin` (D4) | Re-padding the text: it is no longer "as written". Storing the number's own `yy` as `receiptYear`: a wrong-year number would leave the 2026 sequence and could be repeated by a 2025 counter. |
| Split exception | `receiptSplitPart` in the unique key, plus a deferred trigger for group integrity (D4) | A partial unique index excluding splits: split lines would then be unconstrained and could share an issued number. Uniqueness on the text: weaker for the counter path, which relies on seq. |
| Baseline for the new rule | Reuse `receipt_number_baseline` (one row = max) and the counter-creation path (D5) | Creating counters directly in the release: a second path, and it misses employees not yet in Refund. |
| Code storage | Mutable current table with a unique `code`, plus an append-only change history (D8) | Append-only only (current = latest row): no unique index can express "current code unique". `refund_audit_entry`: its `requestId` is NOT NULL. |
| Capability | New resource `receipt-code:manage` (D12) | `settings:manage`: held by admin/refund-admin and not by accounting, and it would hand accounting the distribution mailbox and defaults. A `request` action: entity-scoped, while a code is per person. |
| Dry run mechanism | Propose mode computes; check mode runs the real transaction and rolls back (the R1 precedent), so the reported numbers are the real ones (AC-5.5) | A pure simulation in check mode: two implementations of numbering that could drift. |

## Data model

One migration, **`20261124090000_receipt_numbers_from_register`**, additive-or-safe. It touches no
applied migration. Production has no numbered line, no counter and no baseline row. Dev and test
databases do have numbered lines, hence the backfill.

```sql
-- 1. refund_line: origin and split part of a receipt number
ALTER TABLE "refund_line"
  ADD COLUMN "receiptOrigin"    TEXT,        -- 'issued' | 'paper' | 'paper_split'
  ADD COLUMN "receiptSplitPart" SMALLINT;    -- 1, or 2..n for further lines of a confirmed split receipt

-- 2. Backfill numbers issued before this migration (none on production). Guard v2 does not cover
--    these columns, so the UPDATE is allowed; it runs before guard v3 freezes them.
UPDATE "refund_line" SET "receiptOrigin" = 'issued', "receiptSplitPart" = 1 WHERE "receiptNumber" IS NOT NULL;

-- 3. CHECKs
ALTER TABLE "refund_line"
  ADD CONSTRAINT "refund_line_receipt_origin_all_or_none"
    CHECK (num_nonnulls("receiptNumber", "receiptOrigin", "receiptSplitPart") IN (0, 3)),
  ADD CONSTRAINT "refund_line_receipt_origin_known"
    CHECK ("receiptOrigin" IN ('issued', 'paper', 'paper_split')),
  ADD CONSTRAINT "refund_line_receipt_split_part"
    CHECK ("receiptSplitPart" >= 1 AND ("receiptSplitPart" = 1 OR "receiptOrigin" = 'paper_split')),
  ADD CONSTRAINT "refund_line_receipt_seq_range"
    CHECK (("receiptOrigin" = 'issued' AND "receiptSeq" BETWEEN 1 AND 99999)
        OR ("receiptOrigin" <> 'issued' AND "receiptSeq" BETWEEN 0 AND 99999)),
  ADD CONSTRAINT "refund_line_receipt_number_shape"
    CHECK ("receiptNumber" ~ '^[A-Z]{2,3}[0-9]{2}/[0-9]{1,5}$');

-- 4. Uniqueness: create the new key first, then drop the old one (same transaction)
CREATE UNIQUE INDEX "refund_line_receiptOwnerUserId_receiptYear_receiptSeq_receiptSplitPart_key"
  ON "refund_line" ("receiptOwnerUserId", "receiptYear", "receiptSeq", "receiptSplitPart");
DROP INDEX "refund_line_receiptOwnerUserId_receiptYear_receiptSeq_key";

-- 5. Guard v3: CREATE OR REPLACE FUNCTION refund_line_accounting_guard(), the body of v2 with
--    "receiptOrigin" and "receiptSplitPart" added to the frozen set of (a).

-- 6. Split integrity, checked at COMMIT (both lines of a group are written in one transaction):
CREATE FUNCTION refund_line_split_receipt_check() RETURNS TRIGGER ...
--   for NEW with receiptOrigin = 'paper_split' OR receiptSplitPart > 1, the group
--   (receiptOwnerUserId, receiptYear, receiptSeq) must have: a member with part 1; every member
--   'paper_split'; one receiptNumber; one "date". Else RAISE.
CREATE CONSTRAINT TRIGGER refund_line_split_receipt
  AFTER INSERT OR UPDATE OF "receiptNumber", "receiptOrigin", "receiptSplitPart" ON "refund_line"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refund_line_split_receipt_check();

-- 7. Receipt codes
CREATE TABLE "receipt_code" (
  "ownerUserId"     TEXT PRIMARY KEY,
  "code"            TEXT NOT NULL,
  "updatedByUserId" TEXT NOT NULL,
  "updatedByEmail"  TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "receipt_code_shape" CHECK ("code" ~ '^[A-Z]{2,3}$')
);
CREATE UNIQUE INDEX "receipt_code_code_key" ON "receipt_code" ("code");

CREATE TABLE "receipt_code_change" (            -- append-only, its own audit trail (AC-4.7)
  "id"              TEXT PRIMARY KEY,
  "ownerUserId"     TEXT NOT NULL,
  "codeBefore"      TEXT,
  "codeAfter"       TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdByEmail"  TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "receipt_code_change_shape" CHECK (("codeBefore" IS NULL OR "codeBefore" ~ '^[A-Z]{2,3}$')
                                            AND ("codeAfter"  IS NULL OR "codeAfter"  ~ '^[A-Z]{2,3}$')),
  CONSTRAINT "receipt_code_change_changes" CHECK ("codeBefore" IS DISTINCT FROM "codeAfter")
);
CREATE INDEX "receipt_code_change_ownerUserId_createdAt_idx" ON "receipt_code_change" ("ownerUserId", "createdAt");
CREATE TRIGGER receipt_code_change_no_update BEFORE UPDATE ON "receipt_code_change"
  FOR EACH ROW EXECUTE FUNCTION accounting_history_immutable();
CREATE TRIGGER receipt_code_change_no_delete BEFORE DELETE ON "receipt_code_change"
  FOR EACH ROW EXECUTE FUNCTION accounting_history_immutable();
```

Notes:
- `receipt_code` is **mutable on purpose** (UPDATE and DELETE allowed). Its history is the
  append-only `receipt_code_change`. A code cleared = row deleted, plus a change row `(X → null)`.
- `receipt_counter` and `receipt_number_baseline` are unchanged (CHECK year 2026, seq 1..99999).
  The release writes `startAfterSetBy = 'baseline'` through the existing path.
- No `AuditAction` change: the release audits with `receipt_number_assigned`, the richer detail
  above, actor `system:accounting-release`, cause `release`. No register content beyond row
  positions and the paper number (AC-1.17).
- `schema.prisma`: `RefundLine.receiptOrigin String?`, `receiptSplitPart Int? @db.SmallInt`,
  `@@unique([receiptOwnerUserId, receiptYear, receiptSeq, receiptSplitPart])`; models `ReceiptCode`
  and `ReceiptCodeChange`. The drift tests (`db.accounting-signoff.test.ts` pattern) gain a sibling
  that pins the hand-written SQL.
- Readers untouched: the export orders by `receiptYear, receiptSeq` and then line id, so a split
  pair is stable. `export.ts` already allows seq ≥ 0. `compareReceiptNumbers` and
  `compressReceiptNumbers` (batch PDF) parse any prefix and de-duplicate, so a split receipt is
  listed once and `LC26/039, LCX26/040` stay two prefixes.
  `scripts/accounting-release.ts`' `slice(2, 4)` and `/^[A-Z]{2}/` go with its rewrite.

## API contracts

All under refund-api, mounted like the defaults routes. Middleware order: `noStoreHeaders`, then
`bodyLimit(1 KiB)`, then `jwtMiddleware`, then `authzMiddleware`, then the capability gate
`receipt-code:manage` for **every** method (AC-4.9: reading is gated too), and only then body
validation. Errors are RFC 7807, `instance` = route pattern (no ids).

### `GET /accounting/receipt-codes`

Employees known to Refund (at least one request, any status), ordered by name then user id.

```jsonc
200 {
  "employees": [{
    "userId": "ck…",
    "name": "Anna Rossi",             // newest request's ownerName; null when none
    "email": "anna.rossi@welld.ch",   // newest request's ownerEmail (accounting already sees it in review)
    "initials": "AR",
    "code": "ARO" | null,
    "prefix": "ARO",                  // code ?? initials: what the next number uses
    "prefixSource": "code" | "initials",
    "lastNumber": "AR26/039" | null,  // highest (year, seq) numbered line, as issued
    "changedAt": "2026-11-25T08:12:00.000Z" | null,   // DS-2: newest receipt_code_change (a clear included); null when none
    "changedByEmail": "x@welld.ch" | null,            // DS-2: that change's createdByEmail
    "sharesPrefix": true              // DS-8: `prefix` equals another employee's code, or that employee's initials
                                      // when it has no code, or the prefix of a number issued or imported to it
  }]
}
403 { code: "forbidden" }             // no receipt-code:manage
```

### `PUT /accounting/receipt-codes/{userId}`

```jsonc
// body: strict object
{ "code": "lcx" }        // set or change (normalised to "LCX")
{ "code": "" } | { "code": null }   // clear
200 { ...the employee row above }   // also when unchanged (no history row written)
404 { code: "employee_not_found" }  // no request with that ownerUserId
422 { code: "receipt_code_invalid", detail: "A receipt code is two or three letters A–Z" }   // AC-4.2; also a body with another key
409 { code: "receipt_code_in_use",  detail: "This code is already in use" }   // AC-4.3, both causes, names nobody
403 { code: "forbidden" }
```

### `GET /accounting/receipt-codes/{userId}/history`

```jsonc
200 { "entries": [{ "codeBefore": "LC" | null, "codeAfter": "LCX" | null,
                    "changedBy": { "userId": "…", "email": "…" }, "changedAt": "2026-11-25T08:12:00.000Z" }] }  // newest first
404 { code: "employee_not_found" }
403 { code: "forbidden" }
```

### Unchanged contracts, wider values

`receiptNumber` on every existing response stays `string | null` and may now carry three letters
(`LCX26/040`). Approval answers are unchanged; 409 `accounting_release_pending` holds until the
release (AC-5.4).

### UI surface (refund-ui Settings → "Receipt codes")

- One card: "Receipt codes". An intro sentence says that a code replaces the initials in new numbers
  only, and that issued numbers never change.
- Table columns (design S2): Employee (name, else email), Code, Prefix in use (mono; the code, or the
  initials with a "from initials" hint), Last number (mono), Last changed (DS-2), Status (a badge
  "Shares prefix" whenever `sharesPrefix`, DS-8), then actions. **Set code** / **Change** open
  `ReceiptCodeDialog`, which has one field (no `maxLength`, a–z upper-cased as typed, client check
  matching AC-4.2), a 422 shown on the field, a 409 shown as "This code is already in use". **Clear**
  is a row action of its own, shown only when a code is set, that opens a `ConfirmDialog`; an empty
  field in the dialog never clears (design RC-4, RC-6; updated by design sync DS-3). **History**
  opens the existing `ChangeHistoryDrawer`, fetched on open, with its loading and error states
  (DS-4), showing before → after, who and when.
- The page has no read-only mode: without the capability the section does not exist (AC-4.9, fail
  closed until the shell resolves permissions). The designer may refine layout and copy; the
  behaviours above are the contract.

## Test strategy

Levels:
- **unit**: pure modules under `bun test` (reader, register, pairing, pairing file, report, baseline,
  prefix rules, validators).
- **int**: refund-api against the isolated Postgres (`operai-expense-analysis-pg` :5445, database
  `refund`). `runAccountingRelease` runs in-process with fake Accounting and auth ports and
  synthetic workbooks from `test-support/registerWorkbook.ts`, built from synthetic names only.
- **db**: direct-SQL adversarial tests (`src/lib/db.receipt-register.test.ts`) and a migration test
  on a scratch database holding numbered lines (`refund_mig`).
- **cli**: `scripts/accounting-release.cli.test.ts` spawns the script for exit statuses and output
  privacy.
- **auth**: catalog and seed tests.
- **ui**: refund-ui Vitest.
- **e2e**: an owner step (the e2e stack runs on the shared dev Postgres).

The AC → test mapping is **total**: every AC of the spec maps to at least one test below.

| AC | Level | What proves it |
|---|---|---|
| AC-1.1 | unit, int | Pairing: one exact candidate → `exact`, `AB26/005`, pre-filled, `proposed`. Int: proposal file row as stated; real run on the confirmed file → line `receiptNumber = "AB26/005"`, origin `paper`, seq 5, year 2026. |
| AC-1.2 | int | After the real run: every pre-release line has one non-null number; no line with `paper` also got a counter number (counter `lastSeq` = baseline + count(`new`)); `receipt_number_assigned` rows = pre-release lines, one each. |
| AC-1.3 | unit, int | Same date, other amount → `amount_differs` with both amounts and the number in `reason`, decision blank, `unresolved`. Int: unresolved → exit 8; confirmed `paper` → takes it. |
| AC-1.4 | unit | Two exact candidates → `several_candidates` with both numbers; one row exact for two lines → both doubtful; nothing pre-filled. |
| AC-1.5 | unit, int | Same number proposed for two lines outside a split → `number_taken` on both. Also the seq-collision variant (`LG25/003` vs `LG26/003`). Int: a file giving one number to two lines → exit 8 naming both line ids, DB unchanged (table-count snapshot). |
| AC-1.6 | unit, int, db | Two lines, same date, two exact rows with `FR26/002` → `split_receipt` group `S1`. Real run → both `FR26/002`, origin `paper_split`, parts 1 and 2. Validator refuses a group with two dates, two numbers or two employees, and `new` in a group. db: a part 2 with another number, another date, or attached to an `issued` part 1 fails at COMMIT; a second part 1 violates the index. |
| AC-1.7 | unit, int | One line, two rows with the same number summing to the total → `split_receipt` (group of one); confirmed → the number once, origin `paper_split`. Different numbers → `several_candidates`; the number not picked still raises the baseline (int: next new = max + 1). |
| AC-1.8 | unit, int | No candidate → `no_counterpart`, proposed `new`. Int: `proposed` (not `confirmed`) → exit 8; confirmed → new number. |
| AC-1.9 | unit, int | A row no line pairs with: counted in the report, nothing written for it, included in the baseline (int: baseline row value). |
| AC-1.10 | unit, int | Candidate `LG25/003` on a 2026 expense → demoted to `wrong_year`, unresolved. Baseline counting table (date in 2026, missing, unreadable, outside 2026). Int: confirmed as written → stored `LG25/003`, `receiptYear 2026`, seq 3; confirmed `new` → a new number. |
| AC-1.11 | unit, int | `AB26/000` → `sequence_000` list, proposal `new`, never counted in a maximum. Int: confirmed as written → stored, seq 0 (CHECK allows it for paper); otherwise a new number. |
| AC-1.12 | unit | Prefix equal to the code, the initials, or another exact number's prefix → not doubtful. None of those → `prefix_differs`. A prefix not the code but that of the other paper numbers → not doubtful. |
| AC-1.13 | unit, int | Empty number: never proposed, never counted; a line whose only candidate is such a row → `row_without_number`, proposal `new`, unresolved. Row with a number but no readable date → listed, counted, not matched. Unreadable total → `total_unreadable`. Malformed → `row` record with its shape only. Int: unacknowledged → exit 8; acknowledged → runs. |
| AC-1.14 | unit, int | Worker proposal: unique name match, none, several (two employees with the same name). Mapping by email resolves to the employee across request emails. Int: an unmapped worker → exit 8; `not-operai` accepted; two employees with the same prefix keep separate sequences (two counters, each from its own register max). |
| AC-1.15 | int | Excluded employee: no row paired, the baseline ignores the register rows, its lines get `..26/001` onward with its code. Without a code and sharing initials → exit 9. A `paper` decision for it → exit 8; an offsets row for it → exit 8. |
| AC-1.16 | unit, int | A 2025 line → `outside_2026`, proposed `new`. Confirmed → `XX25/001` from its own counter. A `paper` decision on it → exit 8. |
| AC-1.17 | int | Audit detail of each origin: `{cause:"release", origin:"paper", registerRows:[37]}`, `"paper_split"` with `splitPart`, `"new"`; actor `system:accounting-release`. A whitelist test of the detail keys; a scan of every refund table for the synthetic worker names and descriptions finds nothing. |
| AC-1.18 | db, int | Within (owner, year), duplicate seqs are refused except a confirmed split. Guard v3: UPDATE of `receiptOrigin`/`receiptSplitPart`/number on a numbered line raises; DELETE raises. |
| AC-2.1 | int | Propose mode: the fake Accounting port is called before the workbook is read (call order), a failing port → exit 2 and no file. Row counts of every refund table (audit, setting, baseline, counter, line receipt columns) are equal before and after; the file exists with mode 0600; the report is printed. |
| AC-2.2 | unit | Report from a fixture covering every category: counts per category and reason, codes needed, the per-employee highest seq and first new number, and doubtful lines with id, date, amount, currency and reason. Snapshot test. |
| AC-2.3 | unit | Writer: header, one record per pre-release line with every listed column, exact pre-filled `proposed`, doubtful `unresolved`, worker mapping records, meta `register` = SHA-256 of the bytes. A round trip through the reader, including a `;`-delimited Excel re-save variant. |
| AC-2.4 | unit, int | Validator accepts `paper` (a number present for that employee), `new`, `split`. A number absent from the register → named. Int: the real-run report lists the changed exact match under "differs from the proposal", compared with the recomputed proposal, not the file's columns. |
| AC-2.5 | int | Real run with the same workbook and the confirmed file: every number written in one transaction (injected failure after the first employee → nothing persisted, see AC-5.2). |
| AC-2.6 | unit, cli | One test per problem (line missing, unresolved, extra line, number not in register, number on two lines, malformed unacknowledged), each named by id; cli → exit 8. |
| AC-2.7 | int, cli | One byte of the workbook changed → exit 7 "stale". A request approved into the pre-release set after the proposal (fixture inserted directly) → exit 7. A new proposal then succeeds. |
| AC-2.8 | cli | Real run without `--register`, or without `--pairing` → exit 5 with "run the dry run first", nothing written; `--offsets` alone → exit 5. |
| AC-2.9 | int | Check mode with the confirmed file: the report lists each line's number; DB unchanged; those numbers equal the real run's (AC-5.5). |
| AC-3.1 | unit | Baseline table-driven: offsets only / register only / imported only / all three; wrong-year rules; `000`; malformed; empty number. Report lists offsets ≠ register max. |
| AC-3.2 | int | Register `AB26/001`–`040`, `021` and `022` unmatched, one `new` line → `AB26/041`; the next two `new` lines → `042`, `043`. |
| AC-3.3 | int | Three `new` lines of one employee numbered by expense date, then createdAt, then id. |
| AC-3.4 | int | Register-only employee (Refund-known and not-yet-in-Refund): baseline row written; a later approval of their first 2026 line continues after it. An employee with lines and no rows → `001`, listed in the report. |
| AC-3.5 | int | After the release, a 2027 line approval → `<prefix>27/001`. |
| AC-3.6 | int | The set of numbers written ∩ unpaired paper numbers below the baseline = ∅; later approvals continue above the baseline. |
| AC-4.1 | int | PUT with the capability saves; the next approval of that employee uses the code. |
| AC-4.2 | unit, int | Validator table: `A`, `ABCD`, `A1`, `ÀB`, `A B`, `ßA`, ` lcx ` (accepted → `LCX`). Int: 422 names the reason; no `receipt_code`/`receipt_code_change` row. Empty and `null` clear. |
| AC-4.3 | int | 409 when another employee holds the code; 409 when another employee has an issued or imported number with that prefix; the body names no one (asserts on the other's name, email and user id). Two concurrent PUTs of one code for two employees → one 200, one 409. |
| AC-4.4 | unit, int | `formatReceiptNumber("LCX", 2026, 40)` → `LCX26/040`. Int: imported `LC26/039` (baseline 39), code `LCX`, approval → `LCX26/040`; `LC26/039` unchanged in the line, request, batch and export reads. |
| AC-4.5 | int | Code `LCX`, 2027 line → `LCX27/001`. |
| AC-4.6 | int | Change `LCX`→`LCY` and then clear: the following numbers `LCY26/041`, then `LC26/042`; earlier lines unchanged. |
| AC-4.7 | int, db, ui | History rows (before, after, actor, time) for set/change/clear; none for a no-op save. The list row's `changedAt`/`changedByEmail` are those of the newest change, a clear included, and null for an employee never changed (DS-2). db: UPDATE/DELETE of `receipt_code_change` raises. UI: the drawer's loading, error (Retry) and loaded states (DS-4). |
| AC-4.8 | unit, ui | `exportFormat` Description `Cancelleria [LCX26/040] <name>`; batch PDF `compressReceiptNumbers` with mixed `LC`/`LCX` and a split duplicate; every receipts line of the rendered PDF fits its column for `LCX26/014–016`, `LCX26/1000–1002` and `LCX26/99998–99999` (DS-7). UI: `ReceiptNumber` renders `LCX26/040` as is; the batch employee list shows the name beside it. |
| AC-4.9 | int, auth, ui | 403 on GET/PUT/history without the capability, nothing changed. auth seed test: `accounting` and `admin` hold `receipt-code:manage`, and no other system role (`refund-admin`, `employee`, …). A second seed changes nothing. UI: section and nav hidden without it. |
| AC-4.10 | int | Two connections with a barrier: a code PUT and an approval of the same employee. The number's prefix is wholly old or wholly new; the counter has no gap and no repeat (repeated 20×). |
| AC-4.11 | unit, int | Shared-prefix analysis (derived, register-mapped, imported). Dry run lists codeless members. Real run with a `new` for a codeless member → exit 9, nothing written. A member whose lines are all `paper` → not blocked. |
| AC-4.12 | int | The release's new numbers carry the code in force; check-mode output shows it; a paper number keeps its text when the employee holds a different code. |
| AC-5.1 | cli | A matrix of every refusal family → its own status (2, 4, 5, 6, 7, 8, 9), with a DB snapshot unchanged (no number, counter, baseline, default, owner name, marker or audit row). |
| AC-5.2 | int | Fault injection: a test hook throws after the first employee is numbered → rollback; the rerun on the same inputs completes. |
| AC-5.3 | int, cli | After completion: real run with no inputs, wrong inputs or the right ones → exit 0, "already completed", and no read of the Accounting or auth fakes (call counts 0), no write. |
| AC-5.4 | int | Existing gate tests, plus: approval → 409 before the real run (also after a dry run); 200 after. |
| AC-5.5 | int | Check-mode numbers = real-run numbers, line by line. |
| AC-5.6 | cli | A fixture with synthetic names, emails, descriptions and reasons: stdout and stderr of every mode and of every refusal contain none of them, and no amount of a non-doubtful row. Employees appear as `<prefix> · <8>`. A path inside a temporary git repo → warning on stderr. `--show-emails` → refused. |
| AC-5.7 | int | WellD Italia lines of approved requests stay unnumbered after the release; a post-release approval, batch compile and export run (existing suites green). |

Fixtures: `test-support/registerWorkbook.ts` builds a workbook from rows of
`{ worker, number, date, total }`, with options for a deflated zip, rich-text shared strings,
inline strings, formula cells with cached values, date serials (1900 and 1904), merged worker cells,
a `<!DOCTYPE>` (refused) and a zip bomb (refused). The 88-line production shape is reproduced
synthetically: 9 employees, 77 exact, 8 amount-differs, 3 unmatched, two `LC` and two `FR`
employees, a `FR26/002` split, `LG25/001`–`007` then `LG26/008`, one `..26/000`, statement rows
without a date or number, and a test account. A workbook saved by real Excel with synthetic data is
**an owner step** (R1); the propose-mode dry run on the real register is the definitive reader test.

## Risks

| # | Risk | Mitigation / early check |
|---|---|---|
| R1 | The reader meets a workbook feature it does not handle (for example a formula without a cached value, or a strict-OOXML quirk). | It refuses loudly (exit 6) with the feature named, never a cell. **Run the propose-mode dry run on the real register days before the release day.** Remedy: save it again as `.xlsx` in Excel. |
| R2 | Float totals in the workbook (`24.499999999999996`) mis-round. | Rounding is done on the decimal string. Any residual mismatch lands in `amount_differs`, which a person decides: it fails safe, never wrong. |
| R3 | A wrong worker mapping makes an employee's new numbers start below their paper numbers. | Employees appear as `E<n>` records and are mapped by id or by any of their request emails. The report lists employees with lines but no worker, workers mapped to "not yet in Refund", and offsets ≠ register max. The DB index stops an exact repeat with an imported number. |
| R4 | The swap of the unique index on `refund_line`. | No numbered line in production; the new index is created before the old one is dropped, in one transaction. The migration test runs on a database with numbered lines (backfill, CHECKs, index). |
| R5 | Hand numbering continues after the export (open question "cut-off"), so a Refund number can repeat a later hand number. | Runbook: take the export on release day and record its last date in the report. Accounting stops hand-numbering Refund expenses from the release. A process matter, flagged in the report header. |
| R6 | The pairing file is mangled by an Excel round trip. | Tolerant reader (delimiter, BOM, case); ids and fingerprints protected as text (`sha256:` prefix, cuid ids, `E<n>`/`W<n>`/`R<n>`); informational columns are never validated. A round-trip unit test. |
| R7 | Codes change between the check dry run and the real run. | The real run reads the codes in its own transaction and prints every number; the runbook freezes code edits between steps 7 and 8. |
| R8 | The e2e global setup or local dev breaks because the real run now needs a register and a pairing file. | The setup uses the committed header-only fixture, proposes, confirms `proposed` records and runs. It fails, naming the cause, when the dev DB has doubtful lines or a shared prefix. Released DBs exit 0 at step 0. |
| R9 | The deferred split trigger raises only at COMMIT. | The release validates splits before writing; the trigger is a backstop. db tests cover each violation at COMMIT. |
| R10 | Accounting needs time to decide 11+ doubtful lines; approvals stay blocked meanwhile. | Inherent and accepted by the spec (approvals blocked until settled). The rollout itself adds no blocking: the gate is unchanged. |
| R11 | The register maps a person to a worker the proposal cannot match (spelling). | They stay unresolved and the real run refuses (exit 8) until a person maps them. No silent default. |

## Security

**Security-sensitive: YES.** The `orchestrator` schedules an `owasp-reviewer` pass in parallel with
QE, **standard tier**. The data is personal and financial (names, expense amounts and dates in the
register) but not a regulated category. Escalate to the frontier tier only if the review finds
register content reaching a log, the DB or a response.

Why: the feature parses an untrusted binary file (zip/XML), processes personal data outside the
repository, adds a capability and three endpoints, changes the uniqueness and immutability rules of
a financial record, and widens a system actor's writes.

Surfaces to review:
1. **`scripts/release/xlsxReader.ts`**: zip bomb caps, ZIP64/encryption refusal, CRC checks,
   DOCTYPE/entity refusal, no recursion on attacker-controlled depth, and error messages that quote no
   cell (A04, A05, A08).
2. **`scripts/accounting-release.ts` and `scripts/release/report.ts`**: no name, email, worker text,
   description or non-doubtful amount in stdout, stderr or thrown messages (AC-5.6); the
   `describeReleaseFailure` rule kept; `--show-emails` removed; the pairing file written with
   `O_EXCL` and 0600; git-worktree warnings for every input path; `.gitignore` additions (A09).
3. **`GET/PUT /accounting/receipt-codes*`**: `receipt-code:manage` on every method, before body
   validation; the actor from the JWT only; the body limit; the 409 naming no other employee
   (enumeration: it reveals only that a code is in use, which is the point); the list's exposure of
   names and emails to the capability holders only (A01).
4. **Migration**: the index swap, CHECKs, guard v3 (no column of the receipt left mutable), the split
   trigger (a `paper_split` cannot attach to an issued number), and `receipt_code_change`
   append-only (A08).
5. **auth seed**: the new grants go to `accounting` and `admin` only, never overwrite, unconditioned;
   the catalog declares no condition (A01).

## Release, deploy order and runbook changes

### Deploy order

One release cut per RELEASING.md: auth minor, refund-api minor (0.5.0), refund-ui minor. One push
redeploys them in no fixed order, and every pairing fails closed:

| Pairing during the window | What happens |
|---|---|
| refund-api before auth's seed | `receipt-code:manage` is held by nobody: the routes answer 403 and refund-ui hides the section. Approvals are 409 anyway (gate). |
| refund-ui before refund-api | The section is hidden until the capability resolves; if shown, the API 404s and the card shows its load error. |
| refund-api migration | Additive; `preDeploy` runs `db:deploy`. The old refund-api ignores the new columns, which are nullable. |

As in earlier rollouts, **auth must be live with the new seed before accounting sets codes**. The
step below checks auth's seed log for the receipt-code grant. Holders may need a fresh session (new
`perm_epoch`) before the capability shows.

### Runbook changes (infra/README.md § Accounting release runbook)

Steps 0 to 5 stand. Step 0's "baseline list is a release input" paragraph is replaced by "the
register export (`Recap_RS_2026.xlsx`, taken on release day, kept outside any git worktree) is the
release input; `--offsets` is optional". The old step 6 (Seed Accounting) stands unchanged if not
done yet. Steps 6 to 8 become:

- **Step 6 — Receipt codes.** auth's deploy log shows `… + receipt-code grants`. Accounting opens
  Refund → Settings → Receipt codes and sets the codes agreed on 2026-11-24 (LCM/LCP for the two
  "LC" employees, FRO/FRI for the two "FR" employees, and a code for the owner's test account). The
  list then shows no "Shares initials" badge for anyone who will receive a new number. No code edits
  from here until step 8 has run.
- **Step 7 — Dry run with the register, then the pairing.**
  1. Propose:
     `railway run … sh -c 'DATABASE_URL=… ACCOUNTING_INTERNAL_URL=… AUTH_BASE_URL=… bun run accounting:release --dry-run --register ~/Recap_RS_2026.xlsx --propose ~/pairing-2026.csv'`
     Expect exit 0. Read the report: counts per category, unmapped workers, codes needed, and per
     employee the highest seq and the first new number.
  2. Accounting decides `~/pairing-2026.csv`:
     - map every worker (`E<n>`, an email, or `not-operai`);
     - mark the test account's `employee` record `excluded`;
     - decide every doubtful line (`paper` + number, `new`, or `split` + group);
     - acknowledge malformed and worker-less rows;
     - set every `worker`, `line` and `row` record to `confirmed`.
  3. Check: the same command with `--pairing ~/pairing-2026.csv` instead of `--propose …`. Expect
     exit 0 and the full list of numbers each line will receive, which accounting reads and keeps.
     Exit 7: the register or the lines changed, so go back to 7.1. Exit 8: the listed problems.
     Exit 9: a code is missing (step 6).
- **Step 8 — Real run, then check.** The same command as 7.3 without `--dry-run`. Then `echo "exit
  $?"`, using the exit table above. 0 = released: the first WellD CH approval succeeds and its
  number carries the employee's code or initials after the baseline. A rerun prints "already
  completed" and exits 0. Then:
  - remove `users.contact` from refund-api's `SERVICE_CLIENTS` entry (unchanged rule);
  - accounting archives the confirmed pairing file and the report in its own records, outside
    Operai;
  - delete the local copies of the register export and the pairing file.

The `receipt-baseline:from-register` step disappears from the runbook. The exit-code paragraph of
the old step 7 is replaced by the table above.

### e2e and local

`shell/e2e/global-setup.ts` `releaseRefundAccounting()`:
1. run `--dry-run --register refund-api/scripts/fixtures/synthetic-register-header-only.xlsx
   --propose <tmp>/pairing.csv`. If the output says "already completed", stop;
2. rewrite every `proposed` state to `confirmed` in the setup's own code. If any `unresolved`
   remains, fail and name the command to inspect it;
3. run the real run with `--pairing`.

The temporary directory (mode 0700) is removed whatever the outcome. `AGENTS.md`,
`refund-api/.env.example` comments and `refund-api/CHANGELOG.md` follow. `EMPTY_BASELINE_CSV` stays
for the tests that exercise `--offsets`.

## Design sync (2026-11-24)

Synced unattended with `design.md` § Gaps found (G1–G9) after the design was written. Each entry
below is `DS-n` for gap `Gn`, plus DS-10 for the task split. Decisions D1–D15 stand. Where this
section changes a sentence of the plan above, that sentence is edited in place and marked `DS-n`.
Where it departs from the design, this section wins and the frontend tasks follow it (the design
keeps its text; the departure is DS-8 only).

| # | Gap | Resolution |
|---|---|---|
| DS-1 | G1: the shared-prefix flag was called "decision 10" | Wording only. The decision is **D13** (post-release shared prefix: not refused, flagged in the Settings list only). D10 is `--show-emails` removed. |
| DS-2 | G2: no last change in the list | `GET /accounting/receipt-codes` rows (and the PUT 200 body, which is the same row) gain `changedAt: string \| null` and `changedByEmail: string \| null`, from the employee's **newest `receipt_code_change`**, a clear included. Both are null when the employee has no change row. One query, `DISTINCT ON ("ownerUserId") … ORDER BY "ownerUserId", "createdAt" DESC, "id" DESC`, served by the existing `(ownerUserId, createdAt)` index. The email is shown to capability holders only, as the history already does. Not taken from `receipt_code.updatedAt`, which disappears with a clear. |
| DS-3 | G3: where Clear lives | **Clear is a row action** with its own `ConfirmDialog` (design RC-4), shown only when a code is set. The Set/Change dialog has no Clear, and an empty field never clears there (RC-6). The API still clears on `""` and `null` (AC-4.2). The field has **no `maxLength`** and upper-cases only `a–z` as typed (RC-5), so a pasted `ABCD` is shown and refused rather than truncated to a valid wrong code. The plan's UI-surface sentence is updated. |
| DS-4 | G4: the history drawer | `ChangeHistoryDrawer` gains two optional props, `loading?: boolean` (renders `SkeletonRows` and one polite line, `settings.history.loading`) and `error?: { message: string; onRetry: () => void }` (renders `ErrorBanner` with Retry inside the drawer). With neither, it behaves exactly as today, so the defaults history is unchanged. The receipt-code caller fetches `GET …/{userId}/history` when the drawer opens, maps each entry to `{ at: changedAt, byEmail: changedBy.email, before: codeBefore, after: codeAfter }` and **reverses** the newest-first API order into the drawer's oldest-first input (the drawer reverses again). Added to the refund-ui file table. |
| DS-5 | G5: no search or paging | Accepted (design RC-10). The list is the company's employees who have filed (tens to low hundreds). A name filter is the first thing to add past about 100 rows; no API change is needed for it. |
| DS-6 | G6: a flash of General before permissions resolve | **No flash inside the shell, and no change needed there.** Read from `shell/src/lib/session.ts` and `shell/src/router.tsx`: `usePermissions()` exposes **no resolved flag** (it returns `EMPTY_PERMISSIONS` both before resolution and after a failed `/authz/me`, which are indistinguishable by design: "absence = no access"). But the shell's tool-route guard (`createToolAccessBeforeLoad`) force-revalidates `/authz/me` on a cold cache or an app switch **before** it mounts the refund remote, and `usePermissions()` initialises from that warm cache synchronously. So on the first render of `SettingsPage` the user's capabilities are already the resolved ones, and a holder of only `receipt-code:manage` gets the Receipt codes view on the first render, without General ever mounting. Decision: `SettingsPage` keeps deriving the sections at render (RC-2), with no new shell API. A test pins it: `usePermissions` mocked to return only `receipt-code:manage` from the first render → the Receipt codes view, no tab list, and `ratesApi.listRates` never called. The remaining case is a cold cache outside the shell (refund-ui standalone in dev); there General shows for an instant, which is today's accepted behaviour. Rejected: adding a `resolved` flag to the shell's federated `usePermissions` (a cross-package contract change for a case the guard already prevents). |
| DS-7 | G7: PDF and journal widths for a 3-letter prefix and `/1000` | Measured with the embedded regular font at 9.5 pt (`TYPE.value`), against the batch PDF's "Receipt numbers" column (`DETAIL`, width 80, text width 80 − 6 = **74 pt**): `LCX26/040,` 49.8; `LCX26/014–016,` 70.9 (fits); `LCX26/1000,` 55.2 (fits); `LCX26/1000–1002,` **81.7**; `MC26/1000–1002,` **79.8** (already too wide today with two letters). `wrapText` never breaks a word, so a range with a 4-digit sequence runs into the "Requested" column. The neighbours leave no room to widen the column (Request needs 128 of 134, the amounts 61 of 62). **Decision:** a 3-letter prefix with a 3-digit sequence needs no change; the renderer breaks a receipts token wider than the column **after its en dash** (`LCX26/1000–` / `1002,`), local to `pdf.ts`, and a test asserts that every receipts line drawn fits 74 pt for `LCX26/014–016`, `LCX26/1000–1002` and `LCX26/99998–99999`. The journal workbook's Description is a text cell (`COLUMN_WIDTHS` 70 characters, presentation only); one more character changes nothing, and `exportFormat.test.ts` gains `Cancelleria [LCX26/040] <name>`. The per-request PDF prints `Receipt no. LCX26/1000` in the line's wrapped detail: no change. |
| DS-8 | G8: the shared-prefix rule for an employee **with** a code | **`sharesPrefix(E)`** is true when `prefix(E)` (= code ?? initials) equals, for some other Refund-known employee F: F's code; or F's derived initials **when F has no code**; or the prefix of any number issued or imported to F (any year). It is computed for every row, **with or without a code**, and the badge shows whenever it is true. This departs from design RC-8 and its S2 row "sharesPrefix and a code: no badge": a code equal to a codeless colleague's initials is a shared prefix **caused by** the code, and it is flagged on both rows (the remedy is a code for F, or another code for E). The count note counts every flagged row, so its copy loses "and have no code" (`receiptCodes.shareNote`: EN "N employee(s) share(s) a prefix with another employee.", IT "N dipendente/i condivide/condividono il prefisso con un altro dipendente."). **The 409 rule does not change** (AC-4.3, ambiguity 8): a code is refused when another employee holds it, or when another employee has a number issued or imported with that prefix; another employee's derived initials with **no** number do not block it. So a code equal to another employee's initials is refused exactly when that employee already has numbers with those initials, and otherwise allowed and flagged. At the release this is consistent with D8's AC-4.11 rule: E's new-number prefix is in `prefixes(F)`, so a `new` decision for E exits 9 until F has a code. After the release it is flagged, never refused (D13). |
| DS-9 | G9: "Last number" keeps the old prefix after a code change | Correct by AC-4.4 and kept. The dialog description and the Clear confirmation say that issued numbers do not change and the sequence continues. A "next number starts with" line is deferred until accountants ask for it. |
| DS-10 | Task split and test environment (not a design gap) | `tasks.md` adds `refund-api/scripts/release/types.ts` (types only) so the reader, pairing, pairing-file and report tasks run in parallel. refund-api suites run against a scratch database per task on the local Postgres container (name `<db>_rn_<tag>`, see tasks.md § How to read), not on a shared `refund` database; the levels of § Test strategy are unchanged. |

## Decisions taken unattended

| # | Decision | Why | To change |
|---|---|---|---|
| D1 | Read the `.xlsx` directly, sheet `2026`, four columns by header; an in-house reader | Typed dates and totals, no locale, no extra copy, no dependency | Add a CSV adapter producing the same `RegisterRow[]` |
| D2 | Pairing categories and demotions as tabled; doubtful = blank decision | The spec's reasons, made mechanical and deterministic | Pure module, unit-tested |
| D3 | Pairing CSV with records; the real run accepts only `confirmed` | AC-1.1/1.3 "the file confirms"; editable in Excel | Accept `proposed` exact matches (one line in the validator) |
| D4 | Imported number = trimmed, upper-cased paper text; `receiptYear` = expense year; `receiptSeq` = paper seq (0 allowed for paper); uniqueness on (owner, year, seq, splitPart) | Keeps the counter's seq invariant and makes the split explicit and DB-checked | Migration |
| D5 | Baseline = max(offsets, register, imported), written as the existing baseline row | One counter-creation path; covers employees not yet in Refund | — |
| D6 | Paper numbers only on 2026 lines; lines of other years take `new` | AC-1.16; a paper number on another year's sequence has no defined counter interplay | Relax the validator plus a test |
| D7 | A confirmed paper number must appear on a register row mapped to the line's employee | AC-2.4 "exists in the register export", read per employee (mapping is by employee) | Validator |
| D8 | Receipt code in `receipt_code` (current, unique) + `receipt_code_change` (append-only); prefix read once per numbering call | AC-4.3 race via the unique index; AC-4.7 history; AC-4.10 without new locks | — |
| D9 | `--offsets` optional; exit 3 retired, never reused; new statuses 5 to 9 | AC-2.8 "own status"; the spec's "complements" | — |
| D10 | `--show-emails` removed | AC-5.6 allows no email in any output | — |
| D11 | Marker checked first: a completed release exits 0 without reading anything | AC-5.3 "with any inputs"; e2e idempotence | — |
| D12 | Capability `receipt-code:manage` (new resource, no conditions), seeded to `accounting` and `admin` only, **not** `refund-admin` | AC-4.9 "no other role", which departs from refund-admin's "every refund capability" convention; an admin can grant it | One `ensureGrant` line |
| D13 | Post-release shared prefix: not refused; flagged in the Settings list only, no review-page change | Open-question fallback; no AC asks for a review flag | Add a badge on the review page later |
| D14 | Rows with a number but no worker must be acknowledged; merged cells propagate | They could hide a maximum; this is how a person reads merges | Validator |
| D15 | Propose mode writes the file with `O_EXCL` | A decided file is never overwritten by a re-proposal | — |

## Spec ambiguities resolved (no amendment needed; owner to confirm)

1. **AC-2.4 vs AC-1.16**: may a person give a paper number to a line outside 2026? → No (D6).
2. **AC-2.4 "exists in the register export"**: on any row, or on a row of the same employee? → The
   same employee (D7).
3. **AC-1.18 "equal numbers"**: uniqueness is enforced on (year, seq) per employee, which is
   stricter than equal text. `LG25/003` and `LG26/003` on two 2026 lines of one employee are
   "number already taken" (D4).
4. **"Taken as written"**: the stored text is the cell trimmed and upper-cased, not re-padded.
5. **AC-2.3 "proposed" vs AC-1.1 "confirms"**: exact matches are pre-filled but still need
   `confirmed` (D3).
6. **AC-1.13** rows with a date but an unreadable total → new reason `total_unreadable`; rows with a
   number and no worker → must be acknowledged (D14).
7. **AC-4.9 roles**: `refund-admin` is not seeded (D12).
8. **AC-4.3 "in use"**: covers other employees' codes and their issued or imported numbers' prefixes.
   Another employee's derived initials with no number yet do not block a code; the list flags them.
9. **AC-5.3 exit status**: "already completed" is a success, 0 (D11). **AC-5.1 statuses** as in the
   exit table (D9).
10. **AC-4.1 "employee known to Refund"** = at least one request in any status (the API's 404
    otherwise).

## ADR candidates

For the `adr-writer`; none is written here.

- **A1 — Imported paper numbers and the split-receipt exception** (amends
  20261118-receipt-numbers-come-from-a-row-locked-per-employee-and-year-counter-…). A receipt number
  is issued by the counter (`issued`) or imported from the register (`paper`, `paper_split`). The
  stored text is the paper text, the year is the expense year, and seq 0 is allowed for paper only.
  Uniqueness is (owner, year, seq, splitPart), and a deferred trigger keeps a split group to one
  number, one date, all `paper_split`. A new number is never shared. The counter starts after
  max(offsets, register, imported).
- **A2 — A receipt code per employee overrides derived initials for new numbers only.** Stored as a
  mutable current row with a unique code plus an append-only change history. The prefix is read
  inside the numbering transaction. Codes never rewrite issued numbers. A new refund catalog
  resource `receipt-code:manage` is seeded to `accounting` and `admin`.
- **A3 — Operator data imports read the source workbook directly with an in-house, dependency-free
  xlsx reader** (zip + inflate via `node:zlib`, minimal XML, DOCTYPE refused, caps). This
  constrains the next feature (the Excel detail extract) and any future register import.
- **A4 — A one-off release that needs human judgement runs as propose → confirm → run.** The
  confirmation lives in an operator file outside the repository, bound to its inputs by fingerprints
  (stale refused). Output names people only as `<prefix> · <id8>`, exit statuses are per refusal
  family, and the real run is idempotent once completed. This generalises the 20261118 SO-13 / T84
  conventions for future operator migrations.

- **A2 amendment (design sync DS-8)** for ADR 20261124-a-receipt-code-per-employee-…, decision 5: the
  Settings flag covers every employee whose prefix is shared, **with or without a code** (a code equal
  to another codeless employee's derived initials is a shared prefix caused by the code). The 409
  rule (decision 3/AC-4.3) is unchanged. One sentence for the `adr-writer`.

## Spec amendment proposed

None. The spec is implementable as written; the readings above are recorded for the owner to
confirm on review.
