---
spec: 20261124
generated: 2026-11-24
---

# Tasks: Receipt numbers from the accountant's register, and a receipt code per employee

Derived from these committed files:

- `spec.md`: approved, 52 ACs (US-1 18, US-2 9, US-3 6, US-4 12, US-5 7).
- `plan.md`: approved, with its "Design sync (2026-11-24)" section (DS-1 to DS-10).
- `design.md`: RC-1..RC-11, flows F1–F5, screens S1–S5, the component inventory, copy keys and the
  accessibility plan. Where DS-8 of the plan departs from RC-8, the plan wins.
- The four ADRs of 2026-11-24 in `docs/adr/20261124-*.md`.

## How to read this list

- **Tracks.** Each can run in its own worktree. They meet only at the deps and the `touch:` overlaps
  listed in § Overlap check.

  | Track | Scope | Tasks |
  |---|---|---|
  | **AUTH** | auth catalog and seed | T1 |
  | **CORE** | refund-api migration, receipt-number rules, numbering core | T2–T4 |
  | **CODE** | refund-api receipt-code API | T5 |
  | **XLSX** | operator-file helpers, release types, the xlsx reader, the register export | T6–T8 |
  | **PAIR** | release pure core: pairing, pairing file, report | T9–T11 |
  | **RUN** | the release script: propose, check, real run, adversarial tests | T12–T14 |
  | **PDF** | batch PDF and journal widths (DS-7) | T15 |
  | **RUI** | refund-ui Receipt codes view | T16–T21 |
  | **E2E** | shell e2e global setup and spec | T22–T23 |
  | **DOCS** | runbook, AGENTS.md, ADR amendment, changeset | T24–T26 |
  | **CLOSE** | QE, OWASP, eval, closing (the gate) | T27–T30 |
  | **OWNER** | propose dry run on the real register, live e2e, accounting decisions, release | T31–T34 |

  RUI builds against plan § API contracts (with DS-2 and DS-8) with mocked responses, so it does not
  wait for CODE. PAIR is pure and builds against `scripts/release/types.ts` (T6), so it does not wait
  for the reader.
- **`touch:` is binding.** A task changes only the paths it lists (`*` does not cross `/`). A path
  found missing is added to the task, and to § Overlap check, before it is changed. Files touched
  outside the list are reported in § Implementation notes when the task closes.
- **One migration** (T2), `20261124090000_receipt_numbers_from_register`, exactly plan § Data model.
  No other task edits `schema.prisma` or a migration.
- **One copy catalog.** All new copy goes into `refund-ui/src/strings.ts` in T16 (en and it), from
  design § Copy keys with the DS-8 change to `receiptCodes.shareNote`. No other task touches
  `strings.ts`.
- **Owner tasks** are marked **[OWNER]**. They need the real register, accounting's answers, a live
  stack or a release push, and are never run by an agent.
- **Test environment** (done-when commands use these two names):
  - `WT=/Users/hermes/claude-workspace/repos/operai-register-numbers`
  - `ST=/private/tmp/claude-501/-Users-hermes-claude-workspace/3b8f0432-b131-57d7-bf4a-a725ea48766e/scratchpad/scratch-test.sh`

  `$ST $WT refund_rn_<tag> [files]` creates the scratch database `refund_rn_<tag>` on the local
  container if missing, applies refund-api's migrations, loads placeholder variables (no real
  credential) and runs `bun test` in `refund-api/` with the files given (the whole suite when none).
  Each task uses its own tag (`refund_rn_t2`, `refund_rn_t4`, …), so tracks never share a database.
  Migration tests create their own `refund_mig_rn*` databases on the same server. Removing scratch
  databases is left to the owner. Agents never use Railway or a production database. If the scratch
  script is gone (the scratchpad was cleared), the same three steps are run by hand: `CREATE
  DATABASE`, `bunx prisma migrate deploy`, `bun test`.
  - refund-api types: `cd $WT/refund-api && bun run db:generate && bun run typecheck`.
  - refund-ui: `cd $WT/refund-ui && pnpm exec vitest run [files] && pnpm exec tsc -b && pnpm lint`.
  - auth: pure tests with `bun test <files>`; DB-backed tests on a scratch `auth_rn_<tag>` database
    on the same container, prepared like the script does (create, `bunx prisma migrate deploy` in
    `auth/`, `DATABASE_URL` pointing to it). If auth's variables are not available locally, the
    DB-backed test is recorded as pending for T27, never silently skipped.
  - shell e2e: static checks only (`tsc -p tsconfig.e2e.json`, eslint, `playwright test --list`).
    **The live e2e is an owner step (T32).**
- **Deploying is never a task.** Railway and Vercel are documented (T24) and applied by the owner
  (T34).

## AUTH — auth

- [x] T1: auth — refund catalog resource `receipt-code` (action `manage`, no conditions) and `seedReceiptCodeGrants()` for `accounting` and `admin` only — refs: AC-4.9 — deps: none
  - touch: `auth/src/authz/catalogs/refund.ts`, `auth/src/authz/catalogs/refund.test.ts`, `auth/src/authz/seed.ts`, `auth/src/authz/seed.test.ts`
  - agent: backend-dev · auth
  - Details:
    - Plan § Components (auth) and D12: resource `receipt-code` ("Receipt code"), action `manage`
      ("Manage"), `supportedConditions: []`.
    - `seedReceiptCodeGrants()`: `ensureGrant(accounting, "receipt-code", "manage")` and the same for
      `admin`, unconditioned, idempotent, never overwriting; called from `seed()` after
      `seedSettingsAdminGrants`; logs `+ receipt-code grants` (the runbook's step 6 looks for it).
    - **Not** granted to `refund-admin`, `employee` or any other role (AC-4.9 "no other role").
  - done when: `cd $WT/auth && bun test src/authz/catalogs/refund.test.ts src/authz/catalogs/uniqueResourceKeys.test.ts && bun run typecheck` is green, with the catalog test asserting the resource, the action and no condition; `bun test src/authz/seed.test.ts` on a scratch `auth_rn_t1` database asserts that `accounting` and `admin` hold `receipt-code:manage` unconditioned, that no other system role holds it, and that a second `seed()` changes nothing.

## CORE — refund-api migration and numbering core

- [x] T2: refund-api — the single migration `20261124090000_receipt_numbers_from_register` (origin and split columns with backfill, CHECKs, the 4-column unique index, guard v3, the deferred split trigger, `receipt_code`, `receipt_code_change`), schema, cleanup and DB tests — refs: AC-1.6, AC-1.11, AC-1.18, AC-4.3, AC-4.7 — deps: none
  - touch: `refund-api/prisma/schema.prisma`, `refund-api/prisma/migrations/20261124090000_receipt_numbers_from_register/migration.sql`, `refund-api/src/lib/db.receipt-register.test.ts`, `refund-api/src/lib/migration.receipt-register.test.ts`, `refund-api/src/test-support/dbCleanup.ts`
  - agent: backend-dev · core
  - Details:
    - Plan § Data model steps 1–7 verbatim, in that order (backfill before guard v3; new index
      created before the old one is dropped). Guard v3 is `CREATE OR REPLACE` of v2's body with
      `receiptOrigin` and `receiptSplitPart` added to the frozen set. No applied migration is edited.
    - `schema.prisma`: `RefundLine.receiptOrigin String?`, `receiptSplitPart Int? @db.SmallInt`,
      `@@unique([receiptOwnerUserId, receiptYear, receiptSeq, receiptSplitPart])`, models
      `ReceiptCode` and `ReceiptCodeChange`.
    - `dbCleanup.ts` TRUNCATEs `receipt_code` and `receipt_code_change`.
    - `db.receipt-register.test.ts` (direct SQL, the `db.accounting-signoff.test.ts` pattern, which
      also pins the hand-written SQL against drift): a second part 1 of one (owner, year, seq) violates
      the index; a part 2 with another number, another date, or attached to an `issued` part 1 fails
      **at COMMIT**; `issued` with seq 0 fails, `paper` with seq 0 passes; the shape CHECK accepts
      `LCX26/040` and refuses `LCXX26/040`; UPDATE of `receiptOrigin`, `receiptSplitPart` or the
      number of a numbered line raises, DELETE of a numbered line raises; UPDATE and DELETE of
      `receipt_code_change` raise; two `receipt_code` rows with one code violate the unique index.
    - `migration.receipt-register.test.ts`: on a scratch `refund_mig_rn` database migrated to the
      previous head and holding numbered lines, the migration backfills `issued`/1, keeps every
      number, and the new index exists while the old one does not.
  - done when: `$ST $WT refund_rn_t2 src/lib/db.receipt-register.test.ts src/lib/migration.receipt-register.test.ts` is green; `cd $WT/refund-api && bun run db:generate && bun run typecheck` is green; the whole suite `$ST $WT refund_rn_t2` is green.

- [x] T3: refund-api — pure receipt-number rules: `formatReceiptNumber` for 2 or 3 letters, `parseReceiptNumber`, `RECEIPT_CODE_PATTERN` and `normaliseReceiptCode` — refs: AC-4.2, AC-4.4, AC-4.5 — deps: none
  - touch: `refund-api/src/accounting/receiptNumber.ts`, `refund-api/src/accounting/receiptNumber.test.ts`
  - agent: backend-dev · core
  - Details:
    - Plan § Components (`receiptNumber.ts`) and D8 "Validation": `formatReceiptNumber(prefix, year,
      seq)` accepts `^[A-Z]{2,3}$`; `parseReceiptNumber(text)` → `{ prefix, yy, seq, text }` or `null`
      on `^[A-Z]{2,3}\d{2}/\d{1,5}$` after trim and upper-case; `normaliseReceiptCode(input)` →
      `{ kind: "clear" } | { kind: "code", code } | { kind: "invalid" }`, checking the trimmed input
      against `^[A-Za-z]{2,3}$` **before** upper-casing. `initials()` unchanged.
  - done when: `$ST $WT refund_rn_t3 src/accounting/receiptNumber.test.ts` is green with vectors: `formatReceiptNumber("LCX", 2026, 40)` → `LCX26/040`, `("LCX", 2027, 1)` → `LCX27/001`, seq 1000 → `LCX26/1000`; parse of `AB26/005`, ` ab26/5 `, `LG25/003`, `AB26/000`, and `null` for `AA99/9A`, `ABCD26/001`, `A26/001`; code vectors `A`, `ABCD`, `A1`, `ÀB`, `A B`, `ßA` → invalid, ` lcx ` → `LCX`, `""` and `null` → clear; the existing `initials` vectors unchanged.

- [x] T4: refund-api — numbering core: prefix from the receipt code read once per call inside the transaction, paper assignments that skip the counter, `receiptOrigin`/`receiptSplitPart` on every numbered line, the richer `receipt_number_assigned` detail — refs: AC-1.2, AC-1.6, AC-1.17, AC-3.3, AC-3.5, AC-4.4, AC-4.5, AC-4.10, AC-4.12 — deps: T2, T3
  - touch: `refund-api/src/accounting/numbering.repo.ts`, `refund-api/src/accounting/numbering.repo.test.ts`, `refund-api/src/accounting/numbering.paper.test.ts`, `refund-api/src/accounting/receiptCode.repo.ts`, `refund-api/src/requests/audit.ts`, `refund-api/src/accounting/receipt.lifecycle.test.ts`
  - agent: backend-dev · core
  - Details:
    - Creates `receiptCode.repo.ts` with `receiptPrefix(tx, owner)` only (current `receipt_code`, else
      `initials(name, email)`); T5 extends the file.
    - `classifyAndNumber` (plan § Components (a)–(d)): the prefix is read **once per call**; the new
      optional input `paper: Map<lineId, { number, splitPart, registerRows }>` writes the paper text
      with `receiptYear` = expense year, `receiptSeq` = paper seq, origin `paper` or `paper_split`,
      in the same single `UPDATE` as the classification copies (IS-1); other lines get the counter's
      next number with origin `issued`, part 1. Lines are numbered in (expense date, createdAt, id).
    - `audit.ts`: detail `{ cause, receiptNumber, year, seq, origin: "new" | "paper" |
      "paper_split", registerRows?: number[], splitPart?: number }`.
    - Approval path (`decide.repo.ts`) is not edited: it keeps calling `classifyAndNumber(cause:
      "approval")`.
  - done when: `$ST $WT refund_rn_t4 src/accounting/numbering.repo.test.ts src/accounting/numbering.paper.test.ts src/accounting/receipt.lifecycle.test.ts` is green, proving: a `receipt_code` row `LCX` (inserted directly) with baseline 39 → the next approval gives `LCX26/040` while `LC26/039` stays as issued in the line, request, batch and export reads; a 2027 line with code `LCX` → `LCX27/001`; a paper map writes `AB26/005` origin `paper` and does not move the counter (`lastSeq` = baseline + count of new); two split lines get parts 1 and 2 with one number; the audit detail of each origin; one call with a code changed between two reads in another connection numbers all its lines with one prefix. The whole suite `$ST $WT refund_rn_t4` is green.

## CODE — refund-api receipt-code API

- [x] T5: refund-api — `GET /accounting/receipt-codes`, `PUT /accounting/receipt-codes/{userId}`, `GET /accounting/receipt-codes/{userId}/history`, gated by `receipt-code:manage` on every method; `changedAt`/`changedByEmail` (DS-2) and `sharesPrefix` (DS-8) — refs: AC-4.1, AC-4.2, AC-4.3, AC-4.6, AC-4.7, AC-4.9, AC-4.10, AC-4.11 — deps: T2, T3, T4
  - touch: `refund-api/src/accounting/receiptCode.repo.ts`, `refund-api/src/accounting/receiptCode.routes.ts`, `refund-api/src/accounting/receiptCode.schemas.ts`, `refund-api/src/accounting/receiptCode.routes.test.ts`, `refund-api/src/accounting/receiptCode.race.test.ts`, `refund-api/src/index.ts`
  - agent: backend-dev · code
  - Details:
    - Plan § API contracts and D8: middleware order `noStoreHeaders`, `bodyLimit(1 KiB)`,
      `jwtMiddleware`, `authzMiddleware`, the capability gate, then body validation; RFC 7807 with
      `instance` = route pattern; the actor from the JWT only. Mount in `src/index.ts`.
    - PUT in one transaction: `pg_advisory_xact_lock(hashtext('receipt-code:' || userId))`,
      `normaliseReceiptCode` (422 `receipt_code_invalid`, also for a body with another key), the
      in-use checks (another `receipt_code` row with the code, or a `refund_line` of another employee
      whose prefix equals the code: 409 `receipt_code_in_use`, naming nobody), upsert or delete, one
      `receipt_code_change`; P2002 → 409; saving the current value is a 200 that writes nothing; 404
      `employee_not_found` when no request has that `ownerUserId`.
    - List row as plan § API contracts, with `changedAt`/`changedByEmail` from the newest change row
      (DS-2) and `sharesPrefix` by DS-8 (another employee's code; another codeless employee's
      initials; the prefix of a number issued or imported to another employee).
  - done when: `$ST $WT refund_rn_t5 src/accounting/receiptCode.routes.test.ts src/accounting/receiptCode.race.test.ts` is green, covering: 403 on all three routes without the capability and nothing changed; set (the next approval uses the code), change `LCX`→`LCY` then clear (numbers `LCY26/041` then `LC26/042`, earlier lines unchanged); 422 for each AC-4.2 vector with no `receipt_code`/`receipt_code_change` row; 409 for another employee's code and for another employee's issued or imported prefix, the body containing neither the other's name, email nor user id; a code equal to a codeless colleague's initials with no number → 200 and `sharesPrefix` true on **both** rows; history newest first with actor and time, none for a no-op; `changedAt` null for a never-changed employee and set after a clear; two concurrent PUTs of one code for two employees → one 200, one 409; a PUT racing an approval of the same employee (barrier, 20 repetitions) → each number wholly old or wholly new prefix, counter without gap or repeat. The whole suite `$ST $WT refund_rn_t5` is green.

## XLSX — operator files, release types, the reader, the register export

- [x] T6: refund-api — `scripts/lib/operatorFiles.ts` (moved and new helpers) and `scripts/release/types.ts` (the release's shared types) — refs: AC-5.6 — deps: T3
  - touch: `refund-api/scripts/lib/operatorFiles.ts`, `refund-api/scripts/lib/operatorFiles.test.ts`, `refund-api/scripts/release/types.ts`, `refund-api/scripts/receipt-baseline-from-register.ts`, `refund-api/scripts/receipt-baseline-from-register.test.ts`
  - agent: backend-dev · xlsx
  - Details:
    - `operatorFiles.ts`: `pathInsideGitWorktree(path)` (merging `offsetsPathWarning` and the
      register warning), `shapeOf(cell)` (letters → `A`, digits → `9`, other characters kept),
      `yearOfDate`, `parseCsvRows` (delimiter detection `,` `;` tab, BOM), `sha256File(path)` →
      `sha256:<hex>`, `writeFileExclusive(path, content)` (`O_EXCL`, mode 0600).
    - `receipt-baseline-from-register.ts` imports the moved helpers; no behaviour change.
      `accounting-release.ts` keeps its own copies until T12 switches it.
    - `types.ts`: `RegisterRow` (`position`, `worker`, `number`: paper | empty | malformed shape,
      `date`, `totalCents`, each possibly unreadable), `PreReleaseLine`, `ReleaseEmployee`,
      `PairingCategory`, `PairingProposal`, `PairingDecision`, `PairingFileRecord`. Types only.
  - done when: `$ST $WT refund_rn_t6 scripts/lib/operatorFiles.test.ts scripts/receipt-baseline-from-register.test.ts` is green, including: a path inside a temporary `git init` directory → warning, outside → none; `shapeOf("AA99/9a")` → `AA99/9A`-shape without the cell text; `writeFileExclusive` on an existing path throws and leaves it unchanged, and a new file has mode 0600; `bun run typecheck` green.

- [x] T7: refund-api — the dependency-free xlsx reader and the synthetic register workbook builder, plus the committed header-only fixture — refs: AC-2.1, AC-2.7 — deps: none
  - touch: `refund-api/scripts/release/xlsxReader.ts`, `refund-api/scripts/release/xlsxReader.test.ts`, `refund-api/src/test-support/registerWorkbook.ts`, `refund-api/src/test-support/registerWorkbook.test.ts`, `refund-api/scripts/fixtures/synthetic-register-header-only.xlsx`
  - agent: backend-dev · xlsx
  - Details:
    - Plan § Register export (D1) and ADR 20261124-operator-data-imports-…: ZIP (EOCD scan of the last
      64 KiB, central directory, local headers, methods 0 and 8 via `inflateRawSync` with
      `maxOutputLength`); refusals with a named reason: ZIP64, encryption, other methods, > 10,000
      entries, compressed file > 20 MiB, an entry inflating beyond 64 MiB, CRC mismatch. XML
      tokenizer by local name (transitional and strict), `<!DOCTYPE` refused, five entities and
      numeric references only, no recursion on attacker-controlled depth. Parts: `workbook.xml`
      (sheet → `r:id`, `date1904`), its rels, `sharedStrings.xml` (runs concatenated, `rPh` ignored),
      one worksheet; cell types `s`, `str`, `inlineStr`, `n`, `b`, `e`, `d`; cached `<v>` for
      formulas; `<mergeCell ref>` ranges. Error messages quote no cell.
    - Independent of `src/test-support/xlsxReader.ts` (the test-only reader of the journal) and of
      `src/accounting/xlsx.ts`: neither is imported.
    - `registerWorkbook.ts` builds workbooks from `{ worker, number, date, total }` rows with the
      deterministic writer `src/accounting/xlsx.ts`, with options: deflate, rich-text shared strings,
      inline strings, formula cells with cached values, 1900 and 1904 date serials, merged worker
      cells, a `<!DOCTYPE>` and a zip bomb. Synthetic names only (`Worker Alpha`, …).
    - The fixture is the builder's header-only output, committed.
  - done when: `$ST $WT refund_rn_t7 scripts/release/xlsxReader.test.ts src/test-support/registerWorkbook.test.ts` is green, with: every builder option read back to the same cells; each refusal (DOCTYPE, zip bomb, ZIP64, encryption, method 12, CRC flip, too many entries) named and quoting no cell text; the fixture's bytes equal the builder's header-only output; `bun run typecheck` green.

- [x] T8: refund-api — `registerExport.ts`: sheet → `RegisterRow[]` (header detection, cell coercion, merges, dates, totals to the cent on the decimal string, number classification) — refs: AC-1.13, AC-2.1 — deps: T6, T7
  - touch: `refund-api/scripts/release/registerExport.ts`, `refund-api/scripts/release/registerExport.test.ts`
  - agent: backend-dev · xlsx
  - Details: plan § Register export bullets "Date", "Total", "No.", "Position": headers `Worker`,
    `No.`, `Date`, `Total` found in the first 20 rows (trimmed, case-insensitive), other columns never
    kept; sheet `2026` by default; position = Excel row number `R<n>`; date serials (1900 with the
    1900-02-29 quirk, 1904) and text `YYYY-MM-DD`, `DD.MM.YYYY`, `DD/MM/YYYY`; totals rounded half away
    from zero on the decimal string (`1.0049999999999999` → 1.00, `24.5` → 24.50), text totals with a
    currency code, spaces and `'` stripped, one decimal mark; number trimmed and upper-cased: empty,
    paper or malformed (shape only); a formula with no cached value → unreadable with the "save in
    Excel" hint.
  - done when: `$ST $WT refund_rn_t8 scripts/release/registerExport.test.ts` is green with a table-driven test of every date, total and number form above, a missing header or sheet → a named refusal, merged worker cells propagated, and a test that the returned rows carry no field beyond `position`, `worker`, `number`, `date`, `totalCents`.

## PAIR — release pure core

- [x] T9: refund-api — `pairing.ts` (pure): worker → employee proposal, candidates, categories and demotions, splits, number-taken, baseline (AC-3.1), shared-prefix analysis (AC-4.11), deterministic ordering — refs: AC-1.1, AC-1.3, AC-1.4, AC-1.5, AC-1.6, AC-1.7, AC-1.8, AC-1.9, AC-1.10, AC-1.11, AC-1.12, AC-1.13, AC-1.14, AC-1.15, AC-1.16, AC-3.1, AC-4.11 — deps: T3, T6
  - touch: `refund-api/scripts/release/pairing.ts`, `refund-api/scripts/release/pairing.test.ts`
  - agent: backend-dev · pair
  - Details: plan § Pairing (D2) table and demotions, § Counter continuation (D5), § Prefixes and
    receipt codes (D8, AC-4.11 at the release) and D14. Worker normalisation (trim, collapse,
    case-fold, strip diacritics, word set). Excluded employees have no rows. Rows with a number but no
    worker are listed for acknowledgement. Sorting by (employee, date, createdAt, id), rows by
    position, groups `S<k>` in that order.
  - done when: `$ST $WT refund_rn_t9 scripts/release/pairing.test.ts` is green with one test per row of the category table and per demotion (`wrong_year`, `sequence_000`, `prefix_differs`, `number_taken` incl. the `LG25/003` vs `LG26/003` seq collision), the AC-1.6 and AC-1.7 split shapes, AC-1.7 with two different numbers → `several_candidates`, AC-1.12 "prefix of the other paper numbers is not doubtful", worker mapping unique / none / several, the baseline table (offsets only, register only, imported only, all three; wrong-year with date in 2026, missing, unreadable, outside 2026; `000`; malformed; empty), the shared-prefix analysis (derived, register-mapped, imported; a member whose lines are all paper not blocked; a coded employee whose code equals a codeless colleague's initials is in a shared pair, DS-8), and a determinism test (same inputs shuffled → identical output).

- [x] T10: refund-api — `pairingFile.ts` (pure): CSV writer and tolerant reader, and the validator of AC-2.4, AC-2.6, AC-1.5, AC-1.13, AC-1.14, AC-1.15 — refs: AC-1.1, AC-1.3, AC-1.5, AC-1.6, AC-1.7, AC-1.13, AC-1.14, AC-1.15, AC-1.16, AC-2.3, AC-2.4, AC-2.6, AC-2.7 — deps: T3, T6
  - touch: `refund-api/scripts/release/pairingFile.ts`, `refund-api/scripts/release/pairingFile.test.ts`
  - agent: backend-dev · pair
  - Details: plan § Pairing file (D3): one header for all records, UTF-8 with BOM, RFC 4180;
    `meta` records `format` (`operai-pairing/1`), `register`, `sheet`, `lines` (digest of the sorted
    `lineId|date|approvedTotalCents|currency` list), `builtAt`; `employee`, `worker`, `line`, `row`
    records; states `proposed`, `unresolved`, `confirmed`. Reader: delimiter detection, BOM,
    case-insensitive headers and enums, informational columns never validated. Validator returns all
    problems named by id; `format` unknown or meta missing is an input error (exit 6 in T12).
  - done when: `$ST $WT refund_rn_t10 scripts/release/pairingFile.test.ts` is green with: a writer → reader round trip, also through a `;`-delimited Excel-style re-save with CRLF; fingerprints kept as text (`sha256:` prefix); one validator test per problem (line missing, unresolved, a `proposed` record, extra line, paper number not on a row of the line's employee, number on two lines outside a split, a split group with two dates / two numbers / two employees, `new` in a group, a group of one accepted, paper on a non-2026 line, paper for an excluded employee, worker unmapped, worker mapped to an excluded employee, malformed row unacknowledged, an offsets row for an excluded employee), each naming the id.

- [x] T11: refund-api — `report.ts`: the AC-2.2 report, privacy-safe by construction — refs: AC-1.9, AC-2.2, AC-3.1, AC-3.4, AC-4.11, AC-5.6 — deps: T6, T9
  - touch: `refund-api/scripts/release/report.ts`, `refund-api/scripts/release/report.test.ts`
  - agent: backend-dev · pair
  - Details: counts per category and reason (lines and rows), splits, no counterpart, rows with no
    line, rows without a number, rows without date or total, malformed numbers, unmapped workers;
    employees needing a code; per employee as `<prefix> · <user id 8>`: offsets, register max,
    imported max, baseline, first new number, and the flags offsets ≠ register max and lines without a
    mapped worker; doubtful lines by id with date, amount, currency, reason. The report takes only ids,
    prefixes, numbers, positions, counts and the doubtful lines' own amounts as input types, so a name
    cannot reach it. A header line names the register's last date (plan R5).
  - done when: `$ST $WT refund_rn_t11 scripts/release/report.test.ts` is green with a snapshot over a fixture covering every category and a test that the formatted text contains none of the fixture's synthetic worker names, emails, descriptions or non-doubtful row amounts.

## RUN — the release script

- [x] T12: refund-api — `accounting-release.ts` rewrite, part 1: CLI and order of the run, marker first (exit 0), Accounting (2) and auth (4) as before, inputs present (5) and readable (6), propose mode writing the pairing file, `--show-emails` removed, path warnings, `.gitignore` — refs: AC-2.1, AC-2.2, AC-2.3, AC-2.8, AC-5.1, AC-5.3, AC-5.6 — deps: T4, T6, T7, T8, T9, T10, T11
  - touch: `refund-api/scripts/accounting-release.ts`, `refund-api/scripts/accounting-release.test.ts`, `refund-api/scripts/accounting-release.cli.test.ts`, `refund-api/src/test-support/accountingRelease.ts`, `refund-api/src/test-support/releaseRun.ts`, `refund-api/src/accounting/accounting-unavailable.matrix.test.ts`, `refund-api/src/accounting/classification.inactive-default.test.ts`, `refund-api/src/accounting/natural-keys.test.ts`, `refund-api/src/accounting/no-cache.test.ts`, `.gitignore`
  - agent: backend-dev · run
  - Details:
    - Plan § The release, step by step, steps 0–4 and 8 (propose), and the exit table (D9, D10, D11,
      D15). Exit 3 is retired and never produced; `EXIT_BASELINE_MISSING` is removed with its message.
    - The script imports `operatorFiles.ts` and drops its private copies (`offsetsPathWarning`,
      `parseOffsetsCsv`'s CSV splitting); `--offsets` becomes optional.
    - `releaseRun.ts` (test support): `proposeAndConfirm({ workbook, … })` runs propose, rewrites
      `proposed` to `confirmed`, and fails naming any `unresolved` record; the four existing test
      files that call `runAccountingRelease` move to it with the header-only workbook.
    - `.gitignore`: `**/*pairing*.csv`, `**/Recap_RS*`.
  - done when: `$ST $WT refund_rn_t12 scripts/accounting-release.test.ts scripts/accounting-release.cli.test.ts src/accounting/accounting-unavailable.matrix.test.ts src/accounting/classification.inactive-default.test.ts src/accounting/natural-keys.test.ts src/accounting/no-cache.test.ts` is green, covering: after completion, any inputs → exit 0 "already completed" with zero calls to the Accounting and auth fakes; Accounting read before the workbook (call order), failing port → exit 2 and no file; real run without `--register` or `--pairing`, or with `--offsets` alone → exit 5 "run the dry run first"; a dry run without exactly one mode → 5; an unreadable workbook, sheet, header, pairing format or offsets → 6 quoting no cell; propose writes the file 0600 and refuses an existing path (exit 1, file unchanged); every refund table's row counts unchanged after propose; `--show-emails` refused naming the reason; a path inside a git worktree → stderr warning. The whole suite `$ST $WT refund_rn_t12` is green.

- [x] T13: refund-api — `accounting-release.ts` rewrite, part 2: check mode and real run (stale 7, validation 8, shared prefix 9, the transaction, baseline rows, paper and new numbering, assertions, marker, "differs from the proposal") — refs: AC-1.1, AC-1.2, AC-1.3, AC-1.5, AC-1.6, AC-1.7, AC-1.8, AC-1.9, AC-1.10, AC-1.11, AC-1.13, AC-1.14, AC-1.15, AC-1.16, AC-1.17, AC-1.18, AC-2.4, AC-2.5, AC-2.6, AC-2.7, AC-2.9, AC-3.1, AC-3.2, AC-3.3, AC-3.4, AC-3.5, AC-3.6, AC-4.11, AC-4.12, AC-5.1, AC-5.2, AC-5.4, AC-5.5, AC-5.7 — deps: T12
  - touch: `refund-api/scripts/accounting-release.ts`, `refund-api/scripts/accounting-release.test.ts`, `refund-api/scripts/accounting-release.cli.test.ts`, `refund-api/scripts/accounting-release.run.test.ts`, `refund-api/src/test-support/releaseRun.ts`
  - agent: backend-dev · run
  - Details:
    - Plan § The release steps 5–7: fingerprint and `lines` digest (7); the pure validator (8); then
      in one transaction: advisory lock, marker re-check, pre-release set equal to the file's (7),
      codes read there and the AC-4.11 rule (9), owner names, defaults, one baseline row per employee
      email whose computed baseline is ≥ 1 and differs from the latest, `classifyAndNumber(cause:
      "release", paper)` per employee, the AC-1.2 assertion (rollback, exit 1), the marker.
    - Check mode runs the same transaction and rolls back, ending with the status the real run would
      end with. The real-run report lists decisions that differ from the proposal **recomputed** from
      the workbook and DB, never from the file's columns.
    - A test hook (not a CLI flag) throws after the first employee for AC-5.2.
  - done when: `$ST $WT refund_rn_t13 scripts/accounting-release.test.ts scripts/accounting-release.cli.test.ts scripts/accounting-release.run.test.ts` is green with the int rows of plan § Test strategy for AC-1.1–AC-1.3, AC-1.5–AC-1.11, AC-1.13–AC-1.16, AC-1.18, AC-2.4–AC-2.7, AC-2.9, AC-3.1–AC-3.6, AC-4.11, AC-4.12, AC-5.1 (cli matrix 2, 4, 5, 6, 7, 8, 9 with a DB snapshot unchanged), AC-5.2, AC-5.4 (409 before the real run, also after a dry run; 200 after), AC-5.5 (check numbers = real-run numbers line by line) and AC-5.7; the whole suite `$ST $WT refund_rn_t13` is green; `bun run typecheck` green.

- [x] T14: refund-api — adversarial and cross-cutting release tests: the synthetic production shape end to end, output privacy across every mode and refusal, the audit whitelist and register-content scan, rerun after completion — refs: AC-1.2, AC-1.17, AC-1.18, AC-5.1, AC-5.3, AC-5.6, AC-5.7 — deps: T13
  - touch: `refund-api/scripts/accounting-release.privacy.test.ts`, `refund-api/scripts/accounting-release.production-shape.test.ts`
  - agent: qe · run
  - Details:
    - Production shape (plan § Test strategy, Fixtures): 9 employees, 77 exact, 8 amount-differs, 3
      unmatched, two `LC` and two `FR` employees with codes, a `FR26/002` split, `LG25/001`–`007` then
      `LG26/008`, one `..26/000`, statement rows without date or number, a test account excluded with
      its own code; propose → decide in code → check → real run → every line one number, no number
      equal within (owner, year) outside the split, then a rerun → exit 0, nothing changed.
    - Privacy: stdout, stderr and thrown messages of every mode and every refusal contain none of the
      synthetic names, emails, descriptions, reasons or non-doubtful amounts; employees appear only
      as `<prefix> · <8>`. A scan of every refund table finds no worker text or description; the
      `receipt_number_assigned` detail has only the whitelisted keys.
    - Only new test files; a defect found is a new task, not an edit here.
  - done when: `$ST $WT refund_rn_t14 scripts/accounting-release.privacy.test.ts scripts/accounting-release.production-shape.test.ts` is green and the whole suite `$ST $WT refund_rn_t14` is green.

## PDF — widths (DS-7)

- [x] T15: refund-api — batch PDF receipts cell breaks an over-wide token after its en dash; width tests for 3-letter prefixes and 4–5-digit sequences; journal Description with a 3-letter number — refs: AC-4.8 — deps: none
  - touch: `refund-api/src/batches/pdf.ts`, `refund-api/src/batches/pdf.test.ts`, `refund-api/src/accounting/exportFormat.test.ts`
  - agent: backend-dev · pdf
  - Details: plan DS-7. A local `wrapReceipts` in `pdf.ts` pre-splits a token wider than
    `DETAIL.columns[4].width - 6` after its `–`, then calls the shared `wrapText`; `documentLayout.ts`
    is not changed. `compressReceiptNumbers` and `compareReceiptNumbers` stay as they are.
  - done when: `$ST $WT refund_rn_t15 src/batches/pdf.test.ts src/accounting/exportFormat.test.ts` is green with: `compressReceiptNumbers(["LC26/039", "LCX26/040", "LCX26/041", "LCX26/042", "FR26/002", "FR26/002"])` → `FR26/002, LC26/039, LCX26/040–042`; every receipts line drawn measures ≤ 74 pt with the embedded font for `LCX26/014–016`, `LCX26/1000–1002` and `LCX26/99998–99999`; `describeLine` gives `Cancelleria [LCX26/040] <name>`; the existing PDF golden tests unchanged.

## RUI — refund-ui Receipt codes view

- [x] T16: refund-ui — the whole copy catalog for the feature (en + it) from design § Copy keys, with DS-8's `receiptCodes.shareNote` — refs: AC-4.8, AC-4.9 — deps: none
  - touch: `refund-ui/src/strings.ts`
  - agent: frontend-dev · rui
  - Details: every key of design § Copy keys, plus `settings.history.loading` and
    `settings.history.loadError`. `receiptCodes.shareNote(n)`: EN `1 employee shares a prefix with
    another employee.` / `${n} employees share a prefix with another employee.`; IT `1 dipendente
    condivide il prefisso con un altro dipendente.` / `${n} dipendenti condividono il prefisso con un
    altro dipendente.` (DS-8). No text names the other employee or the cause of a 409.
  - done when: `cd $WT/refund-ui && pnpm exec vitest run src/lib/noHardcodedStrings.test.ts && pnpm exec tsc -b && pnpm lint` is green, and the en/it parity holds (the `it: typeof en` type is the check).
  - evidence: refund-ui vitest 77 files / 1340 tests green (incl. strings.parity and noHardcodedStrings), tsc -b clean, eslint clean; keys under settings.receiptCodes, settings.sections.receiptCodes, settings.descriptionReceiptCodes, settings.history.{loading,loadError,columns.before/after}.

- [x] T17: refund-ui — `receiptCodesApi.ts` client (list, put, history) with the DS-2 and DS-8 row type and error codes — refs: AC-4.1, AC-4.2, AC-4.3, AC-4.7 — deps: none
  - touch: `refund-ui/src/lib/receiptCodesApi.ts`, `refund-ui/src/lib/receiptCodesApi.test.ts`
  - agent: frontend-dev · rui
  - Details: plan § API contracts with `changedAt`, `changedByEmail`, `sharesPrefix`; `putCode(userId,
    code | null)`; errors surface as `ApiError` with `code` (`receipt_code_invalid`,
    `receipt_code_in_use`, `employee_not_found`, `forbidden`), following `accountingApi.ts`.
  - done when: `cd $WT/refund-ui && pnpm exec vitest run src/lib/receiptCodesApi.test.ts && pnpm exec tsc -b && pnpm lint` is green (mocked fetch: paths, method, body, each error code mapped).
  - evidence: refund-ui vitest 78 files / 1352 tests green (receiptCodesApi.test.ts 12), tsc -b and eslint clean.

- [x] T18: refund-ui — `ChangeHistoryDrawer` optional `loading` and `error` props (DS-4) — refs: AC-4.7 — deps: T16
  - touch: `refund-ui/src/components/ChangeHistoryDrawer.tsx`, `refund-ui/src/components/ChangeHistoryDrawer.test.tsx`
  - agent: frontend-dev · rui
  - Details: design S4: loading → `SkeletonRows` and one polite line; error → `ErrorBanner` with
    Retry inside the drawer (Retry keeps focus); with neither prop the drawer is unchanged.
  - done when: `cd $WT/refund-ui && pnpm exec vitest run src/components/ChangeHistoryDrawer.test.tsx src/pages/settings/DefaultsSettingsView.test.tsx && pnpm exec tsc -b && pnpm lint` is green, with jsdom axe (`expectNoAxeViolations`) on loading, error, empty and loaded, and the existing defaults-history tests unchanged.
  - evidence: refund-ui vitest 78 files / 1357 tests green (ChangeHistoryDrawer.test.tsx 14, +5 for loading/error/retry-in-flight/unchanged/axe; DefaultsSettingsView history tests unchanged), tsc -b and eslint clean.

- [x] T19: refund-ui — `ReceiptCodeDialog` (Set/Change, one field, no Clear, no `maxLength`, a–z upper-cased as typed, client shape check, 422/409 field errors, 403/404/network dialog errors) — refs: AC-4.1, AC-4.2, AC-4.3, AC-4.4, AC-4.5, AC-4.6 — deps: T16, T17
  - touch: `refund-ui/src/components/settings/ReceiptCodeDialog.tsx`, `refund-ui/src/components/settings/ReceiptCodeDialog.test.tsx`
  - agent: frontend-dev · rui
  - Details: design S3, RC-5, RC-6, RC-7 and the accessibility bullets for the dialog: `FormDialog`
    `size="sm"`, description with the employee's initials, Save disabled while empty or equal to the
    saved code, focus moved to the field after a failed submit, value kept and selected on a 409.
  - done when: `cd $WT/refund-ui && pnpm exec vitest run src/components/settings/ReceiptCodeDialog.test.tsx && pnpm exec tsc -b && pnpm lint` is green, covering: no request on a bad shape (`A`, `ABCD`, `A1`, `ÀB`, `A B`); `lcx` typed shows `LCX`; `ß` and `À` not altered; Save disabled when empty or equal; 422 and 409 as field errors with local text (never the server `detail`); 404, 403 and network as dialog errors; jsdom axe on empty, valid, 422, 409, busy and dialog error, in en and it.
  - evidence: refund-ui vitest 80 files / 1390 tests green (ReceiptCodeDialog.test.tsx 29 en incl. axe; ReceiptCodeDialog.italian.test.tsx 3 for the it axe pass), tsc -b and eslint clean. Added file outside touch list: ReceiptCodeDialog.italian.test.tsx (language is resolved once per module graph; pattern of MyRequestsPage.italian.test.tsx).

- [x] T20: refund-ui — `ReceiptCodesCard`: the table (S2) with Last changed (DS-2), the "Shares prefix" badge on every flagged row and the count note (DS-8), the Clear row action with `ConfirmDialog` (DS-3), History via the drawer fetched on open (DS-4), success banners and focus rules — refs: AC-4.1, AC-4.3, AC-4.6, AC-4.7, AC-4.8, AC-4.9, AC-4.11 — deps: T17, T18, T19
  - touch: `refund-ui/src/components/settings/ReceiptCodesCard.tsx`, `refund-ui/src/components/settings/ReceiptCodesCard.test.tsx`
  - agent: frontend-dev · rui
  - Details: design S2, S3b, S4, S5, F2–F5, the accessibility bullets (named buttons, badge hint via
    `aria-describedby` on the row's Set code / Change button, focus to the row header after Clear via
    `focusRowKey`, back to the opener after Set/Change and after the drawer). 403 → `PermissionDenied`
    in place of the card (RC-3). The prefix and initials come from the API; the UI derives nothing.
    The history mapping and reversal of DS-4.
  - done when: `cd $WT/refund-ui && pnpm exec vitest run src/components/settings/ReceiptCodesCard.test.tsx && pnpm exec tsc -b && pnpm lint` is green, covering: loading, error with Retry, 403, empty, loaded; badge and count on rows with `sharesPrefix` **with and without** a code, count = flagged rows, no other employee named anywhere; Clear only when a code is set, confirm → row shows initials and "Set code", focus on the row header; Set → row replaced from the 200 body, focus back on the button; Last changed shows date and email, "Not set yet" when null; history drawer loading → loaded newest first, error → Retry; jsdom axe on each state in en and it.
  - evidence: refund-ui vitest 82 files / 1425 tests green (ReceiptCodesCard.test.tsx 30, ReceiptCodesCard.italian.test.tsx 4; dialog test +onNotFound assertion), tsc -b and eslint clean; axe on loading, error, 403, empty, loaded, dialog, confirm, banner, drawer in en and it. Outside touch list: ReceiptCodeDialog.tsx/.test.tsx (optional onNotFound prop so the card reloads after a 404) and ReceiptCodesCard.italian.test.tsx.

- [x] T21: refund-ui — Settings section `receipt-codes` (per-section availability, RC-2), `ReceiptCodesSettingsView`, the nav entry for `receipt-code:manage`, and the first-render test of DS-6 — refs: AC-4.9 — deps: T16, T20
  - touch: `refund-ui/src/pages/SettingsPage.tsx`, `refund-ui/src/pages/SettingsPage.test.tsx`, `refund-ui/src/pages/settings/ReceiptCodesSettingsView.tsx`, `refund-ui/src/pages/settings/ReceiptCodesSettingsView.test.tsx`, `refund-ui/src/pages/settings/SettingsViews.a11y.test.tsx`, `refund-ui/src/components/RefundShell.tsx`, `refund-ui/src/components/RefundShell.test.tsx`
  - agent: frontend-dev · rui
  - Details: design S1 and RC-1/RC-2: `general` with `rate:read` or `settings:read`, `defaults`
    with `settings:read`, `receipt-codes` with `receipt-code:manage`; none of the three → `general`
    (today). One section → no tab list, description `descriptionReceiptCodes`. Unknown or unavailable
    `?section=` → first available. `RefundShell`'s `canSeeSettings` also accepts
    `receipt-code:manage`. `router.tsx` is not changed (it passes any string through).
  - done when: `cd $WT/refund-ui && pnpm exec vitest run src/pages/SettingsPage.test.tsx src/pages/settings src/components/RefundShell.test.tsx && pnpm exec tsc -b && pnpm lint && pnpm exec vitest run` is green, covering: a user with only `receipt-code:manage` from the first render gets the Receipt codes view, no tab list, and `ratesApi.listRates` is never called (DS-6); three sections with all capabilities, the tab label `settings.sections.receiptCodes`; `?section=receipt-codes` without the capability → first available, no error; nav entry shown with only `receipt-code:manage` and hidden without any of the three; jsdom axe on one section and three sections, en and it.
  - evidence: refund-ui vitest 84 files / 1440 tests green (3 consecutive full runs after one unrelated ReviewDetailPage timing flake, which passed alone: 94/94), tsc -b and eslint clean; DS-6 first-render test (receipt-code:manage only: view on first render, no tablist, listRates and getSetting never called); axe for one and three views in en and it. Outside touch list: SettingsViews.a11y.italian.test.tsx (language resolved once per module graph).

## E2E — shell

- [x] T22: e2e — global setup runs the three-step release on the committed header-only fixture — refs: AC-2.8, AC-5.3 — deps: T7, T13
  - touch: `shell/e2e/global-setup.ts`
  - agent: qe · e2e
  - Details: plan § e2e and local: propose into a 0700 temp dir; "already completed" in the output →
    stop; rewrite `proposed` to `confirmed` in the setup's own code, fail naming the inspect command
    when an `unresolved` record remains; real run with `--pairing`; the temp dir removed whatever the
    outcome. The failure message names exits 5–9 instead of exit 3. `E2E_SKIP_REFUND_ACCOUNTING_RELEASE`
    unchanged.
  - done when: `cd $WT/shell && pnpm exec tsc -p tsconfig.e2e.json --noEmit && pnpm exec eslint e2e/global-setup.ts && pnpm exec playwright test --list` is clean (the live run is T32).
  - evidence: `tsc -p tsconfig.e2e.json --noEmit` clean, `eslint e2e/global-setup.ts` clean, `playwright test --list` 270 tests in 57 files; `confirmProposedPairing` output byte-identical to refund-api's `confirmProposed` on a BOM/CRLF/quoted sample and throws naming `line L1` on an `unresolved` record (run with bun); the live run (propose, confirm, run on the dev stack) is T32. The setup passes no `--offsets`: the header-only workbook is the statement "no hand-issued number".

- [x] T23: e2e — `refund-receipt-codes.spec.ts`: accounting user sets, changes (409 shown), clears a code and reads the history by keyboard; a non-holder sees no Settings entry for it; browser axe at the card, the dialog with a 409 and the drawer — refs: AC-4.1, AC-4.3, AC-4.7, AC-4.9 — deps: T1, T5, T21, T22
  - touch: `shell/e2e/refund-receipt-codes.spec.ts`, `shell/e2e/helpers/refundFixtures.ts`
  - agent: qe · e2e
  - Details: design § Accessibility "Tests the tasks should carry" (keyboard journeys, browser
    `axeViolations(page, 'main')`, one dark checkpoint). Codes set in the shared dev database are
    cleared in `afterEach` through the API, and the test codes are drawn from letters no seeded
    employee derives (helper in `refundFixtures.ts`).
  - done when: `cd $WT/shell && pnpm exec tsc -p tsconfig.e2e.json --noEmit && pnpm exec eslint e2e/refund-receipt-codes.spec.ts e2e/helpers/refundFixtures.ts && pnpm exec playwright test --list` is clean and lists the spec (the live run is T32).
  - evidence: `tsc -p tsconfig.e2e.json --noEmit` clean, `eslint` clean on the spec, `helpers/refundFixtures.ts` and `global-setup.ts`; `playwright test --list` 273 tests in 58 files (was 270), the spec lists 3 (keyboard journey with 409 and axe at card, dialog and drawer; dark checkpoint; non-holder). Static only: the live run needs the e2e stack and is T32. Selectors read from refund-ui (`receipt-code-*` test ids, `refund-history-*`, nav link `Settings` of `Refund navigation`); the accountant relies on the `accounting` role's `receipt-code:manage` seed (T1).

## DOCS — runbook, AGENTS.md, ADR amendment, changeset

- [x] T24: infra and repo docs (document only, never deploy): `infra/README.md` § Accounting release runbook steps 0 and 6–8 rewritten, the exit table, `receipt-baseline:from-register` out of the runbook; AGENTS.md (domain terms and the release's three steps); `refund-api/.env.example` comments — refs: none (release plumbing; supports AC-2.8, AC-5.6) — deps: T5, T13, T22
  - touch: `infra/README.md`, `AGENTS.md`, `refund-api/.env.example`
  - agent: devops · docs
  - Details: plan § Runbook changes verbatim (step 6 receipt codes incl. the test account's code and
    the code freeze until step 8; step 7 propose / decide / check; step 8 real run, `SERVICE_CLIENTS`
    clean-up, archive and delete the local files); § Deploy order (auth before codes are set). AGENTS.md
    gains the terms pre-release line, register export, pairing file, imported number, receipt code,
    prefix, and the e2e setup's three steps. No `railway`, `vercel` or deploy command is run.
  - done when: `bash -n infra/check.sh` passes; `mise run env:doctor` is green; every path, script, flag and exit status named in the new text exists in the code (checked by a reviewer, list in the commit message).
  - evidence: `bash -n infra/check.sh` ok; `mise run env:doctor` all checks passed (secrets unresolved, non-secret checks ran); `bun test tools/env-doctor` 299 pass, 1 fail (`push.test.ts` PUSH_ENABLED=false pin vs the template's `true`; fails identically with these edits stashed, so pre-existing, not touched). Runbook steps 0 and 6-8 rewritten, exit table added (0,1,2,4,5,6,7,8,9; 3 retired), old seed step renamed 5b with its three cross-references; AGENTS.md terms and e2e three steps; `.env.example` comment. No railway, vercel or deploy command run.

- [x] T25: ADR amendment by the `adr-writer`: ADR 20261124-a-receipt-code-per-employee-…, decision 5, the Settings flag covers a shared prefix with or without a code (plan DS-8, ADR candidates "A2 amendment") — refs: none (ADR) — deps: none
  - touch: `docs/adr/20261124-a-receipt-code-per-employee-overrides-the-derived-initials-for-new-numbers-only-is-stored-as-a-unique-current-row-with-an-append-only-history-and-is-managed-by-its-own-capability.md`
  - agent: adr-writer · docs
  - done when: the ADR carries a dated amendment matching DS-8 and stating that the 409 rule is unchanged; no other ADR is edited.
  - evidence: decision 5 of the ADR carries "Amendment 2026-11-24 (design sync DS-8)" (flag with or without a code; 409 rule unchanged); its AGENTS.md line updated; `git diff --stat` touches only the ADR, AGENTS.md and this box.

- [x] T26: changeset `.changeset/receipt-numbers-from-the-register.md` (auth minor, refund-api minor, refund-ui minor) — refs: none (release plumbing) — deps: T1, T5, T13, T15, T21
  - touch: `.changeset/receipt-numbers-from-the-register.md`
  - agent: devops · docs
  - done when: `cd $WT && mise run changeset:check` is OK.
  - evidence: `.changeset/receipt-numbers-from-the-register.md` (@operai/auth, @operai/refund-api, @operai/refund-ui, minor; same frontmatter style as hours-ui-record-in-place.md); `mise run changeset:check` result recorded in the commit message.

## CLOSE — QE, security, eval, closing (the gate)

- [x] T27: QE pass over all 52 ACs — refs: all ACs (nominal) — deps: T1, T14, T15, T21, T23, T24, T25, T26
  - touch: `specs/20261124-receipt-numbers-from-the-register/qe-report.md`
  - agent: qe · close
  - Details: every AC has a named, executed test (§ Coverage). Re-run each done-when on fresh scratch
    databases (`refund_rn_qe`, `auth_rn_qe`), including any auth seed test left pending by T1. The
    migration test on a database with numbered lines. Read the release's output of T14's privacy test
    by eye once. The manual browser accessibility pass and the live e2e are listed under T32, not run
    here.
  - done when: `qe-report.md` has verdict PASS; green: `$ST $WT refund_rn_qe` (whole refund-api suite), `cd $WT/refund-api && bun run typecheck`, auth `bun test src/authz` and `bun run typecheck`, `cd $WT/refund-ui && pnpm exec vitest run && pnpm exec tsc -b && pnpm lint && pnpm build`, the shell e2e static checks of T22/T23, `mise run changeset:check`. The live e2e is PENDING (T32), not a failure.
  - evidence: `qe-report.md` verdict PASS: refund-api 2331 pass / 0 fail (94 files) + tsc clean, auth `src/authz` 332 pass + typecheck clean, refund-ui 1440 pass + tsc + lint + build clean, shell e2e static clean (273 tests listed), changeset check OK against origin/main; 32 mutants, 3 real test gaps closed by 4 new tests, no product defect; environment faults E-1 to E-3 (stale Prisma client, estimai-ui without node_modules, changeset base) listed in the report; live e2e PENDING (T32).

- [ ] T28: OWASP review (plan § Security, standard tier), in parallel with QE — refs: all ACs (nominal) — deps: T1, T14, T15, T21, T23, T24, T25, T26
  - touch: `specs/20261124-receipt-numbers-from-the-register/security-review.md`
  - agent: owasp-reviewer · close
  - Details: the five surfaces of plan § Security (the xlsx reader; the release script and report;
    the receipt-code routes; the migration; the auth seed). Escalate to frontier only on the plan's
    trigger (register content reaching a log, the DB or a response).
  - done when: `security-review.md` lists no open high or critical finding; any fix is a new task appended here, with an overlap check.

- [ ] T29: Eval — refs: all ACs (nominal) — deps: T27, T28
  - touch: `specs/20261124-receipt-numbers-from-the-register/eval-report.md`
  - agent: orchestrator · close
  - done when: `/wellforge:eval` produces a passing `eval-report.md`.

- [ ] T30: **The gate.** All gates green; QE, security review and eval pass; the live e2e reported green; spec status → done — refs: all ACs (nominal) — deps: T29, T32
  - touch: `specs/20261124-receipt-numbers-from-the-register/spec.md`, `specs/20261124-receipt-numbers-from-the-register/tasks.md`
  - agent: orchestrator · close
  - Details: **this task defines the gate.** It closes only when tasks **T1–T29 and T32** are checked
    (plus every fix-round task appended after them), `qe-report.md` says PASS, `security-review.md`
    has no open high, `eval-report.md` passes and the changeset is present. The owner tasks T31 and
    T33 are not part of the gate (they feed the release), and **T34 (the release) comes after this
    task by its deps**.
  - done when: `/wellforge:done 20261124-receipt-numbers-from-the-register` accepts.

## OWNER

- [ ] T31: [OWNER] Propose-mode dry run on the real register, days before the release (plan R1) — refs: AC-2.1, AC-2.2, AC-2.3 (live evidence) — deps: T12
  - touch: none (the register export and the pairing file stay outside the repository)
  - agent: owner
  - Details: on a copy of production restored into a scratch database with this branch's migrations
    applied (never production itself before refund-api 0.5.0 is deployed), with `Recap_RS_2026.xlsx`
    taken from accounting and kept outside any git worktree:
    `bun run accounting:release --dry-run --register ~/Recap_RS_2026.xlsx --propose ~/pairing-2026.csv`.
    If the reader refuses the workbook (exit 6), save it again as `.xlsx` in Excel and retry; a
    feature it still refuses is a new task for the XLSX track.
  - done when: exit 0; the report's counts are close to the 2026-11-24 facts (77 exact, 8 amount differs, 3 unmatched over 88 lines of 9 employees) or every difference is explained; the report shows no name, email or worker text; the result (counts only) is noted in `qe-report.md` by the owner.

- [ ] T32: [OWNER] Live e2e and the manual browser accessibility pass — refs: AC-4.1, AC-4.3, AC-4.7, AC-4.9, AC-2.8 (live evidence) — deps: T22, T23
  - touch: `specs/20261124-receipt-numbers-from-the-register/qe-report.md`, `specs/20261124-receipt-numbers-from-the-register/design.md`
  - agent: owner
  - Details: on the e2e stack (shared dev Postgres), with `mise run dev`. The global setup's
    three-step release runs once on a database not yet released; on an already-released one it exits 0
    at step 0. The browser pass covers design § Accessibility hotspots 1–5 in light and dark, and the
    320 px reflow of the card.
  - done when: `cd $WT/shell && pnpm e2e e2e/refund-` passes, every existing `refund-*.spec.ts` included; the browser pass is recorded in design.md ("Browser accessibility pass"); the result is noted in qe-report.md.

- [ ] T33: [OWNER] Accounting decisions for the release: the open questions of spec.md answered or their fallbacks accepted; the receipt-code holders (LCM/LCP, FRO/FRI, the test account's code); the pairing file decided (workers mapped, the test account `excluded`, every doubtful line decided, malformed and worker-less rows acknowledged, every record `confirmed`) — refs: AC-1.3, AC-1.4, AC-1.10, AC-1.11, AC-1.13, AC-1.14, AC-1.15, AC-4.11 (decisions) — deps: T31
  - touch: `specs/20261124-receipt-numbers-from-the-register/spec.md` (only to record answers to open questions)
  - agent: owner (accounting, product)
  - done when: each open question of spec.md has its answer or accepted fallback recorded; the decided pairing file exists outside the repository and a check-mode dry run on the production copy (`--dry-run --register … --pairing …`) exits 0 with the numbers accounting accepts.

- [ ] T34: [OWNER] Release, by the runbook of `infra/README.md` (deploy auth, refund-api 0.5.0 and refund-ui; step 6 receipt codes set in Settings; step 7 propose, decide, check on production; step 8 real run, `SERVICE_CLIENTS` clean-up, archive and delete the local files) — refs: none (release) — deps: T30, T33
  - touch: `CHANGELOG.md`, `*/CHANGELOG.md`, `*/package.json`, `shell/src/lib/suiteVersion.generated.json`, `.changeset/*`
  - agent: owner
  - done when: RELEASING.md "Before" checks pass; `operai@<X.Y.Z>` is tagged; auth's deploy log shows `+ receipt-code grants`; the Settings list shows no "Shares prefix" badge for anyone who receives a new number; the real run exits 0 and a rerun prints "already completed"; the first WellD CH approval after it succeeds with a number after the employee's baseline carrying the code or initials.

## Coverage

Implementing and verifying tasks per AC. Nominal references (T27–T30) are left out. Every AC of the
spec (52) has at least one agent task; owner tasks add live evidence only.

| AC | Tasks |
| --- | --- |
| AC-1.1 | T9, T10, T13 |
| AC-1.2 | T4, T13, T14 |
| AC-1.3 | T9, T10, T13, T33 |
| AC-1.4 | T9, T33 |
| AC-1.5 | T9, T10, T13 |
| AC-1.6 | T2, T4, T9, T10, T13 |
| AC-1.7 | T9, T10, T13 |
| AC-1.8 | T9, T13 |
| AC-1.9 | T9, T11, T13 |
| AC-1.10 | T9, T13, T33 |
| AC-1.11 | T2, T9, T13, T33 |
| AC-1.12 | T9 |
| AC-1.13 | T8, T9, T10, T13, T33 |
| AC-1.14 | T9, T10, T13, T33 |
| AC-1.15 | T9, T10, T13, T33 |
| AC-1.16 | T9, T10, T13 |
| AC-1.17 | T4, T13, T14 |
| AC-1.18 | T2, T13, T14 |
| AC-2.1 | T7, T8, T12, T31 |
| AC-2.2 | T11, T12, T31 |
| AC-2.3 | T10, T12, T31 |
| AC-2.4 | T10, T13 |
| AC-2.5 | T13 |
| AC-2.6 | T10, T13 |
| AC-2.7 | T7, T10, T13 |
| AC-2.8 | T12, T22, T32 |
| AC-2.9 | T13 |
| AC-3.1 | T9, T11, T13 |
| AC-3.2 | T13 |
| AC-3.3 | T4, T13 |
| AC-3.4 | T11, T13 |
| AC-3.5 | T4, T13 |
| AC-3.6 | T13 |
| AC-4.1 | T5, T17, T19, T20, T23 |
| AC-4.2 | T3, T5, T17, T19 |
| AC-4.3 | T2, T5, T17, T19, T20, T23 |
| AC-4.4 | T3, T4, T19 |
| AC-4.5 | T3, T4, T19 |
| AC-4.6 | T5, T19, T20 |
| AC-4.7 | T2, T5, T17, T18, T20, T23 |
| AC-4.8 | T15, T16, T20 |
| AC-4.9 | T1, T5, T16, T20, T21, T23 |
| AC-4.10 | T4, T5 |
| AC-4.11 | T5, T9, T11, T13, T20, T33 |
| AC-4.12 | T4, T13 |
| AC-5.1 | T12, T13, T14 |
| AC-5.2 | T13 |
| AC-5.3 | T12, T14, T22 |
| AC-5.4 | T13 |
| AC-5.5 | T13 |
| AC-5.6 | T6, T11, T12, T14 |
| AC-5.7 | T13, T14 |

**Both directions.** All 52 ACs have at least one implementing agent task. Tasks that serve no AC
directly, and why: T24 (runbook and docs), T25 (ADR amendment), T26 (changeset), T34 (the release).
T27–T30 refer to every AC nominally. Every other task has at least one AC. No AC is unmappable, so no
spec or plan bug was found by the mapping.

## Overlap check

Effective graph = `deps:` ∪ `touch:` overlap. Globs (`*` does not cross `/`) were expanded against each
other. "A → B" means A comes before B.

**Ordered by an explicit dep:**

- `refund-api/src/accounting/receiptCode.repo.ts`: T4 creates it with `receiptPrefix` only, T5 adds
  the list, set and history queries. T4 → T5.
- `refund-api/scripts/accounting-release.ts`, `scripts/accounting-release.test.ts`,
  `scripts/accounting-release.cli.test.ts`, `src/test-support/releaseRun.ts`: T12 → T13. T14's two
  test files are distinct names (no task uses an `accounting-release.*` glob).
- `refund-api/scripts/receipt-baseline-from-register.ts` and its test: T6 only.
- `refund-api/scripts/release/*`: distinct files per task (T6 `types.ts`, T7 `xlsxReader.*`, T8
  `registerExport.*`, T9 `pairing.*`, T10 `pairingFile.*`, T11 `report.*`); no task uses a glob there.
- `refund-ui/src/strings.ts`: T16 only. **Registry overlap removed by design**: without it T18–T21
  would serialize on it.
- `refund-ui/src/components/ChangeHistoryDrawer.*`: T18 only. T20 uses it.
- `shell/e2e/global-setup.ts`: T22 only. `shell/e2e/helpers/refundFixtures.ts`: T23 only.
- `.changeset/*` (T34's glob) vs `.changeset/receipt-numbers-from-the-register.md` (T26): T26 → T30
  → T34.

**Registries, each with one owner:**

| Registry | Owner |
|---|---|
| `refund-api/src/index.ts` (route mounts) | T5 |
| `refund-api/prisma/schema.prisma`, `prisma/migrations/*` | T2 |
| `refund-api/src/test-support/dbCleanup.ts` | T2 |
| `refund-api/src/requests/audit.ts` | T4 |
| `auth/src/authz/seed.ts`, `auth/src/authz/catalogs/refund.ts` | T1 |
| `refund-ui/src/strings.ts` | T16 |
| `.gitignore` | T12 |
| `infra/README.md`, `AGENTS.md` | T24 |

**No overlap (checked):**

- auth (T1) vs everything else.
- CORE (T2–T4) vs XLSX (T6–T8) vs PAIR (T9–T11): distinct files. `receiptNumber.ts` is T3's; T6, T9
  and T10 import it without editing it.
- T12's four adapted test files (`accounting-unavailable.matrix`, `classification.inactive-default`,
  `natural-keys`, `no-cache`) are touched by no other task.
- `src/accounting/numbering.repo.test.ts` and `receipt.lifecycle.test.ts` (T4) vs `receiptCode.*`
  (T5): distinct names.
- PDF (T15) vs CORE: `pdf.ts`, `pdf.test.ts`, `exportFormat.test.ts` are T15's only; `exportFormat.ts`
  is not edited.
- RUI (T16–T21) vs refund-api, auth and shell: no shared path.
- T21 touches `src/pages/settings/SettingsViews.a11y.test.tsx`; T18 runs
  `DefaultsSettingsView.test.tsx` without editing it.

## Parallel batches (effective graph)

Computed on deps ∪ `touch:` overlap, earliest start, ties broken by task number. Within a batch no two
tasks share an edge or a path.

| Batch | AUTH | CORE / CODE | XLSX / PAIR / RUN | PDF | RUI | E2E / DOCS / CLOSE / OWNER | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | T1 | T2, T3 | T7 | T15 | T16, T17 | T25 | No prerequisites. |
| B2 | | T4 | T6 | | T18, T19 | | |
| B3 | | T5 | T8, T9, T10 | | T20 | | PAIR runs against `types.ts`, not the reader. |
| B4 | | | T11 | | T21 | | |
| B5 | | | T12 | | | | Joins CORE (T4) and XLSX/PAIR. |
| B6 | | | T13 | | | T31 [OWNER] | T31 can run as soon as propose exists. |
| B7 | | | T14 | | | T22, T26, T33 [OWNER] | |
| B8 | | | | | | T23, T24 | |
| B9 | | | | | | T27, T28, T32 [OWNER] | Security runs in parallel with QE. |
| B10 | | | | | | T29 | |
| B11 | | | | | | T30 (the gate) | |
| B12 | | | | | | T34 [OWNER] | After the gate and T33. |

**Critical path:** T3 → T6 → T9 → T11 → T12 → T13 → T22 → T23 → T27 → T29 → T30 → T34 (T2 → T4
joins at T12 with a batch to spare). The RUI track finishes by B4 and AUTH, PDF and CODE by B3, so
they have slack for review rework.

## Implementation notes

Deviations and findings recorded while a task closed (branch `rn/release`, T6 to T14, unattended run of 2026-11-24).

- **T12, `PaperAssignment.split` (T4 file touched).** AC-1.7 and the plan's pairing-file section say a split group of ONE line records
  origin `paper_split`, but `classifyAndNumber` derived `paper_split` only when one number appears on several lines. `PaperAssignment`
  gained an optional `split?: boolean` in `refund-api/src/accounting/numbering.repo.ts` (default: derived, so every T4 caller and test is
  unchanged); the release sets it for every line whose decision is `split`. `numbering.repo.ts` is not in T12 or T13's `touch:` list.
- **T12, the real run before T13.** T12 commits the whole control flow (marker first, exits 2/4/5/6, propose, the transaction with names,
  defaults, baseline rows, numbering and the marker) so the four existing suites and the CLI journeys can move to
  `proposeAndConfirm`. The stale check (7), the validator (8) and the shared-prefix rule (9) are T13: until it lands the real run trusts
  the file's decisions.
- **T12, `--offsets` matching.** The old rule "the newest request must carry the listed email" is gone: a row applies to any email the
  employee's requests used and the baseline row is written under the newest one (the counter reads them all, N-01). An offsets email held
  by two user ids is still refused (exit 6). No message quotes an email any more (AC-5.6); `maskEmail` and `--show-emails` are removed.
- **T12, `.gitignore`.** `**/*pairing*.csv` and `**/Recap_RS*` added as the task says; the existing offsets patterns stay.
- **T12, marker-first and old tests.** A release that has completed does nothing (D11), so the old "a second run completes what was
  left" semantics are retired: tests that ran the release on a database that already carried the marker now start from the
  pre-release state (`classification.inactive-default.test.ts` empties the standalone `refund_setting` table in a `beforeEach`).
- **T13, where each check runs.** The register fingerprint and the sheet are compared before the transaction opens (7); the lines
  digest, the validator (8) and the shared-prefix rule (9) run inside it, after the advisory lock and the marker re-check and before
  the first write, so a refusal rolls back nothing because nothing was written. The check mode (`--dry-run --pairing`) throws the same
  errors, so it ends with the status the real run would.
- **T13, the fault hook.** `ReleaseOptions.afterEmployeeNumbered(employeesDone)` is the in-process test hook of AC-5.2; there is no CLI flag.
- **T13, register rows of an audit entry.** For a paper line the audited positions are the rows of that number on the line's expense date
  whose total equals the line's (a split of two lines gets one row each), else every row of the number on that date (one line, two rows),
  else every row of the number (a pairing made by hand). Positions only (AC-1.17).
- **T13, AC-1.15.** A worker mapped to an excluded employee is refused (plan D3), so the operator marks the worker `not-operai` and
  gives the excluded account's lines `new`; the proposal had paired them when the worker carried the account's name. The test account
  needs its own code only when its derived initials meet another employee's prefix (AC-4.11 at the release).
- **T13, the assertion of AC-1.2.** After numbering, every pre-release line has a number, a line took the kind of number its decision
  says (`issued` iff `new`), every counter moved by exactly the number of lines that took a new number in its year and the 2026
  counter started after the baseline; otherwise the run is rolled back (exit 1).
- **T14, nothing found.** The production-shape, privacy and rerun tests found no defect in T12 or T13; they only add test files. The
  production shape builds its own worksheet with the writer of `src/accounting/xlsx.ts` because the T7 builder cannot write an empty
  expense date (the statement rows); the builder is untouched. The register's worker texts are the employees' names in capitals so a scan
  of every table can tell register content from an employee's own name.
- **T12 to T14, the real register (T31 in part).** The propose mode's reader step was run once against the real `Recap_RS_2026.xlsx` on
  a scratch database (`refund_rn_real`, no Refund data, fake ports): the workbook was read without a refusal (253 rows, 19 distinct
  workers, no formula without a stored value, no malformed number, no row without date or total, 7 rows without a number, 2 with a
  sequence 000, 7 with a year other than 26). The pairing against production lines is the owner's step T31, which needs production.
