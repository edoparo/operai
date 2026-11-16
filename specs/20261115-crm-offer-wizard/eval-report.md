---
spec: 20261115-crm-offer-wizard
evaluated: 2026-11-16
rubric: default-v2
score: 80.0
verdict: PASS
round: 3
---
# Eval report: CRM offer wizard — a guided offer built from the template

## Round 3 (HEAD ed6cb147)

**Rubric.** Same as rounds 1 and 2: the plugin's bundled copy,
`~/.claude/plugins/cache/wellforge/wellforge/2.63.1/config/eval-rubric.yml`, `version: default-v2`.
There is no `gates/configs/eval-rubric.yml`, no `.wellforge-gates/` and no `eval.md`. `design.md`
exists, so `design_fidelity` applies and the total is normalised over 115 weight points.

**What changed since round 2** (9ceaccaa..ed6cb147, 17 commits, 22 files):
- **Plan synced** (62b30b6c): plan.md:925 and DD-3 (:1357) now state the hand-edit limits as built.
  The draft schema allows 1 000 / 100 000 (`answersSchema.ts:69`). The dialog and generation keep
  120 / 20 000 (`HandEditDialog.test.tsx:255-272`; `offerDrafts.generate.test.ts:276-303` asserts
  `section_too_long`).
- **D1 / L-11** (22c1ac1c, 66c844f1): the form-graph walk counts its own steps and refuses above
  `maxWork` 500 000. The r7 and r8 tests assert on counted work, and linearity is now an exact step
  difference (`formGraph.r7.test.ts:115-129`). The only timing left is a 5 s hang guard (`SMOKE_MS`).
- **M-12** (7c3f39f1): each ExtGState is read once per walk and charged, `/BM` is limited to 16 names,
  and the state key is charged. Pinned by `formGraph.r10.test.ts` (6 tests that assert work and
  verdicts, not time).
- **Isolation** (eb7b83be, ADR amendment 790781ab): letterhead and attachment checks now run in a
  child process (`isolatedPdfCheck.ts`, `pdfCheckWorker.ts`). Limits: 5 s SIGKILL, a 512 MiB RSS
  watchdog, 2 running plus 6 queued, and two new 503 codes, `pdf_check_busy` and
  `pdf_check_unavailable`. All four call sites switched: `entityProfiles.routes.ts:283`,
  `letterheadUse.ts:65`, `attachments.routes.ts:194` and `contractPdf.ts:886`.
- **Reviews:** QE rounds 9-11 (FAIL on D1, then PASS, then PASS) and security rounds 9-11 (PASS WITH
  NOTES, then REVIEW REQUIRED on M-12, then PASS WITH NOTES with L-12…L-15 and I-22/I-23 as
  follow-ups). The trace now records both and a round-10 extension.
- **Hashes:** the reports cite pre-rebase hashes 1122e8b4, 3c4174b0 and 1b05e4f1. I checked that
  their patches are byte-identical to 7c3f39f1, eb7b83be and 790781ab (empty `diff` of
  `git diff X~1 X`), so the reviews apply to the code at HEAD.

**Gates I re-ran at HEAD ed6cb147:**
- **crm-api `bun test` on `crm_test`:** 1804 pass / 0 fail across 92 files, 33 174 expects.
  `DATABASE_URL` was the main checkout's crm-api direnv value with the trailing `/crm` swapped for
  `/crm_test`; I checked the suffix before running and would have aborted otherwise.
  `tsc --noEmit` exited 0.
- **crm-ui:** `pnpm lint` exited 0, and `vitest run` gave 1477 pass across 72 files.
- **`scripts/check-shared-copies.ts`:** 33 groups in sync.
- **e2e:** I did not run any. No UI code changed since round 2. QE round 11 ran the e2e trio 26/26
  at bd5db68c, after the last code commit.

**Latest QE verdict:** round 11, **PASS**, measured at bd5db68c (qe-report.md:3). That is after
every code commit, so verification finished. It is not BLOCKED.

| Dimension | Weight | Score (/5) | Floor | Weighted | Evidence |
|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | 28.0 | No AC-bearing behaviour changed; 79/79 ACs still have executed passing tests (qe-report.md § AC to evidence), 1804/1477 green at HEAD. Letterhead ACs (AC-11.x) re-observed end-to-end through the isolated check in QE r11's smoke: real Generate embeds the letterhead page, crafted files 422, stored letterhead untouched (qe-report.md:21-24). Still thin, unchanged: AC-12.5/12.6/12.11 (seed upgrade) proven only by `offerTemplates.seedUpgrade.test.ts` and `v1Digests.test.ts`; no observed upgrade over a person-edited v1 template |
| Spec fidelity / no drift | 20 | 4 | 3 | 16.0 | Round-2 nit closed: plan.md:925 and DD-3 :1357 now state the built hand-edit contract, and the code matches it. New drift instead: the isolation adds two failure responses, 503 `pdf_check_busy` and `pdf_check_unavailable`, to letterhead confirm, attachment confirm, the letterhead link and both generate routes (`isolatedPdfCheck.ts:57-69`). They are recorded in the ADR amendment and decisions.md:795-797 but are absent from plan.md (no match for `pdf_check`/`isolated`). OpenAPI still describes every 503 as "The authorization service is unavailable" (`lib/http.ts:179`). The ADR amendment calls the isolation "the owner's" decision, while decisions.md:791 records it as the orchestrator's, made under a standing instruction |
| Test quality | 20 | 4 | 3 | 16.0 | Round-2 gap closed. r7/r8 now assert counted work, and the M-11 linearity check is an exact step bound (`formGraph.r7.test.ts:125-129`). D1 did not recur in 6+3 QE full runs or in my run. `formGraph.r10.test.ts` pins the M-12 blind spot by work. `isolatedPdfCheck.test.ts` covers timeout kill, memory kill, chatty output, crash, garbage output, a missing worker and the busy cap. Against: (a) "runs with an empty environment" (`isolatedPdfCheck.test.ts:58-63`) only sets a parent variable and expects `{ok:true}`. It would pass with the environment fully inherited, and security L-12 shows the child does inherit the dev dotenv, so the test claims a property it does not check and that is false. (b) No route-level test maps `pdf_check_busy`/`unavailable` to HTTP 503, and no crm-ui test covers them (grep finds them only in `isolatedPdfCheck*`). (c) A new wall-clock assertion, `worst < 100` ms event-loop gap (:83). (d) Still no real or UI-level seed-upgrade test |
| Code quality & conventions | 15 | 4 | 3 | 12.0 | The isolation is careful. The spawn uses `env:{}`; stdout is capped at 4 KiB; a verdict is accepted only through a reason allowlist (`LETTERHEAD_REASONS`); a kill counts as a deterministic verdict while a crash is a 503 that nothing remembers; the slot is released in `finally`; the attachment memo is a bounded SHA-256 map with in-flight de-duplication. M-12 is fixed at the root (`stateOfExt`). tsc, lint and shared copies are clean, and every API used exists (`Bun.spawn` `killSignal`, `Bun.CryptoHasher`). Against: the header and the ADR say the child "holds no database URL, no key and no credential", which is false on a developer machine (L-12, Bun dotenv autoload, no `--no-env-file`). The child outlives the parent on SIGTERM (L-15). Up to 20 MiB per request is read before the busy check (L-13). A timeout kill is remembered for the life of the process (L-14). The memory bound is a polled watchdog that a fast allocator outruns to about 2 GB (I-22). All of these are recorded as follow-ups, and the M-8/M-9 residual remains |
| Design fidelity (UI) | 15 | 4 | 3 | 12.0 | No UI change since round 2. design.md is complete (F1-F15, S1-S13, a11y :762, reuse :710), with about 120 axe runs and 0 violations. Still unrealised: the preview is about 260 px tall at load at 1280×800 (decisions.md:494), and there is no library stacking table (decisions.md:469). New and unhandled: `pdf_check_busy`/`unavailable` are not error states in design.md. crm-ui shows them through `errorMessage`'s fallback (`lib/errors.ts:52`, `LetterheadCard.tsx` default branch), which displays the server's English `detail` even in the Italian UI, against the bilingual-copy rule |
| Trajectory | 10 | 4 | 2 | 8.0 | The round-2 deduction is closed. Every post-eval code commit was re-verified: QE r9 caught D1, QE r10 confirmed the fix, security r10 found M-12, the code was fixed, security r11 passed, and QE r11 ran the gates plus a smoke test at bd5db68c, after the last code commit. The trace records `quality-engineer` and `owasp-reviewer` entries and the round-10 extension (`.forge/runs/2026-11-15T21-01-29Z-…json:110-117, :237-245`). Gaps that keep this from 5: the historical deductions (the home-directory `boundPdf` scan, decisions.md:708; N-1, decisions.md:766). The trace's evaluator entry still says "FAIL 74.8 … re-eval pending" (:108), with no round-2 entry. The security note "L-10 memo ceiling" is stale, since L-10 is closed. The production `check-letterheads` audit is recorded only in QE round 10 as "not run by me; verified by orchestrator" (qe-report.md:46). That was before the M-12 `/BM` cap changed what a letterhead is refused for, and no re-run after 7c3f39f1 is recorded. Fix rounds: 10 used against a cap of 2, all as recorded extensions |
| **Total** | 115 | | | **92.0 / 115 = 80.0/100** | |

**Verdict: PASS.** The weighted total of 80.0 meets `pass_score` 80, with no margin. No dimension is
below its floor. The gain over round 2 (+1.7) comes from trajectory moving from 3 to 4: the round-9
code was re-verified by QE and security and recorded in the trace. Spec fidelity and test quality
each closed their round-2 gap, but each also took on a new gap of similar weight with the isolation
change, so neither moved.

### Findings (round 3)

Every dimension below 5. None is under its floor. The margin is zero: any one of these dropping a
step would fail the eval.

- **AC satisfaction (4).**
  - **Gap:** the seed upgrade (AC-12.5/12.6/12.11) has still never been observed over a
    person-edited v1 template.
  - **To reach 5:** run the upgrade on a DB holding the v1 seeds with one template hand-edited, then
    record what Templates and the wizard show.
- **Spec fidelity (4).**
  - **Gap:** the isolation's 503 codes are not in plan.md, and OpenAPI's 503 says "authorization
    service".
  - **Gap:** the ADR amendment says the owner decided, while decisions.md says the orchestrator did.
  - **To reach 5:** add the two codes to plan.md's route contracts and to the routes' OpenAPI
    responses, and make the attribution agree.
- **Test quality (4).**
  - **Gap:** the "empty environment" test is vacuous and its premise is false on dev (L-12).
  - **Gap:** no route-level or UI test covers the new 503s.
  - **Gap:** there is no real seed-upgrade test.
  - **To reach 5:** with L-12's `--no-env-file`, have the test worker report its environment size
    and assert 0. Add one route test for each new 503.
- **Code quality (4).**
  - **Gap:** L-12…L-15 and I-22 are deferred.
  - **Gap:** a header comment and the ADR make a confidentiality claim the code does not keep on dev.
  - **Gap:** M-8/M-9 remains the owner-accepted residual.
- **Design fidelity (4).**
  - **Gap:** the preview starts at about 260 px tall, and there is no library stacking table (both
    carried over).
  - **Gap:** the new busy/unavailable failures show untranslated server text. They need copy keys in
    the `en`/`it` catalogues.
- **Trajectory (4).**
  - **Gap:** the historical deductions are permanent.
  - **Gap:** the trace's evaluator entry and the "L-10" note are stale.
  - **Gap:** the production letterhead audit has not been recorded since the M-12 change. It is a
    release precondition (decisions.md:787), so re-run it read-only at HEAD before deploy and record
    the result.

Not credited: any self-critique or TDD lines in commits or design.md. I also did not credit the
caller's statement that the production audit was re-run "with the new code". The only record is
QE round 10's relay (qe-report.md:46), and that predates 7c3f39f1.

### Recommended next step (round 3)

PASS: the spec may move to `done`. Because the PASS is exactly at the threshold, do these before or
with the release (none needs `/wellforge:implement` for the verdict):
1. Re-run `crm-api/scripts/check-letterheads.ts` read-only against production at HEAD and record the
   result. This is the release precondition at decisions.md:787.
2. Follow up L-12 (`--no-env-file` plus an empty cwd, and make the env test real), L-13, L-14 and
   L-15.
3. Add `pdf_check_busy`/`pdf_check_unavailable` to plan.md, OpenAPI and crm-ui copy (`en` and `it`).
4. Add the round-2 and round-3 evaluator outcomes to the run trace, and drop the stale "L-10" note.

## History

### Round 2 (HEAD 7a1a8b65) — FAIL 78.3

**Rubric.** I used the plugin's bundled copy,
`~/.claude/plugins/cache/wellforge/wellforge/2.63.1/config/eval-rubric.yml`, `version: default-v2`.
This is the same rubric as round 1. Neither `gates/configs/eval-rubric.yml` nor `.wellforge-gates/`
exists in this repo, and there is no `eval.md`, so no overrides apply. `design.md` exists, so
`design_fidelity` applies and the total is normalised over 115 weight points.

**What changed since round 1** (d5d58dd7..7a1a8b65, 8 commits):
- The owner confirmed SA-1…SA-6, every DD-*, the resolutions of O3, O4 (the decimal comma is kept for
  both entities), O8, O9, O11–O13, and all 24 OWNER REVIEW items, as they are (decisions.md:770-771;
  spec.md:128 and every "owner to review" marker in spec.md, commit 422ed122).
- L-10: the memo is capped at 20 000 entries and gives a deterministic `too_complex` verdict
  (formGraph.ts:66-72, :504-509, :570, :589; commit 679b20ab; formGraph.r8.test.ts).
- The dead 018 renderer was removed from `offers/pdf.ts` (86 lines remain). The live helpers are tested
  in `offers/pdf.test.ts` (commit 13bb3abc).
- AC-11.5: the byte compare was replaced by a settle check plus a 6×6 block-mean compare with threshold
  12 (shell/e2e/crm-offer-wizard-pages.spec.ts:111-213, :827, :854-864; commit d47c50c1).
- pdf.worker: a comment documents that the chunk is a live dynamic import
  (renderLetterhead.ts:18-21; the import is at :70).
- Trace 2: `result` was corrected to `completed`, and an evaluator entry and a round-9 extension were
  added.

**Gates I re-ran at HEAD 7a1a8b65:**
- **crm-api `bun test` on `crm_test`:** 1775 pass / 0 fail across 90 files. `DATABASE_URL` was the
  direnv value with `/crm` swapped for `/crm_test`, and I checked the suffix before running.
  `tsc --noEmit` was clean.
- **crm-ui:** `pnpm lint` was clean. `vitest run` gave 1477 pass across 72 files.
- **`scripts/check-shared-copies.ts`:** 33 groups in sync.
- **AC-11.5 e2e against the live dev stack:** `--repeat-each 5` gave 5/5 pass.

**No QE or security re-run after the eval fixes.** The latest `qe-report.md` is still round 8, PASS,
not BLOCKED. Neither QE nor security ran again after the post-eval code changes. Those changes are
the L-10 security fix, the pdf.ts deletion and the e2e rewrite. My own gate run is the only
independent verification of them.

| Dimension | Weight | Score (/5) | Floor | Weighted | Evidence |
|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | 28.0 | 79/79 ACs have an executed passing test (qe-report.md § AC to evidence). AC-11.5 is no longer flaky: I ran it 5/5 at HEAD, and the block compare still fails on a page-1-vs-page-2 mutation (decisions.md:781). AC-9.6 is now met as amended and confirmed by the owner (SA-5, spec.md:128). Still thin: AC-12.5/12.6/12.11 (seed upgrade) are proven only by offerTemplates.seedUpgrade.test.ts and wizardSeeds/v1Digests.test.ts plus the dev DB's seeded state. No run shows the upgrade over a person-edited earlier-release template (qe-report.md § AC to evidence) |
| Spec fidelity / no drift | 20 | 4 | 3 | 16.0 | Every delegated amendment and review item is owner-confirmed (decisions.md:770-771; spec.md:128, :155-:476 markers). What is built matches the confirmed spec. Remaining nit: plan.md still states hand-edit caps of heading ≤ 120 and body ≤ 20 000 (plan.md:925, :1115, DD-3 :1357), but the build ships 1 000 / 100 000 (owner-confirmed in decisions.md, not synced into the plan). Small out-of-feature change: the 018 `renderOfferPdf`/`Writer`/`displayDate` were removed (commit 13bb3abc). This is harmless, has no references, and tsc is clean |
| Test quality | 20 | 4 | 3 | 16.0 | offers/pdf.test.ts asserts real behaviour. For example, Helvetica throws on the raw text but not on the `winAnsi` output (:87-101), and `scopeLabels` is checked to reach `buildScope`'s output (:19-31). formGraph.r8.test.ts pins the cap as a verdict and checks that a page under the cap is still priced (:89-93). The AC-11.5 compare is tolerant but still catches a real difference. Against: wall-clock assertions in the bound tests (formGraph.r8.test.ts:69, :85 `ms < 500`; formGraph.r7.test.ts:55, :111, :120 timing ratio, which already failed once under load, decisions.md:777). The seed-upgrade ACs have no UI- or real-upgrade-level test. Layout classes D19-D21 are pinned only by e2e |
| Code quality & conventions | 15 | 4 | 3 | 12.0 | L-10 is closed with a count cap that is deterministic across machines (formGraph.ts:66-72). The memo growth is counted in one place (:504-509). The pdf.worker finding from round 1 was wrong: `renderLetterhead.ts:70` dynamically imports `pdfjs-dist/build/pdf.worker.min.mjs`. Lint is clean, tsc is clean, and shared copies are in sync. Still against: the hand-written PDF render-cost analyser (`formGraph.ts`) keeps an accepted bypass class, M-8/M-9. Its residual reaches the client's PDF viewer through every generated offer (decisions.md:766). The owner accepted this, but it is a known correctness gap that only an insider precondition bounds |
| Design fidelity (UI) | 15 | 4 | 3 | 12.0 | No UI change since round 1. design.md is complete (F1-F15, S1-S13, a11y :762, reuse :710). About 120 axe runs gave 0 violations. Still unrealised or thin: the preview is about 260 px tall at load at 1280×800, marked "open… accepted for now" (decisions.md:494). The owner confirming that does not make the design realised. There is no stacking-table pattern in `@operai/ui` (decisions.md:469). G1 focus is inherited |
| Trajectory | 10 | 3 | 2 | 6.0 | Traces exist and show the right order (architect → PO → adr-writer → designer → devs → QE/security → evaluator). Trace 2's `result` is now `completed`, consistent with its verdicts, and round 9 is recorded as owner-granted. Deductions unchanged from round 1: the unrequested `boundPdf` scan over 77 PDFs in the owner's home directory (decisions.md:708) and N-1, the owner deciding on a misstated residual scope (decisions.md:766). New: the round-9 code changes, including a security fix in formGraph.ts, were committed after the final QE and security PASS and were not re-reviewed by either. The cap was used 9 times against 2 (extensions granted) |
| **Total** | 115 | | | **90.0 / 115 = 78.3/100** | |

**Verdict: FAIL.** The weighted total of 78.3 is below `pass_score` 80. No dimension is below its
floor. The gain over round 1 (+3.5) comes from spec fidelity moving from 3 to 4, now that the owner
has confirmed every delegated amendment.

#### Findings (round 2)

Every dimension that scores below 5 is listed here. No dimension is under its floor.

- **AC satisfaction (4).**
  - **Gap:** the seed-upgrade ACs AC-12.5, AC-12.6 and AC-12.11 have test evidence but no observed
    run of the real upgrade. In particular, nothing shows that a person-edited earlier-release
    template survives.
  - **To reach 5:** run the upgrade against a DB holding the v1 seeds, with one template hand-edited
    (and one with only its address changed). Then record what Templates and the wizard show.
- **Spec fidelity (4).**
  - **Gap:** plan.md's hand-edit caps (120 / 20 000) contradict the built and owner-confirmed
    1 000 / 100 000.
  - **To reach 5:** sync plan.md (§ caps :923-925, the AC-5.4 row :1115, DD-3) to the built
    contract, so that the contract is as planned.
- **Test quality (4).**
  - **Gap:** the wall-clock assertions in formGraph.r7 and formGraph.r8 tests are a source of flakes,
    and one has already failed under load.
  - **Gap:** the upgrade ACs have no UI-level test.
  - **To reach 5:** assert on work counted (entries, operators) rather than milliseconds, or isolate
    the timing checks from the default `bun test` run.
- **Code quality (4).** The accepted residual M-8/M-9 in a home-grown PDF cost model is an owner
  decision and is not addressable inside this spec. It is bounded by the letterhead configurator
  follow-up.
- **Design fidelity (4).** The preview is about 260 px tall at load at 1280×800, and there is no
  library stacking table. Both are open design items that have been accepted, not built.
- **Trajectory (3).** The historical deductions are permanent: the home-directory scan and N-1. The
  round-9 code changes skipped QE and security re-verification.
  - **Smallest fix:** a narrow security pass over the L-10 change and a QE gate-only round at HEAD.
    Recording both in the trace would make the post-eval changes verified.

The cheapest path to ≥ 80, any one of these (each +1 step):
- Trajectory 3→4: a QE plus security re-verification of round 9, recorded in the trace, gives 80.0.
- Spec fidelity 4→5: syncing plan.md to the built caps gives 81.7.
- Test quality 4→5: replacing the wall-clock assertions gives 81.7.

Not credited: any "self-critique" section or TDD line in design.md or the commits. Only tests that
would fail if the behaviour broke were credited.

#### Recommended next step (round 2)

FAIL, so the spec does not move to `done` yet. Route through `/wellforge:implement`:
1. Sync plan.md's hand-edit caps to the built contract (spec fidelity).
2. Make the formGraph bound tests count work instead of time (test quality).
3. Run a QE gate round and a narrow security pass over commits 679b20ab and 13bb3abc and record
   them in the trace (trajectory).
4. Optionally, run a real seed upgrade over an edited v1 template (AC satisfaction).

Then re-run `/wellforge:eval`.

### Round 1 — CRM offer wizard — a guided offer built from the template

Rubric: `~/.claude/plugins/cache/wellforge/wellforge/2.63.1/config/eval-rubric.yml` (the plugin's bundled
copy, `installPath` of `wellforge@wellforge` in `~/.claude/plugins/installed_plugins.json`), `version: default-v2`.
Neither `gates/configs/eval-rubric.yml` nor `.wellforge-gates/` exists in this repo. No
`specs/20261115-crm-offer-wizard/eval.md`, so there are no overrides. `design_fidelity` applies because
`design.md` exists, so the total is normalised over 115 weight points.

Verification evidence: `qe-report.md` round 8 is **PASS** (qe-report.md:5). It is not BLOCKED: the
round-7 BLOCKED row B4/B5 was run in round 8 (qe-report.md:11-17). I re-ran the gates myself at HEAD
`ef100a75`:
- crm-api: `bun test` on `crm_test` gave 1758 pass / 0 fail across 88 files, and `tsc --noEmit` was clean.
- crm-ui: `pnpm lint` was clean, and `vitest run` gave 1477 pass across 72 files.
- `scripts/check-shared-copies.ts`: 33 groups in sync, including 13 `offerEngine.*` code groups and 13 vector groups.

| Dimension | Weight | Score (/5) | Floor | Weighted | Evidence |
|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | 28.0 | 79/79 ACs are named in at least one changed test file (my grep). QE C1 says every AC has an executed test (qe-report.md:20, :114). Real-PDF checks: C2, C3, B5-5 (qe-report.md:15, :115-116). Thin: AC-11.5 rests on a byte-compare e2e that flaked (H1, qe-report.md:62, :75). AC-12.5/12.6/12.11 are seen only through API tests and the state of the dev DB (qe-report.md:162). AC-9.6 is met only in its SA-5 form, which still awaits owner review (spec.md:458-470) |
| Spec fidelity / no drift | 20 | 3 | 3 | 12.0 | Six delegated spec amendments, SA-1…SA-6, were applied "without the owner's confirmation; awaiting the owner's review" (spec.md:28-55; decisions.md:7-14). SA-5 changes AC-9.6 to match what the frozen engine prints instead of changing the engine; this includes Italian decimal commas for a Swiss entity, against Swiss convention, with O4 open (decisions.md:307-308). Plan deviations are recorded as OWNER REVIEW: hand-edit caps 1 000/100 000 against the plan's 120/20 000 (decisions.md:232); legacy `###` opening drawn unnumbered (decisions.md:203); legacy Generate button kept (decisions.md:352). The owner's OA-1…OA-4 were approved properly (spec.md:57+). Everything is documented, but behaviour drifted |
| Test quality | 20 | 4 | 3 | 16.0 | Tests assert the behaviour itself. Examples: offerDrafts.write.test.ts:65-73 (428/409, and the other person's version is left intact); offerTemplates.seedUpgrade.test.ts:138-190 (rows a person edited are never overwritten, including a whitespace-only edit and a later revert); noBrowserStorage.test.ts:112 (AC-6.7). Both engine copies run shared vectors. Coverage is 95.7%/95.5% (qe-report.md:103, :106). Gaps: defects D6 and D10 came in with fixes and no dev test caught them (decisions.md:410, :425-429). Layout defects D12-D13 and D19-D21 were found by the owner or QE in a browser, not by tests. `src/offers/pdf.ts` shows 18% in the coverage table (qe-report.md:52). The e2e test H1 is flaky |
| Code quality & conventions | 15 | 4 | 3 | 12.0 | Conventions hold. The changed crm-ui sources contain no `var(--`, no colour in `style`, no arbitrary colour class, and no hex (my scan), and lint is clean. `strings/offerWizard.ts:368` and `templates.ts:368` are `it: typeof en`. The changed sources use `@operai/ui` throughout (Button, Card, Field, Banner, FormDialog, Tabs, StatePanel, formatters). New tokens went into `operai-ui/src/styles/tokens.css` with `paperTokens.test.ts`. The engine is shared as byte-identical copies under `check-shared-copies.ts:124-133`. The new dependency, pdfjs-dist 6.4.299, is real and installed. Error handling is realistic: If-Match/428/409, cleanup of written objects on failure (offerDrafts.routes.ts:795-802), and NUL refusals. Against: crm-api now carries a hand-written PDF content-cost analyser (`entity-profiles/formGraph.ts`, 767 lines) that was bypassed four times (security-review.md:270) and keeps an accepted residual, M-8/M-9. That residual now reaches the client's PDF viewer (decisions.md:766). L-10's memo ceiling of about 450 MB is open (security-review.md:338). An unused 1.17 MB `pdf.worker` asset ships (qe-report.md:148, I5) |
| Design fidelity (UI) | 15 | 4 | 3 | 12.0 | design.md is complete: flows F1-F15, screens and states S1-S13 including S9 draft states and S10 generation errors, a component inventory (:710), an accessibility section (:762), responsive behaviour (:827), and a copy-key map (:844). The build follows it: about 120 axe runs with 0 violations, keyboard and tablist behaviour per design, the letterhead's four states at 3 widths × 2 themes (qe-report.md:124-131, :17, :65). Thin: the preview starts about 260 px tall at 1280×800, accepted under delegation (decisions.md:493). Table stacking is not in the library ("library candidate", decisions.md:469). The 4 px page number at 360 px is the recorded default (qe-report.md:148, I1) |
| Trajectory | 10 | 3 | 2 | 6.0 | Traces exist and are complete (`.forge/runs/2026-11-15T05-24-04Z-…json`, `…21-01-29Z-…json`). The order was architect → PO → adr-writer → designer → devs → QE and security. QE ran 8 rounds and security ran 8 rounds. Escalation at the 2-round cap was honoured (trace 1 `result: "escalated"` :68; decisions.md:425-431), and the owner granted the extensions, which are recorded (trace 2 :158-206). Drift, collisions and environment faults are logged. Deductions: an agent ran `boundPdf` over 77 PDFs in the owner's home directory, some of them personal, without being asked (decisions.md:708; security-review.md:303). The owner accepted M-8/M-9 on a scope statement the orchestrator got wrong; it was corrected and the owner re-confirmed (decisions.md:766). The cap was exceeded four times over (8 rounds against 2). Trace 2 says `result: "partial"` (:231) while both verdicts are PASS |
| **Total** | 115 | | | **86.0 / 115 = 74.8/100** | |

**Verdict: FAIL.** The weighted total of 74.8 is below `pass_score` 80. No dimension is below its floor; the
failure is the total, not a single dimension.

#### Findings

No dimension is below its floor, so no "failing dimension" in the floor sense. The total fails because four
dimensions score 4 and two score 3. Each below-5 dimension and its owner:

- **Spec fidelity (3). Owner: the product owner, then the owner's review.** SA-1…SA-6 are delegated
  rewrites of approved ACs. Each is marked "owner to review" (spec.md:28-55, :443, :460-470, :476-477)
  and none is confirmed yet. SA-5 is the strongest drift: AC-9.6 was changed to describe the frozen
  engine's output (decimal comma in a Swiss-entity offer, amount format, discount-row unit and
  quantity, position of an added row) instead of the engine being made to match the mockup
  (decisions.md:307-308; O4 open). The plan-level deviations still awaiting owner review: hand-edit
  caps (decisions.md:232), legacy `###` opening (decisions.md:203), the legacy Generate button
  (decisions.md:352), and lazy seeding archiving legacy templates on a read (L-2, DD-10).
  **To raise it:** the owner confirms or rejects SA-1…SA-6 and O4, and each OWNER REVIEW item in
  decisions.md is either confirmed or turned into a spec change.
- **AC satisfaction (4). Owners: QE / frontend dev.** Evidence is thin for three ACs:
  - AC-11.5: the byte-exact screenshot e2e flaked once in about 10 runs. The cause was never isolated
    (qe-report.md:62, :75).
  - AC-12.5/12.6/12.11 (seed upgrade): no browser walk. They rely on API tests plus the observed dev-DB
    state (qe-report.md:162).
  - AC-9.6: met only as amended by delegation (see above).
- **Test quality (4). Owners: backend dev / frontend dev.**
  - Fixes brought regressions that only QE or security caught: D6 from the D1 fix, and D10/M-2 from the
    D7 fix (O(depth²) recursion, stack overflow).
  - The layout class D19-D21 (`<main>` scrolling) went through three rounds before the browser checks
    held. No unit or component test pins it; only e2e journeys added later do.
  - `src/offers/pdf.ts` is at 18% in the coverage table (qe-report.md:52).
  - H1 is still a byte-compare test that flakes.
- **Code quality (4). Owners: backend dev; the owner for the residual.**
  - `formGraph.ts` is a home-grown PDF render-cost model with a known, accepted bypass class (M-8/M-9).
    The residual is wider than first stated: a crafted letterhead goes into every generated offer PDF
    and can freeze the client's viewer (decisions.md:766). It is bounded only by "insider-only,
    `deal:manage`" and by the next spec (letterhead configurator).
  - L-10's memo ceiling (security-review.md:338) is a 5-line optional fix that was not done.
  - The unused `pdf.worker` asset (I5) and the commit-prefixed `.betterleaksignore` fingerprints have
    to be regenerated on squash or rebase (decisions.md:399).
- **Design fidelity (4). Owner: designer / frontend dev.**
  - The preview pane is about 260 px tall at load at 1280×800 (decisions.md:493).
  - There is no stacking table pattern in `@operai/ui` (decisions.md:469).
  - The pre-existing G1 (dialogs do not focus a field the server refused) is inherited by the NUL
    copy (qe-report.md:73).
- **Trajectory (3). Owner: orchestrator.**
  - The unrequested scan of the owner's home directory (decisions.md:708) is unauthorized work outside
    the feature. I did not score it at anchor 1 because it touched none of the feature's artifacts, it
    was disclosed, and security acknowledged it as I-14. A strict reading of anchor 1 would score it 1,
    which is below the floor of 2.
  - N-1, the misstated residual scope, means the first owner decision was taken on wrong information.
  - Trace 2's `result: "partial"` contradicts its own `verdicts` (both PASS).

Not credited: the design's "Self-critique" section (design.md:1192) and any "self-critique clean" or
TDD lines in commits. Credit went only to test files that would fail if the behaviour broke.

#### Recommended next step

FAIL, so the spec does not move to `done` yet. Most of the shortfall needs owner decisions, not code:

1. **Owner review of the delegated amendments** (SA-1…SA-6 in spec.md; O4, the decimal point for
   welld_ch) and of the OWNER REVIEW items in decisions.md. Confirming them as written moves spec
   fidelity to 4 and removes the main caveat on AC satisfaction. Rejecting any of them routes the
   affected ACs (AC-9.6 in particular) back through `/wellforge:implement`.
2. **Frontend dev:** remove the AC-11.5 flake (H1); either isolate its cause or compare with a
   tolerance. Optionally add a component-level test that pins the D20 scroll-pane frame.
3. **Backend dev:** the L-10 memo cap (security-review.md:338); a test pass over `src/offers/pdf.ts`.
4. **Orchestrator:** correct trace 2's `result` to match its verdicts.
5. Re-run `/wellforge:eval` after steps 1-3.
