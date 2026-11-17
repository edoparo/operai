# QE report — Record hours in place, and the Week view of My hours

Spec `specs/20261116-record-hours-in-place/` · rigor `production` (full mode, every row blocks) · branch `feat/record-hours-in-place`
Pass 2 (re-run after fix round 1), by a fresh QE agent. It re-verifies D1, D2, D3 and the designer's findings of pass 1 in the
running app, re-runs every gate, and re-checks the 41 ACs. Round under test: `git log 109448a0..HEAD`.

## Read this first — what could not run, and what was judged instead

1. **BLOCKED row: screen-reader readback (NVDA, VoiceOver).** Unchanged from pass 1: no screen reader can be driven from here.
   What I checked instead, in the DOM of the running app: the success message is `role="status"` with its text complete (English
   and Italian), every cell button's accessible name carries the row and the day, the scroll hint is `aria-hidden="true"` (it is a cue
   for the eye; the region is a labelled scroll region), and the dialogs are `aria-modal` with their description wired. Script for the
   person who runs it is under **Blocked**.
2. **Judged from the cause, not run in a production build: the dev-only "Duration error on open"** (React StrictMode's simulated unmount
   in the shell's dev root; pass 1, item 2). Unchanged by the round; not counted as a defect.
3. **No coverage gate and no dependency-audit job exist** in hours-ui, projects-ui, crm-ui or shell (nothing configured; hours-ui has
   no coverage provider; `.github/workflows/` has no audit job). Those two rows are n/a, not passed. The round adds no dependency
   (`git diff 72a2760e..HEAD` over every `package.json` and `pnpm-lock.yaml`: empty).
4. The whole `pnpm e2e` was not run (caller's environment note: about 26 failures outside hours for local reasons). The four specs of
   this feature were: **20/20**.
5. The D2 focus unit tests rest on an emulation of the browser's focus fixup (`hours-ui/src/test-support/focusFixup.ts`). I did not
   take it on trust: every focus claim below was measured on `document.activeElement` in real Chromium, and two of the fixes were
   switched off to see the real browser answer `BODY` (see Test strength).

## QE verdict: BLOCKED        (measured at 6c638586; the report commit that follows adds only this file)

No row failed. One row could not be executed (screen-reader readback), so the verdict is BLOCKED, not PASS.
Defects: **0** (D1, D2, D3 and the two design defects are fixed in every placement). Blocked: 1. Environment faults: 1.

| Check | Threshold | Actual | Result |
|---|---|---|---|
| AC coverage (executed check behind every AC) | 41/41 | 41/41 executed, 41/41 pass (AC-4.2, the one failing in pass 1, passes) | ✓ |
| D1 — a fixed task's `activity_not_allowed` is shown | every placement | 7/7 placements shown with the sentence, dialog open, values kept, focus on Save (live) + e2e R1 | ✓ |
| D2 — focus after a refusal / failed delete / failed Week read | never `<body>` | 35 real-browser cases driven by hand, every one on Save / Confirm / Retry / heading, + e2e R1–R3 | ✓ |
| D3 — a row's message survives the list's re-read | every placement | 6/6 placements × removal, deletion and insertion above the row (live) + e2e R4 | ✓ |
| Design: Week at 375 px | the whole Monday column with its figure visible without scrolling | header and figure inside the 220 px region, no scroll (`week-375.png`) | ✓ |
| Design: Week at 1024 px | no overflow of the grid region | 869 = 869 px with small totals and with "144 h" / "160 h" totals | ✓ |
| Design: Week at 960 px | scrolls inside the card, as designed (fits from about 980) | 805 px region, 809 px grid: 4 px sideways scroll; hint shown | ✓ (as designed) |
| Design: scroll hint | below `lg` only, only with a grid | shown at 1023, 960, 768, 375; `display:none` at 1024+; absent while loading, on an empty week, a future week and an error | ✓ |
| Design: Italian success message | "Hai registrato …" | 30 min, 1 h, 2 h 30, 24 h, other work: all read correctly | ✓ |
| Design states (design.md S1–S9) | all states present | unchanged since pass 1 (S1–S9 rendered live; S3 persistence now holds) | ✓ |
| Accessibility (design.md) | keyboard + ARIA per design | keyboard paths and focus after every write, refusal, retry and failed delete hold (see D2) | ✓ |
| Component reuse (design.md inventory) | no NEW library component | `operai-ui` changed by one bug fix of `ListRows` (keys rows by their child's key), no new component; hosts reuse `ListRows` again | ✓ |
| e2e `hours-in-place.spec.ts` + `hours.spec.ts` + `hours-owners.spec.ts` | 16/16 | 16/16 (A–F, 7 owners, 3 hours) | ✓ |
| e2e `hours-in-place.round1.spec.ts` (new, R1–R4) | 4/4 | 4/4 (20/20 with the above, 1.5 min) | ✓ |
| hours-ui lint / build / unit | green | lint 0, build 0, **2134/2134** (81 files) | ✓ |
| shell lint / build / unit | green | lint 0, build 0; unit 668/669 once (see Environment faults), **669/669** (42 files) in the `ui:check` run at the same commit, 3/3 alone | ✓ |
| projects-ui lint / build / unit | green | lint 0, build 0, **942/942** (45 files) | ✓ |
| crm-ui lint / build / unit | green | lint 0, build 0, **1593/1593** (81 files) | ✓ |
| `mise run ui:check` | exit 0 | exit 0: operai-ui 299/299 (25 files), shell 669, refund-ui 789, meetings-ui 1052, hours-ui 2134 | ✓ |
| `ListRows` consumers (admin-ui, inventory-ui, notify-ui, estimai-ui) | unit green | 490/490, 1057/1057, 53/53, 360/360 | ✓ |
| `mise run shared:check` | in sync | 33 groups in sync | ✓ |
| `mise run env:doctor` | all pass | all checks passed | ✓ |
| `mise run changeset:check` | pass | OK (36 changesets matched, `.changeset/operai-ui-list-rows-keyed.md` among them) | ✓ |
| `mise run react:skew` | one React | OK, 11 frontends | ✓ |
| Secret scan, `gitleaks@8.30.1 git --log-opts=72a2760e..HEAD` | 0 | 48 commits scanned, no leaks | ✓ |
| Dependency change / audit | none new | no `package.json` or lockfile in the diff; no audit job exists | n/a ✓ |
| Coverage | no gate configured | not measured (see 3 above) | n/a |
| OWASP (`owasp-report.md`, follow-up at fc8be39e) | PASS | PASS, N1 fixed; my scan of the round's added production lines finds no sink, storage, origin or dependency change | ✓ |
| Test strength (mutation of the fixes) | every effective mutant killed | 7 of 7 killed by the new e2e journeys, 2 more shown live as `BODY` / lost message (see below) | ✓ |
| Exploratory UI pass | every designed flow walked | the placements above, both languages, five widths (1440 / 1280 / 1024 / 960 / 375, plus 1100, 1023, 768) | ✓ |
| Screen-reader readback | NVDA + VoiceOver | not executed | BLOCKED |

## Pass 1's defects, re-verified by placement

All driven in Chromium against the real stack through the dev test-auth sessions (`@operai.test` people, never Google). `focus` is
`document.activeElement` read in the page 1 s after the answer, so a control that was disabled while the request ran has been through
a rendering.

### D1 — `activity_not_allowed` of a fixed task: **fixed** (shown in every placement)

Method: open the page, delete the task through activities-api, press **Record hours** on the row that is still drawn, Duration `1`, Save.
POST answers 422; the dialog stays open, shows "This activity does not belong to the chosen project." (deal: "…chosen deal."), keeps
the value, and focus is on Save (Enter retries with the same result).

| Placement | Result |
|---|---|
| projects-ui project Tasks card row | ✓ (also e2e R1, real services) |
| projects-ui My tasks project row | ✓ |
| projects-ui My tasks pre-sales row with a deal | ✓ |
| crm-ui Tasks page deal-task row | ✓ |
| crm-ui deal timeline deal-task row | ✓ (also e2e R1) |
| crm-ui company timeline deal-task row | ✓ |
| crm-ui contact timeline deal-task row | ✓ |
| project header, deal header (no task fixed: the refusal is on the Activity select) | ✓ by construction, not driven |
| a deal-less task (other work, no activity sent) | n/a, nothing to refuse |

Root cause, as the round states it: the fixed task is a `dl` fact with no field to carry an error, so `failureOf` now routes it to the
dialog's form-level alert when `taskFixed`. Mutant M-D1 (always route to the field) is killed by R1.

### D2 — focus after a refusal: **fixed** in every placement of the class

Dialog placements, each with the refusals that have no field, then Enter on the focused control (retries) and Escape (focus returns to
the opener). 

| Placement | `host_unavailable` | 500 | network | entity refusal | focus after |
|---|---|---|---|---|---|
| project header → widget dialog | Save ✓ | Save ✓ | Save ✓ | `not_on_project` Save ✓ | Escape → Record hours ✓ |
| project Tasks card row → widget dialog | Save ✓ | Save ✓ | Save ✓ | `not_on_project` Save ✓ (and the real 403 of a person removed from the team: My tasks, Save ✓) | ✓ |
| deal header (owner) → widget dialog | Save ✓ | Save ✓ | Save ✓ | `not_involved_in_deal` Save ✓ | ✓ |
| deal timeline row → widget dialog | Save ✓ | Save ✓ | Save ✓ | `not_involved_in_deal` Save ✓ | ✓ |
| My hours' own dialog (other work) | (generic sentence) Save ✓ | Save ✓ | Save ✓ | focus on the picker (unit tests + e2e `hours-owners`, not re-driven) | ✓ |
| My hours' own dialog, **edit** (PATCH 500, List) | | Save ✓ | | | ✓ |
| `DeleteEntryDialog` from the List | | Confirm ✓ | Confirm ✓ | (503: Confirm ✓) | Escape → the entry's Delete ✓ |
| `DeleteEntryDialog` from the Week cell dialog | | Confirm ✓ | Confirm ✓ | | Escape → the entry's Delete ✓; a delete that works → the dialog's heading, never `<body>` |
| Week read, **Retry fails again** (500) | | new Retry ✓ | | | |
| Week read, **Retry works** | | | | | card heading `H3#hours-week-heading` ✓ |

The same refusals in e2e R1–R3 (real Chromium, `toBeFocused()`), with hours-api's answer stubbed only where a real failure cannot be
caused (the harness never breaks a shared service). Real refusals (not stubbed): the deleted-task 422, and the 403 `not_on_project` of
a task row whose assignee left the team.

**Same class, other placement, pre-existing and outside this feature's diff:** hours-ui **Settings → Add category**
(`TimeListItemDialog`, specs/20261112-time-tracking): a refused save (stubbed 500) leaves focus on `BODY`. It is the same cause as D2
(`@operai/ui` `FormDialog` disables Save and the fieldset while busy and gives no ref to Save); decisions.md routed it as a follow-up.
This is **missed by pass 1 and not introduced by the round**; it is not counted as a defect of this feature. Every other
`FormDialog` consumer in the nine apps shares the cause and was not checked.

### D3 — the widget's message dropped by an unrelated reload of the host list: **fixed**

Method: press **Record hours** on a row (message shows), then change the list above or below it, and count the message inside that row
after the re-read has landed. "Above" = Mark done on a row above, Delete on a row above, a row inserted above (a task or an activity
that sorts first, or logged by the person).

| Placement | Mark done above | Delete above | Row inserted above |
|---|---|---|---|
| projects-ui project Tasks card | ✓ | ✓ | ✓ (Add task; also R4) |
| projects-ui My tasks | ✓ (two rows above, in turn) | n/a (no Delete) | ✓ (a task created by the API appears first after the re-read) |
| crm-ui company timeline | ✓ | ✓ | ✓ (Log activity) |
| crm-ui deal timeline | ✓ | ✓ | ✓ (Log activity; also R4 with a call logged by the API) |
| crm-ui contact timeline | n/a (rows above were done) | ✓ | ✓ (Log activity) |
| crm-ui Tasks page | ✓ | ✓ | ✓ (a task due earlier appears first) |

Strength, live A/B on My tasks: with `ListRows` switched back to `key={index}` the message is gone after a row above is marked done
(`[]`); with the fix it stays in its row (`["Overdue | QE2 W task W3 …"]`). Root cause (pass 1 was right to widen it): `ListRows` keyed
each `<li>` by index, so a removed or inserted row above made every row below take its neighbour's element; the cards that also
re-read through `loading` unmounted every row. Fixed in the library (keyed by the child's key, `Children.toArray` namespaced) and in
`TasksCard` / `ActivityTimeline` (`cacheKey`, so a re-read keeps the rows). Known, outside D3's class: the project page's own 409
"reload" path (`resource.retry`) still unmounts the header widget's message; recorded in decisions.md, not exercised here.

### The designer's defects (design.md amended 2026-11-17)

| Item | Measured |
|---|---|
| Week at 375 px | the grid region is 220 px; Monday's header ("MON 16.11.2026") and figure ("2 h 30") are inside it, 249–315 px against 107–327, with the region unscrolled (`.playwright-mcp/qe-hip2/week-375.png`); the page does not scroll sideways (0 px at every width) |
| Week at 1024 px | region 869 px = grid 869 px (no overflow), with day figures only and with totals "144 h" and "160 h" (three-digit hours); fits down to 980 px |
| Week at 960 px | region 805 px, grid 809 px: a 4 px sideways scroll inside the card, with the hint shown, which is what design.md says below about 980 px (`week-960.png`). design.md's sentence "at 960 (805 px) for a short Total" is a few pixels optimistic; its threshold ("from about 980 px up") is right |
| Hint "Scroll sideways to see all seven days." | `display:block` at 1023, 960, 768 and 375; `display:none` at 1024, 1280 and 1440 (`lg`); one element, `aria-hidden="true"`, only in the loaded-with-rows state: absent while loading ("Loading your week…"), on "No hours recorded this week", on "This week has not started" and on the error with Retry. Italian: "Scorri di lato per vedere tutti e sette i giorni." |
| Italian success message | "Hai registrato 30 min su …", "Hai registrato 1 h su …", "Hai registrato 2 h 30 su …", "Hai registrato 24 h su …" (project header and task rows), "Hai registrato 1 h su altro lavoro: Training." (company task without a deal; its dialog reads "Questa attività riguarda un'azienda, non un'opportunità, quindi le ore vengono registrate come altro lavoro. Non sono collegate all'attività.") |

## Acceptance criteria — 41 of 41 executed, 41 pass

`e2e A–F` = `shell/e2e/hours-in-place.spec.ts`; `R1–R4` = `shell/e2e/hours-in-place.round1.spec.ts` (new); `unit` = the feature's vitest files,
all green at 6c638586; `live` = driven by me in the browser this pass. Where an AC's code did not change in the round, the executed
evidence is its unit and e2e tests (re-run green here) plus pass 1's live drive; I say so.

| AC | Evidence | Result |
|---|---|---|
| 1.1 | e2e A; unit `projects-ui/src/lib/recordHours.test.ts`, `ProjectDetailPage.recordHours.test.tsx`; live: the manager's header shows Record hours first, before the state actions | ✓ |
| 1.2 | e2e A (a reader sees no button, no fallback); unit | ✓ |
| 1.3 | e2e A (project as text, no radio, no picker, Day today, Duration focused); live: description "Recording hours on the project …", focus on Duration on open | ✓ |
| 2.1 | e2e B; live: the owner's deal header shows it | ✓ |
| 2.2 | e2e B; unit; live: the admin, who is not owner or technical contact, has none in the deal header | ✓ |
| 2.3 | e2e B; live: "Recording hours on the deal …" | ✓ |
| 3.1 | e2e B, C, R1, R4; live: the row button on the project Tasks card, My tasks (project and pre-sales), the CRM Tasks page and the deal, company and contact timelines; unit `ActivityItem/ProjectTaskItem/MyTasksPageRow.recordHours` | ✓ |
| 3.2 | e2e C; live: project and task as text | ✓ |
| 3.3 | e2e B; live: My tasks pre-sales row and the deal timeline (deal as text, task fixed) | ✓ |
| 3.4 | e2e D; live (Italian): a company task with no deal opens other work, category empty, the "not linked to the task" sentence | ✓ |
| 3.5 | e2e D; live: saved as other work with the chosen category | ✓ |
| 3.6 | unit (a done row offers it, same label and position), pass 1's live drive of the Done tabs; code unchanged in the round | ✓ |
| 4.1 | e2e A (My hours lists the entry with the same values); live: entries recorded from rows appear in My hours with their targets | ✓ |
| 4.2 | R1, R2; live: `not_on_project`, `not_involved_in_deal`, `host_unavailable`, 500, network and **`activity_not_allowed`** all shown in My hours' words, values kept, no "Choose another"; unit `EntryDialog.preset`, `EntryDialogModel.preset`, `EntryDialog.refusalFocus` | ✓ (was ✗ in pass 1) |
| 4.3 | e2e A (dialog closes, message with link, no host read after the save); live: the message stays with the page's re-reads (D3) and has no timer | ✓ |
| 4.4 | unit `RecordHours.test.tsx` (POST only; no Edit, Delete, PATCH); live: the message reads "… See in My hours" with its dismiss, nothing else | ✓ |
| 4.5 | e2e E (hours remote aborted: project page, My tasks, deal page keep working with the link) | ✓ |
| 4.6 | unit `strings.test.ts` parity in four apps, `RecordHours.it.test.tsx`, `WeekView.it.test.tsx`; live: the Italian dialog, messages, Week and hint | ✓ |
| 5.1 | e2e F; live: `/hours` is the List with the List / Week tabs | ✓ |
| 5.2 | e2e F; live: `/hours?view=week` opens the Week | ✓ |
| 5.3 | e2e F; live: MON … SUN headers, Today marked | ✓ |
| 5.4 | e2e F; live: "Week 16.11.2026 – 22.11.2026" on 17.11.2026 | ✓ |
| 5.5 | e2e F; live: Previous, Next, This week (`aria-disabled` on the current week); the next week is "This week has not started" | ✓ |
| 5.6 | e2e F; unit `weekGrid.test.ts`; live: one row per project, deal and category | ✓ |
| 5.7 | unit `weekGrid.test.ts` (a meeting linked to a visible deal stays on its own row); pass 1's live drive | ✓ |
| 5.8 | e2e F; unit; live: projects, deals, other work, in that order | ✓ |
| 5.9 | e2e F (a two-entry cell reads the sum); live: "5 h … 5 entries" | ✓ |
| 5.10 | e2e F (exact day, row and week totals after each write); live: Monday 4 h 30, Tuesday 11 h 30, rows 8 h 30 / 6 h 30 / 1 h, total 16 h | ✓ |
| 5.11 | unit `WeekView.test.tsx` (42 h and 1 h week, same markup); live: no mark and no target in a 160 h week | ✓ |
| 5.12 | e2e F; unit `MyHoursPage.weekCells.test.tsx` | ✓ |
| 5.13 | e2e F; unit (day and target changeable, the changed values posted) | ✓ |
| 5.14 | e2e F; live: Wednesday to Sunday of the current week and every day of the next week offer nothing | ✓ |
| 5.15 | e2e F; live: a cell opens its dialog with the entries, focus on the first Edit | ✓ |
| 5.16 | e2e F (Edit → PATCH, figures follow); live: a refused PATCH (from the List) keeps the dialog open with the alert, focus on Save | ✓ |
| 5.17 | e2e F, R3 (Cancel sends nothing, Confirm deletes; a failed delete keeps the confirmation); live | ✓ |
| 5.18 | unit `WeekCellDialog.test.tsx`; pass 1's live drive; code unchanged in the round | ✓ |
| 5.19 | e2e F (Record hours on a target with no hours that week adds its row) | ✓ |
| 5.20 | e2e F; live: after a delete the cell reads "4 h … 4 entries" without a reload | ✓ |
| 5.21 | unit `MyHoursPage.week.test.tsx` (the read carries all five filters); pass 1's live drive | ✓ |
| 5.22 | unit `MyHoursPage.week.test.tsx`; pass 1's live drive | ✓ |
| 5.23 | unit `weekGrid`, `WeekView`; pass 1's live drive | ✓ |
| 5.24 | unit `weekGrid`, `WeekView`, `WeekCellDialog`; pass 1's live drive | ✓ |

## Defects

None. Findings that are **not** defects of this feature:

1. **Same class as D2, pre-existing, outside the diff** (missed by pass 1, not introduced by the round): hours-ui Settings → Add category
   (`TimeListItemDialog`) leaves focus on `<body>` after a refused save (measured live). Owner: **frontend-dev**, as a follow-up of
   specs/20261112-time-tracking, ideally at the cause (`@operai/ui` `FormDialog`, which ships with the shell to every remote), then a
   check of every other `FormDialog` consumer.
2. design.md's "fits at 960 (805 px) for a short Total" is optimistic by 4 px; the stated threshold (about 980 px) and the hint
   (below 1024 px) are right. Owner: **designer**, wording only.

## Observations (not defects)

- The project page's 409 "reload" path unmounts the header widget's message (decisions.md, round-1 projects-ui entry). Not exercised.
- `/hours/?view=week&week=…` has a trailing slash after the first in-app navigation; the List's `?period=` does the same (pre-existing).
- Between about 980 and 1023 px the hint shows although the grid fits (design.md accepts it).
- Dev-only: the Duration error on open under StrictMode (pass 1, item 2).

## Tests added or changed (this pass)

- `shell/e2e/hours-in-place.round1.spec.ts` (new, committed in 6c638586): R1 (D1 and D2 on the project row and the deal row, real services, a second task keeps the
  person "on one of the deal's activities" so the refusal is the task's); R2 (D2: `host_unavailable`, 500 and a dropped connection on the
  project header's widget dialog, 500 and a dropped connection on My hours' own dialog); R3 (D2: a failed delete from the List and from the Week cell
  dialog, a Week read that fails again then works); R4 (D3: Mark done, Delete and an inserted row above the row holding the message, in the
  project Tasks card and the CRM deal timeline; each re-read is waited for before the count is read, so the check cannot pass early).
  The people are per-run `hip-*@operai.test`, every entry and task is deleted afterwards.
- **Seen to fail when the behavior is broken** (each mutant applied alone, the spec run, the file restored with `git checkout`, tree clean after):

| Mutant | Killed by |
|---|---|
| M-D1 `failureOf` sends `activity_not_allowed` to the field again | R1 (alert text missing) |
| M-D2 `EntryDialog` focus fallback to Save removed | R1 and, alone, R2 (`toBeFocused` fails: inactive) |
| M-D2b `DeleteEntryDialog` focus fallback removed | R3 |
| M-D2c `WeekView.focusRetry` no longer focuses | R3 |
| M-D3 `ListRows` keyed by index again | R4 (message count 0) |
| M-D3b `TasksCard` without `cacheKey` | R4 |
| M-D3c `ActivityTimeline` without `cacheKey` | R4 |

  Also by hand in the browser: with M-D2 and M-D2b applied the real browser answered `BODY` after a refused save and after a failed
  delete (the next Tab went to the dialog's ×); with M-D3 applied the message was lost after a row above was marked done on My tasks.
- No test of pass 1 was changed. Pass 1's `hours-ui/src/components/EntryDialog.fixedActivityRefusal.test.tsx` (written to fail) is green.

## Environment faults (not defects, no fix round)

- **`shell/src/router.meetings.test.tsx` "/my-meetings/$ … shows RemoteMount's error state … when the remote fails to load" failed once** (a
  1012 ms `findBy`, 1 s timeout) in the shell run while the dev stack and a browser were up. At the same commit the file passes 3 of 3
  alone, and the full shell suite passes 669/669 in the `ui:check` run. A timing-sensitive router test the feature does not touch.
- notify-api is not running (`ERR_CONNECTION_REFUSED` on `:8081` in every console); unrelated.
- crm-api answers 503 "Activities are not configured for the CRM" on `DELETE /contacts/{id}` in this environment, so my scratch contact stayed.
- **Data left in the dev databases** (no delete route exists for them): projects `QE2 project …`, `QE2 outsiders …`, `Hip R project …`, companies
  `QE2 company …`, `Hip R company …`, deals `QE2 deal …`, `Hip R deal …` and the contact `QE Contact …`. Deleted: every time entry (26), every task and
  activity of the pass (29, plus the journeys' own), and every user (`hip-*` of this pass, two runs). Browser session snippets with tokens removed;
  the screenshots are in the git-ignored `.playwright-mcp/qe-hip2/` (`week-375.png`, `week-1024.png`, `week-960.png`).

## Blocked

- **Screen-reader readback (NVDA on Windows, VoiceOver on macOS and iOS).** Needs a person with those tools. Script: open a project page as a
  team member, record 2 h 30 from the header and from a task row, and listen for "2 h 30 recorded on <name>. See in My hours" (Italian:
  "Hai registrato 2 h 30 su <nome>. Vedi in Le mie ore"); open My hours → Week and read a filled cell ("2 h on <row>, Wednesday 11 November
  2026, 1 entry"); on a phone-width window confirm the scroll hint is not read (it is `aria-hidden`) while the grid region is announced as a
  labelled region; after a refused save confirm the alert is read and a further Enter retries (focus is on Save). Re-run this row only.

## Recommendations

- Owasp-reviewer pass: **not needed again**. The follow-up (fc8be39e) is PASS with N1 fixed, and the round adds no sink, storage, origin,
  dependency or change to how a save is sent (my scan of its added production lines found none).
- After the person who ran the screen reader records the readback, the verdict becomes PASS with no code change.
- File the Settings dialog (finding 1) against specs/20261112-time-tracking or a small library spec, before the next feature that adds a form dialog.
