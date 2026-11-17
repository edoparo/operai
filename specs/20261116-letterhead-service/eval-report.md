---
spec: 20261116
evaluated: 2026-11-17
rubric: default-v2
score: 64.3
verdict: FAIL
---
# Eval report: Letterhead service — one engine that lays out a whole document, for every tool

**HEAD evaluated:** `8b9b2d58` on `feat/letterhead-service`. The diff is `932de77a...HEAD`: 119 commits and 425 files.
The last code commit is `929d97d6` (T52). Since `af331fbb`, where QE round 2 ran, only `qe-report.md` has changed.

**Rubric used.** This repo has no `gates/configs/eval-rubric.yml`, no `.wellforge-gates/` and no
`specs/20261116-letterhead-service/eval.md`. Earlier evals cited a plugin copy at
`~/.claude/plugins/cache/wellforge/wellforge/2.63.1/config/eval-rubric.yml`, but that file is not on this machine any more. The
synced plugin under `~/.claude/plugins/synced/…/wellforge/config/` has no rubric file. I therefore used **default-v2** as
every earlier eval report in `specs/*/eval-report.md` applies it (e.g. `specs/20261115-crm-offer-wizard/eval-report.md`):

| Dimension | Weight | Floor |
|---|---|---|
| AC satisfaction | 35 | 4 |
| Spec fidelity | 20 | 3 |
| Test quality | 20 | 3 |
| Code quality | 15 | 3 |
| Design fidelity (UI) | 15 | 3, applies when `design.md` exists |
| Trajectory | 10 | 2 |

`pass_score` is 80. `design.md` exists, so design fidelity applies and the total is normalised over 115.

**Verification evidence.**
- **QE round 2 PASS** at `af331fbb` (qe-report.md:302-319), which is after the last code commit. Round 1 was FAIL on D1.
- **OWASP:** the first review was REVIEW REQUIRED with 2 medium; the delta review was PASS WITH NOTES (security-review.md:148-152).
  Both reviews were static only. Nothing was built or run (security-review.md:5, :150).
- **What I re-ran at HEAD:**
  - operai-ui `vitest`: 245/245
  - letterheads-ui: 517/517
  - crm-ui: 1612/1612

  These match QE round 2 (qe-report.md:427-429).
- **What I could not re-run:** this machine has no Rust toolchain (`mise`: rust 1.100.0 missing) and no `bun`, so I did not run
  the Rust or crm-api suites. For those I rely on QE's recorded runs: 611 Rust tests, conformance max 0.3396 %, crm-api 2109,
  contract 6/510, e2e 19 + 8.
- **CI has never run on this code.** The branch is 117 commits ahead of `origin/feat/letterhead-service`. The origin is at
  `fc98fa68`, before the workflow existed. So `.github/workflows/letterhead-api.yml` has never executed.

| Dimension | Weight | Score (/5) | Floor | Weighted | Evidence |
|---|---|---|---|---|---|
| AC satisfaction | 35 | **3** | 4 | 21.0 | 79/79 ACs have an executed check, and none fails on its letter per QE (qe-report.md:30-31, §7). **But AC-10.14 is only partly met, and the spec has not been amended.** The AC says Try the wizard previews "the template being edited, unsaved … no deal is needed" from the service (spec.md:465-470). The code asks the service only when `template !== null && canManageDealsOf(entity)` (`crm-ui/src/components/templateEditor/TryWizardView.tsx:144`). In the other two reachable cases (a never-saved template, and a viewer without `deal:manage`, who can open the editor read-only: `WizardTemplateEditor.tsx:101,291`), it shows the browser-drawn preview with **no letterhead at all** (`TryWizardView.tsx:170,193`), and tests pin that (`TryWizardView.service.test.tsx:306,317`). design.md:977-981 says it "**Deviates from AC-10.14** … the spec owner must accept it or change it". spec.md has no amendment for it, and QE marked AC-10.14 PASS without noting it (qe-report.md:288). AC-1.3 is met only in its A6 form, which the owner has not approved (spec.md:599-606), though the runner applies A6 rigorously (`engine/tests/corpus/conformance.rs:305-342, 573-588, 640-645`). Owner-pending, not counted as unmet but keeping the score below 5: AC-1.9 and AC-1.10 (T40), the deployed parts of AC-3.8, AC-8.4 and AC-10.4, and AC-10.1's sign-off (T35) |
| Spec fidelity / no drift | 20 | 3 | 3 | 12.0 | Most unattended changes are flagged: A6 "Not owner-approved" (spec.md:599-606); the design amendments (design.md:967); the four ADR amendments, "owner to confirm" (commit c23c0399); and the orchestrator decisions on T46 (2 GiB cap, 5 GB container, a cost) and T51 (cap 2) (tasks.md:277, :303). None is confirmed. Drift that is unflagged or unrecorded: (a) the AC-10.14 deviation lives only in design.md, not as a spec amendment; (b) the plan amendment "implementation findings, batch 2" (plan.md:536-653, commit bd2f00f4, 00:32 on the unattended night) is **not** marked owner-to-confirm, yet it says "where they disagree, this section wins" and re-reads AC-3.3 counting, restore validation and style semantics; (c) plan.md was not synced to the built contract: 503 `render_unavailable` (`api/src/routes/render.rs:428-430`; T12's note admits "the plan's error table has no entry"), and crm-api's 429 `preview_busy`, 409 `letterhead_overflow`, 422 `section_too_long`, 409 `entity_profile_missing` and 409 `template_format_mismatch` appear in neither plan.md nor design.md (grep count 0); (d) plan.md:50 still says a 1 GiB cap, while the code and ADR say 2 GiB (owner to confirm) |
| Test quality | 20 | 4 | 3 | 16.0 | The tests check behaviour, and several have built-in controls. Conformance includes a 1 pt positive control (smallest 0.5721 % against a 0.5 % limit, qe-report.md:143-146) and fails if the corpus shrinks (`conformance.rs:722-726`). The residue test plants a marker and checks it is found (`api/tests/residue.rs:250-280`). The AC-10.6 matrix checks 11 failure modes: no row, sequence unchanged, no object, draft unchanged, nothing put then deleted, and a retry takes the unburnt number (`crm-api/src/offers/generation.letterhead.test.ts:336-399`). The golden record holds line baselines, and there are layout-pinning and injection fuzz tests. The advisory step was shown to fail without its ignores (qe-report.md:387-391). Against: (1) **no mutation evidence**. T9's done-when "a deliberate 1 pt template change makes it fail (shown once)" has no record in any commit or file (tasks.md:143; commit 632d14e3 cites only the in-test control), and no cargo-mutants or Stryker run. (2) The gates that matter most (conformance, DB, pg_dump residue, worst-case) skip unless `*_REQUIRE_*` is set. Only CI sets it, and CI has never run. (3) The hook tests missed D1, the untested 429 path, until QE found it in a browser (qe-report.md:62-92). D2 was a racy test. (4) The security reviews ran no tests |
| Code quality & conventions | 15 | 4 | 3 | 12.0 | Clean and idiomatic. The workspace has `unsafe_code = "forbid"` (`letterhead-api/Cargo.toml:20`). `clippy -D warnings` and `fmt` are clean (qe-report.md:33-34). I found no `unwrap`/`expect` outside test modules in `render.rs`, `auth/service.rs` and `authz/resolve.rs`. Errors are RFC 7807 with fixed codes and no echo. Workers run with a cleared environment and are killable. The T48 fixes are sound (F2 fit check moved into the pool, F3, F4, CORS credentials; security-review.md:157-159, :172-174). Bilingual copy has parity. 9/9 packages have changesets. Against, all recorded but open: F5 (worker same uid, no confinement), F6 (service routes on the public domain), F7 (orphaned upload on insert failure), F9 (tag-pinned images and actions), F11, N1 (the reserved slot does not cover the queue share), N3. crm-api holds an aborted preview's slot until the service answers, and the cap is per process (qe-report.md:363-367). The sqlite advisory guard fails open (qe-report.md:394-396). F13: actor e-mail is stored permanently in an immutable row |
| Design fidelity (UI) | 15 | 3 | 3 | 9.0 | design.md is complete for what it designed: flows F1-F15, states S1-S10, an a11y plan and a reuse inventory. The build realises it: all 13 NEW inventory components exist, axe is clean, and the e2e walks every designed state (qe-report.md:158-169, :457-461). Not realised or not designed: (a) F13 says "one automatic retry … for `busy`" (design.md:241), but the 429 path retries three times (`useServicePreview.ts:80,85`), and the code and tasks.md:303 cite "design F13" for it, which F13 does not say. No design amendment covers it (the last design commit, 4e4bebae, predates T49-T51). (b) Four new CRM states have no design entry: `letterhead_overflow` notice, `section_too_long` notice, `entity_profile_missing`, `template_format_mismatch`. They are built with en/it copy (`strings/offerWizard.ts:366-387`), but ad hoc. (c) F15's two-case approximate preview is designed against an AC and is not confirmed (above) |
| Trajectory | 10 | 2 | 2 | 4.0 | **No `wellforge-run/v1` trace** for this feature exists in `.forge/runs/`, in either worktree. The last trace is `2026-11-15T21-01-29Z-orchestrate-20261115-crm-offer-wizard.json`. Per the rubric this gets the neutral floor. Git and tasks.md show good habits: re-sync notes ("From Tn", "Orchestrator decision"), defects routed to new tasks (T37-T52), and QE round 1 FAIL → fix → round 2 PASS. Touch-list discipline is good: my audit of every task commit against its `touch:` globs found only mechanical spill (Cargo.lock/Cargo.toml/lib.rs wiring, two shell tests, `letterheads-ui/src/strings.test.ts`). Git also shows deductions that would block a score above 2: T9 was ticked (1976f05c) without its done-when ("workflow green on the branch", 1 pt mutation shown). T34 was ticked on a local proxy after its done-when was rewritten by an orchestrator note that is **not** marked owner-to-confirm (tasks.md:495-496). The deployed AC-8.4/10.4 measurement it "moved to T40" is absent from T40's done-when (tasks.md:248), so the owner step can close without it. The final OWASP delta review ran before T50-T52 and no OWASP re-run followed them (QE judged none needed) |
| **Total** | 115 | | | **74.0 / 115 = 64.3/100** | |

**Verdict: FAIL.** The total of 64.3 is below `pass_score` 80, and **AC satisfaction (3) is below its floor of 4**.
AC-10.14 is knowingly unmet in two reachable cases, with no spec amendment. Either one alone fails the eval. Even with AC
satisfaction at 4, the total would be 70.4, still below 80.

## Owner-step ACs: how this eval treats them

These ACs depend on owner steps that no agent can do:
- **T40 (deploy):** AC-1.9, AC-1.10, and the deployed parts of AC-3.8, AC-8.4 and AC-10.4.
- **T35 (sign-off):** the real-offer sign-off of AC-10.1.

I counted them as **unverified, not unmet**. Each has local proxy evidence:
- preview p95 165 ms against 1 s, and PDF p95 89 ms against 3 s (qe-report.md:54);
- worst p95 of either preview 1.33 s against 2 s (spike.md:140);
- the Railway declaration in `europe-west4` with the bucket in `ams` (`.railway/railway.ts`);
- three sign-off PDFs prepared with hashes (signoff/README.md).

So they cap AC satisfaction at 4. They do not pull it lower.

Consequences:
1. Even a PASS on re-eval does not let the spec reach `done` until T40 and T35 are recorded. T36 depends on both.
2. If the deployed p95 misses a target, that AC is unmet and the eval FAILs.
3. **T40's done-when must be widened** to cover the deployed AC-8.4/10.4 p95 (`letterhead-api/perf/preview-edits.ts`) and the
   region check. Today it names only AC-1.9 and AC-1.10.
4. The sign-off lists open owner decisions. The most important is that the brand's 25.4 mm bottom margin is refused by
   AC-5.2's 40-character rule. Any of them may become a spec change.

## Findings and who owns them

- **AC satisfaction: 3, below floor.**
  - **Owner:** PO (owner decision), then dev and architect if the AC stands.
  - **Gap:** AC-10.14 is not met for a never-saved template or for a viewer without `deal:manage`. After the switch those cases
    show a preview with no letterhead. QE missed it.
  - **To reach 4 (floor), either:**
    - the owner accepts the deviation and the PO records it as spec amendment A7, with design.md:977-981's option chosen
      ("keep approximate", or "disable Try until saved"); or
    - the architect adds a try-preview path without a saved id, plus a read permission the viewer holds, and dev builds it.
  - **Also:** the owner confirms A6.
- **Spec fidelity: 3, at floor.**
  - **Owner:** PO (owner confirmations) and architect (plan sync).
  - **What to do:**
    - Mark plan amendment batch 2 as owner-to-confirm, or get it confirmed.
    - Add 503 `render_unavailable` and the five new crm-api codes to plan.md § API contracts.
    - Sync plan.md:50 to the RSS cap that gets confirmed.
    - Get A6, the design amendments, the four ADR amendments and the T46/T51 decisions confirmed.
- **Design fidelity: 3, at floor.**
  - **Owner:** designer.
  - **What to do:**
    - Amend F13 for the 429 `preview_busy` budget, or have dev change the code to one retry.
    - Design the `letterhead_overflow`, `section_too_long`, `entity_profile_missing` and `template_format_mismatch` states,
      and fix the false "design F13" citation in `useServicePreview.ts` and tasks.md:303.
- **Test quality: 4.**
  - **Owner:** dev and devops.
  - **What to do:**
    - Push the branch and get `letterhead-api.yml` green, with every `*_REQUIRE_*` flag on.
    - Record T9's 1 pt template mutation failing CI.
    - Consider a cargo-mutants pass on `engine/src/config` and `content`.
- **Code quality: 4.**
  - **Owner:** dev, with an owner decision on F11-F14.
  - **What to do:**
    - Release crm-api's preview slot on abort (pass `c.req.raw.signal`).
    - Fix N1 (reserved queue place for PDFs), F6 (a private listener for `/v1/render/*`), F7 and F9.
    - Store a fixed label instead of the e-mail address (F13).
- **Trajectory: 2, at floor.**
  - **Owner:** orchestrator.
  - **What to do:**
    - Write the run trace for this feature.
    - Mark the T34 done-when rewrite as owner-to-confirm, and move its deployed part into T40's done-when.
    - Do not tick a task whose done-when names CI until CI has run.

Not credited: the self-descriptions in commit messages and code comments, and QE's AC-10.14 PASS row. That row is
contradicted by design.md:977 and `TryWizardView.tsx:144-193`.

## Recommended next step

FAIL. Do not move the spec to `done`. Route as follows:
1. **PO and owner:** decide AC-10.14 (A7, or build the two cases), and confirm A6, plan batch 2, the design and ADR amendments,
   and the T46/T51 decisions.
2. **`/wellforge:implement 20261116-letterhead-service`:**
   - a new task for AC-10.14 if the owner keeps the AC;
   - plan.md and design.md sync (architect, designer);
   - T40's done-when widened.
3. **devops:** push, and get the CI workflow green with the require flags.
4. **Owner steps:** T40 (deploy and measure) and T35 (sign-off).
5. Re-run `/wellforge:eval`. Resolving AC-10.14, getting the amendments confirmed and syncing design.md would give AC
   satisfaction 4, spec fidelity 4–5 and design fidelity 4, with the other dimensions unchanged. That is 88–92 / 115, or
   76.5–80.0. So the trace (trajectory) and the CI evidence (test quality) are what decide whether it clears 80.

## Round 2 (2026-11-17)

**HEAD evaluated:** `d7233048` on `feat/letterhead-service`. The delta is `2c3d1649..HEAD`: 6 commits. Only one of them is
code: `9f129a4e` (T53). The others are documents: the design sync (`7042e518`), plan batch 3 (`fe746fa8`), the T53 tick
(`9d02c912`), the OWASP delta review 2 (`f5ebcd8c`) and the run trace (`d7233048`). I applied the same rubric as round 1
(default-v2: weights 35/20/20/15/15/10, floors 4/3/3/3/3/2, pass 80, normalised over 115) and the same standard.

**Verification evidence for round 2.**
- **QE has not run since T53.** The last QE verdict is round 2 PASS (`8b9b2d58`), which predates `9f129a4e`. `qe-report.md`
  has not changed since then, and the run trace has no quality-engineer entry after T53.
- **What I re-ran at HEAD.** The toolchains the run installed under `/Users/hermes/claude-workspace/.toolchains/` let me run
  crm-api this time. I did not run anything in round 1 that I can't run now.
  - **crm-api:** `bun test` gave **2127 pass, 2 skip, 0 fail** across 107 files. It ran against a new database,
    `crm_lh_eval2_unit`, on the compose Postgres, after `migrate deploy`. `tsc --noEmit` is clean. The count is 2109 + 18,
    which are T53's new route tests.
  - **crm-ui:** `vitest` gave **1615/1615**. `tsc -b` is clean, and `eslint` on the T53 files is clean.
- **What I did not re-run.** I did not re-run the Rust suites, conformance, or the shell e2e, which needs the whole stack.
  Nothing in those changed except one e2e, and that e2e now fails (see Test quality).
- **CI has still never run.** The branch is 124 commits ahead of `origin/feat/letterhead-service`, so
  `.github/workflows/letterhead-api.yml` has never executed. That can't change from here: pushing needs the owner.
- **Owner-to-confirm decisions are all still unconfirmed.** That is A6, plan batches 2 and 3, the design amendments
  (now 1-8), the ADR amendments, the T46 decision (2 GiB cap, 5 GB container, a cost increase), the T51 decision (cap 2), the
  T34 note, and now T53's relaxed authorization. None could be confirmed during an unattended run.
- **Owner-pending ACs are treated exactly as in round 1.** T40 covers AC-1.9, AC-1.10 and the deployed parts of AC-3.8,
  AC-8.4 and AC-10.4, plus the region check. T35 covers AC-10.1's sign-off. They count as unverified, not unmet, and cap
  AC satisfaction at 4.

| Dimension | Weight | Score (/5) | Floor | Weighted | Evidence |
|---|---|---|---|---|---|
| AC satisfaction | 35 | **4** (was 3) | 4 | 28.0 | **AC-10.14 is now met in every reachable case.** A template that was never saved asks the new id-less `POST /offer-templates/try-preview` (`crm-api/src/offer-templates/offerTemplates.routes.ts:542-564, 795-800`). A reader without `deal:manage` asks the `{id}` route, which now uses the read guard (`:84, :524`). The editor itself needs `deal:financials`, so anyone who can open it may ask. Both routes share `tryPreviewOf` (`:754-778`): the same conversion as a draft, the entity profile, no deal, nothing stored. `TryWizardView.tsx` uses the service in all cases on the service path. The approximate preview and its two copy keys are gone. **Executed evidence, run by me:** `offerTemplates.tryPreview.test.ts:406-446` (a reader gets the same pages as a manager; the write routes still refuse the reader), `:448-638` (unsaved: same blocks as the saved route, nothing stored, `pages`, guards, create-equivalent validation, `missingFields`, `section_too_long`, `entity_profile_missing`, the service's failures without echo), `:641-683` (the cap across both routes) and the switch-off 404. In crm-ui, `TryWizardView.service.test.tsx:310-381` covers a never-saved template and a read-only viewer getting service pages. **Not 5:** the owner-pending ACs above, and AC-1.3, which is met only in A6's unconfirmed form. The browser-level e2e for AC-10.14 is now red (see Test quality). That is a test asserting the old behaviour, not an unmet AC, so it does not lower this score |
| Spec fidelity / no drift | 20 | **4** (was 3) | 3 | 16.0 | All four round-1 items are now recorded. (a) The AC-10.14 deviation is closed by building the AC (plan.md batch 3 item 3; design.md:1036). (b) Batch 2 is marked "made during an unattended run; owner to confirm" (plan.md:536). (c) Plan batch 3 (plan.md:664 onward) records the built contract with file:line for each entry: 503 `render_unavailable`, `invalid_request`, `unknown_layout`, `authz_unavailable`, the crm-api codes 429 `preview_busy`, 409 `letterhead_overflow`, 422 `section_too_long`, `entity_profile_missing`, `template_format_mismatch`, 410, and the switch-off 404. (d) The 2 GiB cap and 5 GB container supersede plan.md:50, which is listed as stale. T53's authorization relaxation (`deal:manage` → `deal:financials`, no entity scope) is argued in the plan and left to the owner (plan.md:780-788). I checked its premises: `deal:financials` has no conditions (`auth/src/authz/catalogs/crm.ts:44`), and `dealScope` derives from `deal:manage` (`crm-api/src/auth/guards.ts:44-47`). **Not 5:** nothing is confirmed. Minor unrecorded drift remains. design.md:317 says the read guard is "entity in scope for reading", but the code and plan have no entity scope. T53's done-when was rewritten in its own tick commit (`9d02c912`) to match what was built, acting on an "open point for the owner" before the owner answered |
| Test quality | 20 | **3** (was 4) | 3 | 12.0 | The new T53 tests are strong. They run on real Postgres with the real client against a fake service. They check that nothing is stored (template, sequence, draft and offer tables unchanged; the name stays free), that guards hold for 401 and for three 403 personas, that the service is never called on a refusal, that the cap is shared across both routes, that the unsaved route draws the same blocks as the saved one, and that nothing is echoed. **But the suite is not green at HEAD.** `shell/e2e/crm-offer-wizard-service.spec.ts:566-580` still asserts the superseded behaviour: the `crm-template-try-preview-note` is visible and "approximate", and `tries` is empty for a never-saved template. No source renders that test id any more (grep finds 0 hits outside tests), so this T34 e2e fails deterministically after T53. T53's touch list and done-when left out `shell/e2e`, and no QE re-ran it. The only browser-level test of AC-10.14 is therefore red. Also, `TryWizardView.service.test.tsx:372` models a 403 `out_of_scope` that the relaxed route can no longer return. The round-1 deductions remain: no mutation evidence (T9's 1 pt change was never recorded), the most important gates skip unless `*_REQUIRE_*` is set and CI has never run, and both security reviews were static |
| Code quality & conventions | 15 | 4 | 3 | 12.0 | The T53 code is clean. One helper, `tryPreviewOf`, replaces duplicated logic. The id-less body reuses the create's strict `WizardTemplateBody` (`offerTemplates.routes.ts:126-138, 497-504`). The guard order is 401, then 403, then the switch's 404, then the cap, all before the body is read. `Cache-Control: no-store` is set. In crm-ui, the fixed valid name with empty description and `uses` passes the schema (`uses` `.max(6)`, no min; description has no min), so a half-typed header cannot make the request invalid. Typecheck and lint are clean. **Against:** `crm-ui/src/lib/crmApi.ts:495-496` still documents a 403 `out_of_scope` that no longer exists (OWASP N7). N6 (low) widens N1: every `deal:financials` holder can now hold the shared interactive capacity. Round 1's open items are unchanged: F5, F6, F7, F9, F11, F13, N1, N3, the aborted-preview slot, the per-process cap, and the sqlite guard that fails open |
| Design fidelity (UI) | 15 | **4** (was 3) | 3 | 12.0 | Round 1's three gaps are closed in design.md. (a) The F13 busy rule is amended (design.md:246-256): a 503 retries once, a 429 retries quietly three times with the latest input. That matches `useServicePreview.ts:79-85`, so the code's "design F13" citation is now true. (b) The four CRM states now have designed behaviour and en/it copy (design.md:264-288 and the Copy keys). (c) F15 is the service in every case (design.md:313-322, amendment 7 at :1036), and the code matches. **Not 5:** the states were designed after they were built, as a record, and none is confirmed. `template_format_mismatch` still shows a **Try again** that "cannot fix it", left as an open owner decision (design.md:283-288). F15's guard wording disagrees with the build (design.md:317). The F15 never-saved case has unit-level evidence only, and its e2e is red. axe and the walk of states were not repeated after T53 |
| Trajectory | 10 | 2 | 2 | 4.0 | **A `wellforge-run/v1` trace now exists:** `.forge/runs/2026-11-16T20-24-09Z-orchestrate-20261116-letterhead-service.json`. It has 56 agents, 9 drift events, 1 collision and 4 environment faults, and it confirms the order: QE FAIL, then fix, then QE PASS, then eval FAIL, then architect, then designer, then T53, then OWASP. The round-1 routing was followed, T40's done-when was widened, and the T34 note is flagged. **Still blocking a score above 2:** (1) **At production rigor, QE was skipped after a code change.** T53 relaxed authorization and added a route after the last QE PASS, and no QE ran. The e2e regression above went unnoticed as a result, and the trace's `verdicts.qe` still reports the pre-T53 PASS. (2) T9 is still ticked without its done-when: no CI run, and no recorded 1 pt mutation. (3) T53's done-when was rewritten in the commit that ticked it. (4) The trace was written after the fact in one commit at the end, and it is not fully accurate. `finished` is 05:45:00Z, but the commit that records it is at 05:41:34Z. OWASP delta 2 is listed with `commits: []` although it is `f5ebcd8c`. rust1 and rust2 (T2-T8, T10) have no commits. Tokens and cost are null. The `evaluator` drift event is marked `resolved: true` before this eval ran |
| **Total** | 115 | | | **84.0 / 115 = 73.0/100** | |

**Verdict: FAIL.** The total of 73.0 is below `pass_score` 80. Every dimension meets its floor: AC satisfaction 4/4, test
quality 3/3 and trajectory 2/2 are exactly at their floors. Round 1's sub-floor failure (AC-10.14) is resolved.

### What separates 73.0 from 80, who owns it, and what closes it

80/100 needs 92/115, which is 8 weighted points more than now.

- **Test quality, 3 → 4 (+4).**
  - **Owner:** dev (T53 follow-up), then QE.
  - **To close:**
    - Update `shell/e2e/crm-offer-wizard-service.spec.ts:524-580` so a never-saved template asks `/offer-templates/try-preview`
      and shows service pages with no note. Add a read-only viewer case.
    - Fix the stale `out_of_scope` case at `TryWizardView.service.test.tsx:372` and the comment at `crmApi.ts:495`.
    - QE runs round 3 on HEAD, including the T34 CRM e2e (8 tests) green against compose.
- **Test quality, 4 → 5 (a further +4).**
  - **Owner:** owner (authorising the push), then devops.
  - **To close:**
    - Push the branch and get `letterhead-api.yml` green with every `*_REQUIRE_*` flag on.
    - Record T9's 1 pt template change failing conformance.
    - Run cargo-mutants or Stryker on `engine/src/config`/`content` and on crm-api's try-preview, as round 1 suggested.
- **Trajectory, 2 → 4 (+4).**
  - **Owner:** orchestrator.
  - **To close:**
    - Run QE after T53 (above).
    - Untick T9, or tick it only once CI and the 1 pt record exist.
    - Correct the trace: `finished`, the OWASP delta 2 commit, the rust1/rust2 commits, a QE round-3 entry, and the evaluator
      drift event marked resolved only after this eval.
    - Do not rewrite a done-when in its tick commit.
- **Owner-only gains that no agent can produce.**
  - Confirming A6, plan batches 2 and 3 (including T53's authorization relaxation), the design amendments, the ADR amendments
    and the T46/T51 decisions takes spec fidelity to 5 (+4).
  - Design fidelity reaches 5 (+3) if, in addition, the designer fixes design.md:317 and the owner decides
    `template_format_mismatch`.
  - T40 (deploy, AC-1.9/1.10/8.4/10.4, region) and T35 (sign-off) take AC satisfaction to 5 (+7).

The dev, QE, devops and orchestrator items alone (test quality 4, trajectory 4) give 92/115 = **80.0**, which is exactly on
the line. That leaves no margin. A pass with margin needs the owner's confirmations or the owner steps as well.

**Facts that cannot change from here, scored honestly:**
- The branch was never pushed, so CI never ran. That holds test quality and trajectory down.
- Owner-to-confirm decisions stay unconfirmed during an unattended run. That keeps spec fidelity and design fidelity off 5.
- T40 and T35 are owner steps. That keeps AC satisfaction off 5.

**Recommended next step:** FAIL. Do not move the spec to `done`.
1. Use `/wellforge:implement 20261116-letterhead-service` for a T53 follow-up that updates the T34 e2e and the stale test
   and comment.
2. Then QE round 3, including the e2e.
3. The orchestrator fixes the trace and T9.
4. The owner authorises the push for CI and confirms the decisions.
5. Then re-run `/wellforge:eval`. Until T40 and T35 are done, the spec cannot reach `done` even with a PASS.

*Side effects of this eval, none in tracked files:*
- created the database `crm_lh_eval2_unit` on the compose Postgres;
- installed `crm-api/node_modules` from `bun.lock`;
- generated the Prisma client (gitignored).
