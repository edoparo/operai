---
spec: 20261118
evaluated: 2026-11-20
round: 8
rubric: default-v2
score: 83.5
verdict: PASS
round1_score: 73.9
round2_score: 76.5
round3_score: 72.2
round4_score: 78.3
round5_score: 78.3
round6_score: 78.3
round7_score: 78.3
---
# Eval report: Refund accounting — ledger accounts, VAT, receipt numbers and the batch export

**HEAD evaluated:** `19d1f2b5` on `feat/refund-accounting-spec`. The tree is clean and equal to
`origin/feat/refund-accounting-spec`. The diff is `origin/main...HEAD`: 60 commits, 182 files, +34,330/−88.
QE's re-test ran at `6094b486`. Since then only `qe-report.md`, `security-review.md`, `plan.md` and `tasks.md`
have changed (`git diff --stat 6094b486 HEAD`), so the code QE tested is the code evaluated here.

**Rubric.** The repo has no `gates/configs/eval-rubric.yml` and no `.wellforge-gates/`. The synced WellForge
plugin (`~/.claude/plugins/synced/…/wellforge/config/`) ships no rubric file either. This spec has no `eval.md`.
I therefore applied **default-v2**, as every earlier `specs/*/eval-report.md` does (for example
`specs/20261117-legal-entities/eval-report.md`, `specs/20261116-letterhead-service/eval-report.md`):

| Dimension | Weight | Floor |
|---|---|---|
| AC satisfaction | 35 | 4 |
| Spec fidelity | 20 | 3 |
| Test quality | 20 | 3 |
| Code quality | 15 | 3 |
| Design fidelity | 15 | 3 (applies: `design.md` exists) |
| Trajectory | 10 | 2 |

`pass_score` is 80. Design fidelity applies, so the total is normalised over 115.

**Verification evidence.**

I re-ran everything below myself at HEAD, read-only, against the isolated Postgres on :5445 only. I did not use
:5435, any service, the network or any secret.

| Suite | My result | Matches QE re-test |
|---|---|---|
| refund-api `bun test` | 1426 pass / 0 fail / 67 files | yes (qe-report.md:285) |
| refund-api `tsc --noEmit` | clean | yes |
| refund-ui `vitest run` | 1252 pass / 81 files | yes (qe-report.md:288) |
| refund-ui `tsc -b` and `eslint .` | both clean | yes |
| auth `bun test` | 1416 pass / 36 skip / 0 fail | yes (qe-report.md:287) |

Other evidence:

- **QE:** the first pass was FAIL at `e7cf2ad9` with D-1 to D-4. Fix round 1 (T41, T42) followed, and the
  re-test is PASS (qe-report.md:279-309). The re-test includes a 20/20 mutation sample and 4/4 mutants on the fix.
- **OWASP:** the first review was REVIEW REQUIRED (2 medium). The re-review is PASS, with 0 medium and 3 low
  findings left open as accepted (security-review.md:48, :82). **Both reviews were static only.**
- **Not run by anyone:**
  - the live e2e journeys T31 and T32 (tasks.md:538, :554; qe-report.md:57, :294);
  - any real-browser check: no axe, contrast, keyboard order or screen-reader check (qe-report.md:27-30, :224-225).
- **CI:** no run is recorded for this branch.

**Context weighed.** This was an unattended overnight run under the user's pre-authorisation:

- the plan gate was recorded as pre-authorised (plan.md:5);
- the owner had forbidden the shared dev DB and the secrets, so the live e2e step falls to the owner;
- the six open questions were accepted as risk, each with a fallback (spec.md:353-370, plan D1/D2/D3/D5/D10/D13).

I did not count these against the build. For example, I did not treat the seed placeholders `NOVAT` "(to confirm)"
or the provisional CSV dialect as unmet ACs. **Where they leave a behaviour unobserved, I scored it as unverified.
I did not score it as proven.**

| Dimension | Weight | Score (/5) | Floor | Pass vs floor | Weighted | Evidence |
|---|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | pass (at floor) | 28.0 | **61/61 ACs have a named, executed, green test** (qe-report.md:137-201), and I reproduced every suite they run in. I traced the AC-critical code myself: <br>• AC-6.3/6.4: `amounts.ts` uses BigInt with one half-up rounding. 1040@924600→962 and 2080@810bp→156. <br>• AC-3.1/3.2/3.4/2.7: `classification.ts:97-133` treats an inactive default or designation as none. A non-CHF line uses only the foreign-currency code. <br>• AC-3.4/4.3/4.10: in `decide.repo.ts` approve, the release gate, the CAS and `classifyAndNumber` share one transaction, and a refusal rolls back. Counters are upserted in ascending year order (`numbering.repo.ts`). <br>• AC-6.1/6.5/6.6/6.7: `export.repo.ts` reads stored classifications only, lists blockers all-or-nothing, and counts IT lines. <br>• AC-6.11: the compile gate is `request:review` (`batches.routes.ts:476`), narrowed to WellD CH. <br>• AC-3.10: the owner key-set test. <br>**Why not 5:** <br>• The assembled system has never run: T31/T32 journeys (14 ACs carry an e2e row), the shell mounting `?section=` tabs, the CSV download through CORS and Blob in a browser, and the e2e global-setup release. <br>• Two readings stay literal-edge: <br>&nbsp;&nbsp;– AC-4.9 in the batch PDF shows compressed runs (`MC26/014–016`), so `MC26/015` is implied, not printed (UX-8); <br>&nbsp;&nbsp;– AC-4.8 skips letterless email parts (IS-7). <br>&nbsp;&nbsp;Both are documented. <br>• ACs A1/A2 were amended post-approval without the owner (see Spec fidelity). Their behaviour is verified, but their wording is not owner-confirmed. |
| Spec fidelity / no drift | 20 | 4 | 3 | pass | 16.0 | No unrequested scope, and implementation drift is recorded unusually thoroughly: IS-1..7 (plan.md:1120-1158), SR-1..10 (:1045-1105), FR-1..5 (:1107-1118), G1-G13/UX-1..14 (:1160-1211), and owner decisions D1-D13 each with a reversal path (:1005-1024). Every code path I traced matches plan text, including the SR-1 line scope (`classification.repo.ts:142`, `:399`) and SR-2 (`:311`; auth `catalogs/refund.ts:149`). Not 5 because of **unrecorded or misleading items**: <br>(a) **Stale Accepted ADR on a security control.** `docs/adr/20261118-accounting-classification-…md` decision 4 still says `reclassify` has `supportedConditions: ["entity"]`. It does not mention SR-2's segregation of duties or the either-grant rule (FR-1), and it documents a `classification_required` refusal for `null` that G8 dropped (no such code exists in refund-api or refund-ui). The ADR was last touched in `8a44b9ac`, before the fix round. Its decision 8 also predates the SR-1 line-level scope. <br>(b) **Misattribution.** plan.md:1028 says the amendments were "Applied by the product owner on 2026-11-18 in commit 6e074318". That commit is agent-authored (Co-Authored-By trailer), 17 min after approval, and the spec itself says "unattended run, user pre-authorised" (spec.md:14). The owner may believe they approved A1/A2 when they did not. <br>(c) The approved spec's ACs (AC-1.2/1.4/1.7/1.8/2.3/3.2/3.4/7.1/7.2) were reworded by agents post-approval. This is disclosed, but nothing marks it "owner to confirm". <br>(d) Minor: the `resolveClassification` signature in plan.md:53 and in the ADR differs from the code. Several 422 codes (`invalid_classification`, `invalid_default`, `invalid_month`, `invalid_request`, `export_log_failed`) are not named in the plan's contracts. If this dimension were scored 3, the total would be 70.4 and the verdict would not change. |
| Test quality | 20 | 4 | 3 | pass | 16.0 | Behavioural and adversarial. <br>• Real-Postgres integration, plus direct-SQL trigger tests: immutability, the paid lock, counter monotonicity, all-or-none receipt columns, and fetched-once. <br>• A byte-for-byte golden CSV (BOM, CRLF, quoting, formula guard). <br>• Real `Promise.all` races over 20 rounds: `approve-accounting.test.ts:491` (AC-4.10), and classification vs approve/mark-paid. <br>• An FX budget test, a failed export-log write that sends no file, and a CLI test of the operator entry point. <br>• Mutation sample 20/20 killed (qe-report.md:98-125), and the fix-round repros were committed red-first (`7bccdde1` before `169d0711`) with 4/4 mutants killed. <br>Against: <br>(1) The e2e journeys (77 + 59 `expect`s) are **written but never executed**, so their correctness is unproven. That includes the global-setup release step, which now runs before every e2e spec (`shell/e2e/global-setup.ts:61`). <br>(2) The suite as first built **encoded the S-01 defect**: a test asserted the whole-request scope (qe-report.md:77). The gap was found only by the static review. <br>(3) AC-4.7 had no lifecycle test until QE added `receipt.lifecycle.test.ts`. <br>(4) No a11y automation (axe) exists, and a11y is asserted only through RTL roles. <br>(5) The security reviews ran no tests. <br>"A few edge cases missing" is anchor 4. |
| Code quality & conventions | 15 | 4 | 3 | pass | 12.0 | Clean and idiomatic, matching the repo's conventions. <br>• Pure modules (`amounts`, `classification`, `receiptNumber`, `export`, `parse`) with integer BigInt money and `RangeError` instead of silent clamping. <br>• One shared resolver behind four call sites, and every CSV dialect choice in `exportFormat.ts` with `FORMAT_VERSION`. <br>• Tagged-template SQL only. The permission is chosen on the `FOR UPDATE`-locked status, and the paid lock is backed by a DB trigger. <br>• RFC 7807 codes and Effect tagged errors (`ClassificationMissingError`). <br>• The outbound fetch is hardened: constant host, `redirect: "error"`, body cap, no XML entity resolution. <br>• Changesets are present, and the en/it strings are at parity. <br>Against: <br>• **Accepted but open:** S-07 (no plausibility band on fetched rates), S-08 (trigger-only immutability, with the service as table owner), S-09 (client-supplied fetch `trigger` label), S-10, and R-1 (a custom role with `reclassify` but no `approve` is not self-restricted). <br>• FR-5/FU-S7: an out-of-scope line refused by `classification_missing` gets no `ErrorSummary` row (plan.md:1118). <br>• The e2e global setup now runs `accounting:release` against whatever DB `direnv` resolves on **every** e2e run, seeding placeholder data unless `E2E_SKIP_REFUND_ACCOUNTING_RELEASE=1` is set (`global-setup.ts:36-61`). This has never been exercised. <br>• Comment blocks are very long, which costs readability in places (for example `numbering.repo.ts:1-41`). |
| Design fidelity (UI) | 15 | 3 | 3 | pass (at floor) | 9.0 | design.md was complete for what it designed: <br>• flows, with the ACs that have no UI surface; <br>• S1-S10 with loading, empty, error, denied, read-only, saving and success states; <br>• a component inventory mapped to `@operai/ui`, copy keys and an a11y plan. <br>QE's static audit names a component test for every designed state, and the 14 N-row components exist (qe-report.md:208-226). The cards reuse `@operai/ui`: `Badge`, `FactList`, `Field`, `DataTable`, `ConfirmDeleteModal`. <br>Against: <br>(a) **Nobody has seen these screens.** No browser run, no shell mount, no axe, no contrast or keyboard-order check (qe-report.md:27-30, :224-225). <br>(b) design.md was **never amended** after the fix round, and is still `status: draft` (design.md:3; QE D-6). Its only commit is `98c3d1f4`. The states built since have no design entry: <br>&nbsp;&nbsp;– the self-restricted read-only panel and its note (`LineClassificationPanel.tsx:124`, `:283`); <br>&nbsp;&nbsp;– the out-of-scope line (`:111`); <br>&nbsp;&nbsp;– the `throttled`/`deferred` month states (T26 follow-up `4a04927d`, `settings.fx.throttled`/`deferred`). <br>(c) The FR-5 gap leaves an undesigned refusal path. <br>No design is contradicted, which is why this is not lower. |
| Trajectory | 10 | 2 | 2 | pass (at floor) | 4.0 | **No `wellforge-run/v1` trace for this feature exists** in `.forge/runs/` of this worktree or of any sibling worktree (the last trace is `2026-11-17T14-58-00Z-orchestrate-20261117-legal-entities.json`). Per the rubric this is the neutral floor. Git shows good habits: <br>• the order spec → plan → amendment → ADRs → design → plan sync → tasks (with overlap check) → implementation; <br>• QE FAIL → repro-first fix round → QE PASS → security re-review; <br>• task-tagged Conventional commits, and fix-round commits within their `touch:` globs. <br>Git also shows deductions that would block a score above 3 even with a trace: <br>• T31 and T32 are ticked `[x]` although their done-when ("`pnpm e2e …` passes") is unmet (tasks.md:537-538, :552-554). <br>• T35 is ticked although its done-when includes `cd shell && pnpm e2e refund-` green (tasks.md:617-619; qe-report.md:31-32 admits it). The status notes are honest, but the checkboxes claim done. <br>• The plan approval and the spec amendments were self-recorded by agents. |
| **Total** | 115 | | | | **85.0 / 115 = 73.9/100** | |

**Verdict: FAIL.** The total of 73.9 is below `pass_score` 80. **No dimension is below its floor.** AC
satisfaction (4), design fidelity (3) and trajectory (2) each sit exactly at their floor. The verdict fails on the
total, not on an unmet AC. All 61 ACs have green, executed evidence. What is missing is observation of the assembled
product, design upkeep and the run record.

## Findings

- **AC satisfaction (4, at floor). Owner: owner step, then QE.** Nothing is unmet, but the system has never run
  end to end. What would raise it to 5:
  - run `cd shell && pnpm e2e refund-accounting` and `refund-accounting-settings` green against the e2e stack
    (`REFUND_FX_SOURCE=off`), together with every existing `refund-*.spec.ts`, as T32's done-when requires;
  - record the result in qe-report.md.

  If a journey fails, the failing AC becomes unmet and the eval FAILs on the floor as well.
- **Spec fidelity (4). Owner: plan (architect), with ADR upkeep.**
  - Amend ADR 20261118-accounting-classification decision 4 for SR-2 and FR-1: `reclassify` declares
    `self-approval`, and the owner is refused if either grant is restricted. Remove the `classification_required` /
    `null` sentence (G8), and add the SR-1 line-level scope to decision 8.
  - Correct plan.md:1028: the amendments were applied by the agent run under pre-authorisation, not by the product
    owner.
  - Mark A1/A2 in spec.md "owner to confirm".
  - Optionally, name the 422/500 codes the routes emit in the plan's contracts.
- **Test quality (4). Owner: QE / dev.** The e2e run above is the main gap. Two smaller gaps:
  - add an automated a11y check (axe in Vitest or in the e2e) for the new cards and panel;
  - add an e2e or integration assertion that the global-setup release step is idempotent against a released DB.
- **Code quality (4). Owner: dev / infra.** These are the accepted security follow-ups FU-S1..S7. Before T40:
  - **S-08 / FU-S3:** a non-owner runtime DB role;
  - **S-07 / FU-S2:** a plausibility band.

  Also reconsider whether every e2e run should seed placeholder accounting data by default.
- **Design fidelity (3, at floor). Owner: design.**
  - Amend design.md with the fix-round states (self-restricted panel, out-of-scope line), the `throttled`/`deferred`
    rate states and the FR-5 refusal row, then move it out of `draft`.
  - A browser pass (keyboard order, contrast, screen reader, axe) on Settings > Accounts and VAT, Settings >
    Exchange rates, the review panel and the export card would lift this to 4.
- **Trajectory (2, at floor). Owner: orchestrator (process).** No run trace was written for the feature. A
  retroactive trace would not be evidence, so this dimension cannot be lifted for this run. Future runs must write
  `.forge/runs/*.json` per the observability skill. Do not tick tasks whose done-when is unmet. Leave T31, T32 and T35
  as `[~]`/pending, or rewrite their done-when explicitly as an owner-confirmed change.

**Path to PASS (arithmetic).** The live e2e green gives AC satisfaction 5 (+7.0). A browser/a11y pass plus the
design.md amendment gives design fidelity 4 (+3.0). With the rest unchanged, that is 95/115 = **82.6**. Trajectory
stays at 2 for this run either way.

## Recommended next step

- **FAIL.** Do not move the spec to `done`. T37 stays unchecked, and T38 cannot close.
- Owner, in this order:
  1. Run the T31/T32 live e2e (the owner step, the shared dev DB). This is the gate that matters most.
  2. Fix the ADR, plan.md:1028 and spec "owner to confirm" items through the architect (no code change).
  3. Amend design.md and run a browser a11y pass through the designer and QE.
  4. Re-run `/wellforge:eval 20261118-refund-accounting-export`.
- No dev rework of product code is required for the eval. The open security follow-ups are release decisions for T39
  and T40, and the evaluator did not change any code.

---

# Round 2 (2026-11-19, HEAD `58f70e2b`)

The front matter now carries the round-2 result. The round-1 report above is kept unchanged, except that its front
matter was overwritten. Round 1 scored **73.9**, FAIL, at `19d1f2b5`.

**Range.** `git log 2e40d52b..HEAD` holds six commits:

| Commit | Content |
|---|---|
| `1722ef0e` | T31/T32 reopened |
| `90c47468` | spec "owner to confirm" |
| `d318707f` | ADR/plan/AGENTS/infra drift |
| `025dda21` | design.md implementation sync + browser a11y pass + T43 |
| `58926fee` | T43 refund-ui a11y fixes |
| `58f70e2b` | run trace |

The only product code that changed is refund-ui: 5 components and pages, plus `strings.ts`. `git diff 2e40d52b HEAD`
is empty for `refund-api`, `auth`, `shell` and `operai-ui`. So the round-1 runs still hold for those packages:

- refund-api 1426/0 and tsc clean;
- auth 1416 pass, 36 skip, 0 fail.

**Re-run by me at HEAD.** refund-ui:

- `vitest run`: **1267 pass** (81 files), matching the coordinator's figure;
- `tsc -b`, `eslint .` and `vite build`: all clean.

## What changed, checked against the round-1 findings

**Spec fidelity**

| Round-1 finding | Status at HEAD | Evidence |
|---|---|---|
| (a) Stale classification ADR | **Closed** | Decision 4 now states `supportedConditions: ["entity", "self-approval"]`, seeded like `approve`. It adds the line-level scope, the either-grant rule and the "seed never rewrites" note, and removes `classification_required`. Decision 8 points at the line-level scope. The other four 20261118 ADRs were also synced (the G6 budget, G8 "logged only", IS-6, SR-3/4, G10), as were AGENTS.md and infra/README.md (`d318707f`). |
| (b) plan.md:1028 misattribution | **Closed** | It now reads "by the product-owner agent, during the unattended run … pending the owner's review". |
| (c) Amended ACs not marked | **Closed** | Every amended or added AC and the new domain term are tagged "(owner to confirm)". A new open question asks for confirmation of A1/A2 (owner: Matteo Codogno). A word-level diff (tags stripped) confirms **no AC wording changed**: the commit only adds tags, one sentence and one open question. |
| (d) Minor contract drift | **Open** | `resolveClassification(line, overrides, defaults, foreignVatCodeId)` is still the signature in plan.md:53 and in ADR decision 1, but the code takes `(line, defaults, foreignCurrencyVatCode)`. `invalid_classification`, `invalid_default`, `invalid_month`, `invalid_request` and `export_log_failed` are still named in neither plan.md nor design.md. |

**Design fidelity**

| Round-1 finding | Status at HEAD | Evidence |
|---|---|---|
| (a) Never seen in a browser | **Largely closed** | design.md § Browser accessibility pass: an isolated Chrome with axe-core 4.14 on every state, light and dark themes, 320 px reflow, a manual contrast scan, and 61 screenshots. **Limits, stated by the designer:** <br>• refund-ui ran standalone with a stubbed shell and a mocked API, so it is not the shell mount and server behaviour is not tested; <br>• no real screen reader, no Italian locale, no paid-batch state; <br>• the pass was not re-run on the T43 fixes. |
| (b) Fix-round states undesigned | **Closed** | § Implementation sync adds S7a (self-restricted), S7b (out of scope), S5a (`throttled`/`deferred`/`not_fetchable`), S5b and S8a, and reconciles the built screens with the design. |
| (c) FR-5 gap | **Closed in code** | A-1 (High) was fixed in T43 (`ReviewDetailPage.tsx`): out-of-scope rows are counted, the summary is focused when no select can take focus, and the out-of-scope note is `tabIndex={-1}` (`LineClassificationPanel.tsx:121`). Tests are at `ReviewDetailPage.test.tsx:1344-1415`. A-2, A-3, A-7 and A-8 were fixed with component tests. |
| (d) `status: draft` | **Open** | The front matter still says `draft`. The new status note justifies this ("design is ungated in this flow"). |
| New since T43 | **Open** | The sync predates T43 by 4 minutes and now describes fixed behaviour as current. For example, S8a still says "not designed or fixed … the approval fails silently", and the reconciled table still says "S10 Check again … no live announcement (A-3)". |

**AC satisfaction, test quality and trajectory**

| Round-1 finding | Status at HEAD | Evidence |
|---|---|---|
| AC satisfaction: live e2e | **Open** (owner step) | T31/T32 are now honestly `[ ]` (tasks.md:530, :546). The assembled system has still never run. |
| Test quality: e2e unexecuted, no axe | **Partly closed** | axe ran manually in the browser pass, but nothing automates it in the suites, so a regression would not be caught. The e2e is still unexecuted. |
| Trajectory: no trace | **A trace now exists, but it is a reconstruction** | See the Trajectory row. |
| Trajectory: ticks without done-when | **Partly closed** | T31/T32 were reopened. **T35 is still `[x]`** although its done-when includes `cd shell && pnpm e2e refund-` green (tasks.md:617-619). |

## Round-2 score table

| Dimension | Weight | Score (/5) | Floor | Pass vs floor | Weighted | Evidence |
|---|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | pass (at floor) | 28.0 | Unchanged. 61/61 ACs have green executed evidence, and T43 regressed nothing (refund-ui 1267/0). The A1/A2 wording is now honestly "owner to confirm". **The live e2e (T31/T32) is still not run**, so the shell mount, the browser CSV download through CORS and the global-setup release are unobserved. A 5 needs observed end-to-end behaviour. |
| Spec fidelity / no drift | 20 | 4 | 3 | pass | 16.0 | Round-1 items (a), (b) and (c) are closed, and well beyond the minimum: five ADRs, AGENTS.md and infra/README.md were synced. Not 5: residual (d), the stale resolver signature (plan.md:53, ADR decision 1) and five emitted codes not in the contracts. Also, A1/A2 still await the owner, so part of the contract is unconfirmed. Small, but it is drift. |
| Test quality | 20 | 4 | 3 | pass | 16.0 | T43 added focused tests: focus target, live text and summary row count (`ReviewDetailPage.test.tsx`, `LineClassificationPanel.test.tsx`, `AccountingExportCard.test.tsx`, `ExchangeRatesCard.test.tsx`; +15 tests). The browser pass with axe is real verification, but it is a one-off manual run, not a test that would catch a regression. The e2e journeys are still unexecuted. The round-1 strengths stand. |
| Code quality & conventions | 15 | 4 | 3 | pass | 12.0 | The T43 changes are small and idiomatic, with typed `MissingField`, ref-based focus targets and en/it copy. The round-1 "against" list is unchanged: open low findings S-07, S-08, S-09 and S-10, R-1, and the e2e global-setup release that runs by default. A-1 (FR-5) is now fixed, so it no longer counts against this dimension. |
| Design fidelity (UI) | 15 | 4 | 3 | pass | 12.0 | **Raised from 3 on new evidence, not for effort.** <br>• design.md now covers every built state (§ Implementation sync). <br>• The screens have been observed in a real browser with axe, contrast and reflow checks. <br>• Its High and Medium findings were fixed and tested. <br>Not 5: <br>• the observation used a mocked API without the shell; <br>• no screen reader or Italian locale was used; <br>• it was not repeated after T43; <br>• the sync is already stale on A-1/A-3; <br>• `status: draft`; <br>• A-4 to A-11 (Low/Info) are open. |
| Trajectory | 10 | 2 | 2 | pass (at floor) | 4.0 | **Not raised.** <br>• `.forge/runs/2026-11-18T19-40-00Z-orchestrate-20261118-refund-accounting-export.json` was committed at 02:52 on 11-19 (`58f70e2b`), after the round-1 eval. <br>• It is a reconstruction: its `run_id`/`started` say 2026-11-18T19:40Z, its agent rows have no per-agent timestamps, and `finished` and `tokens` are null. <br>• Nothing in it marks it as reconstructed. <br>• It also records the drift event "stale ADR statements and plan attribution corrected" under agent `evaluator`, but the evaluator found them and the architect corrected them. <br>Its content is honest and matches git: QE FAIL then PASS, eval FAIL 73.9, `result: partial`, and env faults including "live e2e … not run; owner step". But it is a summary written to answer the finding, not a record of the run. As stated in round 1, it is not new trajectory evidence. The underlying evidence is still git, which round 1 judged good but with deductions. One deduction is gone (T31/T32 reopened). One remains: T35 is ticked against its done-when. I keep the neutral floor. Scoring it 3 would give 78.3, and the verdict would not change. |
| **Total** | 115 | | | | **88.0 / 115 = 76.5/100** | |

**Round-2 verdict: FAIL.** The total of 76.5 is below `pass_score` 80. **No dimension is below its floor.** AC
satisfaction and trajectory sit at their floors. The rise from 73.9 is earned: design fidelity went from 3 to 4 on new
evidence, the browser pass plus a complete implementation sync.

What still keeps the total below 80 is **the live e2e that no agent can run**. This is a result of the owner-step
constraint, not of a defect anyone found. No defect is open in the product code against an AC.

## Round-2 findings and owners

- **AC satisfaction (4, at floor). Owner step, then QE.**
  - Run `cd shell && pnpm e2e refund-accounting` (both journeys) plus every existing `refund-*.spec.ts` against the e2e
    stack, then record the run in qe-report.md and tick T31/T32.
  - A green run makes this 5 (+7.0), which gives **95/115 = 82.6, PASS** with every other score unchanged.
  - A red run makes the failing AC unmet: below the floor, so FAIL.
- **Design fidelity (4). Owner: design.**
  - Refresh § Implementation sync for T43: S8a and the "S10 Check again" row now describe fixed behaviour.
  - Re-run the axe pass on the T43 states (A-1 summary focus, A-2 reason focus, A-3 result announcement).
  - Decide whether `status: draft` should become `approved`, or whether the flow will always leave design ungated.
- **Spec fidelity (4). Owner: plan.** Fix the resolver signature in plan.md:53 and in ADR decision 1, and name the
  five 422/500 codes in the contracts. The owner confirms A1/A2 at T39.
- **Test quality (4). Owner: QE/dev.** The live e2e, as above. Add axe to the refund-ui Vitest suite (for example
  vitest-axe on the new cards and panel), so the browser pass becomes a regression gate.
- **Trajectory (2, at floor). Owner: orchestrator.**
  - Untick T35, or record an owner-confirmed rewrite of its done-when.
  - Mark the trace as reconstructed (for example a `note`), and correct the `evaluator` attribution of the drift
    correction.
  - Write traces as the run happens in future runs. This run's score cannot be recovered after the fact.

## Recommended next step (round 2)

- **FAIL.** The spec does not move to `done`, T37 stays unchecked, and T38 cannot close.
- The **most robust gate to PASS is the owner's live e2e run** (T31/T32). After it is green and recorded, re-run
  `/wellforge:eval 20261118-refund-accounting-export`. That needs no dev rework. The design and plan touch-ups above are
  worth doing, and the arithmetic matters here.
  - The total today is 88/115.
  - **Spec fidelity 4 → 5 alone gives 92/115 = 80.0, exactly `pass_score`.**
  - Design fidelity 4 → 5 alone gives 91/115 = 79.1, which is not enough.

  A 5 on spec fidelity would need all of the following:
  - the residual drift (d) fixed;
  - **A1/A2 confirmed by the owner (T39)**, because an approved contract that partly awaits the owner is not
    drift-free;
  - nothing new found on re-eval.

  So a pass through documentation alone also needs an owner action, and it would land on the threshold with no
  margin. The live e2e (+7.0 → 82.6) is the robust gate.

---

# Round 3 (2026-11-20, HEAD `e9439ead`)

The front matter now carries the round-3 result. Rounds 1 and 2 above are kept unchanged, except that the front
matter was overwritten. Round 1 scored **73.9**, round 2 **76.5**, both FAIL.

**Range and branch.** The feature now lives on `feat/accounting-module`. `58f70e2b` (round 2) is an ancestor of
`e9439ead`, and `git log 58f70e2b..HEAD` holds 155 commits (309 files in the product packages). Most of them belong to
specs/20261119-accounting: the Accounting module (T1-T57) and the sign-off round (T58-T83). That round amended this
spec (spec.md "Amendment 2026-11-19 (accounting sign-off)" and "sync with the sample file", F1-F8):

- the CSV became an XLSX journal workbook (AC-6.1, 6.2, 6.13-6.17);
- the VAT code is optional (AC-3.11-3.13; AC-2.5-2.7, 3.2 and 6.4 retired);
- defaults are accounts only;
- 14 expense types (US-8);
- the 2026 receipt baseline (AC-4.11-4.13, 7.4);
- reference data moved to accounting-api (US-1 and US-5 moved).

Since the last QE section, three fixes came out of the live run (5fc594c5, 3e9faef7, 086b92fb), followed by the
docs commit `e9439ead`.

**Re-run by me at HEAD**, read-only, with no database, Docker, e2e or secrets:

| Check | Result |
|---|---|
| refund-ui `vitest run` | **1340 pass / 77 files** (QE sign-off round: 1331; +9 from T83 and the three fixes) |
| refund-ui `eslint .` | clean |
| refund-ui `tsc -p tsconfig.app.json --noEmit` | clean (`tsc -b` not run because it writes build info) |
| refund-api `tsc --noEmit` | clean |
| refund-api pure suites, no DB: `amounts`, `xlsx`, `receiptNumber`, `exportFormat`, `classification` | **170 pass / 0 fail**, 5705 expects. `export.test.ts` (the golden workbook) could not run without `DATABASE_URL` (env validation at import). Its evidence is QE's run. |

DB-backed suites (refund-api 1924, accounting-api 658, auth) were **not** re-run, as instructed. Their evidence is
QE's sign-off round and its T82 re-test (qe-report.md § Sign-off round; specs/20261119-accounting/qe-report.md).

**New evidence weighed**

| Item | Evidence | Weight given |
|---|---|---|
| Live e2e (T81) | 20261119 qe-report.md § "Live e2e (T81, 2026-11-20)": `pnpm e2e e2e/refund- e2e/accounting`, **27/27**. 23 passed in one run. Two batch-PDF journeys passed on a rerun once `minio` was up (an environment cause, stated). The run came after the three fixes (tasks.md T31/T32/T35 notes). | Real. It closes round 2's main gap: the assembled system (shell mount, CORS download of the `.xlsx`, global-setup release) was observed. `refund-accounting.spec.ts:500-551` parses the downloaded workbook and asserts all eight cells per row, including the Description with the employee's **name**. |
| Browser axe | Same section: light and dark, en and it, on the refund review, request and batch pages, 0 violations after the fixes. The e2e helper runs wcag2a/aa including `color-contrast` (`shell/e2e/helpers/meetingsFixtures.ts:343-353`). | Real for the automated rules. There is no artefact beyond the report line, and no screen reader was used. |
| Accrio import (T80/T39) | Owner report, recorded in 20261119 tasks.md T80: the workbook was imported without manual fixes, and the Description pattern, labels, VAT codes, defaults and gifts account were confirmed "as they stand". | Accepted as the owner's statement. It is not verifiable in the repo. |
| 5fc594c5 | `SubtotalsPanel` `<dl>` now valid: `<dt>` and `<dd>`s are direct children of one grid `<div>`. The archive export label now starts with its visible text. The `axeKnownFindings.ts` allowance was **removed**, so the jsdom axe now asserts the fix (`ReviewDetailPage.test.tsx`, `RequestDetailPage.test.tsx`). | Good: a test exemption retired with its fix. |
| 3e9faef7 | The batch request row lost its restating `aria-label`. A `sr-only` "Open <employee>'s request: " now leads the link, so the name contains the visible text (WCAG 2.5.3). Tests are updated in en and it. | Good. Nit: the test pins the accessible text `"Open Alice's request: ApprovedEUR 9.10"`. Status and amount have no separator in the computed name, so some screen readers will run them together. |
| 086b92fb | `POST /requests` now stores `c.get("userName")` (the token's `name` claim) as `ownerName`, as approve/reject already did. The test harness's mocked JWT middleware now carries the claim like the real one (`jwt.middleware.ts:151`). There is a route test for both named and unnamed tokens. | The fix is correct for **new** requests. It is incomplete for the release: see the finding below. |

## Round-3 finding that blocks PASS: AC-6.13 (and the initials) for every request that exists at release

The commit message of 086b92fb says: *"Requests created before this fix keep their null name."*
`requests.repo.ts:39` is the only path that creates a `refund_request`, and it stored `ownerName = null` from
specs/007 (`02ad8508`) until 086b92fb. So **every request in production today has no name**, and nothing in the
branch fills it.

- **Export.** `employeeCell` (`refund-api/src/accounting/export.ts:74-75`) prints `ownerEmail` when `ownerName` is
  null. Every row exported for these requests gets the employee's email instead of their name. That covers:
  - every pre-release WellD CH line that `accounting:release` backfills (AC-7.1);
  - every request already drafted or submitted when refund-api is deployed.

  AC-6.13 asks for "the employee's name (the email address when **the account** has no name)". These accounts do
  have names, so for this population **AC-6.13 is not met**. The first exports after the release are exactly the
  ones that will show emails.
- **Initials.** `accounting:release` numbers the backfill with `initials(latest.ownerName, latest.ownerEmail)`
  (`refund-api/scripts/accounting-release.ts:620-625`). `decide.repo.ts:295` does the same at approval. For these
  requests the initials therefore come from the email local part (`receiptNumber.ts:56-74`).
  - An address like `matteo.codogno@` still gives `MC`.
  - Any other shape (for example `matteo@` gives `MA`, `mcodogno@` gives `MC`, and `m.rossi.it@` gives `MR`) gives
    initials that can differ from the name's.
  - The same employee could then carry two prefixes in 2026: email-derived for pre-deploy requests, name-derived
    after. That would put AC-4.2 at risk.

  This is not proven. It depends on real addresses, and the release report prints the initials for accounting to
  check. But the dry-run that would show it has not run (see Trajectory).
- **Why the tests did not catch it.** The golden fixture treats a null name as a legitimate case
  (`fixtures/accounting-export.input.json:7`). The mocked JWT carried no name until 086b92fb. The live e2e creates
  fresh requests after the fix. No test covers a pre-fix request that is then released or exported.
- **Not recorded anywhere as accepted.** plan.md:795 still assumes `ownerName ?? ownerEmail` with `ownerName`
  populated. There is no follow-up, no runbook step in RELEASING.md or infra/README.md, and no owner decision.

**What would close it** (dev task, then QE). Before T40, fill `refund_request.ownerName` for existing requests from
auth's user names. Do it either in `accounting:release`, or in a one-off script with a `--dry-run` that is idempotent
and audited per the immutable-audit ADRs. Alternatively, resolve the display name at numbering and export time from
the request owner's current account. Add a release/export test that:

- starts from a request with `ownerName = null` whose account has a name;
- asserts the Description and the initials.

Then run `accounting:release --dry-run` on a production copy (T39's own done-when) and have accounting check the
initials column. If the owner prefers to ship the email fallback for legacy requests, that is a spec change. It must
then be recorded as an amendment of AC-6.13, not left in a commit message.

## Round-3 score table

| Dimension | Weight | Score (/5) | Floor | Pass vs floor | Weighted | Evidence |
|---|---|---|---|---|---|---|
| AC satisfaction | 35 | **3** | 4 | **FAIL (below floor)** | 21.0 | **For:** <br>• Round 2's gap is closed. The assembled path ran live, 27/27, after the fixes (20261119 qe-report § Live e2e). <br>• `refund-accounting.spec.ts:500-551` asserts the real downloaded workbook cell by cell: AC-6.1, 6.2, 6.3, 6.13 for new requests, 6.14, 6.15, 6.16, 6.17 and 5.5/5.6. <br>• The sign-off ACs each have executed evidence (qe-report.md:315-345). Accounting imported the workbook into Accrio (owner report, T80). <br>**Against, and decisive:** AC-6.13 is **partially unmet**. Every request that exists at release, including every AC-7.1 backfilled line, exports the email instead of the name (`086b92fb` message; `export.ts:74-75`; `requests.repo.ts:39`). No backfill or decision exists. The same null name drives email-derived initials for that population (`accounting-release.ts:625`, `decide.repo.ts:295`), an unverified risk to AC-4.2. A defined, release-day population for which an AC fails is "partially met", which is anchor 3, not "minor edge" (4). <br>If scored 4, the total would be 78.3 and the verdict would still be FAIL on the total. |
| Spec fidelity / no drift | 20 | 4 | 3 | pass | 16.0 | **For:** <br>• The sign-off amendments are recorded carefully. No AC id is reused, and retired/adjusted ACs are marked inline (spec.md:65-182). <br>• F7/F8 are marked as added after approval and confirmed by the owner on 11-20 (spec.md:170). <br>• Round-2 residual (d): the resolver signature is fixed in plan.md:61 and in ADR decision 1 (`ff2b052d`). <br>**Against:** <br>• spec.md still lists **11 open questions as `[ ]`**: Description pattern, trial import, gifts account, 2025 accounts, remaining defaults, IPM26/IPM38 and others. The owner's 11-20 answers ("confirmed as they stand", 20261119 tasks.md T80) are recorded only in tasks.md, so the contract no longer matches what was decided. <br>• `invalid_classification`, `invalid_default` and `export_log_failed` are still unnamed in plan.md. <br>• plan.md:795 assumes a populated `ownerName`, so the null-name population is unplanned. |
| Test quality | 20 | 4 | 3 | pass | 16.0 | **For:** <br>• The e2e is now **executed** and meaningful (workbook parsed, eight typed cells, browser axe). <br>• jsdom axe on every state (T44), with the known-findings allowance removed by 5fc594c5. <br>• Mutation samples per round (20261119 qe-report). The D-9 order-dependence was fixed and re-run with several `--randomize` seeds. <br>• 086b92fb adds a named and unnamed route test and fixes the harness's JWT fidelity. <br>**Against:** <br>• The live run found three defects the unit suites missed. One came from the mocked JWT diverging from the real middleware. <br>• No test covers a pre-fix (`ownerName = null`) request through release and export. The golden fixture normalises that case as valid. <br>• 3e9faef7 pins an accessible name without a separator ("ApprovedEUR 9.10"). <br>• Browser axe and the Accrio import leave no artefact in the repo. |
| Code quality & conventions | 15 | 4 | 3 | pass | 12.0 | The three fixes are small and idiomatic, with en/it parity and comments citing the WCAG criterion and the cause. The XLSX writer is self-contained and cross-checked by an independent reader (`xlsx.test.ts` header). The pure modules are unchanged in style. <br>**Against:** <br>• 086b92fb fixes the write path but leaves the data it broke. <br>• The round-1 open lows are as accepted in the security re-reviews (S-07..S-10, R-1). <br>• The e2e global-setup release still runs by default. |
| Design fidelity (UI) | 15 | 4 | 3 | pass | 12.0 | **For:** <br>• The design was synced with the sign-off round (`6d090e13`), and SG-1..SG-4 were closed in code (T83 `ff972e4e`, recorded in `b2da6bc5`). <br>• **Real-browser axe now ran** on the shell-mounted refund pages, light/dark en/it, 0 violations after the fixes (20261119 qe-report § Live e2e). This closes round 2's "mocked API, no shell" limit for the automated rules. <br>**Not 5:** <br>• design.md was **not updated with T81**. §5 (design.md:919-933) still says "Nothing from a browser … pending T81" and that the e2e axe calls "have never been executed". §Browser accessibility pass says the same (:695). <br>• Round-2 staleness is still there: S8a "not designed or fixed … fails silently" (:664-668) and "S10 Check again … no live announcement (A-3)" (:681). <br>• `status: draft`. <br>• The checklist items with no recorded result: composer at 320 px in Italian, focus after None, a screen reader. |
| Trajectory | 10 | **3** | 2 | pass | 6.0 | **Raised from 2 on new evidence.** <br>• Both traces now say `reconstructed: true` with a `reconstruction_note` (the round-2 finding is closed). <br>• `2026-11-19T20-30-00Z-orchestrate-20261119-accounting-signoff.json` records the sign-off round with honest drift events (for example "design not synced … until after eval round 2") and `result: escalated`. <br>• Git shows the full QE FAIL → fix → re-test → PASS loop, security re-reviews, three eval rounds, and the live run's defects fixed with tests before T31/T32/T35 were ticked with evidence. <br>**Against:** <br>• **T39 is ticked against its done-when** (tasks.md:651-666): "each open question in spec.md has its answer recorded, and `accounting:release --dry-run` against a copy of production data shows a report accounting accepts". spec.md still has 11 open `[ ]` questions. The only rehearsal ran on synthetic scratch data (20261119 release-rehearsal.md:1-25). No production-copy dry-run is recorded, and that run is what would have shown the null-name initials and Descriptions. <br>• No trace covers the 11-20 session that produced the three fixes. <br>• This spec's qe-report.md still lists T80/T81 as "Pending for the owner" (:355-358). |
| **Total** | 115 | | | | **83.0 / 115 = 72.2/100** | |

**Round-3 verdict: FAIL.** **AC satisfaction (3) is below its floor of 4**, and the total of 72.2 is below
`pass_score` 80. Even if AC satisfaction were 4, the total would be 78.3, still FAIL.

The score is lower than in round 2, though more is now proven. Round 2 scored the ACs on unit evidence and could not
see the assembled system. The live run then showed a real gap: the name snapshot. Its fix leaves every pre-existing
request, which is the release-day population, outside AC-6.13.

## Round-3 findings and owners

- **AC satisfaction (3, below floor). Owner: dev (refund-api), then QE. This blocks PASS.**
  - Backfill `ownerName` for existing requests from auth, or resolve the name from the account at numbering and
    export time. Do this before T40 and before `accounting:release` numbers the backfill.
  - Add the legacy-request release/export test described above.
  - Alternatively, the owner amends AC-6.13 to accept the email for legacy requests.
  - Restoring the name with a test lifts this to 5 (+14.0 from 3). The arithmetic is below.
- **Trajectory (3). Owner: owner and orchestrator.**
  - Run `accounting:release --dry-run` on a production copy and have accounting check the initials column.
  - Record the 11-20 answers in spec.md.
  - Until both are done, T39 should be `[~]`, not `[x]`.
  - Future fix sessions should write a run trace.
- **Spec fidelity (4). Owner: product-owner agent, then architect.**
  - Close the 11 open questions in spec.md with the owner's 11-20 answers, or keep the ones that really stay open.
  - Name the three codes in plan.md.
  - Add the legacy null-name population to plan.md (receipt rules and export).
- **Design fidelity (4). Owner: design.**
  - Record T81's browser result in design.md §5 and § Browser accessibility pass.
  - Refresh S8a and the "S10 Check again" row, which T43 fixed.
  - Decide on `status`.
- **Test quality (4). Owner: QE.**
  - The legacy-request test above.
  - Separate status and amount in the batch row's accessible name.
  - Attach the browser-axe and Accrio evidence (a report file or a screenshot list) to the qe-report.
- **QE report upkeep. Owner: QE.** Move this spec's qe-report.md "Pending for the owner" to the T80/T81 results.

**Path to PASS (arithmetic).**

| Change | Total |
|---|---|
| Today | 83/115 = 72.2 |
| AC satisfaction 3 → 5 (backfill or resolve, plus the test, plus the prod-copy dry-run accepted) | 97/115 = **84.3, PASS** |
| AC satisfaction 3 → 4 only | 90/115 = 78.3, FAIL |

## Recommended next step (round 3)

- **FAIL.** The spec does not move to `done`. T37 stays unchecked, T38 cannot close, and T40 (release) must not run.
  Running `accounting:release` would number the backfill and freeze its lines with email-derived initials and
  email Descriptions.
- Route back through `/wellforge:implement`:
  1. a refund-api task for the `ownerName` backfill or resolution, with a legacy-request test;
  2. QE re-test;
  3. the owner's production-copy `accounting:release --dry-run`, completing T39 as written;
  4. spec.md open questions recorded;
  5. re-run `/wellforge:eval 20261118-refund-accounting-export`.

---

# Round 4 (2026-11-20, HEAD `1f44c2e5`)

The front matter now carries the round-4 result. Rounds 1 to 3 above are kept unchanged, except that the front matter
was overwritten. Round 1 scored **73.9**, round 2 **76.5** and round 3 **72.2**, all FAIL.

**Range.** The branch is `feat/accounting-module` at `1f44c2e5`. The tree is clean, 9 commits ahead of `origin`.
`git log 6a4c9974..HEAD` (`6a4c9974` is the round-3 report) holds seven commits. I read each with `git show`:

| Commit | What it does | Checked against |
|---|---|---|
| `a459fd8c` | refund-ui `BatchEmployeeGroupList.tsx`: hidden `", "` separators, so the row reads "Approved, EUR 9.10". The test pins the new text. T39 (and 20261119 T50) reopened. | Round-3 test nit; round-3 trajectory finding |
| `28d4192e` | design.md: § "Live e2e axe (2026-11-20)" lists the checkpoints, the three defects and what was **not** performed. S8a, S10 and A-6 are marked closed against the code, with file:line references. | Round-3 design findings |
| `ff9ba391` | The 20261119 qe-report states exactly what browser axe covered. | Round-3 evidence finding |
| `b7294792` (T84) | `refund-api/src/accounting/ownerNames.ts` (new auth client). In `accounting-release.ts`, `readOwnerNames` runs before any write and `fillOwnerNames` is step 0 inside the single transaction, before defaults, the baseline and numbering. Exit 4 means auth is unreadable. plan.md notes at :795 and :827-832. 15 + 2 tests. | **Round-3 blocking finding** |
| `a5799b9f` | QE delta PASS. Two more tests: auth failing on the second employee writes nothing; a rerun after the release. | |
| `c62a1125` | No auth read once the release marker is set (QE F-2). The QE test was rewritten to match. | |
| `1f44c2e5` | `src/lib/ownerName.ts` `normaliseOwnerName` (strips `\p{Cf}`, turns controls into spaces, caps at 200 code points), used at `POST /requests` and in the release fill. `users.contact` is held only for the release window (OWASP delta L-1/L-3, PASS with notes). | |

**Re-run by me at HEAD.** These checks are read-only and use no database, Docker, e2e, env files or network:

| Check | Result |
|---|---|
| refund-ui `pnpm exec vitest run` | **1340 pass / 77 files** (a459fd8c changed two assertions, not the count) |
| refund-ui `tsc -p tsconfig.app.json --noEmit` | clean |
| refund-ui `eslint .` | clean |
| refund-api `bunx tsc --noEmit` | clean |
| refund-api DB-free suites: `ownerName`, `amounts`, `xlsx`, `receiptNumber`, `exportFormat`, `classification` | **175 pass / 0 fail**, 5715 expects (round 3: 170; +5 from `ownerName.test.ts`) |

The DB-backed suites were **not** re-run, as instructed. That includes `accounting-release*.test.ts`, which hold all
17 T84 tests and both QE tests. Their evidence:

- the QE delta: refund-api 1942/0 before the QE additions, and `accounting-release.test.ts` 83/0 after them;
- the note added in `c62a1125`: refund-api `bun test` 1944/0.

**No run of the DB suites is recorded after `1f44c2e5`.** That commit changed `requests.routes.ts` (the name is now
normalised at creation) and the release fill. The change is identity for ordinary names, so a regression is unlikely,
but it is unobserved. The live e2e (27/27) ran **before** T84, so the release step that `shell/e2e/global-setup.ts`
runs has not run with the auth read in place.

## Round-3 blocking finding: AC-6.13 / AC-4.2 for legacy null-name requests

**Status: closed in code and in integration tests. Unverified on real data.**

What I checked:

- **Order.** The names are read after Accounting and before the list check. They are written as step 0 of the single
  transaction (`accounting-release.ts`, `fillOwnerNames` before `seedDefaults`, the baseline and `classifyAndNumber`).
  Both the backfill numbering (`accounting-release.ts:621`, `initials(latest.ownerName, …)`) and the later approvals
  (`decide.repo.ts`) therefore see the name.
- **Export.** `employeeCell` (`export.ts:74-75`) reads `ownerName` at export time, so the Description of a filled
  request ends with the name.
- **Approval window.** Approvals answer 409 `accounting_release_pending` until the release (AGENTS.md:408), so no
  number can be issued with email initials between the deploy and the release.
- **Same name source.** The name comes from the same field as the JWT claim. auth `userContact.routes.ts:268-285`
  returns `user.name`, which is non-null in `auth/prisma/schema.prisma:14`. Both paths go through
  `normaliseOwnerName`, so a legacy request and a new one of the same employee get the same initials.
- **Atomicity.** The fill only writes where the name is null (`updateMany where ownerName: null`). A failure of any
  lookup aborts before the transaction, and the "second employee fails" test proves nothing is kept.
- **Tests that assert the round-3 risk directly:**
  - "named BEFORE numbering": email `zz.unrelated@` gives `MC26/001`, not `ZU26`;
  - "baseline row … initials of the NAME": `MC26/082`, with the offsets keyed by email;
  - "DRY RUN reports the names it would fill and writes nothing": the report shows `MC26/001` and the DB is unchanged.

  The dry run therefore *will* show accounting the name-derived initials, which is exactly what T39's open step needs.

**What remains unproven:**

1. **No production-copy dry run.** T39 is reopened, and its done-when is now honest. This is the only run that shows,
   on real data:
   - how many employees resolve or stay unnamed;
   - whether auth's 600 per 10 min per-service contact limit holds for one sequential call per employee (QE F-3,
     OWASP L-2, with no backoff);
   - whether accounting accepts the initials column.
2. **No test exports a release-filled request and asserts its Description cell.** The link is a single field read,
   so I accept it by code reading, but it is not asserted.
3. **Deleted-in-auth employees** keep the email in the Description and initials. The report counts them and
   plan.md:831 records it. The AC says "when **the account** has no name", and a deleted account has none in auth.
   I accept this reading, now that it is recorded.

## The three error codes not named in plan.md: still missing

Emitted by the code and named in neither `plan.md` nor `design.md` (`grep -c` = 0 in both):

| Code | Status | Emitted at |
|---|---|---|
| `invalid_classification` | 422 | `refund-api/src/accounting/classification.routes.ts:80` (the `defaultHook` of the classification router); listed in the route's OpenAPI description at `:291` |
| `invalid_default` | 422 | `refund-api/src/accounting/defaults.routes.ts:69` (the `defaultHook` of the defaults router); OpenAPI description at `:168`; asserted at `defaults.routes.test.ts:222` |
| `export_log_failed` | 500 | `refund-api/src/accounting/export.routes.ts:231` ("The export could not be recorded, so no file was produced") |

There is a related contradiction, not only an omission. **plan.md:897** (the test-strategy row for AC-2.1) says
"a body carrying `vatCode` → 422 `invalid_request` (SO-16)". The code and its test answer `invalid_default`
(`defaults.routes.ts:69`, `defaults.routes.test.ts:222`). I did not fix it.

## Other round-3 findings, rechecked

| Round-3 finding | Status at HEAD | Evidence |
|---|---|---|
| T39 ticked with its done-when unmet | **Closed** | tasks.md:651-653: `[ ]`, with "Still open: `accounting:release --dry-run` against a copy of production … not part of T38's gate". T38's done-when is "every task T1–T37 checked" (tasks.md:641-647), so this is consistent. |
| design.md stale (T81 browser result, S8a, S10) | **Closed** | The `28d4192e` lines are listed in the table above. The limits are stated: no 320 px check, no hand contrast check, no screen reader, no Safari. Six states have no browser-axe checkpoint. |
| qe-report "Pending for the owner" | **Closed** | qe-report.md § "Live e2e update (2026-11-20)" and § "QE delta (2026-11-20)". |
| "ApprovedEUR 9.10" | **Closed** | `a459fd8c`; `BatchEmployeeGroupList.test.tsx` pins "Approved, EUR 9.10". With no `aria-label` there is no label/content mismatch. |
| Browser-axe and Accrio evidence only as report lines | **Partly closed** | ff9ba391 and design.md now state the exact coverage. There is still no artefact (axe JSON or screenshot list) in the repo, and the Accrio import is the owner's word. |
| plan.md assumes a populated `ownerName` | **Closed** | plan.md:795 and the note at :827-832. |
| spec.md open questions still `[ ]` | **Open** (not addressed by this range) | spec.md:706-759 has 11 `[ ]` items. The answers are in 20261119 tasks.md T80 and in tasks.md:652. |
| Three codes unnamed in plan.md | **Open** | See above. Now there is also the plan.md:897 contradiction. |
| No trace for the 11-20 session | **Open** | `git log 6a4c9974..HEAD -- .forge` is empty. The last trace is `2026-11-19T20-30-00Z-…-signoff.json`. |

**New, minor.**

- **infra/README.md:927** still says "Only `system:notify-api` holds `users.contact`".
- **infra/README.md:1916** ("Wiring in auth") gives refund-api's entry as `… accounting.reference.read users.contact`
  with no release-window caveat. The release runbook (:1185) and step 4 (:3038) do carry the caveat.
- **20261119 tasks.md:1023** (T84's done-when) still says the templates "say refund-api's entry holds
  `users.contact`", which `1f44c2e5` reversed.
- `c62a1125` reads the marker through `isAccountingReleased(db as unknown as Tx)`, a type cast, outside the advisory
  lock. It is benign because the in-transaction check repeats the read, but it is a cast.

## Round-4 score table

| Dimension | Weight | Score (/5) | Floor | Pass vs floor | Weighted | Evidence |
|---|---|---|---|---|---|---|
| AC satisfaction | 35 | **4** | 4 | pass (at floor) | 28.0 | **Raised from 3.** <br>• The round-3 gap is fixed where it mattered. Legacy names are filled before any number or baseline (`accounting-release.ts`, step 0 in the one transaction), and initials and Description follow (`:621`, `export.ts:74-75`). <br>• Asserted by `accounting-release.test.ts`: "named BEFORE numbering" (`MC26/001` not `ZU26`), "baseline row … `MC26/082`", "DRY RUN … writes nothing", "auth failing on the SECOND employee … writes nothing", a 404 stays unnamed and counted, an existing name is never overwritten. <br>• The rest of round 3's evidence stands: live e2e 27/27, the workbook parsed cell by cell, the Accrio import. <br>**Not 5:** <br>• no production-copy `--dry-run` (T39 open), so the release-day population's names, initials and the 429 budget are unobserved on real data; <br>• no e2e after T84, although the global setup runs this code; <br>• no DB-suite run recorded after `1f44c2e5`; <br>• no test asserts the exported Description of a release-filled request. <br>"All met, edges unobserved" is anchor 4. Round 3 set the bar for 5 as including "the prod-copy dry-run accepted". |
| Spec fidelity / no drift | 20 | 4 | 3 | pass | 16.0 | **For:** <br>• plan.md now plans the null-name population (:795, :827-832), including the deleted-user fallback. <br>• The OWASP-driven scope change is carried through AGENTS.md, `.env.example`, compose and mise. <br>• A1/A2 are confirmed (spec.md:711). <br>**Against:** <br>• three emitted codes are unnamed (table above); <br>• plan.md:897 names `invalid_request` where the code says `invalid_default`; <br>• spec.md keeps 11 answered questions as `[ ]` (:706-759); <br>• infra/README.md:927 and :1916 are stale on `users.contact`; <br>• T84's done-when contradicts `1f44c2e5`. <br>Each is small, so this is not 3. Together they are not drift-free, so it is not 5. |
| Test quality | 20 | 4 | 3 | pass | 16.0 | **For:** <br>• T84 came with a real-Postgres matrix: order of reads, atomicity across a partial auth failure, dry run, idempotence, never-overwrite, blank-is-none, deleted-user, the report's no-PII text. <br>• An auth-client kinds table: 401 re-mint, 404, 429, 5xx, wrong id, missing `name`, non-JSON, network error, token mint failure, with no secret in messages. <br>• CLI exit-4 tests. <br>• `ownerName.test.ts` covers bidi, zero-width, controls and the cap. <br>• The separator nit is fixed and pinned. <br>**Against:** <br>• no release → export Description assertion; <br>• the normalisation is not asserted through `POST /requests` or the fill (only trimming, in "  Marco Cattaneo "); <br>• the QE test rewritten in `c62a1125` and the new T84 tests had no mutation sample ("I did not run mutants on them"); <br>• the e2e has not been re-run on the changed release path; <br>• the browser-axe evidence has no artefact. |
| Code quality & conventions | 15 | 4 | 3 | pass | 12.0 | **For:** <br>• `ownerNames.ts` mirrors the existing service-client pattern: one re-mint on 401, `redirect: "error"`, a 5 s timeout, the answer bound to the asked id, a closed set of failure kinds with no URL, token or PII. <br>• Read-before-write is preserved, and failures abort with nothing written. <br>• The report prints counts only. <br>• Least privilege was tightened after review (L-1), and input was normalised (L-3). <br>**Against:** <br>• the `db as unknown as Tx` cast (`c62a1125`); <br>• sequential lookups with no backoff (L-2, accepted); <br>• the round-1..3 accepted lows (S-07..S-10, R-1); <br>• the e2e global-setup release by default, which now also depends on auth for a not-yet-released DB with unnamed requests (QE F-1). |
| Design fidelity (UI) | 15 | 4 | 3 | pass | 12.0 | **For:** <br>• design.md now matches what was observed: the live axe result, the defects, and S8a, S10 and A-6 marked closed with code references. <br>• It states precisely what was not performed. <br>• The a459fd8c separators were built as § S9 now describes. <br>**Not 5:** <br>• no manual pass (320 px, hand contrast, focus walk, screen reader, Safari); <br>• six states have no browser-axe checkpoint (composer hint, VAT None, account-only summary, ready Excel card, Settings defaults dialogs, Check again result); <br>• A-2, A-4, A-5 and A-7..A-11 were not re-checked; <br>• `status: draft` (deliberate, stated). |
| Trajectory | 10 | 3 | 2 | pass | 6.0 | **For:** <br>• T39 reopened with an honest note. <br>• The fix followed the round-3 route: dev (T84) → QE delta (with added tests) → fix of a QE finding (`c62a1125`) → OWASP delta → fixes (`1f44c2e5`). <br>• Each step's test counts are recorded in the commit or qe-report. <br>**Against:** <br>• no run trace for the 11-20 session (`.forge/runs` unchanged since `…-signoff.json`); <br>• no recorded test run after `1f44c2e5`; <br>• T84's done-when is stale after `1f44c2e5`. <br>Not 4. |
| **Total** | 115 | | | | **90.0 / 115 = 78.3/100** | |

**Round-4 verdict: FAIL.** The total of 78.3 is below `pass_score` 80. **No dimension is below its floor.** AC
satisfaction is back to 4, at the floor, because the legacy-name gap is fixed and tested.

The verdict now fails on the total only. The remaining distance to 80 is two things:

- **an owner step:** the production-copy dry run, which is the only observation of the release-day data;
- **documentation drift:** the codes, the plan.md:897 contradiction, the spec's open questions, and the infra/README
  lines.

## Round-4 findings and owners

- **AC satisfaction (4, at floor). Owner: owner (T39), then QE.**
  - Run `bun run accounting:release --dry-run --offsets <list>` on a copy of production. Accounting checks the
    initials column, the "employees named / left unnamed" counts, and that no 429 occurs.
  - Record the result in qe-report.md.
  - Before that, re-run refund-api `bun test` at HEAD (after `1f44c2e5`) and the e2e once, so the global-setup release
    has run with the auth step.
  - The dry run accepted, plus a release → export test that asserts the Description of a filled request, makes this 5.
- **Spec fidelity (4). Owner: architect / product-owner agent.**
  - Name `invalid_classification`, `invalid_default` and `export_log_failed` in plan.md's contracts.
  - Correct plan.md:897 (`invalid_request` → `invalid_default`).
  - Record the 11-20 answers in spec.md's open questions.
  - Fix infra/README.md:927 and :1916 and T84's done-when (20261119 tasks.md:1023).
- **Test quality (4). Owner: QE.**
  - Add the release → export Description test.
  - Assert normalisation through `POST /requests` and through the fill (a bidi name in, a clean name stored).
  - Run a mutation sample on the T84 tests.
  - Attach the browser-axe output.
- **Design fidelity (4). Owner: design / owner.** Do the manual pass (320 px, contrast, focus walk, screen reader) on
  the six states with no axe checkpoint.
- **Trajectory (3). Owner: orchestrator.** Write a trace for fix sessions as they happen.

**Path to PASS (arithmetic).** Today the total is 90/115 = 78.3.

| Change, all else unchanged | Total |
|---|---|
| AC satisfaction 4 → 5 (dry run accepted, Description test, suites re-run at HEAD) | 97/115 = **84.3, PASS** |
| Spec fidelity 4 → 5 (all the drift items above, nothing new found) | 94/115 = **81.7, PASS** |
| Design fidelity 4 → 5 (manual pass recorded) | 93/115 = **80.9, PASS** |
| Trajectory 3 → 4 | 92/115 = 80.0, at `pass_score`, with no margin |

The documentation fixes alone could pass this eval. **The production-copy dry run is still the gate that matters for
the release**, because it is the only observation of the data the release will number.

## Recommended next step (round 4)

- **FAIL.** The spec does not move to `done`, T37 stays unchecked, and T38 cannot close. T40 should not run before
  T39's dry run.
- There is no product-code blocker against an AC. Route the following:
  1. Docs (no code): the three codes plus plan.md:897, the spec.md open questions, infra/README.md:927 and :1916, and
     T84's done-when.
  2. QE: re-run the DB suites at HEAD, add the Description-through-export test and the normalisation assertions.
  3. Owner: the production-copy dry run (T39), then the e2e once.
  4. Re-run `/wellforge:eval 20261118-refund-accounting-export`.

---

# Round 5 (2026-11-20, HEAD `0a968716`)

The front matter now carries the round-5 result. Rounds 1 to 4 above are kept unchanged, except that the front matter
was overwritten. Round 1 scored **73.9**, round 2 **76.5**, round 3 **72.2** and round 4 **78.3**, all FAIL.

**Range.** The branch is `feat/accounting-module` at `0a968716`, and the tree is clean. After the round-4 report
(`c9a04384`) there are four commits. I read each with `git show`:

| Commit | What it does | Checked against |
|---|---|---|
| `87634a9a`, `6f247bdd` | spec.md open questions: all 11 are now `[x]` with a dated answer (`grep -n "\- \[ \]" spec.md` returns nothing). The answers point to 20261119 T80, which records the owner's confirmation on 2026-11-20 (20261119 tasks.md:771, :1239). | Round-4 spec-fidelity item |
| `6ea392d1` | 14 tests: release fill → export Description (3, `accounting-release.test.ts:762`, `:771`, `:777`); auth contract fixture and drift guard (2, `:872`, `:891`); `POST /requests` normalisation (1, `requests.routes.test.ts:190`); mocked-vs-real jwt parity (8, `testAuth.parity.test.ts`, new). `isAccountingReleased` now takes `Pick<Prisma.TransactionClient, "refundSetting">`, so the `db as unknown as Tx` cast is gone (`accounting-release.ts:467`). | Round-4 test-quality and code-quality items |
| `0a968716` | plan.md names `invalid_default` (:668), `invalid_classification` (:718) and `export_log_failed` (:782). AC-2.1 (:907) and SO-16 (:1351) now say `invalid_default`. There is a 2026-11-20 amendment for the release window and normalisation (:837). infra/README.md:927 and :1922 now give the release-window caveat, and the runbook has the `env:doctor --live` note. 20261119 T84's done-when is rewritten. The e2e object-storage prerequisite is in README.md and `playwright.config.ts`. The QE re-test is recorded in both qe-reports. | Round-4 drift items |

**Re-run by me at HEAD.** These checks use no database, Docker, e2e, env files or network:

| Check | Result |
|---|---|
| refund-api `bunx tsc --noEmit` | clean (with the cast removed) |
| refund-api DB-free suites: `ownerName`, `amounts`, `xlsx`, `receiptNumber`, `exportFormat`, `classification`, `testAuth.parity` | **183 pass / 0 fail**, 5736 expects (round 4: 175; +8 parity tests) |
| refund-ui `vitest run` | 1340 pass (no refund-ui change since round 4) |
| refund-ui `tsc -p tsconfig.app.json --noEmit`, `eslint .` | both clean |

**The parity test exercises both middlewares.** I checked that its "real" import is not just the mock again. The run
logs `[jwt] verification failed: ERR_JWS_INVALID`. Only `src/auth/jwt.middleware.ts:119` writes that line, and the
mock in `testAuth.ts:84-146` logs nothing. So the `?real-parity` import does reach the real middleware.

**The contract drift guard matches auth today.** Each string it looks for is in `auth/src/system/userContact.routes.ts`:
`:54` (the strict request schema with `max(200)`), `:56-60` (`id`, `email` and `name`, each `z.string()`) and `:73-74`
(the method and the path).

**Not re-run by me** (DB suites, as instructed): the 6 new DB-backed tests. Their evidence is the QE re-test,
refund-api `bun test` **1963 pass / 0 fail**, `tsc` clean (qe-report.md § "QE re-test after c62a1125 / 1f44c2e5").
That count is 1949 plus 14, which is consistent. Two points about that run:

- It ran on a branch `fix/eval-drift` that is not in this repo any more. The only code changes since are the ones in
  `6ea392d1` that it describes, so I accept it as evidence for HEAD.
- It ran in a scratch database (`refund_ownernames_scratch`) inside the `:5435` container. The `refund` database was
  not used. Isolation was at the database level, not by a separate container as in round 1. I note this and do not
  score it.

## Round-4 items, rechecked

| Round-4 item | Status | Evidence |
|---|---|---|
| Three codes unnamed in plan.md | **Closed** | plan.md:668, :718, :782 |
| plan.md:897 `invalid_request` vs code | **Closed** | AC-2.1 at :907 and SO-16 at :1351 both say `invalid_default` |
| spec.md open questions still `[ ]` | **Closed in the list, not carried into the text** | See "New drift" below |
| infra/README.md:927 and :1916 | **Closed** | :927 and :1922 |
| T84 done-when contradicts `1f44c2e5` | **Closed** | 20261119 tasks.md, T84 done-when |
| `db as unknown as Tx` cast | **Closed** | `release.ts` signature, `accounting-release.ts:467` |
| No release → export Description test | **Closed** | `accounting-release.test.ts:762` asserts `"m [MC26/001] Marco Cattaneo"` and that the email is absent. The 404 control at `:771` asserts the email. The test goes through `loadExportSource` → `evaluateExport` → `buildAccountingFile` → `readWorkbook`, so the production path is used, not a stub. |
| Normalisation not asserted through the fill or the route | **Closed** | The fill test (`:777`) asserts the exact value. The `POST /requests` test (`requests.routes.test.ts:190`) checks the bidi case exactly. For the cap it only checks `<= 200`, no U+202E and no trailing space, not the exact value; that is a weaker assertion than the fill test. |
| No mutation sample on the T84 tests | **Open** | qe-report re-test: "no mutation run on the T84 tests" |
| e2e not re-run after T84 | **Open** | The live run (27/27) predates T84. The global setup runs `accounting:release` on every e2e start. |
| Browser-axe evidence has no artefact | **Open** | No change |
| No production-copy dry run (T39) | **Open (owner)** | tasks.md:651-653 |
| No run trace for the 11-20 sessions | **Open** | `git log c9a04384..HEAD -- .forge` is empty. The last trace is `2026-11-19T20-30-00Z-…-signoff.json`. |

## New drift: the answers were ticked in the list but not carried into the spec, plan or design text

Ticking the 11 questions created contradictions. The answers are recorded only in the open-questions list. The ACs,
the plan and the design still describe them as open or provisional:

| Where | Text at HEAD | Contradicts |
|---|---|---|
| spec.md:107-108 (E3) | "The codes for 2.6 % and 3.8 % are not yet known (named IPM26 and IPM38 until confirmed: open question)" | spec.md open question, answered 2026-11-20: `IPM26`/`IPM38` confirmed |
| spec.md:517-519 (**AC-6.13**) | "The order and separators of the elements are provisional until the accountant answers (open question)." | answered 2026-11-20: Accrio accepted the pattern as it is. **The AC itself still calls its own format provisional.** |
| spec.md:577 (**AC-8.3**) | "The defaults of the other types are those of the initial list entered by accounting (open question)." | answered 2026-11-20: confirmed as they stand |
| plan.md:1352 (SO-17) | "the nine 'remaining defaults' stay the draft until accounting confirms (spec open question)" | same |
| plan.md:1336 (SO-1) | "**'Meals with clients'** (proposal, open question owner Matteo Codogno)" | answered 2026-11-20: the labels in the code are final |
| design.md:872 | "the other nine are the draft list until accounting confirms" | same as SO-17 |
| design.md:891 | "**Open, and not a design decision**: the spec still lists the Italian and English labels … as an open question" | No longer true |

Two smaller points about attribution:

- The reverse-charge question has "owner: accounting" but is "Answered … by Matteo Codogno".
- The gifts-account answer ("Answered 2026-11-19, confirmed 2026-11-20") names no one.

Neither changes a behaviour, because each answer is the fallback that was built. They do mean the record is not clean.

Each item is small and documentation-only, and no code contradicts an answer. But round 4 set the bar for 5 at "all
the drift items above, nothing new found". Something new was found, and it sits in two AC texts. That keeps spec
fidelity at 4.

## Round-5 score table

| Dimension | Weight | Score (/5) | Floor | Pass vs floor | Weighted | Evidence |
|---|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | pass (at floor) | 28.0 | **For:** <br>• AC-6.13 for a release-filled legacy request is now asserted end to end through the real export path (`accounting-release.test.ts:762`, `:771`). <br>• AC-4.2 initials come from the cleaned name (`:777`, `MC26/001`). <br>• The rest of the round-3 and round-4 evidence stands: 61/61 ACs with executed tests, live e2e 27/27, Accrio import. <br>**Not 5:** <br>• no production-copy `--dry-run` (T39 open; tasks.md:651-653), which round 3 and round 4 named as part of the bar for 5; <br>• no e2e since T84, although `shell/e2e/global-setup.ts` runs the changed release path on every start. <br>"All met, edges unobserved" is still anchor 4. |
| Spec fidelity / no drift | 20 | 4 | 3 | pass | 16.0 | **For:** <br>• Every round-4 drift item is closed: the codes (plan.md:668, :718, :782), AC-2.1 and SO-16 (:907, :1351), infra/README.md:927 and :1922, T84's done-when, and a dated answer for each of the 11 questions. <br>• The release-window amendment is in both plans (:837; 20261119 plan.md:897). <br>**Not 5:** the answers were not carried into the text. spec.md E3 (:107-108), **AC-6.13** (:517-519) and **AC-8.3** (:577) still say "open question" or "provisional", as do plan.md SO-1 (:1336) and SO-17 (:1352) and design.md:872 and :891. Two answers have attribution gaps (see above). |
| Test quality | 20 | 4 | 3 | pass | 16.0 | **For:** <br>• Release → export through the production functions, with a 404 control. <br>• Normalisation asserted exactly through the fill. <br>• An auth-client contract with a drift guard that reads auth's source; I checked its strings are in auth today. <br>• 8 parity tests that do reach the real jwt middleware; I verified this from the warn line. <br>**Not 5:** <br>• no mutation sample on the T84 tests (qe-report re-test: "no mutation run"); <br>• the e2e has not run on the post-T84 release path; <br>• the `POST /requests` cap assertion is `<= 200`, not exact; <br>• the drift guard's `method: "post"` check matches any POST in the file; <br>• there is still no browser-axe artefact. |
| Code quality & conventions | 15 | 4 | 3 | pass | 12.0 | **For:** the cast is replaced by a narrowed `Pick<…, "refundSetting">` parameter, the idiomatic fix (`release.ts`, `accounting-release.ts:467`). The `testAuth.keySet()` addition is minimal. <br>**Not 5:** unchanged accepted lows: L-2 (sequential lookups with no 429 backoff), S-07..S-10, R-1. The e2e global setup still runs the release by default against whatever DB `direnv` resolves. |
| Design fidelity (UI) | 15 | 4 | 3 | pass | 12.0 | **Unchanged from round 4.** The manual pass (320 px, hand contrast, focus walk, screen reader, Safari) was not performed, as recorded. Six states have no browser-axe checkpoint. **New:** design.md:872 and :891 are now stale against the answered label and default-account questions. |
| Trajectory | 10 | 3 | 2 | pass | 6.0 | **For:** <br>• A test run is now recorded after `1f44c2e5` (1963/0, tsc clean). <br>• T84's done-when matches the code. <br>• The route followed the findings: docs → tests → QE re-test notes. <br>**Not 4:** <br>• there is still no `wellforge-run/v1` trace for any 11-20 session; <br>• the QE re-test ran on a branch (`fix/eval-drift`) that is not in the repo, so I cannot check its order against the commits; the tests (`6ea392d1`) and the QE notes (`0a968716`) were committed one second apart. |
| **Total** | 115 | | | | **90.0 / 115 = 78.3/100** | |

**Round-5 verdict: FAIL.** The total of 78.3 is below `pass_score` 80, and **no dimension is below its floor.** AC
satisfaction is at its floor (4). The score is the same as round 4.

The work since round 4 closed every item it targeted:

- the drift items;
- the Description and normalisation tests;
- the contract and parity tests;
- the cast.

It still lifted no dimension a full anchor:

- **Spec fidelity** missed 5 because closing the questions created new contradictions in two ACs, the plan and the
  design.
- **Test quality** missed 5 because the mutation sample and the post-T84 e2e are still missing.

## Round-5 findings and owners

**Blocking (on the total only, no floor breach).**

- **Spec fidelity (4). Owner: product-owner agent / architect / designer. Docs only.** Carry each answer into the
  text it settles:
  - spec.md E3 (:107-108): IPM26 and IPM38 are confirmed.
  - **AC-6.13** (:517-519): drop "provisional until the accountant answers (open question)" and mark it as adjusted
    on 2026-11-20 by the Accrio acceptance.
  - **AC-8.3** (:577): the remaining defaults are confirmed.
  - plan.md SO-1 (:1336): the labels are final.
  - plan.md SO-17 (:1352): the nine defaults are confirmed.
  - design.md:872 and :891: same.
  - Name who answered the gifts question, and say that the owner answered the reverse-charge question in
    accounting's place, or have accounting confirm it.

  If nothing new turns up, this gives 5: 94/115 = **81.7, PASS**.
- **Test quality (4). Owner: QE.**
  - Run a mutation sample on the T84 and `6ea392d1` tests. Examples: drop `normaliseOwnerName` from the fill; read
    `ownerEmail` before `ownerName` in `employeeCell`; skip the released-marker check.
  - Make the `POST /requests` cap assertion exact.
  - Re-run the e2e once after T84.

  Together these give 5: 94/115 = **81.7**.
- **AC satisfaction (4, at floor). Owner: owner (T39).** The production-copy `accounting:release --dry-run`, accepted
  by accounting, is still the only observation of release-day data: names, initials and the 429 budget. With it
  this is 5: 97/115 = **84.3**. **Whatever this eval says, T40 should not run without it.**
- **Design fidelity (4). Owner: design / owner.** The manual pass on the six states with no checkpoint gives 5:
  93/115 = **80.9**.
- **Trajectory (3). Owner: orchestrator.** Write a trace for fix sessions. Keep QE re-test branches, or name the
  commit tested.

## Recommended next step (round 5)

- **FAIL.** The spec does not move to `done`, T37 stays unchecked, and T38 cannot close.
- Nothing blocks on product code. The quickest route to PASS is the docs-only propagation above, then a re-eval.
  The QE mutation sample and the e2e re-run are the second route.
- T39's production-copy dry run remains a release gate for T40, independent of this eval's verdict.
- Re-run `/wellforge:eval 20261118-refund-accounting-export` after the docs pass.

---

# Round 6 (2026-11-20, HEAD `564a897b`)

The front matter now carries the round-6 result. Rounds 1 to 5 above are kept unchanged, except that the front matter
was overwritten. Round 1 scored **73.9**, round 2 **76.5**, round 3 **72.2**, round 4 **78.3** and round 5 **78.3**,
all FAIL.

**Range.** The branch is `feat/accounting-module` at `564a897b`, and the tree is clean. After the round-5 report
(`9b95fb6f`) there are two commits, and `git diff --stat 9b95fb6f HEAD` touches only two test files, spec.md, plan.md,
design.md and qe-report.md. No product code changed. I read each commit with `git show`:

| Commit | What it does | Checked against |
|---|---|---|
| `77633b21` | spec.md: E3 (:107-108) names IPM26 and IPM38 as confirmed on 2026-11-20; **AC-6.13** (:509 header, :518-519 body) says the pattern is final (Accrio import, 20261119 T80); **AC-8.3** (:576-579) lists the nine remaining defaults and says they were confirmed on 2026-11-20; the F4 header is annotated "confirmed final on 2026-11-20". The gifts answer now names "accounting (relayed by Matteo Codogno)" and the reverse-charge answer says "Decided … by Matteo Codogno, for accounting", with the reason (a display figure, never exported). plan.md SO-1 (:1336) and SO-17 (:1352); design.md 3.7 (:872) and the labels note (:891), now "Settled (2026-11-20)". | Every round-5 drift row and both attribution points |
| `564a897b` | `requests.routes.test.ts:204-205`: the cap is asserted exactly (`"Ab ".repeat(66) + "Ab"`, 200 code points). `accounting-release.test.ts:894-896`: the drift guard binds `method: "post"` to the users-contact path with a regex and checks `router.post("/system/users/contact"`. qe-report.md:406 records refund-api `bun test` 1963/0 and `tsc` clean. | Round-5 test-quality items 3 and 4 |

**Re-run by me at HEAD** (no database, Docker, e2e, env files or network):

| Check | Result |
|---|---|
| refund-api `bunx tsc --noEmit` | clean |
| refund-api DB-free suites: `ownerName`, `amounts`, `xlsx`, `receiptNumber`, `exportFormat`, `classification`, `testAuth.parity` | **183 pass / 0 fail**, 5736 expects (same as round 5; no product code changed) |
| refund-ui `vitest run` | **1340 pass** |
| refund-ui `tsc -p tsconfig.app.json --noEmit`, `eslint .` | both clean |
| The new drift-guard assertions, run by a scratch script against `auth/src/system/userContact.routes.ts` | Both match today (`:72-74` declares `method: "post", path: "/system/users/contact"`; `:228` registers `router.post("/system/users/contact", …)`). A mutant with `method: "get"` on that route **fails** the regex, so the guard now catches what round 5 said it could not. |
| The exact cap value, computed independently | Dropping U+202E and taking the first 200 code points of `"Ab " × 100 + 😀` gives `"Ab " × 66 + "Ab"`, with no trailing space. The expected value in the test is right. |

**Not re-run by me:** the DB-backed suites, as instructed (`accounting-release.test.ts` is one). The full-suite
evidence is QE's line at qe-report.md:406, 1963/0. That is the same count as round 5, which fits: `564a897b` changes
assertions and adds no test. The note says neither which database it used nor which commit it ran at. It was
committed in the same commit as the test edits, 80 s after `77633b21`. I accept it as evidence for HEAD but cannot
check it against a trace.

## Round-5 items, rechecked

| Round-5 item | Status | Evidence |
|---|---|---|
| spec.md E3 (:107-108) | **Closed** | "are IPM26 and IPM38 … confirmed by accounting on 2026-11-20" |
| **AC-6.13** header and body | **Closed** | :509 "confirmed 2026-11-20: the pattern is final"; :518-519 "The order and separators of the elements are final" |
| **AC-8.3** (:577) | **Closed** | :576-579. The nine accounts listed match `refund-api/scripts/data/accounting-defaults.welld-ch.json` type by type. |
| plan.md SO-1 (:1336), SO-17 (:1352) | **Closed** | both rows rewritten |
| design.md :872, :891 | **Closed** | 3.7 "all fourteen confirmed by accounting on 2026-11-20"; "Settled (2026-11-20)" |
| Gifts answer names no one | **Closed** | spec.md:719 |
| Reverse charge "owner: accounting", answered by the owner | **Closed** | spec.md:754 says the owner decided it in accounting's place and why that is acceptable |
| `POST /requests` cap `<= 200` | **Closed** | exact value, see above |
| Drift guard `method: "post"` matches any POST | **Closed** | path-bound regex and handler check; I ran a mutant against it |
| No mutation sample on the T84 / `6ea392d1` tests | **Open** | qe-report.md:404 "no mutation run on the T84 tests"; the round-6 note adds none |
| e2e not re-run after T84 | **Open (owner)** | no change |
| Browser-axe evidence has no artefact | **Open** | no change |
| No production-copy dry run (T39) | **Open (owner, by design)** | tasks.md:651-653 |
| Manual a11y pass | **Open (owner, by design)** | design.md:927 |
| No run trace for the 11-20 sessions | **Open** | `git log 9b95fb6f..HEAD -- .forge` is empty; newest trace is still `2026-11-19T20-30-00Z-…-signoff.json` |

## Remaining text that contradicts a settled answer

As asked, I searched spec.md, plan.md and design.md for text that calls a settled point open, provisional, a draft
or awaiting an answer (`provisional`, `open question`, `until … confirms/answers`, `draft`, `still open`, `to
confirm`), and then read each hit in context.

**History, not counted.** These are dated records that describe what was open at the time:

- the amendment entries in spec.md: A2 (:30), the 2026-11-19 move (:65-66), E6 (:125) and F4 (:158-163; its header now
  says "confirmed final on 2026-11-20", and the body sentence "Order and separators stay a question" is the
  11-19 wording);
- the `[x]` question texts in the open-questions list (:730, :748);
- in plan.md, the 2026-11-18 data-model draft (:578-612, "kept for the record" at :583), the D table (D1, D2, D3 and
  D13 are marked superseded or retired), the "ADRs written 2026-11-18" list (:1297-1298), the SD hand-off list to the
  product-owner agent (:1482-1490) and the original risk register R1/R3/R4 (:1011-1014).

The list in round 5 was incomplete. The items below were already in the tree at round 5, and I did not find them
then. That is my miss, not a regression by the team. But they are the same kind of text that round 5 counted against
SO-1 and SO-17: live rows in the plan's current decision, risk and test tables. **So round 5's "if nothing new turns
up, this gives 5" does not hold.**

| Where | Text at HEAD | Contradicts |
|---|---|---|
| plan.md:1344, **SO-9** (the plan's decision behind AC-6.13) | Title "**Description pattern (provisional, for the accountant).**"; "the bracketed parts are new and easy to cut or move once accounting answers"; rationale "AC-6.13 content is mandatory, **its form provisional**" | AC-6.13 (:509, :518-519): the pattern is final. SO-9 sits in the same "Accounting sign-off delta" table as SO-1 and SO-17, which `77633b21` rewrote. That shows the table is maintained as current text. |
| plan.md:1458, **R21** | "Description pattern rejected by accounting. → **Provisional (SO-9)**" | same. The risk was retired by the Accrio import, but the plan still lists it as live and mitigated by "provisional". |
| plan.md:1441, test strategy **AC-8.3** | "GET defaults shows the five named defaults and **the draft for the others**" | AC-8.3 (:576-579): the nine are confirmed. |
| plan.md:66, module table, `exportFormat.ts` | "This is the single place to change **once accounting answers open question 3 (D3)**" | spec.md:139: open question 3 closed on 2026-11-19 by the sample, and D3 is marked superseded. This is the live module map, not history. Older, minor. |

**The same drift outside the three documents** (release inputs in the repo that this feature's release reads; noted
for completeness, not scored separately):

- `refund-api/scripts/data/accounting-defaults.welld-ch.json` `_note`: the nine types "stay the draft read off the
  2026 register until it [accounting confirms]". Its list of nine also names `company_manuals` and omits
  `travel_train`, which disagrees with AC-8.3's split, where manuals is one of the five named and train is one of the
  nine.
- `accounting-api/scripts/data/seed.welld-ch.json` `_note` (owned by 20261119, cited by E3): IPM26 and IPM38 are
  "written from the rates until accounting confirms them".

No code behaviour contradicts an answer. Each settled answer is the fallback that was built. Everything here is text.

## Round-6 score table

| Dimension | Weight | Score (/5) | Floor | Pass vs floor | Weighted | Evidence |
|---|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | pass (at floor) | 28.0 | **Unchanged.** No product code changed since round 5 (`git diff --stat 9b95fb6f HEAD`). The ACs that `77633b21` re-worded (AC-6.13, AC-8.3) still match the code: the `describeLine` pattern is unchanged, and the defaults JSON holds the nine accounts AC-8.3 now lists. The DB-free suites are 183/0 and refund-ui is 1340/0. **Not 5:** no production-copy `--dry-run` (T39; tasks.md:651-653) and no e2e since T84. Both are owner steps by design, and round 3 to 5 named them as the bar for 5. |
| Spec fidelity / no drift | 20 | 4 | 3 | pass | 16.0 | **For:** every round-5 item is closed exactly as asked: E3, AC-6.13 header and body, AC-8.3 with the account list, F4 annotated, SO-1, SO-17, design 3.7 and :891, and both attributions. The spec and design now carry no live text that contradicts an 11-20 answer. **Not 5:** the plan still does. SO-9 (:1344) and R21 (:1458) call the Description pattern provisional, which is the same point AC-6.13 now calls final. The AC-8.3 test row (:1441) still says "the draft for the others", and :66 still waits for open question 3. These rows are the same kind as SO-1 and SO-17, so I cannot count them as history. The release-input notes in the two seed JSONs say the same. Round 4 set the bar for 5 at "all drift items closed, nothing new found". These are four rows. |
| Test quality | 20 | 4 | 3 | pass | 16.0 | **For:** the two round-5 assertion gaps are closed, and I checked both. The exact cap value is right when computed independently. The path-bound guard matches auth's `:72-74` and `:228`, and it rejects a `method: "get"` mutant. Everything from round 5 stands: release → export through production functions, a 404 control, and parity tests that reach the real jwt middleware. **Not 5:** <br>• there is still no mutation sample on the T84 / `6ea392d1` tests (qe-report.md:404), which round 5 named first; <br>• the e2e has not run on the post-T84 release path; <br>• there is no browser-axe artefact. |
| Code quality & conventions | 15 | 4 | 3 | pass | 12.0 | **Unchanged** (no product code change). The accepted lows are still open: L-2 (sequential lookups, no 429 backoff), S-07..S-10 and R-1. The e2e global setup still runs the release against whatever DB `direnv` resolves. |
| Design fidelity (UI) | 15 | 4 | 3 | pass | 12.0 | **For:** design.md 3.7 and :891 now match the settled answers, with a name and a date. **Not 5:** the manual pass (320 px, hand contrast, focus walk, screen reader, Safari) has not been performed, and six states have no browser-axe checkpoint (design.md:927). Both are open by design as an owner step. They are still unobserved. |
| Trajectory | 10 | 3 | 2 | pass | 6.0 | **For:** the work followed round 5's routes in order, docs then tests, and the commit messages state their scope accurately. **Not 4:** <br>• there is still no `wellforge-run/v1` trace for any 11-20 session; <br>• the QE line was committed together with the test edits, with no commit or database named, so I cannot place the 1963/0 run against the tree. |
| **Total** | 115 | | | | **90.0 / 115 = 78.3/100** | |

**Round-6 verdict: FAIL.** The total of 78.3 is below `pass_score` 80, and **no dimension is below its floor.** AC
satisfaction is at its floor (4). The score is the same as rounds 4 and 5.

Both commits closed every item they targeted. I verified each one, including the drift guard against a mutant. No
dimension moved a full anchor:

- **Spec fidelity** still has live plan rows that call the Description pattern provisional and the defaults a draft.
  Round 5 should have listed these. They are documentation only.
- **Test quality** still lacks the mutation sample, which was the first test item in round 5.

## Round-6 findings and owners

**Blocking (on the total only, no floor breach).** Either route below is enough on its own.

- **Spec fidelity (4 → 5). Owner: architect (plan.md); docs only.** This is the quickest route.
  - plan.md:1344 SO-9: drop "(provisional, for the accountant)" from the title. Replace "easy to cut or move once
    accounting answers" and "its form provisional" with the 2026-11-20 confirmation (Accrio import, 20261119 T80).
  - plan.md:1458 R21: mark it closed on 2026-11-20 by the Accrio import, or replace "Provisional (SO-9)".
  - plan.md:1441 AC-8.3 row: "the confirmed list for the others".
  - plan.md:66: open question 3 is answered (SO-6 to SO-12).
  - Also, outside the three documents: the `_note` of `refund-api/scripts/data/accounting-defaults.welld-ch.json`
    (confirmed on 2026-11-20, and the list of nine corrected to AC-8.3's split). The IPM26/IPM38 sentence in
    `accounting-api/scripts/data/seed.welld-ch.json` belongs to 20261119.

  With a full re-grep finding nothing more, this gives 5: 94/115 = **81.7, PASS**.
- **Test quality (4 → 5). Owner: QE.** Run a mutation sample on the T84 and `6ea392d1` tests and record the result.
  Examples: drop `normaliseOwnerName` from the fill; read `ownerEmail` before `ownerName` in `employeeCell`; skip the
  released-marker check. With the e2e still owner-only, this alone may not reach 5. Prefer the docs route.
- **AC satisfaction (4, at floor). Owner: owner (T39).** No change: the production-copy dry run, accepted by
  accounting, gives 5. **T40 should not run without it, whatever this eval says.**
- **Design fidelity (4). Owner: design / owner.** No change: the manual a11y pass.
- **Trajectory (3). Owner: orchestrator.** No change: write a trace for fix sessions, and name the commit and
  database in each QE re-test line.

## Recommended next step (round 6)

- **FAIL.** The spec does not move to `done`, T37 stays unchecked, and T38 cannot close.
- Nothing blocks on product code. Apply the four plan rows and the defaults-file note above. Then grep the plan for
  `provisional|draft|once accounting|until accounting|open question` and confirm that every hit is in a dated
  history entry. Then re-run `/wellforge:eval 20261118-refund-accounting-export`.
- T39's production-copy dry run remains a release gate for T40, independent of this eval's verdict.

---

# Round 7 (2026-11-20, HEAD `ac7fa804`)

The front matter now carries the round-7 result. Rounds 1 to 6 above are kept unchanged, except that the front matter
was overwritten. Round 1 scored **73.9**, round 2 **76.5**, round 3 **72.2**, and rounds 4, 5 and 6 **78.3**, all
FAIL.

**Range.** The branch is `feat/accounting-module` at `ac7fa804`, and the tree is clean. After round 6 (`564a897b`,
report `8af61a5f`) there is one commit. `git diff --stat 564a897b ac7fa804` touches plan.md, the two data files and
this report, and nothing else. spec.md, design.md, tasks.md, qe-report.md and all product and test code are unchanged.

| Commit | What it does | Checked against |
|---|---|---|
| `ac7fa804` | plan.md :66 (`exportFormat.ts` row), the SO-9 title and body (:1344), the AC-8.3 test row (:1441) and R21 (:1458) rewritten to the 2026-11-20 answers. The `_note` of `refund-api/scripts/data/accounting-defaults.welld-ch.json` now says all fourteen were confirmed on 2026-11-20 (20261119 T80), and the wrong list of nine is gone. The `_note` of `accounting-api/scripts/data/seed.welld-ch.json` now says IPM26/IPM38 were confirmed on 2026-11-20 (T80). | Round-6 fix list, item by item; spec.md answers (:730-:762); 20261119 tasks.md:1239-1247 (T80 `[x]`, Accrio import recorded) |

**Re-run by me at HEAD** (no database, Docker, e2e, env files or network):

| Check | Result |
|---|---|
| refund-api `bunx tsc --noEmit` | clean |
| refund-api DB-free suites: `receiptNumber`, `exportFormat`, `amounts`, `xlsx`, `classification`, `ownerName`, `testAuth.parity` (run with `DATABASE_URL` unset) | **183 pass / 0 fail**, 5736 expects (the same as round 6) |
| Both data files parse as JSON. `_note` is free text: `accounting-release.ts:132-135` declares it the one free key, and `seed-welld-ch.ts:85` ignores it. The key-set tests (`accounting-release.test.ts:205`, `seed-welld-ch.test.ts:31,101`) assert only that the key exists. | No behaviour depends on the edit |
| The defaults file against SO-17 (:1352) and AC-8.3 (spec.md:574-579) | 14 keys, `representation_gifts` null, and each account matches |
| accounting-api `seed-welld-ch.test.ts` | **Not run.** It is DB-backed: `:12` imports `../src/lib/db`, and `:20-22` and `:138-148` query the DB. |

## Round-6 items, rechecked

| Round-6 item | Status | Evidence |
|---|---|---|
| plan.md:66, `exportFormat.ts` "once accounting answers open question 3 (D3)" | **Closed** | Now "accounting's sample file settled it (SO-6 to SO-12) and the trial import into Accrio confirmed it on 2026-11-20". The spec backs this at the trial-import answer (spec.md:735-737). |
| plan.md:1344 SO-9, title "(provisional, for the accountant)" | **Closed** | Now "(final: accepted by accounting with the Accrio import on 2026-11-20, AC-6.13)" |
| SO-9 body "easy to cut or move once accounting answers" | **Closed** | Now "accounting accepted them as they are on 2026-11-20" |
| SO-9 rationale "**its form provisional**" (named explicitly in round 6's fix list) | **Open** | :1344 Rationale column, unchanged: "AC-6.13 content is mandatory, its form provisional; one line per row is safe …". The title of the same row now says "final". |
| plan.md:1441, AC-8.3 test row "the draft for the others" | **Closed** | Now "the fourteen defaults of SO-17 (all confirmed by accounting on 2026-11-20), `representation_gifts` with none". SO-17 counts the same way. |
| plan.md:1458 R21 "Provisional (SO-9)" | **Closed** | Now "Closed 2026-11-20: accounting accepted the pattern (SO-9)" |
| defaults `_note`: nine "stay the draft … until it does", and the wrong list of nine | **Closed** | Now "Accounting confirmed all fourteen on 2026-11-20 (20261119 T80), including the nine that were the draft …". The list is dropped, so the mismatch is gone. |
| seed `_note`: IPM26/IPM38 "until accounting confirms them" | **Closed** | Now "confirmed by accounting on 2026-11-20 (T80)" |
| Mutation sample on the T84 / `6ea392d1` tests | **Open** | qe-report.md is unchanged since round 6 |
| e2e after T84; browser-axe artefact; T39 production-copy dry run; manual a11y pass | **Open (owner)** | unchanged |
| Run trace for the 11-20 sessions | **Open** | the newest file in `.forge/runs/` is still `2026-11-19T20-30-00Z-orchestrate-20261119-accounting-signoff.json` |

## The full grep (spec.md, plan.md, design.md, the two `_note`s)

I searched the three documents and both data-file notes for `provisional`, `draft`, `open question`, `open item`,
`still open`, `until … (accounting|it does|confirm)`, `once accounting`, `when accounting answers`, `to be confirmed`,
`TBC`, `TBD`, `unconfirmed`, `awaiting` and `placeholder`, then read each hit in context.

**History or not about a settled point, not counted** (as ruled in round 6):

- spec.md: amendment entries A2 (:30), the 11-19 move (:65-68), :77, :117, E6 (:125), :139, :152, F4 (:158), F6 (:167);
  the AC-6.13 and AC-6.14 change notes (:509, :520), which are dated and now say "final"; the `[x]` question texts
  (:704, :725 "Still open, below", :730, :748).
- plan.md: the data-model draft (:578-612), the original R1/R3/R4 (:1011-1014), the superseded D table (D1-D3, D5,
  D13: :1075-1087), the "ADRs written" list (:1268, :1297-1298), and the SD hand-off list (:1482-1490, including
  :1485 "Still open").
- plan.md, uses with a different meaning: "draft" as a request status (:91-94, :687, :714, D12 :1086), and
  "provisional before approval" for an amount (:691).
- design.md: `status: draft` and its notes (:3, :17, :641, :735), which are deliberate because design is ungated;
  "draft request" (:213, :772, :854); select placeholders (:236, :347, :757, :802, :825); the G-gaps and "Still open:
  G3, G5, G6, G9, G10, G11" (:689-691). The G-gaps are UX gaps, not accounting questions. :691 still lists G9 as open
  even though :629 marks it retired; that is noted, not scored. design.md:927 is the owner's manual pass.
- Both `_note`s: no hits remain.

**Live text that still treats a settled point as open.** These rows are in the same "Accounting sign-off delta"
table (plan.md :1303 ff.) as SO-1, SO-9 and SO-17, which `77633b21` and `ac7fa804` maintain as current text:

| Where | Text at HEAD | Contradicts | New since round 6? |
|---|---|---|---|
| plan.md:1344, **SO-9**, Rationale column | "AC-6.13 content is mandatory, **its form provisional**" | the same row's new title ("final … 2026-11-20"), and AC-6.13 (spec.md:509, :518-519) | **No.** Round 6 named this exact phrase in its fix list ("Replace … 'its form provisional' with the 2026-11-20 confirmation"). `ac7fa804` rewrote the title and body of the row and left this column. |
| plan.md:1343, **SO-8** | "no Table object (the template's 'Table1' is presentation; **added only if the import needs it, see Open items**)" | The trial-import answer (spec.md:735-737) asked exactly whether "its table object … matter[s]", and answered: Accrio imported the workbook without manual fixes. Also, plan.md has **no "Open items" section** (`grep -n -i 'open items'` finds only this line), so the reference leads nowhere. | Present at round 6. My round-6 grep had no `open item` term, so I missed it, as I missed SO-9's rationale column in round 5. |
| plan.md:1340, **SO-5** (minor) | "as a reference only (**the spec's fallback for its open question**; never exported)"; rationale "**open question 'reverse charge' fallback**" | spec.md:751-754: decided on 2026-11-20 to keep the fallback. The behaviour is right; only the wording still calls the question open. | Present at round 6, and missed by my grep then. It hit `open question`, and I did not read it in context. |
| plan.md:1450, **R16** (minor; not a grep hit) | Mitigation still future tense: "The golden file is handed to accounting for a trial import before release (owner task T80)". R21, two rows below, now says "Closed 2026-11-20". | T80 is `[x]` and the Accrio import was done (20261119 tasks.md:1239, :1247) | Present at round 6 |

No code behaviour contradicts an answer. The data-file notes are now clean. Everything left is plan text, and two
of the four rows are a few words each.

## Round-7 score table

| Dimension | Weight | Score (/5) | Floor | Pass vs floor | Weighted | Evidence |
|---|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | pass (at floor) | 28.0 | **Unchanged.** No product or test code changed (`git diff --stat 564a897b ac7fa804`). The DB-free suites are 183/0 and `tsc` is clean, re-run by me. The defaults file matches AC-8.3 and SO-17 account by account. **Not 5:** there is no production-copy `--dry-run` (T39; tasks.md:651-653) and no e2e after T84. Both are owner steps, and they have been the bar for 5 since round 3. |
| Spec fidelity / no drift | 20 | 4 | 3 | pass | 16.0 | **For:** `ac7fa804` closed seven of the eight round-6 items exactly: :66, the SO-9 title and body, the AC-8.3 row, R21, and both `_note`s (the wrong list of nine is gone). spec.md and design.md carry no live text that contradicts an 11-20 answer. **Not 5:** the bar set in round 6 was "with a full re-grep finding nothing more". The re-grep finds: <br>• the SO-9 rationale phrase "its form provisional" that round 6 named verbatim, still there, in a row whose title now says "final"; <br>• SO-8's "added only if the import needs it, see Open items", deferring a question the trial import answered and pointing to a section that does not exist; <br>• SO-5's "fallback for its open question" (minor); <br>• R16 not closed beside a closed R21 (minor). <br>These are the same kind of rows as SO-1, SO-9 and SO-17, so the same strictness as round 6 keeps this at 4. |
| Test quality | 20 | 4 | 3 | pass | 16.0 | **Unchanged.** No test changed. Round 6's evidence stands: the exact cap value and the path-bound drift guard (a mutant was rejected). **Not 5:** there is no mutation sample on the T84 / `6ea392d1` tests (qe-report.md:404), the e2e has not run on the post-T84 release path, and there is no browser-axe artefact. |
| Code quality & conventions | 15 | 4 | 3 | pass | 12.0 | **Unchanged** (no code change). The accepted lows are still open: L-2, S-07..S-10 and R-1. The e2e global setup still runs the release against whatever DB `direnv` resolves. |
| Design fidelity (UI) | 15 | 4 | 3 | pass | 12.0 | **Unchanged** (design.md not touched). **Not 5:** the manual pass has not been performed, and six states have no browser-axe checkpoint (design.md:927). |
| Trajectory | 10 | 3 | 2 | pass | 6.0 | **For:** one commit, scoped to the round-6 list, with an accurate message, 31 s after the round-6 report. **Not 4:** there is still no `wellforge-run/v1` trace for any 11-20 session. The commit says SO-9 "reflect[s] the settled answers", but it left the one SO-9 phrase round 6 quoted, and no grep step was recorded, although round 6 asked for one ("Then grep the plan for … and confirm every hit is history"). |
| **Total** | 115 | | | | **90.0 / 115 = 78.3/100** | |

**Round-7 verdict: FAIL.** The total of 78.3 is below `pass_score` 80, and **no dimension is below its floor.** AC
satisfaction is at its floor (4). The score is the same as rounds 4 to 6.

`ac7fa804` closed seven of the eight items it targeted, and both data notes are now clean. Spec fidelity does not
reach 5, for two reasons:

- the SO-9 rationale column still says "its form provisional", which round 6 quoted for replacement;
- the full grep that round 6 asked for finds SO-8's dangling "see Open items" for the Table object, a question the
  Accrio import answered. SO-5's wording and R16 are minor.

Part of this is my own miss. SO-8 and SO-5 were in the tree at round 6, and I did not list them then. I record them
now rather than let them pass. The bar for 5 was "nothing more found", and the grep found more.

## Round-7 findings and owners

**Blocking (on the total only, no floor breach).** Either route below is enough on its own.

- **Spec fidelity (4 → 5). Owner: architect (plan.md); docs only, four cells.**
  - plan.md:1344 SO-9, Rationale column: replace "AC-6.13 content is mandatory, its form provisional" with, for
    example, "AC-6.13 content is mandatory; its form final since 2026-11-20 (Accrio import, 20261119 T80)".
  - plan.md:1343 SO-8: replace "added only if the import needs it, see Open items" with "not needed: Accrio imported
    the workbook without it on 2026-11-20 (20261119 T80)".
  - plan.md:1340 SO-5: "the fallback, kept as the answer on 2026-11-20" in place of "the spec's fallback for its open
    question", in both columns.
  - plan.md:1450 R16: mark it closed on 2026-11-20 by the Accrio import (T80), as R21.

  Then run this grep on spec.md, plan.md and design.md and read every hit:
  `grep -n -i -E 'provisional|draft|open question|open item|still open|until accounting|once accounting'`. Every
  hit should be in the history list above. If nothing beyond these four turns up, this gives 5: 94/115 =
  **81.7, PASS**.
- **Test quality (4 → 5). Owner: QE.** No change: a mutation sample on the T84 and `6ea392d1` tests, recorded with
  the commit and the database used.
- **AC satisfaction (4, at floor). Owner: owner (T39).** No change: the production-copy dry run, accepted by
  accounting, gives 5. **T40 should not run without it, whatever this eval says.**
- **Design fidelity (4). Owner: design / owner.** No change: the manual a11y pass. Optional cleanup: design.md:691
  lists G9 as still open, but :629 retires it.
- **Trajectory (3). Owner: orchestrator.** No change: write a trace for the fix sessions, and record the grep output in
  the fixing commit's message or trace.

## Recommended next step (round 7)

- **FAIL.** The spec does not move to `done`, T37 stays unchecked, and T38 cannot close.
- Nothing blocks on product code. Apply the four plan.md cells above, run the grep, and then re-run
  `/wellforge:eval 20261118-refund-accounting-export`.
- T39's production-copy dry run remains a release gate for T40, independent of this eval's verdict.

---

# Round 8 (2026-11-20, HEAD `b5e24263`)

The front matter now carries the round-8 result. Rounds 1 to 7 above are unchanged, except that the front matter was
overwritten (round 7's 78.3 is kept there as `round7_score`). Rounds 1 to 7 scored 73.9, 76.5, 72.2, 78.3, 78.3, 78.3
and 78.3, all FAIL.

**Range.** The branch is `feat/accounting-module` at `b5e24263`, and the tree is clean. After round 7 (`ac7fa804`, report
`22302fbd`) there are two commits. `git diff --stat ac7fa804 b5e24263 -- . ':!specs' ':!.forge'` is empty, so no product,
test or data file changed. Only plan.md, design.md, this report and one new run trace changed.

| Commit | What it does | Checked against |
|---|---|---|
| `04ccd615` | plan.md: SO-5 (both columns), SO-8 (the Table object), the SO-9 rationale, the SO-14 rationale, R16, R18 and SD-2. design.md:691: G9 is no longer listed as open. The commit message records the round-7 grep and the classes of the remaining hits. | Round-7 fix list, cell by cell; spec.md:730-754 (the 11-19 and 11-20 answers) |
| `b5e24263` | Adds `.forge/runs/2026-11-20T13-00-00Z-live-e2e-and-close-20261119-20261118.json` (`wellforge-run/v1`, `reconstructed: true`) | `git log` for 11-20 and every SHA the trace cites (see Trajectory) |

**Re-run by me at HEAD** (no database, Docker, e2e, env files or network):

| Check | Result |
|---|---|
| refund-api `bunx tsc --noEmit` | clean |
| refund-api DB-free suites: `receiptNumber`, `exportFormat`, `amounts`, `xlsx`, `classification`, `ownerName`, `testAuth.parity` (run with `DATABASE_URL` unset) | **183 pass / 0 fail**, 5736 expects (the same as rounds 6 and 7). The `[jwt] verification failed` line is the parity suite's negative case. |
| DB-backed suites, e2e | **Not run**, as instructed |

## Round-7 items, rechecked

| Round-7 item | Status | Evidence at HEAD |
|---|---|---|
| plan.md:1340 SO-5, "the spec's fallback for its open question" (both columns) | **Closed** | "decided by the owner on 2026-11-20; never exported" / "the owner's reverse-charge decision of 2026-11-20". This matches spec.md:751-754. |
| plan.md:1343 SO-8, "added only if the import needs it, see Open items" | **Closed** | "the Accrio trial import of 2026-11-20 accepted the workbook without it". This matches spec.md:735-737. The dangling "Open items" reference is gone (`grep -n -i 'open item' plan.md` finds nothing). |
| plan.md:1344 SO-9, Rationale column, "its form provisional" | **Closed** | "AC-6.13 content is mandatory and its form is the one accounting accepted". The title, body and rationale of the row now agree, and they agree with AC-6.13 (spec.md:509, :518-519). |
| plan.md:1450 R16, mitigation still in future tense | **Closed** | "Closed 2026-11-20: accounting imported the workbook into Accrio without manual fixes (owner task T80)". It now matches R21. |
| design.md:691, G9 listed as still open although :629 retires it | **Closed** | "Still open: G3, G5, G6, G10, G11 (G9 retired 2026-11-19, see its row)" |
| Beyond the list: R18, SO-14 rationale, SD-2 | **Closed** | R18 now says "decided 2026-11-19 … release input, owner accounting, T39/T40" (spec.md:741-746). The SO-14 rationale no longer cites an open question. SD-2 now says the length, the pattern and the Table object were "left open then and closed on 2026-11-20". |
| Grep recorded in the fixing commit | **Done** | The `04ccd615` message gives the exact pattern and the classes of the remaining hits |
| Run trace for the 11-20 sessions | **Done, reconstructed** | `b5e24263`; judged under Trajectory below |
| Mutation sample on the T84 / `6ea392d1` tests; e2e after T84; browser-axe artefact; T39 production-copy dry run; manual a11y pass | **Open** | No change since round 7 (qe-report.md, tasks.md and design.md:927 are untouched) |

## The round-7 grep, run by me, every hit classified

`grep -n -i -E 'provisional|draft|open question|open item|still open|until accounting|once accounting'` over spec.md,
plan.md and design.md at `b5e24263` returns 20 + 24 + 12 = 56 lines. I read every hit in context.

| File:line | Hit | Class | Live contradiction of a settled answer? |
|---|---|---|---|
| spec.md:30 | A2 "New open question: which code is designated" | Amendment entry (2026-11-18), marked "(Superseded … 2026-11-19)" | No |
| spec.md:65, :68 | "Open questions 1, 4 and 6 keep their owner"; "answered the open questions" | Amendment entries (11-19) | No |
| spec.md:117, :125, :139 | E5 "Closes open question 1"; E6 "wait for the accountant's sample file (open question)"; the summary "Open questions: 1, 2, 3 and 6 closed" | Amendment entries (11-19 sign-off). E6's wait was answered by the next entry, F1 (:145 ff.). | No |
| spec.md:152, :158, :167 | F1 "(no longer provisional)"; F4 "(provisional; confirmed final on 2026-11-20, see AC-6.13)"; F6 "open questions" | Amendment entries (11-19 sample sync). F4's heading carries the 11-20 confirmation. Its body sentence "Order and separators stay a question" is dated history, and AC-6.13 overrides it. | No |
| spec.md:509, :520 | AC-6.13 and AC-6.14 change notes | Dated change notes that end in "final" / "no longer provisional" | No |
| spec.md:551 | AC-7.2 "refused … until accounting classifies them" | AC behaviour (a runtime condition), not a pending decision | No |
| spec.md:582 | AC-8.4 "once accounting has chosen any active account" | AC behaviour (a runtime condition) | No |
| spec.md:611 | "drafts" | Request status (Non-goal) | No |
| spec.md:684, :686 | "## Open questions" and its preamble | Section heading. Every item below it is `[x]` with a dated answer (:690-768). | No |
| spec.md:704, :725, :730, :748 | "a draft can be read off the register"; "Still open, below"; "the provisional pattern"; "the draft list" | Texts of ticked questions, each closed by a dated answer on the same item | No |
| plan.md:91, :94, :687, :714 | withdraw-to-draft, "draft line", `none = draft/rejected`, "// draft / rejected" | Request status | No |
| plan.md:691 | "provisional before approval" | Amount semantics, not a decision | No |
| plan.md:578, :583, :610, :612 | The data-model seed draft | Kept "for the record" under the "Superseded 2026-11-19" banner (:581-583). :612 is a runtime condition. | No |
| plan.md:1011, :1013, :1014 | R1, R3, R4 "(open question 4/2/3)" | Original 11-18 risk rows. R3 and R4 carry 11-19 annotations. R1's "Running the script is a release gate: run only after accounting signs off the seed" is still a true release gate (T39/T40). | No |
| plan.md:1075-1077, :1079, :1086, :1087 | D1, D2, D3, D5, D12, D13 | Original "Decisions taken unattended" table (11-18), superseded by the sign-off delta. D13 is marked "Retired 2026-11-19". D12 uses "draft" as a request status. | No |
| plan.md:1268 | F2 follow-up "a product question, alongside open question 5" | Under "Post-approval sync with design.md (2026-11-18)" (:1224). This is 11-18 text. Round 7 counted it as history, under the label "ADR list". | No. F2 (who may read exchange rates) is a separate question and still a follow-up. The reference to open question 5, answered on 11-20 (spec.md:706-707), is stale wording only. Noted, not scored. |
| plan.md:1297-1298 | "dialect values stay provisional until accounting answers open question 3 (D3)" | "ADRs written" list (11-18), a record of what ADR 5 said when it was written | No |
| plan.md:1317 | "It answers most of the spec's open question on the sample file" | Dated narrative of the 11-19 input in the sign-off delta's intro | No. The remainder is closed by SD-2 (:1482-1487) and spec.md:730-737. |
| plan.md:1482 | SD-2 "(open questions answered by the sample)" | Fixed by `04ccd615`. It now ends "closed on 2026-11-20 by the Accrio trial import" | No |
| plan.md:1491 | SD-5 "(open question on line breaks …): answered 'no' by SO-9" | States the answer | No |
| design.md:3, :17, :641, :735 | `status: draft` and its notes | Deliberate. Design is ungated (ruled in rounds 6 and 7). | No |
| design.md:213, :772, :854 | "drafts", "Draft request page", "draft request" | Request status | No |
| design.md:628 | G5 "a product question for the user, with open question 5" | G-gap row (UX), and G5 is still open by :691 | No. Same stale reference to question 5 as plan.md:1268. Noted, not scored. |
| design.md:689, :691 | "Gaps closed or still open"; "Still open: G3, G5, G6, G10, G11" | Open design gaps. G9 is now excluded, which fixes the round-7 note. | No |
| design.md:802 | "the A-10 nit, still open" | Open UX nit (the required-field star on S6c) | No |
| design.md:927 | "Still open before the release (T39/T40): `accounting:release --dry-run` against a copy of …" | Owner follow-ups that really are open (the T39 production-copy dry run and the manual pass). It also names the T80 Accrio import as done. | No, it is accurate |

**Result.** Every hit is history (amendment entries, ticked questions, the superseded draft, the D table, the 11-18
risk, ADR and design-sync rows), a workflow word (request "draft", design `status: draft`), a runtime condition in an AC,
or an open UX gap. None is live text that treats an accounting answer of 11-19 or 11-20 as open. This matches the
classes in the `04ccd615` message. That message does not name four of the classes (the AC runtime conditions :551 and
:582, SD-2 and SD-5 now stating answers, and the :1317 intro), but none of them is a contradiction.

**Two non-grep checks.**

- `grep` over the sign-off delta (plan.md:1303 ff.) for `trial import|Accrio|T80|to confirm|awaiting|TBD|TBC` finds
  only past-tense, closed text (SO-8, SO-9, R16, SD-2).
- spec.md:722 "accounting to confirm" is inside a ticked question (:719-726).

**Nits found while reading (not scored).**

- The new SO-14 rationale (plan.md:1349) cites "(duplicates, wrong-year numbers: AC-4.8)". AC-4.8 (spec.md:412) is the
  initials-from-email rule. The register's defects are described in the ticked baseline-list question (spec.md:741-746),
  which mentions AC-4.8 only for initials. The cross-reference is wrong; no decision is misstated.
- plan.md:1268 and design.md:628 pair F2/G5 with "open question 5", which was answered on 11-20.

Round 7 set this bar for spec fidelity 5: "If nothing beyond these four turns up, this gives 5". Nothing beyond them
turned up, so the bar is met.

## Trajectory: the reconstructed trace against git history

`.forge/runs/2026-11-20T13-00-00Z-live-e2e-and-close-20261119-20261118.json`:

- **Shape.** It conforms to `wellforge-run/v1`. It is flagged `"reconstructed": true`, with a note that it was written
  "from git history (086b92fb..04ccd615) and agent hand-back reports; times are approximate". It honestly records
  `finished: null` and `result: "in-progress"`, and `verdicts.eval` says "20261118 pending re-run after 04ccd615".
- **Every cited SHA exists.** I checked these with `git cat-file -e`: 5fc594c5, 3e9faef7, 086b92fb, b7294792, 28d4192e,
  a5799b9f, c62a1125, 1f44c2e5, 6ea392d1, 0a968716, 87634a9a, 6f247bdd, 77633b21, ac7fa804, 04ccd615, 564a897b, a459fd8c,
  ff9ba391 and 3f8a6645.
- **Agreement with `git log` (11-20, +0100).** The steps match the log in this order:
  - T81 fixes at 15:35-15:57;
  - the evaluator rounds 77.4 / 72.2 (`6a4c9974`, 16:35);
  - T84 (`b7294792`, 16:43);
  - the designer (`28d4192e`, 16:39);
  - the QE delta (`a5799b9f`, 16:47) and F-2 (`c62a1125`);
  - OWASP L-1/L-3 (`1f44c2e5`, 16:52);
  - T79 PASS 86.1 and T37 round 4 (`c9a04384`, 16:58);
  - the owner answers (`87634a9a`, `6f247bdd`);
  - the eval-drift fix (`6ea392d1`, `0a968716`, 17:03);
  - the doc fixes (`77633b21`, `ac7fa804`, `04ccd615`), with the test tightening (`564a897b`) between them.

  The two drift events are real and resolved: T39/T50 reopened in `a459fd8c`, and the axe over-claim corrected in
  `ff9ba391`. The minio prerequisite is documented in `0a968716`.
- **Inaccuracies.**
  - One evaluator entry ("T37 FAIL 78.3, rounds 4-7") is placed before the `fix/eval-drift` backend-dev entry. In git,
    rounds 5, 6 and 7 (`9b95fb6f` 17:08, `8af61a5f` 17:13, `22302fbd` 17:18) came after `6ea392d1` (17:03), so the
    trace's order understates the fix-and-re-eval loop.
  - `a459fd8c` is a `fix(refund-ui)` product change. The trace mentions it only as the drift event, and its "three
    defects" count leaves it out.
  - No drift event records `ac7fa804` claiming that SO-9 "reflect[s] the settled answers" while it kept the phrase round
    6 had quoted.
  - The trace was written after the fact, 36 s after `04ccd615`.
  - I cannot verify the `env_faults` beyond `0a968716`.
- **Process facts from git, unchanged.**
  - Rounds 5, 6 and 7 were each followed, about 30 s later, by a docs commit. Each fixed most but not all of the named
    cells, until `04ccd615`.
  - `04ccd615` is the first of these commits to record the grep, which round 7 asked for.

Round 7 gave two reasons for "Not 4": no 11-20 trace, and no recorded grep. Both are now addressed. The trace agrees
with git apart from the ordering compression above. That is a minor deviation in a trace marked as reconstructed and
approximate, so trajectory gets **4**. It does not get 5: the trace is reconstructed after the fact, its order is
partly wrong, it leaves out one fix, and the 11-20 session needed several eval rounds to settle docs drift.

## Round-8 score table

| Dimension | Weight | Score (/5) | Floor | Pass vs floor | Weighted | Evidence |
|---|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | pass (at floor) | 28.0 | **Unchanged.** No product or test code changed (`git diff --stat ac7fa804 b5e24263` outside specs/.forge is empty). I re-ran the DB-free suites (183/0) and `tsc` (clean). **Not 5:** there is no production-copy `--dry-run` (T39) and no e2e after T84. Both are owner steps, and they have been the bar since round 3. |
| Spec fidelity / no drift | 20 | 5 | 3 | pass | 20.0 | `04ccd615` closes all five round-7 cells: SO-5 (:1340), SO-8 (:1343), the SO-9 rationale (:1344), R16 (:1450) and design G9 (:691). It also fixes R18, the SO-14 rationale and SD-2. I ran the round-7 grep myself: all 56 hits are history, workflow words, AC runtime conditions or open UX gaps (classified above), and none contradicts an 11-19 or 11-20 answer. This meets the bar round 7 set for 5. Nits, not scored: the SO-14 rationale's AC-4.8 cross-reference is wrong, and plan:1268 and design:628 still call question 5 "open". |
| Test quality | 20 | 4 | 3 | pass | 16.0 | **Unchanged** (no test changed). **Not 5:** there is no mutation sample on the T84 / `6ea392d1` tests (qe-report.md:404), no e2e on the post-T84 release path, and no browser-axe artefact. |
| Code quality & conventions | 15 | 4 | 3 | pass | 12.0 | **Unchanged** (no code change). These accepted lows are still open: L-2, S-07..S-10 and R-1. The e2e global setup still runs against whatever DB `direnv` resolves. |
| Design fidelity (UI) | 15 | 4 | 3 | pass | 12.0 | design.md changed at :691 only, where G9 now agrees with :629. **Not 5:** the manual a11y pass has not been performed, and six states have no browser-axe checkpoint (design.md:927). |
| Trajectory | 10 | 4 | 2 | pass | 8.0 | **For:** the 11-20 trace exists, is honest about being reconstructed and in progress, and every SHA in it exists and matches the git order apart from one compression. `04ccd615` records the grep and the hit classes, as round 7 asked. **Not 5:** the trace was reconstructed after the fact; rounds 5-7 are placed before the `6ea392d1` fix they followed; `a459fd8c` is left out as a fix; there is no drift event for the `ac7fa804` partial fix; and docs drift took several fix-and-re-eval loops. |
| **Total** | 115 | | | | **96.0 / 115 = 83.5/100** | |

**Round-8 verdict: PASS.** The total of 83.5 is at or above `pass_score` 80, and no dimension is below its floor. AC
satisfaction is at its floor (4). The verdict does not depend on the trajectory raise: with trajectory at 3, the total
is 94/115 = 81.7, still PASS.

## Round-8 findings (non-blocking)

- **AC satisfaction (4, at floor). Owner: owner (T39).** This is a release gate, not an eval gate. The production-copy
  `accounting:release --dry-run` with the offsets list must be run and accepted by accounting before T40. **This PASS
  does not authorise T40 without it.** A slip here would put AC satisfaction below its floor in any later round.
- **Test quality (4). Owner: QE.** A mutation sample on the T84 and `6ea392d1` tests; the e2e on the post-T84 release
  path; a browser-axe artefact.
- **Design fidelity (4). Owner: owner / designer.** The manual a11y pass (design.md:927).
- **Trajectory (4). Owner: orchestrator.** When the run closes, finish the trace:
  - set `finished` and `result`;
  - split the evaluator entry into rounds 4, 5, 6, 7 and 8 in git order;
  - list `a459fd8c` as a fix.
- **Spec nits. Owner: architect (optional).**
  - plan.md:1349, SO-14 rationale: cite spec.md:741-746 (the baseline-list answer) instead of AC-4.8.
  - plan.md:1268 and design.md:628: drop "open question 5", which was answered on 2026-11-20.

## Recommended next step (round 8)

- **PASS.** T37 may be checked. The spec may move to `done` once T38's own conditions are met. The release remains
  gated by T39's production-copy dry run (accepted by accounting) before T40, independent of this verdict.
