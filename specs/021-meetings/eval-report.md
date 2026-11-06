---
spec: 021
evaluated: 2026-11-06
rubric: default-v2
score: 80.0
verdict: PASS
round: 5
---
# Eval report: Meetings — record, transcribe, summarise and question meetings (re-eval, round 5)

**History.** Round 1: FAIL 73.0. Round 2: FAIL 76.5. Round 3: PASS 80.0. Round 4: PASS 80.0 at b8d8245.
Round 5 (this one) is at **206bf41**, after the rebase onto main, the fixes from round 4, the renumbering of
ADR 0073 to 0074, the crm-api middleware consolidation and the T104/T128 split. Result: **PASS 80.0**, with
zero margin for the third round running.

**Rubric.** I used `/Users/matteocodogno/.claude/plugins/cache/wellforge/wellforge/2.56.0/config/eval-rubric.yml`
(`version: default-v2`), the plugin's bundled copy. The repo has no `gates/` and no `.wellforge-gates/`, and there
is no `specs/021-meetings/eval.md`, so no overrides apply. `design.md` exists, so `design_fidelity` applies and the
weight pool is 115.

**What I ran myself on `feat/021-meetings` @ 206bf41.** PR #8's head is the same commit.
- **meetings-api**, full suite with the database (`direnv exec . bun test`): **1749 pass, 30 skip, 0 fail**. This
  matches the evidence file. The 30 skips are the `skipIf(!hasFfmpeg/ffprobe)` real-media suites
  (`split.real`, `normalize.real`, `prepare.real`, `probe`). Round 4 could not run this suite at all; it is now
  reproduced.
- **crm-api**: 351/351. **auth**: 763/763. **meetings-ui**: 955/955, and `pnpm lint` exits 0.
- **notify-api**: 268 pass, 5 fail. All 5 failures are in `src/lib/env.emailNotices.test.ts`, which this branch
  does not touch (`git diff main...HEAD -- notify-api` lists 13 files and that file is not one of them).
  **estimai-api**: the branch does not touch it (`git diff --quiet main...HEAD -- estimai-api`). So the known
  local failures are not caused by this branch.
- **PR #8 checks** (`gh pr view 8`): all SUCCESS on head 206bf41.
- **Not reproduced:**
  - `pnpm e2e meetings-*`: the stack was down. **No meetings e2e has run on the rebased tree**; that is a T92 item.
  - the real-ffmpeg suites;
  - the live evals.

**Rebase checks** (verified in the tree, not taken from the brief):
- **auth**: `KNOWN_SERVICE_SCOPES` holds both `estimate-notices.send` and `host-notices.send`
  (`auth/src/system/serviceClients.ts:44-50`).
- **notify-api**: the origin map keeps `system:meetings-api → meetings` and main's `system:auth → admin`
  (`notify-api/src/system/systemAuth.middleware.ts:53-55`).
- **crm-ui**: `DealDetailPage` keeps main's `EstimateCard` and adds only `MeetingsSection`.
- **crm-api**: `src/system/serviceAuth.ts` was deleted. `POST /system/estimate-notices` now uses
  `createSystemAuthMiddleware` (`estimateNotices.routes.ts:40`). The surviving middleware is at least as strict:
  - it adds a `system:` prefix check (`systemAuth.middleware.ts:96-103`);
  - it keeps RS256, the pinned issuer, `aud = SERVICE_AUDIENCE`, the required claims and one identical 401;
  - the deny cases (wrong sub, wrong scope, user JWT, other audience) are still tested
    (`src/estimates/estimate.test.ts:133-148`).
- **ADR renumbering**: no stale meetings reference to 0071 or 0073 remains in code, the specs, the ADRs or
  AGENTS.md. The crm-api `ADR-0073` references correctly point at main's estimate-close ADR.

| Dimension | Weight | Score (/5) | Floor | Weighted | Evidence |
|---|---|---|---|---|---|
| AC satisfaction | 35 | 4 | 4 | 28.0 | **Unchanged in substance since round 4.** Since then only comments, one unused import and dead copy were removed from meetings code (`1e0965b`, `7845db4`), and the full DB suite is now reproduced green. Per-AC evidence still holds: <br>• AC-6.11: `googleSpeech.ts:107` `MAX_TRIES = 1`. <br>• AC-6.12, AC-6.13: `completeness.test.ts`. <br>• AC-6.14, AC-6.15, AC-6.17: `stitch.test.ts`, `stitch.recorded.test.ts`. <br>• AC-6.16: `transcript/separate.test.ts`. <br>• AC-14.9 and reordering: `crm-api/src/meeting-host/notices.test.ts:144-252`. <br>• AC-12.4: `meetings-api/src/lib/notify.ts:9,70` has no `email` field. <br>**Why not 5:** <br>• AC-2.2, AC-2.4, AC-2.5: browser microphone and tab audio are verified only with stubs and fake media. <br>• The A7/A8 rules have been observed only on recordings of **synthetic** audio (O14/T125 is open). <br>• The AC-9.x availability bar was relaxed by QH-2. <br>• The meetings e2e evidence predates the rebase. |
| Spec fidelity / no drift | 20 | 4 | 3 | 16.0 | **Round-4 items closed:** <br>• The A8 overlap clarification is marked "confirmed by the user 2026-11-05" (`spec.md:114`, `74d2527`). <br>• The `failure.code`-on-draft contract is now in plan.md (Addendum 2026-11-05, `fcaf85a`). <br>The implementation matches the bounds: `MATCH_WORDS 20`, tries 1, overlap 60–120 s. <br>**Not 5. Remaining or new drift, all minor:** <br>• **The changeset contradicts A8.** `.changeset/meetings-transcript-completeness.md:6` says "a failed part is retried on its own before the whole transcript is marked possibly incomplete". Since A8, tries = 1 (`googleSpeech.ts:107`). This text becomes the CHANGELOG. <br>• **T104 was re-scoped in tasks.md only.** `206bf41` drops "a dispatched run without the vars fails" from T104's done-when and creates T128 outside T92's dependencies. plan.md still carries the original done-when (`plan.md:2142`), has no T128, and records no user decision. Contrast T125's "user decision 2026-11-05" (`tasks.md:712`). The GitHub constraint behind the split is real (`workflow_dispatch` needs the file on the default branch), and T121's live runs already evidence AC-7.12/9.7, so this is honest but ungoverned. <br>• The AC-6.13 overlap exception ("each label is joined to a different label") is still vacuous in the spec. The code now calls it "a defensive safeguard that no current input reaches" (`stitch.ts:11-16`), but the spec does not say so. <br>• The Separate-by-part confirmation is still an addition AC-6.16 does not ask for. It is documented (`design.md:741` (c)). <br>• The plan addendum records no approval and states it "takes precedence" over earlier plan sections. It documents code QE had already passed. |
| Test quality | 20 | 4 | 3 | 16.0 | The tests are adversarial, and the DB suite is now reproduced: 1749 pass, 0 fail. They replay recorded provider seams, test the exact bounds (19.9 vs 20 s, 7 vs 8 words), statically check that no audio or voice feature is imported, and cover the authorization matrix (`matrix.test.ts`, crm-api `matrix.test.ts:59`). The crm-api refactor is pinned by the existing negative cases (`estimate.test.ts:133-148`). <br>**Not 5:** <br>• No e2e covers the A7/A8 UI: the only `shell/e2e` change since round 3 is `7a3a864`, the consent version. <br>• The 30 real-ffmpeg tests run in no CI job, and PR #8 runs no `bun test` or `pnpm test` for any meetings package (the workflows are changeset, env-doctor, eval-fake, react-skew and shared-copies). <br>• No meetings e2e has run on the rebased tree. <br>• `googleSpeech.test.ts` needed three load-flake fixes (`d9b72c8`, `14938fb`, plus round 4's). |
| Code quality & conventions | 15 | 4 | 3 | 12.0 | **Round-4 nits fixed:** <br>• the `stitch.ts` header now states the A8 overlap rule, and the unused `sameSpeaker` import is gone (`1e0965b`); <br>• the dead `notJoined` copy was removed (`7845db4`); <br>• two crm-api service-JWT middlewares were merged into one, the test hook was consolidated, and no behaviour was weakened (`b06a56f`). <br>**Not 5:** <br>• **The same stale-comment hazard survives inside the body.** `stitch.ts:193-195` still says aligned words "are the same speech only where the overlap joined their labels (or a word has no label at all)". That contradicts the rule implemented 35 lines below (`stitch.ts:227-230`: same unless joined to a *different* root). Only the header was fixed. <br>• Open since round 4 and not re-scored: the separate route answers 500, not 404, on a hard-delete race; the quadratic worst case on adversarial provider output (bounded by caps); the L4 cross-job transient-key leftovers. |
| Design fidelity (UI) | 15 | 4 | 3 | 12.0 | design.md covers F8/F9/F12, the S3b notice, markers, the joined indication, the Separate dialog, caveat labels, a11y and the copy plan, and the build realises them (`Banner live`, `TranscriptView`, `SeparateSpeakerDialog`). No new library component. <br>**Not 5. design.md has gone stale against the fixes it prompted:** <br>• The copy plan still lists `separate {…, notJoined}` (`design.md:671`), and divergence (b) still describes it as live dead copy (`design.md:741`), but `7845db4` deleted it. <br>• Round-3 divergence (a), the draft `failure.code` with no plan contract (`design.md:736`), is now closed by the plan addendum, but design.md does not say so. <br>• The confirmation step (c) is still "kept, flagged". |
| Trajectory | 10 | 4 | 2 | 8.0 | There are two `wellforge-run/v3` traces with 83 agent rows. They show the right order: <br>1. the PO, architect and dev lanes; <br>2. QE FAIL then PASS rounds, with QE-produced red tests; <br>3. OWASP at every round (`always_at_tier:production`); <br>4. drift events recorded and resolved. <br>The post-round-4 work can be followed in git (Conventional, task-tagged commits). <br>**Not 5, and the gaps grew:** <br>• The trace has **no entry for anything after round 4**: the A8 user confirmation, the plan addendum, the rebase and its conflict resolutions in auth, crm-api, notify-api and env-doctor, the 0073→0074 renumbering (the trace's last drift event still says "renumbered 0073"), the crm-api authentication refactor, and the T104/T128 split. <br>• `finished` is null and `result` is "partial". <br>• **Every commit hash in the trace, and the ones cited in plan.md (2), tasks.md (1) and design.md (2), is pre-rebase and is not an ancestor of HEAD.** For example `6d87fa7`, `575e5bd`, `76d6c29` and `ac3b3b5`: `git merge-base --is-ancestor` fails for each. Those references will dangle after merge and gc. <br>• **No QE or OWASP pass ran on the rebased tree**, although the conflict resolutions touched authentication paths. This is not a skipped step yet, because T92 requires both, but it is unevidenced today. |
| **Total** | 115 | | | **92.0 / 115 = 80.0 / 100** | |

**Verdict: PASS.** The total of 80.0 meets `pass_score` 80, with zero margin. No dimension is below its floor;
`ac_satisfaction` is exactly at its floor of 4. Any single one-point drop in any dimension would turn this into a
FAIL.

## Findings

- **No finding is unmet-AC grade.** The rebase did not break anything I could test: meetings-api, crm-api, auth
  and meetings-ui are green, and the conflict resolutions keep both sides.
- **The changeset claims behaviour A8 removed.** Rewrite `.changeset/meetings-transcript-completeness.md` so it no
  longer says a failed part is retried. It should say: a part is transcribed once, and a gap is marked. Otherwise
  the release notes contradict spec A8, ADR-0074 and `MAX_TRIES = 1`. This is cheap; fix it before T92 runs
  `release:version`.
- **The T128 governance gap.** Either record the user's decision that T128 is post-merge and not a T92 dependency,
  as was done for T125, or put T128 in plan.md and update T104's plan entry (`plan.md:2142`). The split itself is
  sound: the dispatch needs the file on `main`, and AC-7.12/9.7 already have T121's two live PASS runs. Today it is
  a tasks-only edit by the orchestrator.
- **The stale comment at `stitch.ts:193-195`.** It is the same looks-right hazard round 4 flagged, only half fixed.
  Align it with `stitch.ts:227-230`.
- **design.md is stale.** Remove `notJoined` from the copy plan (`:671`), mark divergence (b) as resolved
  (`:741`), and mark round-3 (a) as closed by the plan addendum (`:736`).
- **Dangling commit references.** The run trace, plan.md, tasks.md and design.md cite pre-rebase hashes. Either
  re-point them to their rebased equivalents (for example, 6d87fa7 → 942a27e/797889b) or note in the trace that
  the hashes are pre-rebase.
- **T92 must run on the rebased tree, not inherit earlier verdicts.** That means:
  - the full `pnpm e2e meetings-*`, never yet run after the rebase, which also pulled in spec 023's sign-up gate
    and the test-auth change;
  - a QE verdict;
  - an OWASP pass that covers `b06a56f` and the auth, crm-api and notify-api conflict resolutions;
  - and then closing the 2026-11-05 run trace (`finished`, `result`, and `verdicts.security` = "PASS WITH NOTES",
    not "PASS").
- **Open by design, honestly recorded:**
  - T125 (O14) is a go-live gate by user decision (`tasks.md:712`; spec O14). "Done" therefore means not
    releasable until T125 measures the bounds on consented real recordings. A changed bound reopens AC-6.11 to
    AC-6.14.
  - T128 is post-merge (see above).
  - T92 is the closing task.

  None of these hides an unmet AC.

## Should anything block the close?

- **Nothing blocks the eval gate.** It passes at 80.0.
- **Do not move the spec to `done`** until T92 has run every listed gate **on the rebased tree**, in particular the
  meetings e2e, QE and OWASP.
- **Fix the A8-contradicting changeset first**, because T92/T110 turns it into published CHANGELOG text.
- The remaining items cost little and would buy margin above a zero-margin PASS: the T128 decision record, the
  `stitch.ts:193-195` comment, the design.md staleness and the trace hygiene.

## Recommended next step

- PASS. Route the small fixes through `/wellforge:implement`:
  - the changeset wording (T127 lane);
  - the `stitch.ts` comment (T115);
  - the design.md copy plan and divergence notes (designer);
  - the plan and trace record for T128 (orchestrator).
- Then run T92 in full on HEAD. T125 and T128 stay as the go-live and post-merge checks.
