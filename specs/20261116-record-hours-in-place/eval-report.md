---
spec: 20261116
evaluated: 2026-11-19
rubric: default-v2
score: 82.6
verdict: PASS
---
# Eval report: Record hours in place, and a Week view of My hours

**HEAD evaluated:** `52262f64` on `feat/record-hours-in-place`, stacked on `feat/time-tracking` (`69b560d3`, an ancestor of
HEAD). QE pass 3 measured `c4b4f0cd`. The only change since then is `52262f64`, which adds 129 lines to `qe-report.md`.

**Scope:** what this branch adds on top of `feat/time-tracking`, read with `git diff --name-only feat/time-tracking...HEAD`.
That is 53 commits and 131 files. They change hours-ui, the shell, projects-ui and crm-ui, plus one bug fix in `@operai/ui`
`ListRows`, two ADRs, AGENTS.md, `infra/README.md`, changesets and the spec folder. No backend file, `package.json` or
lockfile changes. A problem in another module counts as context here, never as a finding.

**Rubric:** the bundled copy of the WellForge plugin. `gates/configs/eval-rubric.yml` and
`.wellforge-gates/gates/configs/eval-rubric.yml` do not exist, so the rubric is
`~/.claude/plugins/cache/wellforge/wellforge/2.61.0/config/eval-rubric.yml`, the `installPath` of
`wellforge@wellforge` 2.61.0. Its version is **default-v2**: `pass_score` 80, floors AC 4, spec 3, tests 3, code 3,
design 3 and trajectory 2. There is no `eval.md`. `design.md` exists, so design fidelity applies and the total is
normalised over 115.

**Inputs read:** spec.md (41 ACs, amended for D12 and D13), plan.md (first amendment G1–G7), design.md (F1–F6, S1–S9,
§ Gaps, § Amendment 2026-11-19), tasks.md (T1–T15 checked, T16 the close), decisions.md, ledger.md (D1–D14) and
qe-report.md. The latest QE pass is pass 3, 2026-11-19, **PASS**: 0 defects, nothing blocked, and the screen-reader
readback excluded by D14 and not claimed. owasp-report.md is **PASS**: N1 fixed, 0 findings at medium or above.

**Verification I re-ran at HEAD** (Node 26.10.0 with `NODE_OPTIONS=--no-webstorage`):

| Gate | Result |
|---|---|
| hours-ui unit | **2153/2153** (81 files) |
| projects-ui unit | **941 passed + 2 expected fail** (45 files; the two `it.fails` are in `MyTasksPage.projectsDown.qe.test.tsx`, outside the diff) |
| crm-ui unit | **1824/1824** (94 files) |
| shell unit | **706/706** (43 files) |
| operai-ui `ListRows.test.tsx` | **9/9** |
| `pnpm lint` | exit 0 in all four apps |
| `pnpm build` (`tsc -b` + vite) | exit 0 in all four apps |
| Plan R3 on the built hours-ui `dist/` | `exceljs` appears only in `hoursWorkbook-*.js`, which only `App-*.js` names; `RecordHours-*.js` imports only the shared scope, `EntryDialog-*.js` and `shell/session` |
| `mise run changeset:check` | OK. The feature's four changesets and `operai-ui-list-rows-keyed.md` are matched |

**Not re-run:** e2e. It needs the dev stack, and it leaves companies, deals and projects in the dev databases. I rely on
QE pass 3's fresh run at `c4b4f0cd`, where the production code is the same as at HEAD:
- `hours-in-place.spec.ts` and `hours-in-place.round1.spec.ts`: 10/10, with notify-api up;
- `hours.spec.ts` and `hours-owners.spec.ts`: 12/12.

**Context, not a finding:** the hours-ui run prints one React duplicate-key warning. It comes from
`src/components/EntriesTable.test.tsx`, a time-tracking test outside this diff, whose fixture renders two entries with id
`e1` through `DataTable`, which this branch does not change. It contradicts QE pass 3's line "0 'same key' warnings in
any of the ten suite outputs". That is a wording slip in the QE report, not a defect of this feature.

| Dimension | Weight | Score (/5) | Floor | Weighted | Evidence |
|---|---|---|---|---|---|
| AC satisfaction | 35 | 5 | 4 | 35.0 | All 41 ACs are met. Each is backed by a passing test at HEAD and by observed behaviour; the details follow the table. |
| Spec fidelity | 20 | 4 | 3 | 16.0 | Every planned contract is implemented as written. A few documented changes outside the plan alter existing behaviour (Findings). |
| Test quality | 20 | 4 | 3 | 16.0 | The tests check each AC and the error and edge cases, and QE showed by mutation that they catch regressions. A few tests are weak (Findings). |
| Code quality | 15 | 4 | 3 | 12.0 | Conventional, with real error handling and no invented APIs. Minor nits (Findings). |
| Design fidelity (UI) | 15 | 4 | 3 | 12.0 | design.md is complete and the build follows it. Not 5 because of D14 and some stale design text (Findings). |
| Trajectory | 10 | 2 | 2 | 4.0 | No run trace exists for this feature, so this is the rubric's neutral floor (Findings). |
| **Total** | 115 | | | **95 / 115 = 82.6/100** | |

**Verdict: PASS.** The total is 82.6 against a `pass_score` of 80, so the margin is 2.6. No applicable dimension is below
its floor. AC satisfaction is 5 (floor 4), trajectory is 2, exactly at its floor of 2, and the rest are 4 (floor 3).

**The margin rests on the AC score.** If AC satisfaction were 4, the total would be 88/115 = 76.5 and the verdict
FAIL. The neutral trajectory score takes 6 points off the achievable maximum. The rationale for 5 is below.

## AC evidence

**ACs with a test and an end-to-end journey:**

| AC | Journey | What the journey checks |
|---|---|---|
| AC-1.1–1.3 | e2e A | button shown to a team member; project as text, Day today, Duration focused; a reader gets no button and no fallback |
| AC-2.1–2.3, 3.1, 3.3 | e2e B | the owner sees it in the header; the assignee of the deal's task sees none there but one on the row; the entry carries `activity.id` |
| AC-3.2 | e2e C | |
| AC-3.4, 3.5 | e2e D | category required; the saved entry is other work and contains neither the company id nor the task id |
| AC-4.1, 4.3 | e2e A | My hours lists the same values; facts and tasks text unchanged; no host read after the save |
| AC-4.2 | R1, R2 | |
| AC-4.5 | e2e E | the hours `remoteEntry.js` is aborted |
| AC-5.1–5.6, 5.8–5.10, 5.12–5.17, 5.19, 5.20 | e2e F | exact cell, row and day totals; `['3 h','1 h 30','5 h','—','1 h','—','—','10 h 30']` |

**ACs with a test and a live drive:**

| AC | Test | Live drive |
|---|---|---|
| AC-4.4 | `RecordHours.test.tsx` "what it never does" | QE pass 2 |
| AC-4.6 | parity and hardcoded-copy tests in four apps; `RecordHours.it.test.tsx` and `WeekView.it.test.tsx` | QE pass 2, Italian |
| AC-5.11 | `WeekView.test.tsx`, 42 h and 1 h weeks | a 160 h week, QE pass 2 |
| AC-3.6, 5.7, 5.18, 5.21–5.24 | unit and component tests, green at HEAD | QE pass 1 (`4e659056`), at an earlier base |

For the last row, QE pass 3 checked that the production patch is unchanged since then. Pass 1's evidence is specific:
- AC-5.23: a person who lost `projects:access` sees rows labelled "Not visible to you".
- AC-5.24: the retired-category row has no plus on its empty cells and no Add hours, while Edit and Delete stay.

**Why 5:** every AC has a passing test and observed behaviour, which is anchor 5. The rubric's lower-anchor rule was
weighed against the one weakness: for those eight ACs the live observation was made at an earlier base and carried over,
not repeated. The verdict depends on this choice, and it is open to challenge.

## Findings

**Spec fidelity (4).**

*What matches the plan:*
- The six-prop extension type is at `shell/src/lib/extensions.tsx:45`, with the loader at `:68` and the expose at
  `hours-ui/vite.config.ts:44`.
- `checkProps` and `presetOf` implement the plan's valid sets (`hours-ui/src/RecordHoursModel.ts:44`, `:76`).
- The "who" rules are pure functions, as decision 3 says: `projects-ui/src/lib/recordHours.ts:30,85` and
  `crm-ui/src/lib/recordHours.ts:21,47`. They match hours-api's owners: crm-api's resolve
  `involved = [ownerUserId, technical]`, `crm-api/src/activity-host/resolve.routes.ts:160`.
- The Week reads one complete week with `whose: 'mine'` and the week's span (`hours-ui/src/pages/MyHoursPage.tsx:90-93`,
  `:194-207`). The address is `?view=week&week=`, and no backend changed.

*Not 5: changes outside the plan.* Each is recorded in decisions.md and serves AC-4.3 and G1 (the message must survive
the host list's re-reads), but they change behaviour of existing screens, and the plan's Components table was never
amended for them. decisions.md's own header says such drift should amend the plan.
- **(a)** `@operai/ui` `ListRows` now keys a row by its child's key, a behaviour change for every caller, shipped through
  the shell. design.md § Component inventory says "0 NEW or EXTENDED library components".
- **(b)** `cacheKey` on projects-ui `TasksCard.tsx:83` and crm-ui `ActivityTimeline.tsx:46`. On those cards, a revisit
  now shows the last-known rows and refreshes behind them.
- **(c)** The `useHoursQuery` stale-outcome fix and the `DeleteEntryDialog` focus fix.
- **(d)** `ActivityField` keeps a deprecated `locked` alias instead of the plan's rename.
- **(e)** The widget opens the dialog only after the lists answer, as the plan says. Design S4 says it opens at once;
  design.md was not amended.

**Test quality (4).**

*Strengths:*
- `RecordHours.test.tsx` covers every refusal, the aborted reads, focus return, message persistence and "never
  PATCH or DELETE".
- `weekGrid.test.ts` checks the invariants (Σ cells = row, Σ rows = week = Σ days, each entry in exactly one cell) over
  a mixed set.
- `MyHoursPage.week.test.tsx:855-930` walks two pages and checks that a failed second page draws no grid.
- e2e A–F use the real stack with exact figures; R1–R4 are real-browser regressions.
- QE killed 7 of 7 mutants in pass 2, and in pass 3 the reader mutants of `bbe8747c` were also killed.

*Not 5:*
- **(a)** `projects-ui/src/components/ProjectTaskItem.recordHours.list.test.tsx`: "100 rows import `shell/extensions`
  once" cannot fail because of the code, since the module system caches the import (the file's header says so). Its
  two tests are order-dependent.
- **(b)** Some "not offered" assertions rest on fixed waits: 25 ms in `ProjectDetailPage.recordHours.test.tsx:72-74`
  and the 1.5 s grace of `recordHoursSettled`, `shell/e2e/hours-in-place.spec.ts:131`. Positive controls and the QE
  mutants mitigate this.
- **(c)** The focus-after-refusal unit tests depend on an emulation, `hours-ui/src/test-support/focusFixup.ts`. Only e2e
  R1–R3 prove the real browser's behaviour.
- **(d)** Coverage is not measured; no gate is configured in these apps.
- **(e)** ACs 3.6, 5.7, 5.18 and 5.21–5.24 are tested only at unit or component level.

**Code quality (4).**

*Strengths:*
- Authority stays with hours-api, which fails closed. The host rules decide only whether a button shows.
- `checkProps` throws with messages that hold no value, so the host's boundary shows its fallback.
- Reads nobody waits for any more are aborted (`hours-ui/src/RecordHours.tsx:58-64`, `:89`).
- `weekGrid` is pure and throws on an entry outside the week; the page turns that into a failed read with Retry
  (`MyHoursPage.tsx:90-93`).
- R3 holds in the build. Lint and build are clean.

*Nits:*
- **(a)** Two near-identical `RecordHoursAction` wrappers cache the seam import differently: crm-ui at module scope
  (`crm-ui/src/components/RecordHoursAction.tsx:18-22`), projects-ui once per instance
  (`projects-ui/src/components/RecordHoursAction.tsx:76`).
- **(b)** The six-prop contract is copied by hand in five places: the shell's `extensions.tsx` and `remotes.d.ts`,
  crm-ui's and projects-ui's `remotes.d.ts`, and hours-ui's `RecordHoursModel.ts`. No `shared:check` group covers them;
  only the runtime `checkProps` would catch a mismatch.
- **(c)** The focus workarounds reach into the library's DOM: `closest('form')…button[type="submit"]` at
  `EntryDialog.tsx:261` and `DeleteEntryDialog.tsx:52`, and `heading.tabIndex = -1` at `WeekCellDialog.tsx:64`.
- **(d)** `MyHoursPage.tsx` is now 761 lines, with state updates during render and a numbered focus-request machine. The
  tests pass, but it costs maintenance.
- **(e)** crm-ui's `recordHoursPropsOf` does not guard a blank deal id, which projects-ui does. This is safe: the widget
  throws and the fallback link shows.

**Design fidelity (4).**

*Complete:* design.md has flows F1–F6, states S1–S9 (loading, empty, filtered-empty, not started, error, replaced) and a
full a11y plan (keyboard, focus, ARIA, contrast, table rather than ARIA grid). It maps reuse to `@operai/ui` with zero new
library components, and has en and it copy.

*Realised:* QE measured it:
- the layout at 375, 960 and 1024 px;
- the scroll hint, shown below `lg` only and `aria-hidden`;
- the region label;
- focus after every write, refusal and retry.

*Not 5:*
- **(a)** By D14 (the user's decision), the a11y plan's spoken announcements are not verified by a screen reader.
  Pass 3 says so and does not claim them.
- **(b)** S4 promises "the dialog opens at once" with Loading hints inside it (`design.md:295`). The build shows a busy
  button instead, and the design was not amended.
- **(c)** S3 still says a second save "restarts its timer" (`design.md:204`), although G1 removed the timer.
- **(d)** design.md's front matter still says `status: draft`.
- **(e)** "Fits at 960" is a few pixels optimistic (QE).

*Context, not counted:* the 375 px figures assume the shell's rail is collapsed. That is a shell issue, outside scope.

**Trajectory (2).** `.forge/runs/` has no trace for this feature; the newest is
`2026-11-18T14-00-00Z-orchestrate-20261112-time-tracking.json`. The rubric then gives the neutral floor, whatever git
shows. Git history is consistent with a correct trajectory:
1. plan and ADRs (`3b3793fe`, `4d2233dc`);
2. design, with the user's D12 and D13 (`506f664e`);
3. tasks (`09afa559`);
4. T1–T12, with decisions recorded per task;
5. e2e (T13), OWASP PASS (T14), docs and changesets (T15);
6. QE FAIL (`4e659056`), then a fix round (`1871838d` … `ea592129`);
7. OWASP follow-up PASS (`239a6302`);
8. QE pass 2 BLOCKED only on the readback (`04467c43`);
9. the user's D14 (`c4b4f0cd`);
10. the rebase and a test-only fix (`8ffd408c`, `bbe8747c`);
11. QE pass 3 PASS (`52262f64`).

Two points to note:
- `c38326b9` committed a deliberately failing test (QE D1), made green in `1871838d`.
- D14 took a gate row out by the user's explicit decision, recorded in the ledger and design.md. It was not skipped
  silently.

A faithful trace would very likely score 4.

## Recommended next step

- **PASS → the spec may move to `done`.** T16 (`/wellforge:done 20261116-record-hours-in-place`) can proceed. The main
  loop should write this feature's run trace (owner: orchestrator); it is the one item that would lift trajectory.
- **Follow-ups (not part of the gate):**
  - The screen-reader readback (D14; the script is in qe-report.md pass 2 § Blocked). Owner: a person with NVDA and
    VoiceOver.
  - Tidy design.md: S3's timer sentence, S4's "opens at once", and `status`. Owner: designer.
  - Add a plan note for the `ListRows`, `cacheKey`, `useHoursQuery` and `DeleteEntryDialog` changes outside the plan.
    Owner: architect.
  - Add a `shared:check` group or a type-level check for the six-prop contract, and make the two `RecordHoursAction`
    wrappers cache the seam import the same way. Owner: frontend-dev.
