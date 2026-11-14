---
spec: 20261104
evaluated: 2026-11-08
rubric: default-v2
score: 80.0
verdict: PASS
round: 6
---
# Eval report: Meetings — record, transcribe, summarise and question meetings (re-eval, round 6)

**History.**

| Round | Commit | Result |
|---|---|---|
| 1 | | FAIL 73.0 |
| 2 | | FAIL 76.5 |
| 3 | | PASS 80.0 |
| 4 | b8d8245 | PASS 80.0 |
| 5 | 206bf41 | PASS 80.0 |
| 6 (this one) | `main` @ **c75b9eb** | **PASS 80.0** |

Round 6 is the first round after the squash-merge (`c30a110`). It also covers these later commits: `a1c2b2c`, `25cf4f0`, `c5ac981`, `ce46003`, `2ef01d2` and `c75b9eb`. The PASS has zero margin for the fourth round running.

**Rubric.** I used `/Users/matteocodogno/.claude/plugins/cache/wellforge/wellforge/2.56.0/config/eval-rubric.yml` (`version: default-v2`), the plugin's bundled copy.
- The repo has no `gates/` and no `.wellforge-gates/`.
- There is no `specs/20261104-meetings/eval.md`, so no overrides apply.
- `design.md` exists, so `design_fidelity` applies and the weight pool is 115.

**What I ran myself at c75b9eb**
- **meetings-ui:** `pnpm lint` exits 0, and `vitest run` passes 956/956.
- **operai-ui:** `vitest run` passes 143/143. This includes the new PersonPicker blur test.
- **meetings-api:** `bun test src/ai/stitch src/ai/completeness src/media/probe` passes 135/135, with ffmpeg present.
- **notify-api:** `src/lib/env.emailNotices.test.ts` passes 8/8 under `direnv exec .`. **Without direnv it fails 6/8.** The child process reports `DATABASE_URL: Required`, because the test takes its base environment from the parent shell. So the claim in `c75b9eb` that the test passes "on any machine" holds only when the caller's environment is loaded. See Test quality.
- **T128 on GitHub:**
  - Run **42465786983** (unconfigured) failed with `##[error]live eval not configured … (names only): MEETINGS_EVAL_GCP_WIF_PROVIDER MEETINGS_EVAL_GCP_SERVICE_ACCOUNT MEETINGS_EVAL_GCP_PROJECT_ID MEETINGS_EVAL_VERTEX_LOCATION MEETINGS_EVAL_VERTEX_MODEL_ID`, as T128 requires.
  - Run **42465838067** (configured) is `status: waiting`, held for the human reviewer's approval. **I did not assume its outcome**, so T128 is still open.

**Not reproduced; taken from the brief and the run trace, and weighted accordingly**
- the full meetings-api suite (1778) and notify-api (273);
- crm-ui 742 and shell 354;
- `pnpm e2e meetings-*` 18/18 (the stack was not up);
- the fake-model eval 53/53;
- `infra/check.sh` 60/60;
- the user's end-to-end production test on 2026-11-07.

**Round-5 findings, checked in the tree**

| Round-5 finding | Status | Evidence |
|---|---|---|
| The changeset contradicted A8 | Fixed | `.changeset/meetings-transcript-completeness.md` now says "A part is not retried …" |
| The stale comment in `stitch.ts` | Fixed | `meetings-api/src/ai/stitch.ts:192-194` and `:221-224` now agree with the rule at `:225` |
| Stale entries in design.md | Fixed | `notJoined` is recorded as removed (`design.md:741` (b)); round-3 (a) is "Resolved 2026-11-06" (`design.md:757`) |
| T128 had no governance | Fixed | User decision recorded in `plan.md:2143` and `tasks.md:714`, and in the 2026-11-06 trace's drift event |
| No QE or OWASP pass on the rebased tree | Fixed | The 2026-11-06T16-26-45Z trace shows QE FAIL (D1, dependency alignment) → frontend fix → QE PASS (meetings e2e 17/18, an ffmpeg env fault), and OWASP PASS WITH NOTES, matched `auth/**` |

**The O14/T125 drop (`2ef01d2`).** I treat it as a recorded scope decision by the user, not an unmet AC.
- The decision is recorded in three places: `spec.md:874` ([x], dropped 2026-11-08), `plan.md:2228` and `tasks.md:713`.
- AC-6.11, AC-6.13 and AC-6.14 stay backed by T113–T116 and T124 (`stitch.recorded.test.ts` and `completeness.test.ts` pass).

| Dimension | Weight | Score (/5) | Floor | Weighted | Evidence |
|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | 28.0 | **Every AC has test evidence; nothing is unmet.** <br>• AC-6.11 to AC-6.17: `stitch.test.ts`, `stitch.recorded.test.ts`, `completeness.test.ts` (135/135, run by me). <br>• AC-6.1 and AC-6.12: `TranscriptView.test.tsx`, including the new "shows a speaker once per run … still names every line" case and the axe run (956/956, run by me). <br>• AC-7.12 and AC-9.7: the unconfigured-dispatch half is proven by run 42465786983. <br>• The e2e result (18/18) and the production test are reported, not reproduced. <br>**Why not 5:** <br>• AC-2.2, AC-2.4 and AC-2.5 (browser microphone and tab audio) are tested only with stubs and fake media. The user's production test is behavioural evidence, but I could not observe it. <br>• With O14 dropped, the A7/A8 bounds rest on synthetic-audio spike data only, by the user's choice. <br>• The configured live-eval run (42465838067) is pending approval. AC-7.12 and AC-9.7 live evidence is still T121's pre-merge runs. <br>• The AC-9.x availability bar was relaxed by QH-2. |
| Spec fidelity / no drift | 20 | 4 | 3 | 16.0 | Behaviour matches the spec and A8: `MAX_TRIES = 1`, `MATCH_WORDS 20`, overlap 60–120 s. All round-5 drift items are closed. <br>**New drift, all documentary: the O14 drop was not propagated.** <br>• `plan.md:2863` still lists `- [ ] T125 … Go-live gate`. <br>• The AC→task map still names T125 (`plan.md:2896,2898,2899`). <br>• Risks R20, R23, R24 and R25 still say "O14 measures … before go-live" (`plan.md:2679-2682`). <br>• `plan.md:2230` still reads "provisionally until O14 … retry 2 (3 tries per part)", directly under the note that drops O14 and contradicting A8's tries = 1. <br>• Two ADRs still state a go-live gate that no longer exists: ADR 20261105-meetings-transcript-completeness-detect-retry-mark (`:4`, `:103`, `:142`: "Bounds are provisional until O14 (go-live gate)") and ADR 20261105-meetings-transcript-parts-speaker-labels-per-part (`:62`). <br>**Still open from earlier rounds:** <br>• The AC-6.13 overlap exception is vacuous in the spec. <br>• The Separate-by-part confirmation is an addition (documented, `design.md:741` (c)). |
| Test quality | 20 | 4 | 3 | 16.0 | **Strengths:** <br>• The tests are adversarial: exact bounds, recorded provider replays, a static check that no audio or voice feature is imported, and the authorization matrices. <br>• `25cf4f0` added a real a11y assertion: the visually hidden speaker is present on every line (`TranscriptView.test.tsx:60-76`). <br>• `a1c2b2c` added a blur → closed → focus → open test (`PersonPicker.test.tsx:131-138`). <br>• The `probe.test.ts` ogg fixture no longer needs libvorbis. <br>**Not 5:** <br>• **The notify-api env test is not hermetic.** It inherits `DATABASE_URL` and the other base variables from the parent process. I got 6/8 fail without direnv and 8/8 with it. `--no-env-file` fixed only the opposite leak. <br>• The trace records **unresolved flakes**: job-runner and shell router tests fail "under parallel load". <br>• CI still runs no `bun test` or `pnpm test` for any meetings package. Only `bun test evals` and the shared-copies script run (`.github/workflows/*`), so the real-ffmpeg suites run only on a developer machine. <br>• No e2e covers the A7/A8 UI. |
| Code quality & conventions | 15 | 4 | 3 | 12.0 | **Clean, conventional changes:** <br>• The `Combobox` listbox has `onMouseDown={keepInputFocus}` (`operai-ui/src/components/Combobox.tsx:157,197`), so the new `onBlur` close does not swallow a mouse selection. <br>• `25cf4f0` passes `pnpm lint`, which enforces the design-token rules. <br>• `ce46003` correctly moves `working-directory` to the steps that run after checkout. <br>• `c5ac981` adds health, 401 and CSP pin checks in the established `infra/check.sh` pattern. <br>**Not 5:** <br>• Code comments still point at the removed task: `completeness.ts:16` ("Residual, measured by T125") and `split.ts:17` ("T125 (O14) confirms them"). <br>• `infra/check.sh` has no meetings-bucket `connect-src` check. It relies on the shared `t3.storageapi.dev` default, the same pattern as inventory. <br>• Not re-verified this round, and earlier rounds left them open: the separate route answers 500, not 404, on a hard-delete race; the quadratic worst case is bounded by caps; L4 transient-key leftovers. |
| Design fidelity (UI) | 15 | 4 | 3 | 12.0 | design.md is complete (flows F1–F12, every loading, empty and error state, an a11y section, reuse mapped, no new library component). The round-5 staleness is fixed (`:741`, `:757`). The build realises the design, and the a11y requirement survived the restyle. <br>**Not 5:** <br>• `25cf4f0` changed the Summaries, Transcript and Ask tabs: cards, a speaker shown once per run, a fixed time column, questions on the right and answers on the left. design.md was not re-synced (it was last touched in `c30a110`), so the design no longer describes the shipped layout. <br>• The confirmation step (c) is still "kept, flagged". |
| Trajectory | 10 | 4 | 2 | 8.0 | Five `wellforge-run/v3` traces show the right order: <br>• PO, architect and dev lanes, then QE FAIL→PASS rounds with OWASP; <br>• post-rebase QE plus OWASP (2026-11-06T16-26-45Z, closed, `completed`); <br>• the T92 re-run (2026-11-08T09-29-07Z, closed, `completed`) with its drift event (O14) and its env faults. <br>The git commits are Conventional and task-tagged. <br>**Not 5:** <br>• **The 2026-11-08 `verdicts.qe = "PASS"` is the main loop's own claim.** The QE agent returned a strict FAIL. The main loop fixed the two deterministic reds and judged the rest flaky, and QE was not re-run. Under the evaluator rules, an author's own verdict is not evidence. I re-verified part of it myself (see above). <br>• OWASP was not dispatched for the 2026-11-08 delta. The trace's justification is reasonable (UI, a blur handler, CI and test fixtures), but the 2026-11-06 trace records `verdicts.security: "PASS"` where the agent row says "PASS WITH NOTES". <br>• The 2026-11-05 trace is still `result: partial`. <br>• The commit hashes cited in the traces and design.md are not ancestors of `main`: for example `575e5bd`, `a2a3656` and `706b1c7`. `git merge-base --is-ancestor` fails for each, because the squash-merge left them dangling. |
| **Total** | 115 | | | **92.0 / 115 = 80.0 / 100** | |

**Verdict: PASS.** The total of 80.0 meets `pass_score` 80, with zero margin. No dimension is below its floor; `ac_satisfaction` is exactly at its floor of 4. A one-point drop in any dimension would make this a FAIL.

## Findings

- **No finding is unmet-AC grade.** The O14/T125 drop is a recorded user decision. AC-6.11, AC-6.13 and AC-6.14 keep their T113–T116/T124 test evidence, which I re-ran green.
- **Spec fidelity: finish propagating the O14 drop.** Each item below still treats O14 as a live go-live gate. A reader of the ADRs would believe a gate still blocks go-live.
  - `plan.md:2863`: the unchecked T125. Strike it or mark it removed.
  - `plan.md:2896-2899`: T125 in the AC map.
  - `plan.md:2230`: "provisionally until O14 … retry 2 (3 tries per part)". Make it final and use tries = 1.
  - `plan.md:2679-2682`: R20 and R23–R25.
  - ADR 20261105-meetings-transcript-completeness-detect-retry-mark `:4`, `:103`, `:142`, and ADR 20261105-meetings-transcript-parts-speaker-labels-per-part `:62`: add an amendment note.
  - The code comments `completeness.ts:16` and `split.ts:17`.
- **Test quality: make `env.emailNotices.test.ts` hermetic.** Give the child process an explicit base environment, for example a fixed test `DATABASE_URL` and the other required variables, instead of `{ ...process.env }`. Then the test passes without direnv, as `c75b9eb` claims. Also track the job-runner and shell router flakes as defects rather than treating them as environment noise.
- **Design fidelity: re-sync design.md S3b.** Describe the `25cf4f0` tab layout: cards, a speaker once per run with a visually hidden name on every line, the time column, and the Ask bubble alignment.
- **Trajectory: record verdicts honestly.** When QE returns FAIL and the main loop fixes the reds, either re-dispatch QE or record `verdicts.qe` as "FAIL → fixed, not re-verified". Record security as "PASS WITH NOTES". Close or mark the 2026-11-05 trace.
- **T128 is not done.** Run 42465838067 is waiting for reviewer approval, so T128 stays `[ ]` until it passes. T92 does not depend on it, by the user's decision of 2026-11-06.

## Recommended next step

- **PASS.** The eval gate does not block. T92's command list is reported green.
  - QE ran and its reds were resolved, though QE was not re-run (see Trajectory).
  - OWASP for the merged tree is in the 2026-11-06 trace.
- The spec may move to `done` via `/wellforge:done 021`. Merging and production use were already the user's call.
- Before closing, route the cheap items through `/wellforge:implement` to buy margin above a zero-margin PASS:
  - the O14 propagation in plan.md, ADR 20261105-meetings-transcript-parts-speaker-labels-per-part/0074 and the two code comments;
  - the hermetic notify-api env test;
  - the design.md S3b re-sync.
- **T128 stays open** until run 42465838067 is approved and passes. If it fails, the live-eval release gate (AC-7.12, AC-9.7) reopens.
