# QE report — Record hours in place, and the Week view of My hours

Spec `specs/20261116-record-hours-in-place/` · rigor `production` (full mode, every row blocks) · branch `feat/record-hours-in-place`
Pass 1, by a fresh QE agent. Diff under test: `git diff 72a2760e..HEAD` (hours-ui, shell, projects-ui, crm-ui; no backend, no
`@operai/ui`, no dependency change).

## Read this first — what could not run, and what was judged instead

1. **BLOCKED row: screen-reader readback (NVDA, VoiceOver).** design.md § Accessibility asks QE to hear the success message
   (`role="status"`) and the new `aria-label`s ("2 h 30 on …, 2 entries"). No screen reader can be driven from here. What I
   checked instead, in the DOM of the running app: the message is `role="status"` inside a `aria-live="polite"` element, inserted
   with its text complete; every cell button's accessible name carries the row and the day; the dialogs are `aria-modal` with
   their description wired by `aria-describedby`. Needs a person with NVDA and VoiceOver (see Blocked).
2. **Judged from the cause, not run in a production build: the "Duration error on open".** The dialog the widget opens shows
   "Write a duration such as 2:30, 2,5 or 2h30." on its first frame in the dev stack. The focus-event trace on open is
   `button → Duration`, `Duration → button`, `button → Duration` (three moves; a single mount makes one), which is React
   StrictMode's simulated unmount (the shell's root is `<StrictMode>`, `shell/src/main.tsx:47`) restoring focus to the opener
   and blurring the empty required field. React's production build does not double-invoke effects. A jsdom probe with and
   without `<StrictMode>` did **not** reproduce it (error absent in both), so the cause is established from the trace and the
   mechanism, not reproduced elsewhere. Not counted as a defect, as the caller asked. A production shell cannot be served
   against these backends (their CORS allows only `:5173`, which the dev shell holds).
3. **No coverage gate exists** in hours-ui, projects-ui, crm-ui or shell (no threshold, and hours-ui has no coverage provider
   installed), and CI has no dependency-audit job (`.github/workflows/`: changeset-check, env-doctor, shared-copies, react-skew,
   railway-drift, meetings-eval). Those two rows are n/a, not passed. The feature adds no dependency.
4. The whole `pnpm e2e` was not run (the caller's environment note): the three hours specs were, 16/16.

## QE verdict: FAIL        (measured at a933b8ba; HEAD 057987ea adds one deliberately failing test file, D1)

| Check | Threshold | Actual | Result |
|---|---|---|---|
| AC coverage (executed check behind every AC) | 41/41 | 41/41 have an executed check; **AC-4.2 does not pass** (D1) | ✗ |
| e2e `hours-in-place.spec.ts` (T13), nothing stubbed | A–F green | 6/6 (A, B, C, D, E, F) at a933b8ba | ✓ |
| e2e `hours.spec.ts` + `hours-owners.spec.ts` | 10/10 | 10/10 (run together with the new spec: 16/16, 1.2 min) | ✓ |
| hours-ui lint / build / unit | green | lint 0, build 0, **2010/2010** (77 files) at a933b8ba; at 057987ea 2010 pass + **2 fail** (the D1 test) | ✓ at a933b8ba · ✗ at HEAD (intended) |
| projects-ui lint / build / unit | green | lint 0, build 0, 934/934 (43 files) | ✓ |
| crm-ui lint / build / unit | green | lint 0, build 0, 1580/1580 (79 files) | ✓ |
| shell lint / build / unit | green | lint 0, build 0, 669/669 (42 files) on a quiet machine (see Environment faults) | ✓ |
| `mise run ui:check` (operai-ui + shell, refund-ui, meetings-ui, hours-ui) | exit 0 | exit 0: operai-ui 290/290, shell 669, refund-ui 789, meetings-ui 1052, hours-ui 2010 | ✓ |
| `mise run shared:check` | in sync | 33 groups in sync | ✓ |
| `mise run env:doctor` | all pass | all 10 services pass | ✓ |
| `mise run changeset:check` | pass | OK (T15's four changesets matched: hours-ui, shell, projects-ui, crm-ui) | ✓ |
| `mise run react:skew` | one React | OK, 11 frontends | ✓ |
| Secret scan, `gitleaks@8.30.1 git --log-opts=72a2760e..HEAD` | 0 | 29 commits, no leaks | ✓ |
| Dependency change / audit | none new | no `package.json` or lockfile in the diff | n/a ✓ |
| Coverage | no gate configured | not measured (see 3 above) | n/a |
| OWASP (T14), `owasp-report.md` at fe516c2e | PASS | PASS; production code is byte-identical since (only test files and docs changed after fe516c2e) | ✓ |
| Test strength (mutation of the feature's logic) | every effective mutant killed | 20 of 20 effective mutants killed (17 by unit tests, 3 against the live stack by e2e); e2e F survived its first mutant (no two-entry cell), was strengthened, then killed it; 3 attempts were invalid on my side (see Tests added) | ✓ |
| Design states (design.md S1–S9) | all present | S1–S9 rendered live, incl. the Week's empty (future week), error with Retry and unreadable states; the loading skeleton and the filtered-empty state by component test only; one not honoured: S3 message persistence (D3) | ✗ |
| Accessibility (design.md) | keyboard + ARIA per design | keyboard paths and focus after each write hold; focus after a refusal is lost (D2) | ✗ |
| Component reuse (design.md inventory) | no NEW library component | `operai-ui` untouched; `Tabs`, `DataTable`, `Dialog`, `Banner`, `FactList` reused; 6 planned app-level compositions only | ✓ |
| Exploratory UI pass | every designed flow walked | walked in the browser at 1440/1024/375, both themes, en and it (see below) | ✓ |
| Screen-reader readback | NVDA + VoiceOver | not executed | BLOCKED |

Defects: 3 (D1, D2, D3). Blocked: 1. Environment faults: 1.

## Defects, by class

### D1 — a refusal with no surface: a fixed task's `activity_not_allowed` is swallowed · AC-4.2 · owner: **frontend-dev** · **new in this feature**

A task row's dialog shows the task as a fact (`ActivityField lock="fixed"`) and sends its id. When the task has been deleted or
moved since the page was drawn (a shared list: someone else did it), hours-api answers `422 activity_not_allowed`. In My hours the
sentence ("This activity does not belong to the chosen project.") is on the Activity field. `failureOf` routes it to
`fields.activity`, but the fixed variant of `ActivityField` renders no error slot (`hours-ui/src/components/ActivityField.tsx`, the
`mode === 'fixed'` branch ignores `error`), and no other field shows it. **Save does nothing visible**: the dialog stays open, no
alert, no `aria-invalid`, focus on `<body>`. AC-4.2: "refuses it in the same way, with the same message".

- **Failing test (committed):** `hours-ui/src/components/EntryDialog.fixedActivityRefusal.test.tsx`, 2 cases (project, deal) — both fail
  today with "Unable to find an element with the text: This activity does not belong to the chosen project." They pass once the
  sentence is anywhere inside the open dialog with the values kept.
- **Reproduction (live):** as a project manager, project page → Tasks card, note the row of a task; delete that task through
  activities-api (`DELETE /activities/<id>`, or from another tab); click **Record hours on <task>** on the still-drawn row; Duration `1`; Save.
  Observed: `dialogOpen true`, `alerts []`, `aria-invalid` 0, `activeElement BODY`; `POST /time-entries` → 422 `activity_not_allowed`
  (screenshot `.playwright-mcp/qe-hip/fixed-activity-gone.png`).
- **Placements** (every dialog that fixes a task is the same component, so each is ✗; a dialog with no task fixed shows the error on the
  ordinary Activity select and is ✓ by construction, not exercised live):
  project Tasks card row ✗ (reproduced) · My tasks project row ✗ · My tasks pre-sales row with a deal ✗ · CRM Tasks page deal-task row ✗ ·
  CRM deal / company / contact timeline deal-task row ✗ · project header and deal header (no task fixed) ✓ · deal-less task (other work, no task) ✓ (no activity sent).
- Why no test caught it: `EntryDialog.preset.test.tsx` covers `not_on_project`, `not_involved_in_deal` and `not_found` in the fixed dialog, not `activity_not_allowed`.

### D2 — focus falls to `<body>` after a form-level refusal in the dialog · design § Accessibility · owner: **designer** (the stated behaviour is wrong) then **frontend-dev**

design.md S4 *Errors* and § Accessibility: "focus stays on Save after a refusal with no field, **as it does today for `host_unavailable`**".
Not so: after the Save button goes `busy` (disabled) and the save is refused, `document.activeElement` is `BODY`; the next Tab lands on the
dialog's ×. In My hours' own dialog the entity refusals (`not_on_project`, `not_involved_in_deal`, target gone) focus the picker, so
the person keeps their place; in a **fixed** dialog they now have no picker and fall into the same body-focus as `host_unavailable`, which is
**new in this feature** for those three. The alert (`role="alert"`) is announced, so this is a focus-order gap, not a silent failure.

- **Reproduction:** project Tasks card or My tasks, task row of a person who is not on the team (remove them from the team after the task
  was assigned, A7) → Record hours on <task> → Duration `1` → Save. Observed: alert "You are not the project manager or on the team of this
  project.", `activeElement` `BODY`, one Tab → `hours-entry-dialog-close`. Same for `host_unavailable` (POST answered 503 by an intercepted route).
- **Placements:** widget dialog from the project header ✗, deal header ✗, task rows ✗ (one component) · My hours' own dialog, `host_unavailable`
  and "Something went wrong" ✗ (pre-existing, not new: baseline measured, `BODY`) · My hours' own dialog, entity refusals ✓ (focus on the picker).
- Suggested: on a form-level refusal move focus to the form error (it is `role="alert"`, made focusable) or back to Save; fixes all placements in `EntryDialog`.

### D3 — the widget's message is dropped by an unrelated reload of the host list · design S3 / plan G1 · owner: **frontend-dev** (or the **designer**, if the behaviour is accepted)

design S3: "The message goes by ×, by the next save, or by leaving the page." (no timer, G1). In three placements an unrelated write in the
same list reloads it through `loading`, which unmounts every row and the message with it, so the "See in My hours" link disappears
without the person asking. T7 saw this on crm-ui and recorded it as an observation (`decisions.md`); it is wider than crm-ui.

- **Reproduction:** record hours on task A's row (message shows), then "Mark done" on task B in the same list; message count 1 → 0.
- **Placements (each driven live):** crm-ui company timeline ✗ · crm-ui deal timeline ✗ (logging a note drops it) ·
  projects-ui project Tasks card ✗ · crm-ui contact timeline (same `ActivityTimeline`) ✗ by construction, not driven ·
  projects-ui My tasks ✓ (message survives) · crm-ui Tasks page ✓ (survives).
- Severity low: the entry is saved and listed in My hours. Fix noted by T7: give `ActivityTimeline` (and `TasksCard`) a `cacheKey`, or reload without
  going through `loading`.

## Observations (not defects; each with where it was seen)

- **Week at 375 px.** The content area is 220 px (the 64 px rail takes the rest); the row label's floor width (`min-w-44`) fills it, so no day
  figure is visible until the person scrolls the grid sideways, and nothing hints that it scrolls (the region is focusable and labelled, the page
  does not scroll, `.playwright-mcp/qe-hip/week-375.png`, `week-375-scrolled.png`). design G10 accepted this (and measured 263 px). At 1024 px the grid
  region is 10 px wider than its card (879 vs 869), a small sideways scroll. Designer's call: a narrower label or a visible scroll cue.
- **Italian copy.** "1 h registrate su …", "30 min registrate su …": "registrate" (f. pl.) does not agree with "1 h" or with "minuti" (m.). design already asks for a
  native reader before release; this is the first concrete case. Owner: PO / native reader.
- **Week, plain error then Retry works:** focus ends on `<body>` (the Retry button is gone). design S7 does not specify it; only the deal-filter refusal has focus handling.
- **`/hours/?view=week&week=…` has a trailing slash** after the first in-app navigation. Pre-existing pattern: the List's `?period=` does the same.
- **Dev-only Duration error on open** — see "Read this first", item 2.
- **Target size:** week cell buttons are 44×25 and 28×28 px (WCAG 2.2 AA minimum 24×24 holds). Contrast of the figures in the dark theme 5.4:1 (AA).

## The two items the caller asked to look at

- **T11 test that "cannot fail" (`MyHoursPage.weekCells.test.tsx`).** Confirmed for the line it names: it asserted
  `cellButton('project:unknown', …)` is null for a row whose key is `project:p-secret`, so it passed with or without the behaviour. The test as a whole was
  not vacuous: the next line (`/^Record hours on .*(Seminars|not visible to you)/`) would catch a button on those rows. **Fixed (test code):** it now names the real key
  and proves each key with the cell that holds hours (`not.toBeNull()`). Seen to fail when the behaviour is broken: with `preset` given to unreadable rows in
  `weekGrid.ts` the test and one other fail (2 failed), the file restored afterwards (`git diff` empty). Committed in a933b8ba.
- **`ActivityTimeline` reload** — reproduced and widened, D3.

## Acceptance criteria — 41 of 41 checked, 40 pass

`e2e X` = `shell/e2e/hours-in-place.spec.ts` journey X (real stack, nothing stubbed). `unit` = the named test file in the feature. `live` = driven in the browser by me.
`Mxx` = a mutant of the production logic that the named tests killed (see Tests added).

| AC | Evidence | Result |
|---|---|---|
| 1.1 | e2e A (team member offered it first in the header, `aria-haspopup`); live as a project manager; `projects-ui/src/lib/recordHours.test.ts`, `ProjectDetailPage.recordHours.test.tsx`; M1 killed | ✓ |
| 1.2 | e2e A (a salesperson who can read the project: no button, no fallback link, no row button); same unit; M1 | ✓ |
| 1.3 | e2e A (description "Recording hours on the project …", no radio, no picker, Day = today, Duration focused); `RecordHours.test.tsx` | ✓ |
| 2.1 | e2e B (owner); **live: `admin@operai.test` is the estimate's technical contact, not the owner, of deal `cmw92lfvq…` and sees the header button**; `crm-ui/src/lib/recordHours.test.ts`, `DealDetailPage.recordHours.test.tsx`; M2 | ✓ |
| 2.2 | e2e B (the assignee of the deal's task: no header button, one on the row; a reader: none anywhere); unit; M2, M3 | ✓ |
| 2.3 | e2e B (deal as text, Day today, Duration focused); `RecordHours.test.tsx` | ✓ |
| 3.1 | e2e B (assignee on the deal task row; the owner has none on a task that is not theirs), C (project task assignee), A (a reader has none on the Tasks card); live: a **participant** of a deal task gets the row button and nothing else; unit rules, `ActivityItem/ProjectTaskItem/MyTasksPageRow.recordHours.test.tsx`; M3, M4 | ✓ |
| 3.2 | e2e C (project and task as text; no Activity select; entry has `activity.id`); unit | ✓ |
| 3.3 | e2e B (deal and task fixed, entry points at the task); live My tasks pre-sales row | ✓ |
| 3.4 | e2e D (other work, no kind radio, no Activity, Category empty, "not linked to the task" sentence); live My tasks deal-less row | ✓ |
| 3.5 | e2e D (category from the person; the stored entry holds neither the company id nor the task id; `activity` null); M6, H7 | ✓ |
| 3.6 | live: Done tab of the project Tasks card and of My tasks show Record hours on a done row (same last position, same label); unit; M5 | ✓ |
| 4.1 | e2e A (day, 2 h 30, project, work type, note read back from hours-api and listed in My hours with the same values); `RecordHours.test.tsx` | ✓ |
| 4.2 | live: `not_on_project` and `host_unavailable` show My hours' sentences, values kept, no "Choose another" (screenshot `refusal-not-on-project.png`); `EntryDialog.preset.test.tsx` (403s, 404, future day, 30-minute steps). **`activity_not_allowed` is not shown (D1).** | ✗ |
| 4.3 | e2e A: dialog closes, `role="status"` message "2 h 30 recorded on <project>.", still there after 4 s (no timer), link is a shell transition (same-document marker kept), no read of projects-api or activities-api after the save (the listener is proved first), the page's facts and Tasks card text unchanged; H6 killed | ✓ |
| 4.4 | `RecordHours.test.tsx` ("writes only with POST", no PATCH/DELETE, no Edit/Delete); live: the message holds the link and × only | ✓ |
| 4.5 | e2e E (hours remote's origin aborted: project page header + task row, My tasks row, deal page each show "Record hours in My hours" → `/hours`, and the pages work); `extensions.test.tsx` (rejection, 5 s timeout, unknown name); H10b, H10c killed; live screenshots `fallback-*.png` | ✓ |
| 4.6 | `strings.test.ts` parity in four apps, `RecordHours.it.test.tsx`, `WeekView.it.test.tsx`; live Italian pass (`<html lang="it">`: dialog, message, Week, cells) — see the copy observation | ✓ |
| 5.1 | e2e F (`/hours` is the List with `List | Week`, List selected); `MyHoursPage.week.test.tsx` | ✓ |
| 5.2 | e2e F (`/hours?view=week` opens the Week, current week); `MyHoursPage.week.test.tsx` | ✓ |
| 5.3 | e2e F (9 header cells: row + 7 days + total; Today marked); `week.test.ts`; H5b | ✓ |
| 5.4 | e2e F (heading = this week); `MyHoursPage.week.test.tsx` | ✓ |
| 5.5 | e2e F (previous week; This week `aria-disabled` on the current one); live next week → "This week has not started"; garbage, impossible and pre-2000 `week=` → this week, any day → its Monday | ✓ |
| 5.6 | e2e F (rows: two projects, one other work); live (+ deal, meeting, retired category); `weekGrid.test.ts` | ✓ |
| 5.7 | `weekGrid.test.ts` (meeting linked to a visible deal stays on the meeting's row); H9 killed; live: the meeting row shows, the deal row unchanged | ✓ |
| 5.8 | e2e F (projects by name, other work last); `weekGrid.test.ts`; H4 killed | ✓ |
| 5.9 | e2e F (a two-entry cell reads 3 h = 2 h + 1 h; empty cells are plus buttons) | ✓ |
| 5.10 | e2e F (every day total, row total and the grand total, exact, after each write); out-of-band sum of the API equals the grid; H3, E2 killed | ✓ |
| 5.11 | `WeekView.test.tsx` (a 42 h and a 1 h week, same markup); live: no mark, no target on any state | ✓ |
| 5.12 | e2e F (empty past cell → dialog with the day and the row's project, Duration focused); `MyHoursPage.weekCells.test.tsx` | ✓ |
| 5.13 | e2e F (kind radio checked, picker holds the project, Day enabled); `weekCells` ("a save after changing the day and the target posts the changed values") | ✓ |
| 5.14 | e2e F (the current week: tomorrow's and Sunday's cells have no control); H1 killed | ✓ |
| 5.15 | e2e F (Monday's cell lists both entries with their note, 2 Edit buttons, "2 entries, 3 h"; Close returns focus to the cell); `WeekCellDialog.test.tsx` | ✓ |
| 5.16 | e2e F (Edit → PATCH, API holds 210 min, cell dialog stays, focus back on that entry's Edit) | ✓ |
| 5.17 | e2e F (Cancel sends nothing, API still holds the entry; Confirm deletes, dialog closes, focus on the now-empty cell) | ✓ |
| 5.18 | live (cell dialog → Add hours: Day = the cell's, kind and picker = the row, Duration focused, Cancel returns focus to Add hours); `WeekCellDialog.test.tsx` | ✓ |
| 5.19 | e2e F (Record hours on a project with no hours that week → its row appears, in order, totals updated) | ✓ |
| 5.20 | e2e F (record, edit, delete: cell, row, day, week figures follow; a same-document marker survives, no reload); H8 killed | ✓ |
| 5.21 | `MyHoursPage.week.test.tsx` (the read carries all five filters); live category filter narrows the Week | ✓ |
| 5.22 | `MyHoursPage.week.test.tsx` (picked project and deal); live: category kept List → Week → List, Period hidden in the Week and back in the List | ✓ |
| 5.23 | live as a person who lost `projects:access` (rows "Not visible to you", their cells open, the standing note shown); `weekGrid.test.ts`, `WeekView.test.tsx` | ✓ |
| 5.24 | live: the retired category's row and the unreadable rows have no plus on empty cells and no Add hours in the cell dialog, Edit and Delete stay; `weekGrid.test.ts`; H2 killed; the T11 assertion fixed | ✓ |

## What was rendered and driven (evidence on disk, git-ignored: `.playwright-mcp/qe-hip/`)

- Project header with a 123-character title, manager (Record hours + Start project, Put on hold, Cancel project), 1440 / 1024 / 375 px, with the success message: `project-1440.png`,
  `project-message-1440.png`, `project-message-1024.png`, `project-message-375.png` — the row wraps under the title, the message grows beside the button; at 375 it is a full-width banner,
  × on a second line; no horizontal page scroll at any width.
- Deal header (Record hours, Edit, Move to stage): `deal-header-1440.png`, `-1024.png`, `-375.png`, with message `deal-message-1440.png`, `deal-message-375.png`.
- Task rows with the message at 375 px (project Tasks card `taskrow-message-375.png`, deal timeline `dealrow-message-375.png`); the message is the last item on its own line, nothing moves; fixed dialogs `taskrow-dialog-375.png`, `dealrow-dialog-375.png`, `project-dialog-1440.png`.
- Host fallback: `fallback-project-1440.png` (header link beside the manage buttons; row link), `fallback-mytasks-375.png`.
- My hours List and Week (wide layout vs default width): `myhours-list-1440.png`, `week-1440.png`, `week-1024.png`, `week-375.png`, `week-375-scrolled.png`, dark theme `week-dark-1440.png`, `week-celldialog-dark.png`,
  Italian `week-it-1440.png`, `project-dialog-it.png`, future week `week-future.png`, read failure `week-error.png` (alert, Retry, no partial grid, navigator kept), unreadable rows `week-hidden-1440.png`, retired row `week-retired-dialog.png`.
- Keyboard, real key events: focus a cell → Enter opens the cell dialog (focus on the first Edit, Tab cycles inside, Escape returns to the cell); empty cell → Enter → Duration focused → type, Enter saves, focus lands on the cell; Delete → confirmation (focus on Cancel; Escape cancels and returns to Delete); Confirm → dialog closes, focus on the emptied cell.
- Everyone's hours has no List | Week switch (WA4).
- Console during all of it: only the notify-api connection refusals (environment), the injected failures, and the dev StrictMode flash; no React warning.

## Tests added or changed

- `shell/e2e/hours-in-place.spec.ts` (new): journeys A–F, per-run `hip-*@operai.test` people, entries deleted in `afterAll`, the journeys' tasks deleted too. Strength: journey A's negative checks have a positive control (the member's page, in the same test);
  the "no host read after the save" instrument is proved against a real request before it is trusted; mutants run against the live stack — projects rule made permissive (A fails), the fixed task dropped from the preset (C fails), the
  day totals made wrong for a two-entry cell (F fails; the first version of F had no two-entry cell and let this mutant survive, so a two-entry cell was added).
- `shell/e2e/helpers/hoursFixtures.ts`: the `hip` persona prefix next to `hrs` (the role-change guard still refuses anyone else), `hoursAdmin(runId, prefix)`.
- `hours-ui/src/pages/MyHoursPage.weekCells.test.tsx`: the vacuous assertion fixed (above).
- `hours-ui/src/components/EntryDialog.fixedActivityRefusal.test.tsx` (new, **failing on purpose**, D1).
- Mutation checks run on the production logic, each restored with `git checkout` (tree clean afterwards): host rules M1–M6 (project, deal, task rules, done task, deal-less task link), Week and widget H1–H4, H5b, H6–H9 (future cell control, unreadable row control, day totals, row order, week start, 3 s auto-dismiss, activity on other work, stale query outcome, meeting counted on its deal), shell H10b–H10c (wrong loader, no timeout fallback) — 17 killed by unit tests; live-stack e2e E1 (anyone offered on a project), E2 (wrong day totals), E3 (task dropped from the preset) — 3 killed. Not counted: H5 (my search string did not match, nothing mutated), the first H10 and E4 (my mutations changed nothing).

## Environment faults (not defects, no fix round)

- **`shell/src/router.inventory.test.tsx` "/devices … shows RemoteMount's error state" failed once** (a 1 s `findBy` timeout) in the shell run at a933b8ba while I was
  running a secret scan, three `mise` checks and a browser against the same machine. It passes 3 of 3 in isolation and the full shell suite passes 669/669 on a quiet machine,
  the same commit. It is an inventory route test the feature does not touch.
- notify-api is not running (the browser console shows `ERR_CONNECTION_REFUSED` on `:8081`); unrelated to this feature.
- **Data left in the dev databases** (no delete route exists for them, the repo's other e2e specs leave the same): projects (`Hip project …`, `Hip F alpha|beta|gamma …`, plus 3 `QE …` projects),
  companies (`Hip company …`, one per run of the spec; `QE company …`) and deals, and one retired time category (`QE retired …`, a category is retired, never deleted).
  Deleted: every time entry, every user, the meeting, and the tasks of the seed run; the journeys of the final spec delete their own tasks. Pre-sales tasks of the earlier spec runs
  (company and deal tasks) remain, because their author is deleted and the real admin may not delete them (403).

## Blocked

- **Screen-reader readback (NVDA on Windows, VoiceOver on macOS and iOS).** Needs a person with those tools: open a project page as a team member, record hours, and listen for the message
  "2 h 30 recorded on <name>. See in My hours"; open My hours → Week and read a filled cell ("2 h on <row>, Wednesday 11 November 2026, 1 entry"). The caller re-runs this row only.

## Recommendations

- Owasp-reviewer pass: **not needed again** — T14 is PASS and the production code has not changed since it (only tests and docs). Re-run only if the D1/D2 fix changes how a save is sent.
- After D1–D3 are fixed: `hours-ui` unit tests must show 2012/2012 and `cd shell && pnpm e2e hours-in-place.spec.ts hours.spec.ts hours-owners.spec.ts` 16/16; the two fixes are in
  `ActivityField`/`EntryDialog` (D1, D2) and the two lists' reload (D3); add a component test for D2 (focus after a form-level refusal) and D3 with the fix.
