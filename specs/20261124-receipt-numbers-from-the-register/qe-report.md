# QE report: receipt numbers from the register (T27)

Spec 20261124, rigor `production`. Branch under test: `refund/register-numbers` at `a00780fa` (T1 to T26 landed; a later docs-only
commit `c0bd8253`, the T28 security review, does not touch code). Run date 2026-11-24. QE branch `rn/qe` in `../operai-rn-qe`.

## QE verdict: PASS

No product defect found. Three test gaps (four tests) were found by mutation checks and closed with new tests (below). The live e2e, the
manual browser accessibility pass and the propose run on the real register are owner steps (T31, T32) and are PENDING, not failures.

| Check | Threshold | Actual | Result |
|---|---|---|---|
| AC coverage | 52/52 ACs with an executed test | 52/52 (table below); AC-1.12 unit only, as the plan says | PASS |
| refund-api whole suite (`scratch-test.sh ... refund_rn_qe`) | 0 fail | 2331 pass, 0 fail, 94 files (after `bun run db:generate`, see Environment faults); with the 3 new files 2335 | PASS |
| refund-api `bunx tsc --noEmit` | clean | clean (also with the new tests) | PASS |
| auth `bun test src/authz` on scratch `auth_rn_qe` | 0 fail | 332 pass, 0 fail, 20 files (includes the T1 seed test left pending by T1: `receipt-code:manage` to `accounting` and `admin` only, second seed changes nothing) | PASS |
| auth `bun run typecheck` | clean | clean | PASS |
| refund-ui `vitest run` | 0 fail | 84 files, 1440 tests, 0 fail (second full run; first run had one timing failure, see Flakes) | PASS |
| refund-ui `tsc -b`, `pnpm lint`, `pnpm build` | clean | clean, clean, built | PASS |
| shell e2e static: `tsc -p tsconfig.e2e.json --noEmit`, eslint on the three e2e files, `playwright test --list` | clean | clean, clean, 273 tests in 58 files (spec lists 3 receipt-code tests) | PASS |
| `changeset:check` | OK | `node scripts/check-changeset.mjs --base=$(merge-base HEAD origin/main)`: OK, matched `.changeset/receipt-numbers-from-the-register.md` (the mise task's base is local `main`, which equals HEAD here and so reports "nothing to gate": see Environment faults) | PASS |
| env-doctor tests (`bun test tools/env-doctor`) | only the known failure | 299 pass, 1 fail: `notify-api web push env > the production template ships push off ...` (push.test.ts, known on main, unrelated) | PASS (known) |
| `mise run ui:check` | green | FAILS at the shell federation integration test for an environment reason (estimai-ui has no `node_modules` here); its other stages ran: operai-ui 381 tests green, shell 718 pass, 22 skipped; refund-ui build, lint and test run directly above | environment fault, not a defect |
| Migration on a database with numbered lines | green | `migration.receipt-register.test.ts` + `db.receipt-register.test.ts`: 27 pass, 0 fail (backfill `issued`/1, numbers kept, new index present, old one dropped) | PASS |
| Output privacy read by eye (T14 privacy test, output captured once) | no name, email, worker text, non-doubtful amount | none found in propose, check, real, rerun and every refusal (exits 1, 2, 4, 5, 6, 7, 8, 9); employees shown as `<prefix> . <8 chars>`, lines by id, rows by `R<n>` | PASS |
| Mutation checks on the riskiest logic | each mutant killed, or shown equivalent | 32 mutants: 26 killed by the existing suite; 6 survived: 3 real gaps (M1, M17, M34) closed by new tests that now kill them, 3 equivalent (M18, M20, M32, below) | PASS after the new tests |
| Coverage threshold / dependency audit | none configured; no dependency changed | `git diff origin/main..HEAD` touches no `package.json` or lockfile (the xlsx reader is dependency-free) | n/a |
| Design states and accessibility (design.md) | all states present | loading, error with Retry, 403, empty, loaded, dialog 422/409/403/404/network, clear confirm, history drawer loading/error/loaded: all have tests in `ReceiptCodesCard.test.tsx`, `ReceiptCodeDialog.test.tsx`, `ChangeHistoryDrawer.test.tsx`, with jsdom axe in en and it. Component reuse matches the inventory (`FormDialog`, `ConfirmDialog`, `DataTable`, `SkeletonRows`, `StatusBadge`, `ErrorBanner`, `PermissionDenied`, `SuccessBanner`, the extended `ChangeHistoryDrawer`; no new component where reuse was specified). The browser pass of hotspots 1 to 5 (light, dark, 320 px) is T32 | PASS (static); browser pass PENDING (T32) |

Defects: none.

Environment faults (no owning dev agent, no fix round):

- E-1: the first refund-api full run failed 517 tests (`undefined is not an object (evaluating 'client.receiptCode.findMany')`,
  `PrismaClientValidationError`). Root cause: the worktree's generated Prisma client predated the T2 schema. `scratch-test.sh` migrates but
  does not run `db:generate`. After `cd refund-api && bun run db:generate` the same suite is 2331 pass, 0 fail. T2's done-when already
  says to run `db:generate`; the script could do it.
- E-2: `mise run ui:check` stops at `shell/src/federation/remoteVersionExposes.integration.test.ts`: it runs `pnpm build` in `estimai-ui`,
  which fails with `tsc: command not found` (no `node_modules` in this checkout). The branch changes nothing in `estimai-ui`, `shell/src`
  or `operai-ui`. The stages after it (refund-ui, meetings-ui, hours-ui) were not reached by the task; refund-ui's build, lint and tests
  were run directly and are green.
- E-3: `mise run changeset:check` compares with local `main`, which here equals the branch tip (merge-base = HEAD), so it prints "nothing to
  gate". Run against `origin/main` it is OK (see table).

Flakes (not reproduced, recorded for the eval):

- `AccountingExportCard.test.tsx > Check again counts the blocker as one item...` failed once in the first parallel full refund-ui run
  (timing under load); it passed alone twice and in the full rerun. The file is not touched by this feature. T21's notes record a similar
  unrelated flake in `ReviewDetailPage`.

## Tests added (branch `rn/qe`)

Each closes a gap found by a mutation that left the existing suite green, and each fails when the mutation is put back.

| File | Mutant it kills | What it pins |
|---|---|---|
| `refund-api/scripts/release/pairing.qe.test.ts` (2 tests) | M1: `several_candidates` threshold `>= 2` to `>= 3`; M6: exact match tolerant to 1.00 | AC-1.4: two exact rows with the SAME number are several candidates (a duplicated register row is never taken silently); AC-1.3: one cent above or below is "amount differs" with both amounts in the reason |
| `refund-api/scripts/accounting-release.qe.test.ts` (1 test) | M17: stale check ignores the sheet in the pairing file's meta | AC-2.7: a file built from sheet 2026 run against another sheet is stale (exit 7), in check and real mode, nothing written; the untouched file still completes |
| `refund-api/src/accounting/receiptCode.qe.race.test.ts` (1 test) | M34: the per-employee advisory lock of the PUT removed | AC-4.7, AC-4.10: two PUTs of different codes for the same employee at once (20 repetitions) leave a history chain (each `codeBefore` is the previous `codeAfter`) and one held value; ran 5 times green with the lock, red without it |

Total with the new files: refund-api 2335 tests.

## Mutation checks (temporary edit in `../operai-rn-qe`, restored after each; test files run in brackets)

Killed (the named test fails): `several_candidates` shared-row rule (pairing.test); `sequence_000` demotion (pairing, run, production-shape);
`wrong_year` demotion; `prefix_differs` demotion; AC-1.7 rows-sum check; baseline counting a wrong-year number outside 2026; baseline
counting `000`; baseline ignoring the register maximum (13 tests); stale register digest ignored (exit 7 tests); stale lines digest
ignored; shared-prefix exit 9 off (3 tests); validator problems ignored (exit 8, 13 tests); split with two dates, two numbers, two
employees, `new` in a group, number on two lines, `not-confirmed` (one or more tests each); a paper number counting against the counter
(24 tests); audit origin `paper_split` always `paper`; audit `registerRows` dropped; xlsx CRC check off, encryption flag check off;
receipt-code in-use-by-issued-number off; capability gate off. (Mutation run notes: an early script bug left mutants stacked; the whole
batch was rerun one mutant at a time on a restored tree, and the tree was verified clean before every commit.)

Survived and shown equivalent: M18 (DOCTYPE label changed: every `<!` construct is refused anyway, only the reason text differs); M20
(ZIP64 locator check removed: the same file is still refused by the 0xffff and 0xffffffff checks two lines below); M32 (in-use-by-another-
code pre-check removed: the unique index on `receipt_code.code` turns the same case into the same 409, which is the concurrent test's path).

## AC to test (every AC has an executed test; all green in the runs above)

Files are under `refund-api/` unless noted. "run" = `scripts/accounting-release.run.test.ts`, "cli" = `scripts/accounting-release.cli.test.ts`,
"pairing" = `scripts/release/pairing.test.ts`, "pfile" = `scripts/release/pairingFile.test.ts`, "paper" = `src/accounting/numbering.paper.test.ts`,
"shape" = `scripts/accounting-release.production-shape.test.ts`, "priv" = `scripts/accounting-release.privacy.test.ts`.

| AC | Executed tests (mutation-checked rows marked +) |
|---|---|
| AC-1.1 | pairing (exact), run (takes and audits the paper number), shape |
| AC-1.2 | run, paper, shape + (paper counted against the counter fails 24 tests) |
| AC-1.3 | pairing, pfile, run; `pairing.qe.test.ts` (to the cent) + |
| AC-1.4 | pairing (two exact, shared row, two numbers); `pairing.qe.test.ts` (same number twice) + |
| AC-1.5 | pairing (`number_taken`, seq collision LG25/003 vs LG26/003), pfile, run (exit 8 naming both) + |
| AC-1.6 | pairing, pfile (group validator), run, paper, `db.receipt-register.test.ts` (commit-time trigger) + |
| AC-1.7 | pairing (sum rule, two numbers), pfile, run + |
| AC-1.8 | pairing, run (proposed is not confirmed: exit 8) |
| AC-1.9 | pairing, report.test, run (baseline row value) |
| AC-1.10 | pairing (`wrong_year`), run, baseline table + |
| AC-1.11 | pairing, run, `db.receipt-register.test.ts` (paper seq 0 allowed, issued seq 0 refused) + |
| AC-1.12 | pairing (prefix rules, both directions) + |
| AC-1.13 | `registerExport.test.ts`, pairing, pfile, run (acknowledgement) |
| AC-1.14 | pairing (unique, none, several), run (unmapped refused, `not-operai`, separate sequences) |
| AC-1.15 | pairing, run (excluded: no rows, own sequence, paper and offsets refused, exit 9 without a code) + |
| AC-1.16 | pairing, pfile, run, paper (2025 line from `001`) |
| AC-1.17 | paper (detail keys), run, shape, priv (whitelist and table scan) + |
| AC-1.18 | `db.receipt-register.test.ts`, `migration.receipt-register.test.ts`, run, shape, paper |
| AC-2.1 | cli (call order, no file on failure, row counts, mode 0600), `registerExport.test.ts`, `xlsxReader.test.ts` |
| AC-2.2 | `report.test.ts` (snapshot, every category); output read by eye |
| AC-2.3 | pfile (writer, round trip, `;` and CRLF re-save), cli |
| AC-2.4 | pfile, run ("differs from the proposal" recomputed) |
| AC-2.5 | run (one transaction), `accounting-release.test.ts` |
| AC-2.6 | pfile (one test per problem), cli (exit 8) + |
| AC-2.7 | cli, run (one byte, late line), `accounting-release.qe.test.ts` (sheet) + |
| AC-2.8 | cli (exit 5 matrix), `accounting-release.test.ts`; shell e2e global-setup static only (live is T32) |
| AC-2.9 | run (check numbers equal real numbers) |
| AC-3.1 | pairing (baseline table), `report.test.ts`, run + |
| AC-3.2 | run (`AB26/041` after unmatched 021 and 022) |
| AC-3.3 | run, paper (order by date, createdAt, id) |
| AC-3.4 | run (register-only employee; lines without rows), `report.test.ts` |
| AC-3.5 | run, paper, `numbering.repo.test.ts` (2027 restarts) |
| AC-3.6 | run (unused paper numbers never given) |
| AC-4.1 | `receiptCode.routes.test.ts`, `numbering.repo.test.ts`, `ReceiptCodeDialog.test.tsx`, `ReceiptCodesCard.test.tsx`; shell e2e (static) |
| AC-4.2 | `receiptNumber.test.ts` (vectors), `receiptCode.routes.test.ts` (422, no rows), `ReceiptCodeDialog.test.tsx` |
| AC-4.3 | `receiptCode.routes.test.ts` (409, names nobody), `receiptCode.race.test.ts` (concurrent), `db.receipt-register.test.ts` (unique) + |
| AC-4.4 | `numbering.repo.test.ts` (`LC26/039` then `LCX26/040`), `receipt.lifecycle.test.ts`, `receiptNumber.test.ts` |
| AC-4.5 | `numbering.repo.test.ts`, `receiptNumber.test.ts` |
| AC-4.6 | `receiptCode.routes.test.ts` (change then clear), `numbering.repo.test.ts` |
| AC-4.7 | `receiptCode.routes.test.ts` (history, no-op), `db.receipt-register.test.ts` (append-only), `ReceiptCodesCard.test.tsx` and `ChangeHistoryDrawer.test.tsx`; `receiptCode.qe.race.test.ts` + |
| AC-4.8 | `exportFormat.test.ts` (`Cancelleria [LCX26/040] ...`), `pdf.test.ts` (widths, compress), UI list tests |
| AC-4.9 | auth `refund.test.ts` and `seed.test.ts`, `receiptCode.routes.test.ts` (403 on three routes) +, `ReceiptCodesSettingsView.test.tsx`, `SettingsPage.test.tsx`, `RefundShell.test.tsx` |
| AC-4.10 | `receiptCode.race.test.ts` (20 reps), `numbering.repo.test.ts` (prefix read once per call) |
| AC-4.11 | pairing (shared-prefix analysis), run, cli (exit 9) +, `report.test.ts`, `receiptCode.routes.test.ts` and `ReceiptCodesCard.test.tsx` (`sharesPrefix`) |
| AC-4.12 | run, cli, paper |
| AC-5.1 | cli matrix (2, 4, 5, 6, 7, 8, 9 with a table snapshot), shape, priv + |
| AC-5.2 | run (fault hook after the first employee, rerun completes) |
| AC-5.3 | cli, run, shape, priv (zero calls to the Accounting and auth fakes) |
| AC-5.4 | run (409 before, after a dry run; 200 after), `accounting-unavailable.matrix.test.ts` |
| AC-5.5 | run, shape (check equals real, line by line) |
| AC-5.6 | cli, priv (every mode and refusal), `report.test.ts`, `operatorFiles.test.ts` (git-worktree warning); output read by eye |
| AC-5.7 | run, shape (WellD Italia untouched), existing export and batch suites green |

## Not run here, by design

- Live e2e, manual browser accessibility pass (hotspots 1 to 5, light and dark, 320 px reflow) and any exploratory Playwright drive: T32
  (needs the e2e stack on the shared dev Postgres).
- Propose-mode dry run on the real register against production lines: T31, T33.

## Recommendations

- OWASP review: already scheduled as T28 (its commit `c0bd8253` is on the branch). Surfaces that merit it: the xlsx reader, the release
  output and pairing file, the receipt-code routes (capability gate, in-use refusals naming nobody), the migration, the auth seed.
- Process: have `scratch-test.sh` run `bun run db:generate` (E-1), and make `mise run changeset:check` base on `origin/main` (E-3).
- Cosmetic, not a defect: the real-run summary line `ZF26/001 to ZEL26/003` shows a range across two prefixes when an employee's
  paper numbers keep the old prefix and the new ones carry the code. Correct, but it may read oddly to the operator.
- Spec: no spec bug found by this pass (every AC was testable).

## Commands run

- `bash scratch-test.sh <WT> refund_rn_qe` (whole refund-api suite), `bunx tsc --noEmit` (refund-api), after `bun run db:generate`.
- auth: `bunx prisma migrate deploy`, `bun test src/authz`, `bun run typecheck` with `DATABASE_URL` to scratch `auth_rn_qe`.
- refund-ui: `pnpm exec vitest run`, `pnpm exec tsc -b`, `pnpm lint`, `pnpm build`.
- shell: `pnpm exec tsc -p tsconfig.e2e.json --noEmit`, `pnpm exec eslint e2e/global-setup.ts e2e/refund-receipt-codes.spec.ts e2e/helpers/refundFixtures.ts`, `pnpm exec playwright test --list`.
- `bun test tools/env-doctor`, `node scripts/check-changeset.mjs --base=<merge-base with origin/main> --head=HEAD`, `mise run ui:check`.
- Mutation runs: scratch databases `refund_rn_qe2`; nothing outside `*_rn_*` databases was used. No production, Railway, Vercel or env file was touched.
