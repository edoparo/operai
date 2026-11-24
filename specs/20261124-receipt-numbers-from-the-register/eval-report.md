---
spec: 20261124
evaluated: 2026-11-24
round: 2
rubric: default-v2
score: 80.9
verdict: PASS
round1_score: 75.7
round1_verdict: FAIL
---
# Eval report: Receipt numbers from the accountant's register, and a receipt code per employee

# Round 1 (HEAD `30b178a5`, score 75.7, FAIL)

**HEAD evaluated.** The caller named `30b178a5` on `refund/register-numbers`. While this eval ran, the branch moved to
`66473a5b` ("chore(forge): run trace … reconstructed, in progress"). `git diff --stat 30b178a5 66473a5b` shows a single
file, the new `.forge/runs/…json`. The code evaluated is therefore the code at `30b178a5`, and the trace is judged under
Trajectory. The feature range is `0a6735aa..HEAD`: 28 commits, 102 files, +13,945/−1,079.

**Rubric.** The repo has no `gates/configs/eval-rubric.yml`, and this spec has no `eval.md`. As every earlier
`specs/*/eval-report.md` does (for example `specs/20261118-refund-accounting-export/eval-report.md`), I applied
**default-v2**:

| Dimension | Weight | Floor |
|---|---|---|
| AC satisfaction | 35 | 4 |
| Spec fidelity | 20 | 3 |
| Test quality | 20 | 3 |
| Code quality | 15 | 3 |
| Design fidelity | 15 | 3 (applies: `design.md` exists) |
| Trajectory | 10 | 2 |

`pass_score` is 80. Design fidelity applies, so the total is normalised over 115.

**Verification I re-ran at HEAD.** These checks are DB-free only: no database suite, e2e, Docker, env file or network.

| Check | Result |
|---|---|
| refund-ui `pnpm exec vitest run` | 84 files / **1440 pass** (equals qe-report.md:18) |
| refund-ui `pnpm exec tsc -b` and `pnpm lint` | both clean |
| refund-api `bunx tsc --noEmit` | clean |
| refund-api DB-free suites (`DATABASE_URL` unset): `operatorFiles`, `pairing`, `pairing.qe`, `pairingFile`, `registerExport`, `report`, `xlsxReader`, `receiptNumber`, `exportFormat`, `xlsx`, `amounts`, `classification` | **404 pass / 0 fail**, 6331 expects, 1 snapshot |
| refund-api `src/batches/pdf.test.ts` (DS-7 widths) | 32 pass / 0 fail |
| shell `pnpm exec tsc -p tsconfig.e2e.json --noEmit` | clean |
| shell `vitest run src/e2eGlobalSetup.test.ts` (the I-9 fix's test) | 6 pass |
| DB-backed refund-api suites (`cli`, `run`, `privacy`, `production-shape`, `db.*`, `receiptCode.*`), auth DB suites, e2e | **Not run by me**, as instructed |

**Other evidence.**

- **QE (T27): PASS at `a00780fa`** (qe-report.md:3-6).
  - 52/52 ACs map to executed tests (:84-137).
  - Whole refund-api suite 2331/0, and 2335 with the QE files (:14).
  - 32 mutants: 26 killed, 3 real gaps closed by 4 new tests, 3 shown equivalent (:26, :55-76).
- **Security (T28): PASS with notes.** 0 critical/high/medium, 3 low, 10 info. Fix round `4010237d` covers L-1, L-2,
  I-4 and I-9 (security-review.md:13-34). The review was static only.
- **The real register.** A propose was run read-only against an EMPTY scratch database. The real `Recap_RS_2026.xlsx`
  was read with no refusal: 253 rows, 19 workers, 7 rows without a number, 2 with sequence 000, 7 with a non-26 year
  (tasks.md § Implementation notes, last bullet). This proves the reader on the real artefact. **It proves nothing
  about the pairing against the 88 production lines** (77/8/3); that is T31.
- **Owner steps open by design:**
  - T31: propose against production lines;
  - T32: live e2e and the browser a11y pass;
  - T33/T34: accounting decisions and the release.

  I did not count them against the build. Where they leave behaviour unobserved, I scored it as unverified, not as
  proven.

**Context weighed.** This was an unattended overnight run under the owner's instruction. The spec and plan approvals
say so plainly: plan.md:5 `approved_note` and spec.md front matter. Every unattended choice is listed for cheap reversal:

- D1-D15 (plan.md:799-817);
- ambiguities 1-10, marked "owner to confirm" (:819-838);
- DS-1..DS-10 (:778-797).

This is the disclosure the 20261118 eval asked for in its round 1, and it was done here from the start.

| Dimension | Weight | Score (/5) | Floor | Pass vs floor | Weighted | Evidence |
|---|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | pass (at floor) | 28.0 | **52/52 ACs have a named, executed, green test** (qe-report.md:84-137), and I reproduced every DB-free suite they rely on (404/0, pdf 32/0, refund-ui 1440/0). I traced the riskiest logic myself: <br>• `scripts/release/pairing.ts:221-305`: the category table, first match wins, as in plan:235-246. A shared exact row goes to `several_candidates` (:252). The AC-1.7 sum rule is at :246. Demotions in plan order (:330-352): `number_taken` on (expense year, seq) per unit, so a split group counts once. Then `wrong_year`, `sequence_000` (proposal changed to `new`) and `prefix_differs` against the code, the initials and the other proposals' prefixes. <br>• `receiptNumber.ts:142-149`: shape checked **before** upper-casing (AC-4.2, `ß`/`À` refused). <br>• `ReceiptCodesCard.tsx:196, :251-272`: badge on every `sharesPrefix` row (DS-8). <br>QE covered the cent boundary, the duplicated row, the stale sheet and concurrent PUTs by mutation-driven tests. <br>**Why not 5:** <br>• The assembled system has never run. The T23 journeys and the T22 three-step global setup are static only (qe-report.md:20, :141). <br>• The production-critical claim of US-1 (77 exact / 8 differ / 3 unmatched over 88 lines) is shown only on a **synthetic** reproduction (`accounting-release.production-shape.test.ts`). The real pairing is T31. <br>• **The post-fix tree has no recorded whole-suite run.** `4010237d` changed `accounting-release.ts`, `pairingFile.ts` and `global-setup.ts` after the QE verdict. Its DB-backed tests (`cli`, `privacy`) have no recorded result (see Test quality). |
| Spec fidelity / no drift | 20 | 4 | 3 | pass | 16.0 | No unrequested scope. Deviations are recorded unusually well: D1-D15, ambiguities 1-10 "owner to confirm", DS-1..10, the T12-T14 Implementation notes (tasks.md:619-659), and the T2 out-of-list changes in the `1fc4a9a9` message. The ADRs A1-A4 match the code I read, and the DS-8 amendment is in ADR decision 5. Not 5 because of **unsynced items**: <br>(a) The L-1 fix makes `--propose` inside a git worktree a **refusal** (exit 1, `accounting-release.ts` `main`). infra/README.md was updated, but these still say "warn": <br>&nbsp;&nbsp;– ADR 20261124-a-one-off-release-… decision 8 (:26); <br>&nbsp;&nbsp;– ADR 20261124-operator-data-imports-… (:103); <br>&nbsp;&nbsp;– plan.md:118-119 (step 3) and plan § Security 2. <br>&nbsp;&nbsp;Also, the refusal runs **before** the marker check, so on a released DB a propose into a worktree exits 1, not 0 "already completed" as plan:110-113 ("whatever the inputs") and D11 state. This is stricter and safe, but unrecorded. <br>(b) plan.md:441-443 names the index `refund_line_receiptOwnerUserId_…_receiptSplitPart_key`. The migration uses `refund_line_receipt_owner_year_seq_part_key` (63-char limit), which is recorded only in the `1fc4a9a9` commit message. <br>(c) design.md RC-8 and the S2 row "sharesPrefix and a code: no badge" contradict the implemented DS-8. This is disclosed in plan:784 and :795, but the design file itself was left contradicting the code (scored under Design fidelity). <br>(d) The run trace says the T2/T4 out-of-list touches are "recorded in § Implementation notes". They are not: those notes cover T12-T14 only, and T2's are in its commit message. |
| Test quality | 20 | 4 | 3 | pass | 16.0 | Behavioural and adversarial: <br>• real-Postgres integration and direct-SQL trigger tests (COMMIT-time split trigger, guard v3, append-only history, the index swap migration on a DB with numbered lines); <br>• the CLI exit matrix 2/4/5/6/7/8/9, each with a DB snapshot; <br>• a privacy scan of every refund table for synthetic worker text; <br>• 20-rep races (code PUT vs approval, two PUTs); <br>• synthetic workbooks covering deflate, rich text, 1904 dates, merges, DOCTYPE and zip bombs; <br>• a deterministic header-only fixture pinned to the writer; <br>• mutation testing with 32 mutants, whose 3 real gaps were closed by tests that now kill them. <br>Against: <br>(1) e2e written, never executed (T32), including the global setup that now auto-confirms proposals on every e2e run. <br>(2) **No QE re-run after the security fix round.** `4010237d` (02:51) follows the QE commit `80fccec7` (02:46). Its message and T28 record no suite result. security-review.md:34 claims "each with a test that fails without the fix", but no run is evidenced. I could confirm only the DB-free parts (pairingFile, e2eGlobalSetup). <br>(3) AC-1.12 is unit-only (qe-report.md:13). <br>(4) No real-Excel-saved synthetic workbook (plan:660-662, R1). <br>(5) No browser axe artefact. <br>"A few edge cases missing" is anchor 4. |
| Code quality & conventions | 15 | 4 | 3 | pass | 12.0 | Clean and in the repo's idiom: <br>• pure modules (`pairing`, `pairingFile`, `report`, `registerExport`) behind `scripts/release/types.ts`; <br>• a dependency-free xlsx reader with caps (entries, sizes, inflate limit, CRC, ZIP64/encryption/DOCTYPE refused) and messages that quote no cell (security-review I-1); <br>• `O_EXCL` + 0600 symlink-safe writes, `sha256:`-prefixed fingerprints, CSV neutralisation (L-2 fixed); <br>• per-employee advisory lock plus a unique index deciding races; DB CHECKs and a deferred trigger as backstops; <br>• RFC 7807 errors with the capability gate before validation; en/it parity; a changeset; no new dependency. <br>Against: <br>• `scripts/accounting-release.ts` is a 1,389-line orchestration file. <br>• L-3 is accepted (per-owner uniqueness). <br>• I-3: no size cap on the pairing/offsets read. <br>• The e2e global setup still proposes, **auto-confirms** and runs the real release against whatever DB `direnv` resolves on every e2e run. I-9 guards only the explicit override (security-review.md:34 admits the direnv case "is not checked"). <br>• The cross-prefix range in the summary (`ZF26/001 to ZEL26/003`, qe-report.md:150) is cosmetic but can mislead an operator. |
| Design fidelity (UI) | 15 | 3 | 3 | pass (at floor) | 9.0 | design.md is complete for its scope: <br>• RC-1..RC-11, flows, the ACs with no UI surface; <br>• S1-S5 with loading, error/Retry, 403, empty, loaded, dialog 422/409/403/404/network, clear confirm and drawer states; <br>• a component inventory mapped to `@operai/ui`, copy keys, an a11y plan with hotspots, and gaps G1-G9 fed back into the plan as DS-1..DS-9. <br>The implementation realises it. QE matched every state to a test with jsdom axe in en and it (qe-report.md:28). The reuse matches the inventory (`FormDialog`, `ConfirmDialog`, `DataTable`, `StatusBadge`, the extended `ChangeHistoryDrawer`). <br>Against: <br>(a) **design.md was never amended** and is still `status: draft` (design.md:3). RC-8, the S2 state row "Row with `sharesPrefix` and a code: No badge" (:128), the wireframe note "…and have no code" (:107) and the test list "`sharesPrefix` + code shows no badge" (:318) all contradict the shipped DS-8 behaviour. The trace marks this drift `resolved: true`, but the design text still describes behaviour the code does not have. <br>(b) **Nobody has seen these screens.** No browser run, no browser axe, no keyboard-order, contrast, dark or 320 px check. The design itself says none is claimed (:289), and the hotspots 1-5 are T32. <br>No designed behaviour is missing, which is why this is not lower. |
| Trajectory | 10 | 3 | 2 | pass | 6.0 | **For:** a `wellforge-run/v1` trace exists for this feature (`.forge/runs/2026-11-24T00-00-00Z-orchestrate-…json`, committed `66473a5b`). It is honest about being reconstructed and in progress (`finished: null`, `eval: pending`). Its agents, worktrees and SHAs agree with `git log`: spec `7f1dfe25` → plan `d8b39015` → ADRs `70c6276d` → design `c9b5f60b` → sync and tasks `0a6735aa` → T1-T26 in parallel tracks → OWASP `c0bd8253` → QE `80fccec7` → fixes `4010237d`/`30b178a5`. Two drift events and three env faults are recorded. The commits are task-tagged Conventional commits. <br>**Against:** <br>• **The fix round bypassed the process.** T28's done-when says "any fix is a new task appended here, with an overlap check" (tasks.md:431). No task was appended. `4010237d` also touched `infra/README.md` and `shell/src/e2eGlobalSetup.test.ts`, and it landed **after** the QE verdict with no QE re-run. <br>• T28 is still `[ ]` although its review and fix are committed (tasks.md:425). <br>• T2-T5 carry no `evidence:` line (12 of 26 implemented tasks do). <br>• The trace has two inaccuracies: the Implementation-notes claim in Spec fidelity (d), and "the runner now runs prisma generate", which is not verifiable in the repo. <br>• The trace was written after the fact, 50 s after the last commit. |
| **Total** | 115 | | | | **87.0 / 115 = 75.7/100** | |

**Verdict: FAIL.** The total of 75.7 is below `pass_score` 80. **No dimension is below its floor.** AC satisfaction (4)
and design fidelity (3) sit exactly at their floors. The verdict fails on the total, not on an unmet AC. All 52 ACs
have executed green evidence. What is missing is:

- observation of the assembled product and of the real pairing;
- a QE re-run of the post-fix tree;
- keeping design.md, the ADRs and the plan in sync with what shipped.

## Findings

- **AC satisfaction (4, at floor). Owner: owner (T31, T32), then QE.** Nothing is unmet. To reach 5:
  - T32: `cd shell && pnpm e2e e2e/refund-` green, with the global setup's three-step release on a fresh dev DB;
  - T31: the propose against the production lines, with counts reconciled to 77/8/3 over 88 lines of 9 employees (or
    every difference explained), and the report read for privacy.

  If a journey fails or the real pairing contradicts the synthetic shape, an AC becomes unmet and the eval fails on the
  floor.
- **Spec fidelity (4). Owner: architect / adr-writer (docs only).**
  - Amend ADR propose-confirm-run decision 8 and ADR operator-data-imports (GDPR line) for the L-1 refusal of a
    `--propose` path inside a worktree.
  - Amend plan.md step 3 and § Security 2 the same way, and decide whether the refusal should come after the marker
    check (plan step 0, D11), or record that it precedes it.
  - Correct the index name in plan.md:441-443.
  - Correct the trace's "recorded in § Implementation notes", or add the T2/T4 out-of-list notes there.
- **Test quality (4). Owner: QE.**
  - Re-run the whole refund-api suite on a fresh scratch DB at the post-fix tree, plus auth `src/authz` and the shell
    `src/e2eGlobalSetup.test.ts`, and record the result in qe-report.md.
  - Optionally, add a mutation check on the L-1 and L-2 fixes.
  - The e2e run and a browser-axe artefact come with T32.
- **Code quality (4). Owner: dev / infra (optional before T34).**
  - Make the e2e global setup refuse a non-local host also when the DB comes from `direnv`. For example, read the
    resolved `DATABASE_URL` inside the spawned script and refuse a non-local host there.
  - Consider splitting `accounting-release.ts`.
  - Add a read cap for the pairing and offsets files (I-3).
- **Design fidelity (3, at floor). Owner: designer, then owner.**
  - Amend design.md for DS-8: RC-8, the S2 state row, the count-note copy and the test list. Mark G1-G9 with their DS
    resolutions, and move the file out of `draft`.
  - T32's browser pass of hotspots 1-5 (light, dark, 320 px), recorded in design.md, together with the amendment would
    lift this to 4.
- **Trajectory (3). Owner: orchestrator.**
  - Append the fix round as a task (for example T35: security fixes L-1, L-2, I-4, I-9, with `touch:` and an overlap
    check), with its evidence line and the QE re-run.
  - Check T28.
  - Add evidence lines to T2-T5 from their commit messages.
  - When the run closes, finish the trace: `finished`, `result`, the fix-round task, and the QE re-run.

**Path to PASS (arithmetic).**

- **Agent-doable now, no owner step:**
  - the docs sync above gives spec fidelity 5 (+4.0);
  - the fix round recorded as a task, with a QE re-run green and T28 checked, gives trajectory 4 (+2.0);
  - that is 93/115 = **80.9**, a narrow PASS.
- **With the owner steps:**
  - T32 green and T31 reconciled give AC satisfaction 5 (+7.0);
  - the design.md amendment plus T32's browser pass gives design fidelity 4 (+3.0);
  - that is 103/115 = **89.6**.

A failing T31 or T32 would instead put AC satisfaction below its floor.

## Recommended next step

- **FAIL.** Do not move the spec to `done`. T29 stays unchecked, and T30 cannot close.
- In this order:
  1. QE re-run of the post-fix tree, recorded in qe-report.md, with the fix round appended as a task and T28 checked.
     This is orchestrator / QE work and needs no product code change.
  2. Docs sync through the architect, adr-writer and designer: the two ADRs and the plan for L-1, the index name, and
     design.md for DS-8 out of `draft`.
  3. Re-run `/wellforge:eval 20261124-receipt-numbers-from-the-register`.
  4. Owner: T31 (propose against production lines) and T32 (live e2e and browser pass) before T30. T33/T34 follow.
     This verdict does not authorise T34.
- No dev rework of product logic is required by this eval. The evaluator changed no code, test, spec or task.

# Round 2 (HEAD `1fd4d503`, score 80.9, PASS)

**What was evaluated.** Branch `refund/register-numbers` at `1fd4d503`. Three commits landed after round 1 (`49ec659d`).
I read each one with `git show`:

- `67f57307` (T36, code): the L-1 refusal moves from `main()` into an `afterMarker` hook. `runAccountingRelease` calls
  the hook right after the marker read (`refund-api/scripts/accounting-release.ts:703-705`) and before the Accounting
  and auth ports are built. `main()` supplies the hook (`:1343-1352`). There is one new cli test, "(D11, L-1) on an
  already released database --propose inside a git worktree exits 0 'already completed'…".
- `0b964797` (T35/T36, docs sync):
  - plan.md: step 0 and 0a, step 3, § Security 2, the AC-5.6 test row, D11, the index name (:450), the `map:` in the
    schema note, and § Fix rounds;
  - both ADRs: decisions 7 and 8, the GDPR line and the Evidence sections;
  - AGENTS.md;
  - design.md: RC-8, F5, the wireframe note, the S2 row, `shareNote`, the test list, and G8 marked resolved;
  - tasks.md: T35 and T36, T28 checked, evidence for T2-T5, and the T2/T4 notes;
  - two drift entries in the trace.
- `1fd4d503` (QE re-run):
  - a second cli test, "(L-1, T36) the refusal on a database not yet released reads nothing…";
  - qe-report.md § Re-run after fix rounds: refund-api 2339/0 on fresh `refund_rn_qe3`, auth `src/authz` 332/0,
    shell `e2eGlobalSetup` 6, refund-ui 1440, and 4 mutations each killed;
  - T27's re-run line and T36 checked.

The rubric, weights, floors and `pass_score` are the same as round 1: default-v2, normalised over 115 because design
fidelity applies.

**Verification I re-ran at `1fd4d503`.** These checks are DB-free only.

| Check | Result |
|---|---|
| refund-api `bunx tsc --noEmit` | clean |
| refund-api DB-free suites (`DATABASE_URL` unset): `operatorFiles`, `scripts/release/*` (7 files), `amounts`, `classification`, `exportFormat`, `receiptNumber`, `xlsx`, `batches/pdf` | **436 pass / 0 fail** across 13 files, 6414 expects. This equals round 1's 404 + 32. |
| shell `pnpm exec tsc -p tsconfig.e2e.json --noEmit` | clean |
| shell `vitest run src/e2eGlobalSetup.test.ts` | 6 pass |
| refund-ui `vitest run`, `tsc -b`, `pnpm lint` | 1440 pass, both clean |
| `git diff --stat 49ec659d HEAD -- refund-ui shell auth` | empty: no UI, shell or auth code changed since round 1 |
| DB-backed suites (`cli`, `run`, `privacy`, …), auth DB suites, e2e | **Not run by me**, as instructed. I relied on qe-report.md § Re-run after fix rounds. |

I also checked the runner that the trace and qe-report say "runs prisma generate". It is
`/private/tmp/claude-501/-Users-hermes-claude-workspace/3b8f0432-b131-57d7-bf4a-a725ea48766e/scratchpad/scratch-test.sh`
(tasks.md:51), and it does run `bunx prisma generate` and then `migrate deploy`. The round-1 claim is now verifiable.
The runner sits outside the repository, so the claim still cannot be checked from the repo alone.

**The T36 fix, read adversarially.**

- **Order.** Nothing else runs before the marker. The only things ahead of it are:
  - argument parsing;
  - the stderr warning loop for read-only paths (`:1332-1339`), which stats the filesystem to look for `.git` but reads
    no input.

  Then come the marker, the hook, and Accounting, auth and the files.
- **Global setup.** `runAccountingRelease` called without the hook does not refuse. This is the e2e global setup's
  path. It is acceptable: the setup does not pass an operator `--propose` path.
- **Tests.** The two cli tests cover both orders, and each asserts:
  - the exit code;
  - whether the file was created;
  - `world.requests` empty;
  - the footprint unchanged.

  QE's mutation 1 (swap the order back) turns the released-DB test red, and mutation 2 (remove the refusal) turns both
  tests red. The tests are meaningful, not decorative.

| Dimension | Weight | Score (/5) | Floor | Pass vs floor | Weighted | Evidence |
|---|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | pass (at floor) | 28.0 | All 52 ACs still map to executed green tests (qe-report.md:84-137). AC-5.3 "with any inputs" now holds for a `--propose` path in a worktree too: `accounting-release.cli.test.ts` "(D11, L-1) on an already released database…". The post-fix tree has a recorded whole-suite run (qe-report § Re-run: 2339/0, 97 files, fresh DB), and I reproduced the DB-free part (436/0, refund-ui 1440). This closes the third round-1 reason. **Still not 5, unchanged from round 1:** <br>• the assembled system has never run (T23 journeys, the T22 three-step global setup; live e2e is T32); <br>• the US-1 production shape (77/8/3 over 88 lines) is shown only on the synthetic reproduction. The real pairing is T31. |
| Spec fidelity / no drift | 20 | 5 | 3 | pass | 20.0 | Every round-1 item (a)-(d) is resolved in the artefacts: <br>(a) the L-1 refusal and its order are in plan step 0/0a (:110-120), step 3, § Security 2 (:709-712), D11 (:840), the AC-5.6 row (:663), ADR propose-confirm-run decisions 7 and 8 (:25-26), the operator-data-imports GDPR line (:111) and AGENTS.md:1250. The code now matches the plan's original D11 rather than the plan being bent to the code. <br>(b) the index name in plan:450-452 matches the migration, and `map:` is in the schema note. <br>(c) design.md matches DS-8 (scored under Design fidelity). <br>(d) the trace's implementation-notes claim is made true: tasks.md § Implementation notes now has T2/T4, and tasks.md:110 and :140 point to it. <br>No unrequested scope. This matches the repo's anchor-5 practice: drift recorded and resolved spec-first, with the code aligned (for example `specs/20260719-refund-monthly-processing/eval-report.md`). Non-blocking nits are listed under Findings: stale "pending" sentences, and "only argument parsing precedes" step 0. |
| Test quality | 20 | 4 | 3 | pass | 16.0 | Round-1 item (2) is closed: <br>• a whole-suite run on the post-fix tree with fresh scratch DBs; <br>• auth `src/authz` 332/0; <br>• mutations of the T36 order, the L-1 refusal, L-2 `neutralise` and I-9 `assertLocalDatabase`, each killed (qe-report § Re-run, items 1-4); <br>• a gap QE found in the existing L-1 test (it did not assert the absence of reads) closed by a new test. <br>**Held at 4:** <br>• e2e still written, never executed (T32); <br>• AC-1.12 unit-only; <br>• no real-Excel-saved synthetic workbook; <br>• no browser axe. <br>Also, the "2340" whole-suite figure is inferred: the suite count was taken before the last test was added, and only the cli file (42) was re-run with it (qe-report § Re-run, "Tests added"). This is minor, but it is not a measured number. |
| Code quality & conventions | 15 | 4 | 3 | pass | 12.0 | The T36 change is minimal and idiomatic: <br>• an optional `afterMarker` hook on `ReleaseOptions` (`:388-389`), documented; <br>• the operator-only policy stays in `main()`, the CLI layer; <br>• the module header comment is updated (`:26`). <br>**Unchanged from round 1:** <br>• `accounting-release.ts` is about 1,390 lines; <br>• I-3: no read cap on the pairing and offsets files; <br>• the e2e global setup still auto-confirms and runs the release against whatever DB `direnv` resolves (I-9 guards only the explicit override; plan § Fix rounds now says so openly); <br>• the cross-prefix summary range is cosmetic. |
| Design fidelity (UI) | 15 | 3 | 3 | pass (at floor) | 9.0 | Round-1 item (a) is resolved: <br>• design.md RC-8 (:30), F5 (:68-69), the wireframe note (:109), the S2 row (:130) and `shareNote` (:245) match the shipped behaviour; <br>• the `shareNote` copy matches `strings.ts:272` and `:1357` and the card tests (`ReceiptCodesCard.test.tsx:236`, `.italian.test.tsx:121`); <br>• the test list (:320) matches; <br>• G1-G9 are mapped to DS-1..9 (:326); <br>• `status: draft` is explained (:8), and the explanation checks out: 19 of 25 `specs/*/design.md` are `draft`. <br>**Held at 3, the same bar round 1 set for 4 (amendment AND browser pass):** <br>• nobody has seen these screens: no browser run, browser axe, keyboard order, contrast, dark or 320 px check (design :291 "Claim"; hotspots 1-5 are T32); <br>• a small copy gap left by DS-8: `receiptCodes.sharesPrefixHint` ("…Set a code to tell the numbers apart", design :244) is the visually hidden description of **every** flagged row (`ReceiptCodesCard.tsx:251-256`). On a row that already has a code, the DS-8 remedy is "another code here or a code for the colleague" (design :130, F5.2), so a screen-reader user on that row gets the wrong advice. |
| Trajectory | 10 | 4 | 2 | pass | 8.0 | **For:** <br>• the round-1 process gaps are closed: T35 is appended with `touch:`, an overlap check and evidence (tasks.md:492-498); <br>• T28 is checked (:431); <br>• T2-T5 have evidence lines; <br>• T36 is a proper task with touch list, overlap check, done-when and evidence (:500-506); <br>• T29 deps now include T35 and T36, and the QE re-run preceded this eval; <br>• the sequence eval FAIL `49ec659d` → fix `67f57307` → docs `0b964797` → QE `1fd4d503` is task-tagged and in order. <br>**Against (why not 5):** <br>• T36's task entry landed in `0b964797` (03:02) **after** its code commit `67f57307` (02:59). The task-first discipline that round 1 asked for was followed in letter, not in order. <br>• The run trace was not updated for anything after `0b964797`: <br>&nbsp;&nbsp;– `verdicts.eval` is still "pending" although round 1 FAIL was committed in `49ec659d`; <br>&nbsp;&nbsp;– `verdicts.qe` does not mention the re-run; <br>&nbsp;&nbsp;– there are no `agents` entries for the T36 backend-dev or the QE re-run. <br>• Two sentences written by the docs sync went stale five minutes later and were not corrected by `1fd4d503`: <br>&nbsp;&nbsp;– ADR propose-confirm-run Evidence (:101 "a QE re-run after the fix rounds is pending"; :108 "the test that pins the order … lands with … T36"); <br>&nbsp;&nbsp;– plan.md:824 "A QE re-run … is owed". <br>• The trace is still reconstructed (`reconstructed: true`). |
| **Total** | 115 | | | | **93.0 / 115 = 80.9/100** | |

**Verdict: PASS.** The total of 80.9 is at least `pass_score` 80, and every applicable dimension is at or above its
floor. AC satisfaction (4) and design fidelity (3) sit exactly at their floors. The margin is narrow, 0.9 points. Spec
fidelity moving from 4 to 5 (+4.0) and trajectory from 3 to 4 (+2.0) are what changed, as round 1's arithmetic
predicted.

This PASS covers the build as evaluated. **It is not live evidence.** T31 and T32 are owner steps. If either contradicts
the synthetic evidence (a failing e2e journey, or a real pairing that does not reconcile with 77/8/3), an AC becomes
unmet, AC satisfaction drops below its floor, and the verdict becomes FAIL. T30's own deps (T29, T32) already encode
this.

## Findings (round 2)

**Blocking: none.** Nothing below is a floor or `pass_score` issue.

- **AC satisfaction (4, at floor). Owner: owner, T31 and T32.** These are the only route to 5, and the only thing that
  could still fail the feature:
  - T32: `cd shell && pnpm e2e e2e/refund-` green on a fresh dev DB, including the global setup's three-step release;
  - T31: propose against production lines, with the counts reconciled to 77/8/3 over 88 lines of 9 employees (or each
    difference explained), and the report read for privacy.
- **Design fidelity (3, at floor). Owner: designer and frontend, then owner.**
  - Fix the DS-8 copy gap. Give `receiptCodes.sharesPrefixHint` a coded-row variant (for example "Another employee uses
    the same letters. Change this code, or set a code for the other employee."), or neutral wording that fits both
    rows. Then update design.md :244 and the en/it strings, with a card test on a coded flagged row.
  - Together with T32's browser pass of hotspots 1-5 (light, dark, 320 px, recorded in design.md), this gives 4.
- **Trajectory (4). Owner: orchestrator, bookkeeping only.**
  - Update the trace: `verdicts.eval` with round 1 FAIL 75.7 and round 2; `verdicts.qe` with the re-run; `agents`
    entries for T36 (backend-dev, `67f57307`) and the QE re-run (`1fd4d503`).
  - Correct the stale sentences in ADR propose-confirm-run Evidence :101 and :108 (name the test "(D11, L-1) on an
    already released database…" and the "(L-1, T36)" test) and in plan.md:824.
  - Close the trace (`finished`, `result`) when the run ends.
- **Spec fidelity (5), nit.** plan step 0 (:115-116) and ADR decision 7 say "only argument parsing precedes" the
  marker. In fact the read-path worktree warnings (`accounting-release.ts:1332-1339`) also run before it, so a released
  database given a `--register` path inside a worktree prints a stderr warning before "already completed". This is
  harmless, but either word it ("argument parsing and the read-path warnings") or move the warnings after the marker.
  The AC-5.3 test does not assert stderr.
- **Test quality (4).** Record a measured whole-suite count with the "(L-1, T36)" test included at the next QE touch.
  The e2e run and the browser axe artefact come with T32.
- **Code quality (4), optional before T34.** Unchanged from round 1:
  - the direnv-resolved DB guard in the e2e global setup;
  - the I-3 read caps;
  - splitting `accounting-release.ts`.

## Recommended next step (round 2)

- **PASS.** The evaluator does not check T29 or change the spec status. T29 can be checked by the orchestrator. The spec
  **must not** move to `done` yet: T30's gate also needs T32, the live e2e reported green.
- In order:
  1. Optional, agent-doable now: the trajectory bookkeeping and the `sharesPrefixHint` copy fix above. Neither changes
     release logic.
  2. Owner: T31 (propose against production lines) and T32 (live e2e and browser pass). Then T30. T33 and T34 follow.
     This verdict does not authorise T34.
- If T31 or T32 surfaces a defect, route the fix through `/wellforge:implement` as a new task, re-run QE and re-run
  this eval.
- The evaluator changed no code, test, spec, task or status. Only this file was written.
