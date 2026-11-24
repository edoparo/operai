---
feature: 20261124-receipt-numbers-from-the-register
task: T28
date: 2026-11-24
verdict: PASS with notes
---

# Security review (OWASP Top 10): receipt numbers from the register

Scope: `git diff 0a6735aa..a00780fa -- ':!specs' ':!*.md'` (90 files), static, read-only (owasp-reviewer agent). No tests,
services, databases or env files were run or read.

**Verdict: PASS with notes.** 0 critical · 0 high · 0 medium · 3 low · 10 info. The dispositions below were added by the
orchestrator; a fix round follows QE (T27).

| # | Severity | Finding | Location | Disposition |
|---|---|---|---|---|
| L-1 | low (A09/A04) | The operator-file location check only warns: `--propose` writes a file with names and emails even inside a git worktree, and `.gitignore` covers only `**/*pairing*.csv` and `**/Recap_RS*`. | `scripts/accounting-release.ts` ~1328-1335, `scripts/lib/operatorFiles.ts` 27-53, `.gitignore` 25-28 | Fixed in 4010237d |
| L-2 | low (A03, CSV injection) | The `row` record's `label` (the cell's shape) is not passed through `neutralise()`; punctuation survives `shapeOf`, so a shape can start with `=`/`-`/`@`. | `scripts/release/pairingFile.ts` ~162 | Fixed in 4010237d |
| L-3 | low (A04) | Receipt-number uniqueness is per owner (index on owner, year, seq, part), not global; two employees with colliding prefixes can hold the same text. Not new; mitigated by `number_taken`, `prefix_differs`, `sharesPrefix`, 409 `receipt_code_in_use`, exit 9. | migration `20261124090000_receipt_numbers_from_register` § 4 | Accepted risk (per-employee sequences are the spec's AC-4.6 model); recorded here. |
| I-1 | info | xlsx reader: zip-bomb, ZIP64, encryption, method, EOCD, CRC, DOCTYPE/entities, depth, merge and cell caps all hold; fixed refusal messages. Optional: aggregate inflated-bytes budget; reject trailing content after the root element. | `scripts/release/xlsxReader.ts` | No action. |
| I-2 | info | Pairing/offsets writing: `O_EXCL` + 0600, symlink-safe, fingerprints prefixed `sha256:`, free text neutralised (except L-2). | `pairingFile.ts`, `operatorFiles.ts` | No action. |
| I-3 | info | No size cap on the pairing/offsets read (register capped at 20 MiB after read). Local operator tool. | `accounting-release.ts` | Optional. |
| I-4 | info | Privacy of output: report has no name/email field; failure text is class + code. Two `ReleaseError` messages interpolate `${ref}`: confirm it is the `employeeRef` form. | `accounting-release.ts` ~1001, ~1004 | Fixed in 4010237d |
| I-5 | info | Receipt-code API: capability gate before validation on all routes; actor from the JWT; strict body; fixed 404/409 wording; advisory lock per employee; unique index decides races; append-only history. Small window: the issued-prefix check is not serialised against a concurrent numbering of another employee (effect: a flagged shared prefix). | `src/accounting/receiptCode.*` | No action. |
| I-6 | info | Migration: shape/range/all-or-none CHECKs, guard v3 freezes origin and part, deferred split trigger, append-only history; no CHECK ties number text to year/seq (application-validated); TRUNCATE not blocked (suite-wide posture). | migration | No action. |
| I-7 | info | `receipt-code:manage` seeded to `accounting` and `admin` only, idempotent `ensureGrant`. | `auth/src/authz/*` | No action. |
| I-8 | info | refund-ui: no `innerHTML`, server `detail` not rendered, ids encoded. | `refund-ui/src/*receiptCode*` | No action. |
| I-9 | info | e2e global setup: private temp dir and 0600 file, URL scrubbed; it auto-confirms proposals against whatever database it is pointed at. | `shell/e2e/global-setup.ts` | Fixed in 4010237d |
| I-10 | info | No new dependency. | — | No action. |

## Fix round, 2026-11-24

L-1, L-2, I-4 and I-9 are fixed in 4010237d, each with a test that fails without the fix. L-1: `--propose` inside a git worktree is refused with exit 1 (nothing read or written; `.gitignore` now also covers `**/accounting-release*.csv`). L-2: the `row` shape and the `currency` are neutralised (the employee id is `E<n>` or `mailto:`, `proposedNumber` is built from a validated paper number: constructed values). I-4: the employee reference is always `<prefix> · <8>` or `not yet in Refund`, never a name or an email; privacy test added. I-9: the e2e release step refuses a non-local `E2E_REFUND_DATABASE_URL` host unless `E2E_ALLOW_REMOTE_DB=1`; when that override is not set, the database comes from the service's own direnv file, which the setup does not read, so that case is not checked. Not touched: L-3 (accepted), I-1 to I-3, I-5 to I-8, I-10.
