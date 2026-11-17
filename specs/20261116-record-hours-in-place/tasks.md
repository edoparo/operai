---
spec: 20261116
generated: 2026-11-17
synced: 2026-11-17
---

# Tasks: Record hours in place — from the project, the deal and the task, and a week view of My hours

Contracts are `plan.md` (approved 2026-11-16, first amendment 2026-11-17 after design: G1, G3, G4, G5, G7, D12, D13):
Components, Decisions 1–7, Sequences, API contracts (`hours.recordHours`, `hours/RecordHours`, `EntryDialog`
`preset`/`fixed`/`focus`, My hours' address, `weekGrid`), the Test strategy rows each `done when:` below quotes, Risks
R1–R10 and Security. Screens, flows, states, copy (en + it) and the component inventory are `design.md` (F1–F6, S1–S9;
no NEW or EXTENDED `@operai/ui` component, so plan R4 never triggers). Decisions with rejected alternatives are ADR
20261116-week-view-sums-a-complete-read-in-the-browser and ADR 20261116-record-hours-widget-through-the-host-extension-seam.
hours-api, projects-api, crm-api and activities-api are not changed by any task.

Test commands: hours-ui, projects-ui, crm-ui `pnpm lint && pnpm build && pnpm test`; shell the same with
`NODE_OPTIONS=--no-webstorage pnpm test`; e2e `cd shell && pnpm e2e <spec>` with the stack up (`mise run dev`).

## hours-ui — the dialog and the widget

- [ ] T1: [FE] hours-ui `EntryDialog` recording mode takes `preset`, `fixed` and `focus`; `ActivityField` `lock: 'hidden' | 'fixed'` — refs: AC-1.3, AC-2.3, AC-3.2, AC-3.3, AC-3.4, AC-4.2, AC-5.12, AC-5.13 — deps: none
  - touch: `hours-ui/src/components/EntryDialog*`, `hours-ui/src/components/ActivityField*`, `hours-ui/src/strings/entry.ts`, `hours-ui/src/strings/activity.ts`, `hours-ui/src/test-support/*`
  - done when: `cd hours-ui && pnpm lint && pnpm build && pnpm test` passes, every existing EntryDialog / ActivityField test unchanged (R9), and new `EntryDialog.preset.test.tsx` shows: `preset` project + `fixed` → the project is read-only text and the dialog's description (design S4), no "What was it on" radio and no picker in the DOM, Day = today, focus on Duration with `focus: 'duration'`; a preset activity + `fixed` → `ActivityField lock="fixed"` shows the task's subject with its own hint and makes no activities read; `preset` none + `fixed` → Other work fixed, category select with nothing chosen (A3); `preset` without `fixed` → day and target set, radio and picker editable, a changed target is what the POST carries (AC-5.13); with `fixed`, a 422 `not_on_project`, a 422 `not_involved_in_deal` and a 404 land in the form-level error, the first two with My hours' sentence and the 404 as `entry.errors.targetGoneFixed` (D13); `targetName` empty → "this project" / "this deal"; `lock="hidden"` is today's "not visible" variant unchanged; every new string in en and it

- [ ] T2: [FE] hours-ui `./RecordHours` widget and its expose — refs: AC-1.3, AC-2.3, AC-3.2, AC-3.3, AC-3.4, AC-3.5, AC-4.1, AC-4.2, AC-4.3, AC-4.4, AC-4.6 — deps: T1
  - touch: `hours-ui/src/RecordHours*`, `hours-ui/src/strings/recordHours.ts`, `hours-ui/src/strings.ts`, `hours-ui/vite.config.ts`, `hours-ui/src/federation/exposes.test.ts`, `hours-ui/src/test-support/*`
  - done when: `cd hours-ui && pnpm lint && pnpm build && pnpm test` passes, including `RecordHours.test.tsx` and `RecordHours.it.test.tsx`: the button (`placement` page → `secondary`, row → `secondary sm`; accessible name "Record hours on <task>" when `activityName` is set, also with `on: 'none'`, G3) opens the dialog only after `getTimeLists` answers, with target (and task) fixed, Day today and focus on Duration (AC-1.3, 2.3, 3.2–3.4); the POST body equals `toInput` of the same values (AC-4.1) and for `on: 'none'` is `{on:{type:'none',categoryId}}` with no `activityId` (AC-3.5); `not_on_project`, `invalid_minutes`, a future day and a 503 `host_unavailable` show My hours' strings, values kept (AC-4.2); after a 201 the dialog closes and a `role="status"` message says "2 h 30 recorded on <name>." (or on other work: <category>) with "See in My hours" calling `navigateSuite('/hours')`, still present after 10 s, gone on × with focus back on Record hours (AC-4.3, G1); no Edit, Delete, PATCH or DELETE ever (AC-4.4); an invalid prop set (plan § `hours/RecordHours` valid sets) throws; `exposes.test.ts` lists exactly `./App`, `./RecordHours`, `./version`; after `pnpm build`, no file the `./RecordHours` entry loads statically names `exceljs` (R3: `rg -l exceljs dist/` lists only the export's lazy chunk)

## shell — the seam

- [ ] T3: [FE] shell extension `hours.recordHours`: registry, loader, ambient type, test stub — refs: AC-4.5, AC-1.1, AC-2.1, AC-3.1 — deps: none
  - touch: `shell/src/lib/extensions.tsx`, `shell/src/lib/extensions.test.tsx`, `shell/src/federation/remotes.d.ts`, `shell/vitest.config.ts`, `shell/src/federation/__stubs__/*`, `shell/src/lib/noHardcodedStrings.test.ts`, `shell/src/federation/remoteVersionSpecifiers.test.ts`
  - done when: `cd shell && pnpm lint && pnpm build && NODE_OPTIONS=--no-webstorage pnpm test` passes, including: `ExtensionProps['hours.recordHours']` has exactly the six string members of plan § "The shell's extension"; `LOADERS['hours.recordHours']` imports `hours/RecordHours` (aliased to a stub in tests) and renders it with the props; a rejected import, a timeout (5 s) and a render throw each show the host's `fallback` (`extensions.test.tsx`); `remotes.d.ts` declares `hours/RecordHours` and the specifier test pins it; the dotted name is allowlisted in the hardcoded-strings test

## projects-ui — project page and task rows

- [ ] T4: [FE] projects-ui seam wrapper, the "who" rule and Record hours on the project page — refs: AC-1.1, AC-1.2, AC-4.5, AC-4.6 — deps: none
  - touch: `projects-ui/src/federation/remotes.d.ts`, `projects-ui/vitest.config.ts`, `projects-ui/src/federation/__stubs__/*`, `projects-ui/src/lib/recordHours*`, `projects-ui/src/components/RecordHoursAction*`, `projects-ui/src/pages/ProjectDetailPage*`, `projects-ui/src/strings*`
  - done when: `cd projects-ui && pnpm lint && pnpm build && pnpm test` passes, including: `recordHours.test.ts` — `mayRecordOnProject` true for the project manager and a team member, false for a reader, for `projectManager: null` (awaiting) and for `me: null`; `recordHoursPropsOf(project)` takes id and name from the same object (R10); `ProjectDetailPage.recordHours.test.tsx` — `HostExtension` called with `{on:'project', targetId, targetName, activityId:'', activityName:'', placement:'page'}` as the first header action (design S1) for a team member and never for a reader; with the `shell/extensions` stub rendering `fallback`, the page works and shows the link to `/hours` (AC-4.5); with `shell/extensions` failing to import, the page still renders (the wrapper's own boundary); the link's copy in en and it with parity and no hardcoded strings

- [ ] T5: [FE] projects-ui Record hours on task rows: the project's Tasks card and My tasks — refs: AC-3.1, AC-3.2, AC-3.3, AC-3.4, AC-3.6 — deps: T4
  - touch: `projects-ui/src/lib/recordHours*`, `projects-ui/src/components/ProjectTaskItem*`, `projects-ui/src/components/TasksCard*`, `projects-ui/src/pages/MyTasksPageRow*`, `projects-ui/src/pages/MyTasksPage*`, `projects-ui/src/strings*`
  - done when: `cd projects-ui && pnpm lint && pnpm build && pnpm test` passes, including: `mayRecordOnTask` true for the assignee and a participant, false for the author alone and anyone else, unchanged by `completedAt` (AC-3.6); `recordHoursPropsOf` gives an operational task → project + task, a pre-sales task with a deal → deal + task, a pre-sales task with no deal → `{on:'none', targetId:'', targetName:'', activityId:''}` with `activityName` = its subject (G3); `ProjectTaskItem.recordHours.test.tsx` and `MyTasksPageRow.recordHours.test.tsx` — the action is the last item of the row's actions (design S2) on the rows the rule allows, done rows included, and absent otherwise; a list of 100 rows the person may record on imports `shell/extensions` once (R1)

## crm-ui — deal page and task rows

- [ ] T6: [FE] crm-ui seam type, the "who" rule and Record hours on the deal page — refs: AC-2.1, AC-2.2, AC-4.5, AC-4.6 — deps: none
  - touch: `crm-ui/src/federation/remotes.d.ts`, `crm-ui/src/federation/__stubs__/*`, `crm-ui/src/lib/recordHours*`, `crm-ui/src/components/RecordHoursAction*`, `crm-ui/src/pages/DealDetailPage*`, `crm-ui/src/strings*`
  - done when: `cd crm-ui && pnpm lint && pnpm build && pnpm test` passes, including: `recordHours.test.ts` — `mayRecordOnDeal` true for the owner and the technical contact (`estimate.technical.id`), false for a reader, for a task assignee who is neither, for `estimate: null` and for `me: null`; props id and title from the same deal (R10); `DealDetailPage.recordHours.test.tsx` — `HostExtension` called with `{on:'deal', …, placement:'page'}` as the first header action for the owner, also when the person cannot manage the deal (the header becomes a fragment, design S1), never for a reader; the stub's fallback link to `/hours` shows and the page works (AC-4.5); `MeetingsSection` tests unchanged; copy in en and it

- [ ] T7: [FE] crm-ui Record hours on task rows: the Tasks page and every activity timeline (deal, company, contact) — refs: AC-3.1, AC-3.3, AC-3.4, AC-3.5, AC-3.6 — deps: T6
  - touch: `crm-ui/src/lib/recordHours*`, `crm-ui/src/components/ActivityItem*`, `crm-ui/src/components/ActivityTimeline*`, `crm-ui/src/pages/TasksPage*`, `crm-ui/src/strings*`
  - done when: `cd crm-ui && pnpm lint && pnpm build && pnpm test` passes, including: `mayRecordOnTask` true for the assignee and a participant, false for the author alone and anyone else, unchanged by `completedAt`; `recordHoursPropsOf(activity)` gives a task with a deal → `{on:'deal', targetId: deal.id, targetName: deal.title ?? '', activityId, activityName}`, a task with no deal → `on:'none'` with no ids and `activityName` = subject (AC-3.4, AC-3.5's host half); `ActivityItem.recordHours.test.tsx` — the action follows the author's Edit/Delete in the row's actions for an allowed task, done included, and is absent on non-task activities and for others; `CompanyDetailPage.meetings.test.tsx` still passes (it asserts the meetings extension is never called there)

## hours-ui — the Week view

- [ ] T8: [FE] hours-ui week model: `lib/week.ts` and the pure `lib/weekGrid.ts` — refs: AC-5.3, AC-5.4, AC-5.6, AC-5.7, AC-5.8, AC-5.9, AC-5.10, AC-5.23, AC-5.24 — deps: none
  - touch: `hours-ui/src/lib/week*`, `hours-ui/src/lib/weekGrid*`
  - done when: `cd hours-ui && pnpm lint && pnpm build && pnpm test` passes, including `week.test.ts` (`weekDays` = 7, Monday first; `readWeekParam({}, today)` = today's Monday; a real day → its Monday; garbage → this week; `shiftWeek` ±1 across a month and a year) and `weekGrid.test.ts`: two entries on one project on two days → one row, two cells; a project, a deal, a meeting and two categories → five rows; a meeting linked to a visible deal stays on the meeting's row (AC-5.7); order projects, deals, meetings, other work, by name inside, unnamed after named (AC-5.8); Σ cells = row, Σ rows = `totalMinutes` = Σ `dayMinutes`, each entry in exactly one cell (AC-5.10); a `hidden` entry → `name: null`; `preset: null` for an unreadable row and for a retired category's row (AC-5.24, D12); an entry outside the week throws; an own entry with no id → the kind's `unknown` row

- [ ] T9: [FE] hours-ui `WeekView`: the grid card, totals, states and the navigator, presentational — refs: AC-5.3, AC-5.5, AC-5.9, AC-5.10, AC-5.11, AC-5.14, AC-5.23, AC-4.6 — deps: T8
  - touch: `hours-ui/src/components/WeekView*`, `hours-ui/src/components/WeekNavigator*`, `hours-ui/src/strings/week.ts`, `hours-ui/src/strings.ts`
  - done when: `cd hours-ui && pnpm lint && pnpm build && pnpm test` passes, including `WeekView.test.tsx` over a `WeekGrid`: a table (design S7: table semantics, not `role="grid"`) with seven day columns Monday–Sunday, today marked, a row total column, a day totals row (an en dash for a day with nothing) and the week total; a cell's figure is `formatDuration(…, {style:'short'})`; an empty cell of today or earlier on a row with a `preset` is a button with the accessible name of design S7, a future day's cells and the empty cells of a `preset: null` row are not controls (AC-5.14); an unreadable row reads as the list reads it (`rowName`, AC-5.23); the same markup for a 42 h week and a 1 h week, no target, mark or comparison (AC-5.11); loading (skeleton), empty week, filtered-empty and error states of design S7; the navigator's previous / next / this week call back with the shifted Monday and its label is two `formatDate`s with an en dash (AC-5.5); every string in en and it with parity

- [ ] T10: [FE] hours-ui My hours: the List | Week switch, the address, the filters in Week, the week read and the wide layout — refs: AC-5.1, AC-5.2, AC-5.4, AC-5.5, AC-5.21, AC-5.22, AC-4.6 — deps: T9
  - touch: `hours-ui/src/pages/MyHoursPage*`, `hours-ui/src/components/HoursFilters*`, `hours-ui/src/components/HoursFiltersState*`, `hours-ui/src/components/HoursShell*`, `hours-ui/src/components/ViewSwitch*`, `hours-ui/src/strings/week.ts`, `hours-ui/src/strings/myHours.ts`, `hours-ui/src/router*`
  - done when: `cd hours-ui && pnpm lint && pnpm build && pnpm test` passes, every existing MyHoursPage test unchanged, and new `MyHoursPage.week.test.tsx` shows: `/hours` → the List with a `Tabs` switch, List current (AC-5.1); `/hours?view=week` → the Week (AC-5.2) and `HoursShell` at `width="wide"`, `default` on the List (C1); the week read is `readAllEntries` with `whose=mine`, `from` = Monday, `to` = Sunday of today's week (AC-5.4) and, after previous / next / this week, of the shifted week with `week` in the URL (AC-5.5); with category, work type, recorded on, project and deal set the read carries `categoryId`, `workTypeId`, `target`, `projectId`, `dealId` (AC-5.21); List → Week → List keeps `category`, `workType`, `target` in the URL and the picked project and deal chosen, and keeps `period` (AC-5.22); Period, Totals, Entries and Export are absent in the Week (WA5, WA10) and "Clear filters" ignores `period`, `from`, `to`, `group` there (G5); a 503 `host_unavailable` under a deal filter shows `DealFilterUnavailable`, any other failed page an error with Retry and no grid; `HoursBanners` from the walk's `unavailable`

- [ ] T11: [FE] hours-ui Week: record on an empty cell, and the figures and focus after any write — refs: AC-5.12, AC-5.13, AC-5.14, AC-5.19, AC-5.20 — deps: T1, T10
  - touch: `hours-ui/src/components/WeekView*`, `hours-ui/src/pages/MyHoursPage*`, `hours-ui/src/strings/week.ts`, `hours-ui/src/test-support/*`
  - done when: `cd hours-ui && pnpm lint && pnpm build && pnpm test` passes, including `MyHoursPage.weekCells.test.tsx`: an empty cell of today / yesterday opens `EntryDialog` with that day and the row's target, focus on Duration (AC-5.12, G7), and a save after changing day and target posts the changed values (AC-5.13); tomorrow's cells and a future week offer nothing (AC-5.14); after the save the week is read again and the cell, row, day and week figures change without a reload (AC-5.20), and focus returns to the cell, or to the Week card's heading when the save moved the entry out of it; recording with the page's Record hours on a target absent from the week adds its row (AC-5.19); a save on a day outside the week shown says so (design S7)

- [ ] T12: [FE] hours-ui Week: a cell's entries — `WeekCellDialog` with the list's `EntryRow`, Edit, Delete, Add hours — refs: AC-5.15, AC-5.16, AC-5.17, AC-5.18, AC-5.20, AC-5.24 — deps: T11
  - touch: `hours-ui/src/components/WeekCellDialog*`, `hours-ui/src/components/EntryRow*`, `hours-ui/src/components/EntryDayList*`, `hours-ui/src/components/WeekView*`, `hours-ui/src/pages/MyHoursPage*`, `hours-ui/src/strings/week.ts`, `hours-ui/src/test-support/*`
  - done when: `cd hours-ui && pnpm lint && pnpm build && pnpm test` passes, every existing EntryDayList test unchanged (the row moved to `EntryRow`), and `WeekCellDialog.test.tsx` / `MyHoursPage.weekCells.test.tsx` show: a cell with hours opens the cell dialog titled with row and day, listing its entries through `EntryRow` with the list's text (AC-5.15); Edit → `EntryDialog` on the entry over the cell dialog → PATCH with the changed members only, focus back on that entry's Edit (AC-5.16); Delete → `DeleteEntryDialog`, DELETE only after Confirm, Cancel sends nothing (AC-5.17); Add hours → `EntryDialog` with day and row, focus on Duration (AC-5.18); Add hours absent on an unreadable row and on a retired category's row, whose entries still offer Edit and Delete (AC-5.24, D12); after each write the figures follow (AC-5.20) and deleting a cell's last entry closes the dialog with focus on the now-empty cell, or the card heading when the row is gone (design S8)

## End to end, security, docs, close

- [ ] T13: [QE] e2e `shell/e2e/hours-in-place.spec.ts`: journeys A–F of plan § Test strategy — refs: AC-1.1, AC-1.2, AC-2.1, AC-2.2, AC-3.1, AC-3.2, AC-3.4, AC-3.5, AC-4.1, AC-4.3, AC-4.5, AC-5.12, AC-5.16, AC-5.19, AC-5.20 — deps: T2, T3, T5, T7, T12
  - touch: `shell/e2e/hours-in-place.spec.ts`, `shell/e2e/helpers/hoursOwnersFixtures.ts`, `shell/e2e/helpers/hoursFixtures.ts`
  - done when: `cd shell && pnpm e2e hours-in-place.spec.ts` passes with the stack up, nothing stubbed, per-run `hip-*@operai.test` people and their entries deleted at the end, covering: A a team member records 2 h 30 with a work type and a note from the project page, the message and its link open My hours, which lists the entry with the same values, and a salesperson reading the project sees no Record hours (AC-1.1, 1.2, 4.1, 4.3); B the deal's owner records from the header, the assignee of the deal's task sees none there and one on their task's row (AC-2.1, 2.2, 3.1); C a project task's assignee records from the Tasks card row and the entry points at the task (AC-3.1, 3.2); D a CRM company task with no deal records other work with a category and no task (AC-3.4, 3.5); E with the hours remote's `remoteEntry.js` aborted the project page, the deal page and My tasks load and show the My hours link (AC-4.5, the `remote-failure.spec.ts` pattern); F the Week shows entries on two projects over three days with the right cells and totals, an empty past cell records, a cell's Edit changes an entry, and the figures follow without a reload (AC-5.12, 5.16, 5.19, 5.20); and `pnpm e2e hours.spec.ts hours-owners.spec.ts` still passes 10/10

- [ ] T14: [QE] owasp-reviewer pass (plan § Security: YES), in parallel with T13 — refs: AC-4.2, AC-4.4, AC-5.21 — deps: T2, T3, T5, T7, T12
  - touch: `specs/20261116-record-hours-in-place/owasp-report.md`
  - done when: `specs/20261116-record-hours-in-place/owasp-report.md` records verdict PASS over every surface plan § Security names — the `./RecordHours` widget (writes only `POST /time-entries` as the caller; a forged `targetId` meets hours-api's owner check; names rendered as text; the link a fixed path through `navigateSuite`), the `hours.recordHours` props (only what the host already shows; nothing flows back), the hosts' rule as UX only, the Week's `whose=mine` read and its URL (a day and the existing filter ids, no note or name), no new origin — with every finding fixed and re-checked

- [ ] T15: [DOC] AGENTS.md, the deploy order and the changesets — refs: AC-4.5, AC-5.1 — deps: T2, T3, T5, T7, T12
  - touch: `AGENTS.md`, `infra/README.md`, `.changeset/*`
  - done when: `mise run changeset:check` passes with one changeset per changed app (hours-ui, shell, projects-ui, crm-ui; minor); AGENTS.md says hours-ui exposes `./RecordHours`, the shell's `hours.recordHours` extension and its hosts (the project and deal pages, the task rows), projects-ui's first use of `shell/extensions`, and My hours' Week view (`/hours?view=week`); `infra/README.md` § Time tracking adds the deploy order hours-ui → shell → projects-ui and crm-ui (plan R2), noting that any other order shows the host's My hours link; `mise run env:doctor` still passes

- [ ] T16: Close: all gates green (typecheck, lint, unit in hours-ui, shell, projects-ui, crm-ui, operai-ui; e2e; `env:doctor`, `shared:check`, `changeset:check`), owasp PASS (T14), QE PASS, eval, spec status → done via `/wellforge:done` — refs: all — deps: T13, T14, T15
  - touch: `specs/20261116-record-hours-in-place/qe-report.md`, `specs/20261116-record-hours-in-place/eval-report.md`, `specs/20261116-record-hours-in-place/spec.md`
  - done when: `/wellforge:done 20261116-record-hours-in-place` accepts the transition

## Coverage

| AC | Tasks |
|---|---|
| AC-1.1 | T3, T4, T13 |
| AC-1.2 | T4, T13 |
| AC-1.3 | T1, T2 |
| AC-2.1 | T3, T6, T13 |
| AC-2.2 | T6, T13 |
| AC-2.3 | T1, T2 |
| AC-3.1 | T3, T5, T7, T13 |
| AC-3.2 | T1, T2, T5, T13 |
| AC-3.3 | T1, T2, T5, T7 |
| AC-3.4 | T1, T2, T5, T7, T13 |
| AC-3.5 | T2, T7, T13 |
| AC-3.6 | T5, T7 |
| AC-4.1 | T2, T13 |
| AC-4.2 | T1, T2, T14 |
| AC-4.3 | T2, T13 |
| AC-4.4 | T2, T14 |
| AC-4.5 | T3, T4, T6, T13, T15 |
| AC-4.6 | T2, T4, T6, T9, T10 |
| AC-5.1, 5.2 | T10 (5.1 also T15) |
| AC-5.3 | T8, T9 |
| AC-5.4 | T8, T10 |
| AC-5.5 | T9, T10 |
| AC-5.6–5.8 | T8 |
| AC-5.9, 5.10 | T8, T9 |
| AC-5.11 | T9 |
| AC-5.12 | T1, T11, T13 |
| AC-5.13 | T1, T11 |
| AC-5.14 | T9, T11 |
| AC-5.15, 5.17, 5.18 | T12 |
| AC-5.16 | T12, T13 |
| AC-5.19 | T11, T13 |
| AC-5.20 | T11, T12, T13 |
| AC-5.21 | T10, T14 |
| AC-5.22 | T10 |
| AC-5.23 | T8, T9 |
| AC-5.24 | T8, T12 |

Every task serves at least one AC; none was added that no AC asks for.

## Scheduling (effective graph: `deps:` ∪ `touch:` overlap)

- Batch 1, in parallel: T1, T3, T4, T6, T8 (no shared path).
- Batch 2: T2 (after T1), T5 (after T4), T7 (after T6), T9 (after T8). **Induced edge:** T2 and T9 both add to the
  `hours-ui/src/strings.ts` barrel — kept separate, so they run one after the other; T2 and T1 also share
  `hours-ui/src/test-support/*` (already ordered by `deps:`).
- Batch 3: T10 (after T9). Batch 4: T11 (after T1, T10), then T12 (after T11; both share `WeekView*`,
  `MyHoursPage*`, `strings/week.ts` with T9/T10, already ordered; both share `hours-ui/src/test-support/*` with T2, an
  induced edge if T2 is still running).
- Batch 5, in parallel: T13, T14, T15. Then T16.
