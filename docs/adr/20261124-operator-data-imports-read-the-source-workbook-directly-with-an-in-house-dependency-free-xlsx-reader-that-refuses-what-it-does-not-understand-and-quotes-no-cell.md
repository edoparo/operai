# 20261124 — Operator data imports read the source workbook directly with an in-house, dependency-free xlsx reader that refuses what it does not understand and quotes no cell

**Date:** 2026-11-24  
**Status:** Accepted — approved plan of specs/20261124-receipt-numbers-from-the-register (approved 2026-11-24 under the owner's choice of an unattended overnight run; review on the owner's return); decision D1 and the security surface 1 of the plan. Plan ADR candidate A3. It constrains the next feature (the Excel detail extract) and any later register import.  
**Deciders:** Matteo Codogno (product owner), by choice of the unattended run; the architect proposed it in the plan  
**Project:** operai  
**Relates to:** ADR 20261118-the-accounting-export-is-generated-on-request-never-stored-and-logged-append-only-with-its-content-hash-and-format-version (the in-repo deterministic xlsx **writer**, this decision is its mirror), ADR 20261118-monthly-exchange-rates-are-fetched-on-demand-from-the-federal-source-recorded-once-and-corrected-only-by-an-admin-never-by-a-scheduler-and-the-outbound-fetch-is-hardened (DOCTYPE and entity refusal, size caps for an outside document), ADR 20261124-a-one-off-release-that-needs-human-judgement-runs-as-propose-then-confirm-then-run-and-the-confirmation-is-a-file-bound-to-its-inputs-and-refused-when-they-changed (the reader feeds the propose step).

---

## Context

The release now takes its numbers from the accountant's own register workbook (`Recap_RS_2026.xlsx`). The match keys are the expense date and the total to the cent, and the workbook holds them typed (a date serial, a numeric value). The project avoids new dependencies, and 20261118 already wrote a small deterministic xlsx writer. The file is untrusted binary input from outside the system, holding personal and financial data (names, dates, amounts), and the release runs on an operator's machine with access to production.

## Decision

We will read the accountant's `.xlsx` **directly**, with an in-house reader of about 300 lines and **no new dependency** (`scripts/release/xlsxReader.ts`: ZIP with stored and deflate entries via `node:zlib`'s `inflateRawSync`, and a minimal OOXML tokenizer), reading only the four columns it needs, found by header text, and **refusing with a named reason, never a cell value**, anything it does not understand.

1. **ZIP.** End-of-central-directory scan in the last 64 KiB, central directory, local headers. Methods 0 and 8 only. Refused: ZIP64, encryption, other methods, more than 10,000 entries, a compressed file over 20 MiB, an entry inflating beyond 64 MiB (`maxOutputLength`), a CRC mismatch.
2. **XML.** A tokenizer by local name (transitional and strict namespaces). A `<!DOCTYPE` is refused (entity expansion, XXE). Only the five predefined entities and numeric character references are decoded. Parts read: workbook, its relationships, shared strings (runs concatenated, phonetic parts ignored) and the one worksheet. No recursion on attacker-controlled depth.
3. **Cells and values.** Types `s`, `str`, `inlineStr`, `n`, `b`, `d`; an error cell, or a formula with no cached value, is unreadable (the message tells the operator to save the workbook in Excel). Merged ranges propagate the top-left value. A date serial (1900 with its leap-year quirk, or 1904) becomes `YYYY-MM-DD`. A numeric total is rounded half away from zero to cents **on its decimal string**, never by a float multiplication.
4. **Keep only what is needed.** Four columns (`Worker`, `No.`, `Date`, `Total`) found in the first 20 header rows, trimmed and case-insensitive; every other column is never kept. The only reference to a register row that is ever stored or printed is its sheet row position (`R37`).
5. **Errors name the feature, not the content.** A failure says which structural rule failed (exit 6), never a cell, a name or an amount. The fingerprint of the run is the SHA-256 of the accountant's own file.
6. **Fail early.** The propose-mode dry run is the early check on the real workbook, run days before the release (R1). The remedy for a refusal is to save the file again as `.xlsx` in Excel.

## Failure shape

**A document from outside is turned into data by a step that either interprets more than it should, or loses precision on the way, or says more about it than it should.** Interpreting more: a compressed container that expands without bound, a markup that fetches or expands entities, a formula that is evaluated. Losing precision: the value that is the *key* of a match is re-typed through a locale-dependent format on its way in, so `24.50` becomes `24,5` or a date swaps day and month, and an exact match silently turns into a doubt or a wrong match. Saying too much: the error path or the report prints the cell it choked on, and personal data reaches a log or a terminal history.

Where else this shape can appear, including the mirror-image positions:

- **Reader and writer.** The in-house writer (the accounting export) and this reader are two halves of one rule: text only ever reaches a cell as escaped data, and what is read is read as data, never as a formula or a command. A new output format needs the same discipline on the way out (a leading `=`), a new input format on the way in.
- **Export and re-import.** Round-tripping through CSV, a clipboard or a spreadsheet's "save as" changes types and separators. Where a value is a key, take it from the typed source or compare on its exact decimal string.
- **Any untrusted container.** A PDF, an image, a zip or tar, a docx, an uploaded CSV with a huge field: caps on compressed size, inflated size, entry count and nesting, and a refusal for the features not needed (encryption, ZIP64, external entities), come before the parse.
- **Library or no library.** Pulling a dependency for a one-off read imports its whole attack surface; writing a parser means owning its refusals. Whichever is chosen, the list of what is refused is written down and tested with hostile fixtures.
- **Errors and logs.** The message from a parser on bad input is itself an output; it must not contain the input.

## Options considered

### Option A — Read the `.xlsx` directly with an in-house reader (chosen)

Described above.

**Pros:**
- Typed dates and totals, so exact matches stay exact
- No extra copy of a personal-data file on a laptop, and no locale or encoding step
- The fingerprint is that of the file accounting can archive
- No new dependency; the same style and tests as the existing writer

**Cons:**
- About 300 lines to own and test, including the refusals
- A workbook feature it does not handle (a formula with no cached value, a strict-OOXML quirk) stops the run until the file is saved again

### Option B — The operator exports a CSV (rejected)

**Pros:**
- A trivial parser

**Cons:**
- The export passes through the locale: `;` delimiters, `14.03.2026`, `24,50`, `1'234.50`, `CHF 24.50`; a re-typed number can lose its cents, which is exactly what would turn exact matches into doubts or wrong matches
- One more personal-data copy and one more manual step, only for the active sheet, with an encoding choice that affects names

### Option C — An xlsx library (`exceljs`, `xlsx`) (rejected)

**Pros:**
- Broader format coverage

**Cons:**
- Supply chain and size for a one-off read, and its parser's surface is not ours to bound

### Option D — Accept both xlsx and CSV (rejected)

**Pros:**
- Flexible for the operator

**Cons:**
- Two parsers and two fingerprint semantics for a release that runs once

## Evidence

Implemented (updated 2026-11-24; QE verdict PASS in `specs/20261124-receipt-numbers-from-the-register/qe-report.md`):

- Synthetic workbooks: `src/test-support/registerWorkbook.ts` (with `registerWorkbook.test.ts`); `scripts/release/xlsxReader.test.ts` "readXlsxSheet: what the builder writes is read back" over the builder's variants (stored and deflate, 1904 date serials among them), and `scripts/release/registerExport.test.ts` "is the same through every variant of the builder".
- One test per refusal: `scripts/release/xlsxReader.test.ts` "readXlsxSheet: refusals name the feature and quote no cell": "a DOCTYPE", "a zip bomb declaring its real size", "a zip bomb declaring one byte", "ZIP64", "encryption", "compression method 12", "a CRC mismatch (header flipped)", "a CRC mismatch (a data byte flipped in a stored part)", "more than 10,000 entries", "a compressed file over 20 MiB", "a corrupt deflate stream"; in "hand-made parts": "an entity other than the five is refused", "markup nested too deeply is refused without recursion", "a merge covering a huge area is refused, not expanded".
- Float totals on the decimal string: `scripts/release/registerExport.test.ts` "totals to the cent, on the decimal string (AC-2.1: no float ever)" (`1.0049999999999999` → 100 cents, `24.5` → 2450); `xlsxReader.test.ts` "a number cell keeps its decimal string as stored, never a float".
- Merged cells and dates: `xlsxReader.test.ts` "a merged worker cell is read over the whole range"; `registerExport.test.ts` "propagates a merged worker cell over its rows", "a date cell" (1900 serial, leap day), "text dates and totals of every form, and a 1904 serial".
- No failure message contains the cell: `xlsxReader.test.ts` "only the refusals' own messages are ever thrown: every code has a fixed message with no placeholder"; `registerExport.test.ts` "a malformed number never carries the cell's text", "a missing column is a named refusal and quotes nothing"; `scripts/accounting-release.cli.test.ts` "an unreadable workbook, a missing sheet, a sheet with no header, a pairing file of another format and a bad offsets file are exit 6, quote no cell, and write nothing".
- Security review surface 1 (standard tier): `security-review.md` I-1, no action needed.
- The real workbook: the propose step's reader ran once on `Recap_RS_2026.xlsx` against an empty scratch database with no refusal (tasks.md § Implementation notes); the pairing against production lines is owner task T31.

## Consequences

**Positive:**
- The register is read as the accountant typed it
- The next import (the Excel detail extract) starts from a bounded, tested reader

**Negative / trade-offs:**
- A new reader to maintain next to the writer; each format feature added is a decision with a test

**Risks:**
- **The reader meets a feature it does not handle** (plan R1). Mitigation: it refuses loudly (exit 6) naming the feature; run the propose-mode dry run days before the release.
- **Float totals** (plan R2). Mitigation: rounding on the decimal string; a residual mismatch falls into the "amount differs" category a person decides, which fails safe.

## Escalation triggers

- A second workbook layout, a sheet with formulas that must be evaluated, or an encrypted or ZIP64 file: reopen this decision before extending the reader.
- A dependency that is already in the repository for another reason and covers xlsx reading safely: compare it against this reader.

## Compliance notes

- GDPR / data-protection impact: low. The file holds names and expense data of employees, is read on an operator's machine outside any git worktree (a warning is printed if the path read is inside one; the pairing file the propose step **writes**, which also holds names, is refused with exit 1 when its path is inside one, checked after the completed-release marker so a released database still exits 0: amendment 2026-11-24, security fix round L-1 and eval round 1) and is not stored in Operai; only paper numbers and sheet row positions are written to the database.
- Data residency: no change; the file stays with accounting.
- Audit trail: not required for the read; the numbers it yields are audited per line.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
