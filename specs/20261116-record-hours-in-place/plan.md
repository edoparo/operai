---
spec: 20261116
status: approved
approved: 2026-11-16
---

# Plan: Record hours in place — from the project, the deal and the task, and a week view of My hours

Spec: `spec.md` (approved 2026-11-16, amended and re-approved the same day). Decision ledger: `ledger.md`.
Depends on specs/20261112-time-tracking (hours-api, hours-ui, `EntryDialog`); nothing here changes hours-api.

## Architecture

### Shape in one paragraph

Two pieces, both owned by hours-ui. **(1) Record hours on other tools' pages** is a new federated module of
hours-ui, `./RecordHours`: a button that opens My hours' own `EntryDialog` with the target (and the task) set and
fixed, records the entry as the person through the unchanged `POST /time-entries`, and says what it recorded with
a link to My hours. Hosts embed it through the shell's existing `HostExtension` seam under the new name
`hours.recordHours` (ADR 20261104-host-extension-federated-panel-through-the-shell), with their own fallback — a
link to My hours — when hours-ui cannot be loaded (AC-4.5). Whether a page offers it at all is decided by the host
from data it already holds and the person's id (D4): the project's manager and team, the deal's owner and
technical contact, a task's assignee and participants. Hours-api still decides every save, fail closed (ADR
20261112-time-bookability-asked-of-owners-meeting-hosts-system-route). **(2) The Week view** is a second view of
My hours on the same page (`/hours?view=week`), built from ONE complete, all-or-nothing read of the person's
entries of that week (`readAllEntries`, the export's walk) and folded into rows × days by a pure function; its
cells open the same `EntryDialog` (preset, not fixed) or the list of their entries with the list's Edit and
Delete. No hours-api route, schema or permission changes.

### Components

| Where | What changes | Why |
|---|---|---|
| `hours-ui/src/components/EntryDialog.tsx`, `EntryDialogModel.ts` | Recording mode gains `preset` (day, target, task), `fixed` (target kind, entity and task shown read-only) and `focus` (`day` default, or `duration`). `emptyValues` → `presetValues(today, preset)`. Editing mode unchanged. | D3, AC-1.3, AC-2.3, AC-3.2–3.4; AC-5.12, AC-5.13, AC-5.18 (preset, not fixed — WA6). The design's seam ("prop-driven, initial values in", time-tracking design § Seams). |
| `hours-ui/src/components/ActivityField.tsx` | `locked?: boolean` becomes `lock?: 'hidden' \| 'fixed'`: `hidden` is today's "not visible" variant, `fixed` shows the task the page chose with its own words. | AC-3.2, AC-3.3: the task is set and not changeable. |
| `hours-ui/src/RecordHours.tsx` (new, exposed `./RecordHours`) | The widget: button → lists read on open (`getTimeLists`) → `EntryDialog` with `preset` + `fixed` + `focus: 'duration'` → `createEntry` → a status message "2 h 30 recorded on <name> · See in My hours" (`navigateSuite('/hours')`). Never edits, never deletes. | US-1–US-4. |
| `hours-ui/vite.config.ts`, `src/federation/exposes.test.ts` | `exposes['./RecordHours']`; the "exposes nothing else" test lists three modules. | The seam. |
| `hours-ui/src/lib/week.ts` (new) | `mondayOf(day)`, `weekDays(monday)` (7, Mon–Sun), `readWeekParam(search, today)` (a real day → its Monday; anything else → this week), `shiftWeek(monday, ±1)`. | AC-5.3–5.5, WA1, WA5. |
| `hours-ui/src/lib/weekGrid.ts` (new, pure) | `weekGrid(entries, monday) → WeekGrid` (contract below): rows, cells, row/day/week totals, order. | AC-5.6–5.10, 5.23, 5.24. |
| `hours-ui/src/components/EntryRow.tsx` (new, moved out of `EntryDayList.tsx`) | The list's entry row, exported unchanged so the cell dialog shows exactly what the list shows. `EntryDayList` imports it. | AC-5.15 ("each with what My hours' list shows"). |
| `hours-ui/src/components/WeekView.tsx`, `WeekCellDialog.tsx`, `WeekNavigator.tsx`, `ViewSwitch.tsx` (new) | The grid card, the cell's entries (Edit, Delete, Add hours), previous / next / this week, the List \| Week switch. | US-5. Exact controls and layout: `/wellforge:design`. |
| `hours-ui/src/pages/MyHoursPage.tsx` | Reads `view`; in Week it makes the week read instead of the three list reads (entries, day totals, totals), hides Period, Totals, Entries and Export, shows the week card. The record / edit / delete handlers are shared; after any write it re-reads whichever view is shown. The deal-filter refusal (AC-4.11 of time tracking) blocks the week as it blocks the list. | AC-5.1, 5.2, 5.19–5.22, WA10. |
| `hours-ui/src/components/HoursFiltersState.ts`, `HoursFilters.tsx` | `view` and `week` in the search; `clearFilterSearch` keeps both (a view, not a filter); Period is not rendered in Week. | AC-5.21, 5.22, WA5. |
| `hours-ui/src/components/HoursShell.tsx` | `ToolLayout width="wide"` while My hours is in Week (C1, the EstimAI workspace width); `default` everywhere else. | C1. |
| `hours-ui/src/strings/recordHours.ts`, `strings/week.ts` (new) + `strings.ts` | en + `it: typeof en`. | AC-4.6. |
| `shell/src/lib/extensions.tsx` | `ExtensionProps['hours.recordHours']` and `LOADERS['hours.recordHours'] = () => import('hours/RecordHours')`. | The seam. |
| `shell/src/federation/remotes.d.ts`, `shell/vitest.config.ts`, `shell/src/federation/__stubs__/hoursRecordHours.tsx`, `shell/src/lib/noHardcodedStrings.test.ts`, `shell/src/lib/extensions.test.tsx` | Ambient type, test alias and stub, the dotted name allowlisted, a loader test. | The seam. |
| `projects-ui/src/federation/remotes.d.ts`, `projects-ui/vitest.config.ts`, `projects-ui/src/federation/__stubs__/shellExtensions.ts` (new) | projects-ui's first use of `shell/extensions`: ambient type (`'hours.recordHours'` only), alias, stub (renders `fallback`, the crm-ui stub's shape). | — |
| `projects-ui/src/lib/recordHours.ts` (new), `src/components/RecordHoursAction.tsx` (new) | `mayRecordOnProject`, `mayRecordOnTask`, `recordHoursPropsOf(task)`; the seam wrapper (dynamic `import('shell/extensions')`, `typeof HostExtension === 'function'`, own error boundary — `crm-ui/src/components/MeetingsSection.tsx:39-106`'s shape) with the fallback link. | AC-1.1, 1.2, 3.1–3.6, 4.5. |
| `projects-ui/src/pages/ProjectDetailPage.tsx` (header, beside the manage actions), `src/components/ProjectTaskItem.tsx` and `src/pages/MyTasksPageRow.tsx` (`TaskRow` `actions`) | Render `RecordHoursAction` when the rule says so. `TasksCard` already passes `currentUserId`. | US-1, US-3. |
| `crm-ui/src/federation/remotes.d.ts` | `ExtensionProps` gains `'hours.recordHours'` (the hand-kept copy). | The seam. |
| `crm-ui/src/lib/recordHours.ts` (new), `src/components/RecordHoursAction.tsx` (new) | `mayRecordOnDeal`, `mayRecordOnTask`, `recordHoursPropsOf(activity)`; the seam wrapper. | AC-2.1, 2.2, 3.1, 3.3–3.6, 4.5. |
| `crm-ui/src/pages/DealDetailPage.tsx` (header), `src/components/ActivityItem.tsx` (`TaskRow` `actions`, so the Tasks page and every Activity timeline — deal, company, contact) | Render it. `ActivityItem` already has `currentUserId` (`:51`). | US-2, US-3. |
| projects-ui and crm-ui `strings` | The fallback link's words ("My hours" / "Le mie ore"), en + it. | AC-4.5, AC-4.6. |
| `shell/e2e/hours-in-place.spec.ts` (new), `shell/e2e/helpers/hoursOwnersFixtures.ts` (reused) | The journeys below. | Test strategy. |
| `AGENTS.md`, `.changeset/*` | hours-ui exposes `./RecordHours`; the shell's `hours.recordHours` extension; the Week view. Changesets: hours-ui, shell, projects-ui, crm-ui (minor). | — |

### Decisions this plan makes

1. **The week's figures are summed in the browser, from one complete read** (ADR candidate R1, written as
   `docs/adr/20261116-week-view-sums-a-complete-read-in-the-browser.md`). The Week view
   reads every entry of the person's week through `readAllEntries` (`GET /time-entries`, `limit=500`, every
   page, all or nothing — the export's walk, `hours-ui/src/lib/exportPages.ts`) and folds them with
   `weekGrid`. Every figure — cell, row, day, week — is a sum over that one set, so they agree by construction
   (Σ cells = row, Σ rows = week = Σ days), and a page that fails shows an error, never a partial grid. The
   cell's list (D8) needs the entries anyway, and the grid needs a row per meeting and per unreadable target
   (AC-5.6, AC-5.23), which no totals grouping gives (`project` and `deal` merge what the viewer cannot name
   into one `hidden` group; there is no `meeting` grouping).
   This **narrows** the time-tracking design convention "No figure on screen is computed in the browser"
   (specs/20261112-time-tracking/design.md, conventions) for this view: its reason was a sum over the pages
   loaded so far, wrong until the last page (plan § Totals, "Day totals", rejected "a client sum marked so
   far"), and a deal's total that must include meetings linked now (read with hours-api's own credential).
   Neither applies: the read is complete or absent, and a meeting's hours stay on the meeting's row (D10).
   *Rejected:* a server grid (`groupBy` of two dimensions, or a `GET /time-entries/week`) — a second
   aggregation shape on the totals contract, a new route to version and deploy first, and the cell's list
   would still need the entries; the week's day and week totals from `groupBy=day` with cells summed in the
   browser — two sources for figures that must add up on one screen; the list's paged reads — "so far" sums.
2. **Record hours is hours-ui's own widget, reached through the shell's `HostExtension`** (ADR candidate R2,
   written as `docs/adr/20261116-record-hours-widget-through-the-host-extension-seam.md`).
   The host passes plain strings (the convention of ADR 20261104-host-extension-federated-panel-through-the-shell;
   the boundary is keyed by `JSON.stringify(props)`, `shell/src/lib/extensions.tsx:130`) and nothing comes back:
   the widget owns the dialog, the write, and the message after it (AC-4.3: "nothing else on the page changes",
   so the host needs no callback). The link to My hours goes through `navigateSuite` (`shell/src/lib/session.ts:872`),
   a shell-router transition, not a reload. *Rejected:* a copy of the dialog in each host (two dialogs, two
   sets of rules, against D3 and "never copy a component"); `EntryDialog` in `@operai/ui` (it reads hours-api
   and three owners; ADR 20261104-host-extension-federated-panel-through-the-shell keeps domain widgets out of the
   library); a link that opens My hours with the target prefilled (the person leaves the page — the problem
   the spec exists for); a host callback across the seam or a new shell toast API for the message (a function
   across the boundary, or a new shell seam, for a message the widget can say itself).
3. **Who is offered Record hours is decided by the host, from what it already shows** (D4, the user's choice;
   no ADR — the ledger records it and its rejected options). A pure function per host, `null` for a person
   whose id the session has not given yet:
   - project: `me === project.projectManager?.id || project.team.some(p => p.id === me)`
     (`projects-ui/src/lib/types.ts:162-164`);
   - deal: `me === deal.owner.id || me === deal.estimate?.technical.id` (`crm-ui/src/lib/types.ts:112, 126`;
     both are auth user ids: `ownerUserId`, `technicalUserId`);
   - task: `me === task.assignee?.id || (participants ?? []).some(p => p.id === me)` — the author alone is not
     offered it (AC-3.1); a done task as an open one (AC-3.6, A4).
4. **What a task row records on** (D2, F6, F9): a project task (`kind: 'operational'`, `project.id`) →
   project + task; a pre-sales task with a deal (`deal.id`) → deal + task; a pre-sales task with no deal →
   other work, kind fixed, no category chosen, no task (`activityId` is accepted only on a project or a deal,
   time-tracking AC-2.7). The crm-ui `Activity` type gains nothing: `deal` is on it (`types.ts:311-332`).
5. **The view is a search param of My hours, not a route** — `?view=week&week=YYYY-MM-DD`. The page stays
   mounted when the person switches, so the project and deal picked in the filters (held in memory, the URL
   carries no label — `HoursFiltersState.ts` header) are still set (AC-5.22); My hours' tab stays current
   (`includeSearch: false`); the list's `period` stays in the URL, unread in Week, so going back restores it.
   *Rejected:* a `/hours/week` route (a remount loses the in-memory picks; the tab would need its own
   matching). A plan note, not an ADR: one page's address, changed in one file.
6. **Seam wrapper per host.** projects-ui and crm-ui each get a ~40-line `RecordHoursAction` with the
   `MeetingsSection` shape (dynamic import of `shell/extensions`, feature check, own boundary). `@operai/ui`
   cannot import `shell/extensions`, and a library component that took the loader as a prop would hide nothing.
   In crm-ui the dynamic import may be shared with `MeetingsSection` through a small hook; that refactor is
   allowed, not required.
7. **Rows without a readable name offer no recording** (AC-5.24, WA8): `hidden` and `unavailable` alike — an
   owner that did not answer cannot be named in the dialog either. Their entries are still listed, edited and
   deleted from the cell.

### Sequences

**Record from a page (project, deal or task row)**

```
host page renders → may(me, record)? ─no→ nothing
                                    └yes→ <RecordHoursAction props=…/> → import('shell/extensions')
   → <HostExtension name="hours.recordHours" props fallback=<a My hours>/>
   → shell LOADERS → import('hours/RecordHours')   (5 s; failure or timeout → fallback, AC-4.5)
click Record hours → getTimeLists() → EntryDialog(preset, fixed, focus: duration)
Save → POST /time-entries as the person (hours-api asks the owner as the caller, fail closed)
   201 → dialog closes; widget shows "2 h 30 recorded on <name>" + See in My hours (navigateSuite('/hours'))
   4xx/5xx → EntryDialog's own failureOf words it, values kept (AC-4.2)
```

**The Week view**

```
/hours?view=week[&week=d] → monday = readWeekParam(search, todayZurich())
readAllEntries({ whose: 'mine', from: monday, to: monday+6, target, projectId, dealId, categoryId, workTypeId })
   ok → weekGrid(items, monday) → WeekView; unavailable → HoursBanners as on the list
   503 host_unavailable with a deal filter → DealFilterUnavailable (time-tracking AC-4.11), nothing drawn
   any other failure → ErrorBanner + Retry (no partial grid)
empty past cell → EntryDialog(preset: day + row)          cell with hours → WeekCellDialog(entries)
   → Edit → EntryDialog(entry) → PATCH;  Delete → DeleteEntryDialog → DELETE;  Add hours → EntryDialog(preset)
any write that worked → readAllEntries again → new figures (AC-5.20)
```

## Data model

No change. No migration in any service.

## API contracts

hours-api, projects-api, crm-api and activities-api: **unchanged**. The contracts below are between hours-ui,
the shell and the two hosts.

### The shell's extension `hours.recordHours`

```ts
// shell/src/lib/extensions.tsx — ExtensionProps
'hours.recordHours': {
  on: 'project' | 'deal' | 'none'
  targetId: string      // the project or deal id; '' when on = 'none'
  targetName: string    // its name as the host shows it; '' when the host cannot name it, or on = 'none'
  activityId: string    // the task's id when recorded from a task row on a project or a deal; else ''
  activityName: string  // the task's subject; '' with activityId ''
  placement: 'page' | 'row'   // the page header's button, or a task row's smaller one
}
// LOADERS
'hours.recordHours': () => import('hours/RecordHours')
```

The host renders:

```tsx
<HostExtension name="hours.recordHours" props={…} fallback={<a href="/hours">{t.myHours}</a>} />
// no `loading`: nothing shows until the widget is ready; the fallback only on failure or after 5 s
```

### `hours/RecordHours` (hours-ui `./RecordHours`)

```ts
export default function RecordHours(props: RecordHoursProps): ReactNode   // the props above
```

- Valid sets: `on: 'project' | 'deal'` with `targetId !== ''`; `on: 'none'` with `targetId`, `activityId`
  `''`; `activityName` only with `activityId`. Anything else **throws** at render (the host's boundary shows
  its fallback): a host bug, never a silent "record on nothing".
- `targetName === ''` → the dialog and the message say "this project" / "this deal".
- Writes only `POST /time-entries` with the body `EntryDialog` builds (`toInput`), the same as My hours.
- No edit, no delete, no read of entries, no permission check (`useHoursAccess` is not used).
- The message: `role="status"`, the duration in `formatDuration(…, { style: 'short' })`, "on <name>" or "on
  other work: <category>", and "See in My hours"; dismissible, gone after the hosts' `Saved` delay
  (`CONFIRMATION_DISMISS_MS`). Placement next to the button (page) or under the row's actions (row):
  `/wellforge:design`.

### `EntryDialog` (recording mode only)

```ts
type EntryPreset = {
  day?: string                         // YYYY-MM-DD; default todayZurich()
  on:
    | { kind: 'project'; project: ProjectChoice }   // companyName may be null
    | { kind: 'deal'; deal: DealChoice }
    | { kind: 'meeting'; meeting: MeetingChoice }   // startsAt may be null
    | { kind: 'none'; categoryId: string | null }   // null: no category chosen (A3)
  activity?: { id: string; subject: string | null } // project or deal only
}
type EntryDialogRecordingProps = {
  entry?: undefined
  onSubmit: (input: EntryInput) => Promise<void>
  preset?: EntryPreset   // absent: today, nothing chosen (My hours' Record hours, unchanged)
  fixed?: boolean        // true: the kind, the entity and a preset activity are shown, not editable
  focus?: 'day' | 'duration'   // default 'day'
}
```

- `fixed` without `preset` is a type error (the union says so). With `fixed` and `kind: 'none'` the kind is
  fixed and the category is chosen as usual.
- A preset day after today is a host bug: the dialog opens on it and Save refuses it with the usual
  `future_day` words (the Week view never offers one, AC-5.14).

### My hours' address

```
/hours                         the List (unchanged; the user menu's link)            AC-5.1
/hours?view=week               the Week, this week                                    AC-5.2, AC-5.4
/hours?view=week&week=<day>    the week holding <day> (any real day → its Monday)     AC-5.5
```

`view` other than `week` → List. A `week` that is not a real day → this week. `target`, `category`,
`workType` (URL) and the picked project and deal (memory) apply to both views; `period`, `from`, `to` and
`group` are read by the List only and kept in the URL while the Week shows. Clear filters keeps `view` and
`week`.

### `weekGrid`

```ts
type WeekCell = { minutes: number; entries: TimeEntryView[] }          // only days with entries
type WeekRow = {
  key: string                  // 'project:<id>' | 'deal:<id>' | 'meeting:<id>' | 'category:<id>'
  kind: 'project' | 'deal' | 'meeting' | 'none'
  name: string | null          // null: not readable (visibility 'hidden' | 'unavailable')
  visibility: Visibility       // 'visible' for a category
  retired: boolean             // a category's; false otherwise
  preset: EntryPreset['on'] | null   // what Add hours sets; null when name is null (AC-5.24)
  cells: Readonly<Record<string, WeekCell>>   // key: YYYY-MM-DD within the week
  minutes: number
}
type WeekGrid = {
  days: readonly string[]      // 7, Monday..Sunday
  dayMinutes: readonly number[]   // 7, 0 for a day with nothing
  rows: readonly WeekRow[]
  totalMinutes: number
}
function weekGrid(entries: readonly TimeEntryView[], monday: string): WeekGrid
```

- One row per `on.type` + id (an entry on a meeting is on the meeting's row whatever deal it counts for,
  AC-5.7); one row per category for `type: 'none'`.
- Order (AC-5.8): projects, deals, meetings, other work; within a kind, named rows by name
  (`Intl.Collator(<html lang>, { sensitivity: 'base' })`), then rows with no name, then by key (stable,
  never shown).
- An entry outside `monday..monday+6` throws (the read asked for the week; anything else is a server bug).
- An own entry always carries its target's id (time-tracking D44); one without (defensive) goes to the
  kind's one `<kind>:unknown` row, unnamed, with no Add hours.
- Labels: `name` is `on.label` when `visibility: 'visible'`, the category's name otherwise; how an unnamed
  row reads is the list's (`lib/names.ts` `rowName`), AC-5.23.

## Test strategy

Levels: **unit** (pure functions, vitest), **component** (React Testing Library + vitest, the app's
existing harness: `shell/session` and `shell/extensions` stubbed, `fetch`/`apiFetch` mocked), **e2e**
(`shell/e2e/hours-in-place.spec.ts`, the dev stack, nothing stubbed; fixtures from `hoursOwnersFixtures`).
File names are where the test lives; `*` = new.

| AC | Level | Test (what fails if the AC is broken) |
|---|---|---|
| AC-1.1 | unit + component + e2e | `projects-ui/src/lib/recordHours.test.ts`* PM and team member → true; `ProjectDetailPage.recordHours.test.tsx`* `HostExtension` called with `{on:'project', targetId, targetName, activityId:'', activityName:'', placement:'page'}`; e2e A: a team member sees Record hours on the project page |
| AC-1.2 | unit + component + e2e | same unit: reader not on the team, PM `null` (awaiting), `me` `null` → false; page test: `HostExtension` never called; e2e A: a salesperson who can read the project sees none |
| AC-1.3 | component | `hours-ui/src/RecordHours.test.tsx`*: dialog opens with the project as read-only text (no picker, no other kind selectable), Day = today, focus on Duration |
| AC-2.1 | unit + component + e2e | `crm-ui/src/lib/recordHours.test.ts`* owner, technical contact → true; `DealDetailPage.recordHours.test.tsx`* props `{on:'deal', …}`; e2e B: the deal's owner sees it |
| AC-2.2 | unit + component + e2e | unit: a reader, a task assignee on the deal who is not owner or technical, `estimate: null` → false; page test: never called with `placement: 'page'`; e2e B: the assignee of the deal's task sees no Record hours in the deal page's header, while their task's row in the page's timeline offers it (AC-3.1) |
| AC-2.3 | component | `RecordHours.test.tsx`: on=deal → deal read-only, Day today, focus Duration |
| AC-3.1 | unit + component + e2e | both `recordHours.test.ts`: assignee, participant → true; author only, anyone else → false; `crm-ui/src/components/ActivityItem.recordHours.test.tsx`*, `projects-ui/src/components/ProjectTaskItem.recordHours.test.tsx`*, `projects-ui/src/pages/MyTasksPageRow.recordHours.test.tsx`*: action present / absent; e2e C: a project task's assignee sees it on the Tasks card row |
| AC-3.2 | unit + component | `recordHoursPropsOf(projectTask)` → project + task; `RecordHours.test.tsx`: project and task both read-only, the POST carries `activityId` |
| AC-3.3 | unit + component | crm-ui and projects-ui (My tasks, pre-sales) `recordHoursPropsOf(task with deal)` → deal + task; `RecordHours.test.tsx` as AC-3.2 for a deal |
| AC-3.4 | unit + component | `recordHoursPropsOf(task without deal)` → `{on:'none', targetId:'', activityId:''}`; `RecordHours.test.tsx`: Other work fixed, no category selected |
| AC-3.5 | component + e2e | `RecordHours.test.tsx`: the POST body is `{on:{type:'none',categoryId}}` with no `activityId`; e2e D: from a CRM company task with no deal, My hours lists other work with the category, no task |
| AC-3.6 | unit + component | `recordHoursPropsOf` / `may…` give the same answer with `completedAt` set; row tests render it on a done row |
| AC-4.1 | component + e2e | `RecordHours.test.tsx`: the POST body equals `toInput` of the same values (My hours' builder); e2e A: after recording from the project page, My hours lists the entry with the same day, duration, project, task, work type and note |
| AC-4.2 | component | `RecordHours.test.tsx`: a 422 `not_on_project`, a 422 `invalid_minutes`, a future day, a 503 `host_unavailable` each show the string `EntryDialog` shows in My hours (same `strings.entry.errors.*` key), values kept; `EntryDialog.preset.test.tsx`*: the client rules hold with a preset |
| AC-4.3 | component + e2e | `RecordHours.test.tsx`: after 201 the dialog closes, a `status` says "2 h 30 recorded on <name>" (and "on other work"), "See in My hours" calls `navigateSuite('/hours')`; host tests: no host read is repeated after the widget's save (fetch count unchanged); e2e A: the message shows, the link opens My hours |
| AC-4.4 | component | `RecordHours.test.tsx`: no Edit or Delete is ever rendered, and the widget never calls PATCH/DELETE; host tests: no hours action besides Record hours |
| AC-4.5 | component + e2e | host tests with the `shell/extensions` stub (renders `fallback`): the page and the rows work and show the My hours link; `shell/src/lib/extensions.test.tsx`: `hours.recordHours` falls back on rejection and timeout; e2e E: `**/5184/remoteEntry.js` (hours) aborted → the project page, the deal page and My tasks load, with the link (the `remote-failure.spec.ts` pattern) |
| AC-4.6 | unit | hours-ui `strings.test.ts` (parity, `catalogGaps`) + `noHardcodedStrings.test.ts`; projects-ui and crm-ui the same for the link; `RecordHours.it.test.tsx`* with `<html lang="it">` |
| AC-5.1 | component | `MyHoursPage.week.test.tsx`*: `/hours` shows the list and a List \| Week switch with List current |
| AC-5.2 | component | same: `/hours?view=week` opens on the Week |
| AC-5.3 | unit + component | `week.test.ts`*: `weekDays` = 7, Monday first, Sunday last; component: seven day headings |
| AC-5.4 | unit + component | `readWeekParam({}, today)` = this Monday; component with a fixed today: the read asks `from`=Monday, `to`=Sunday of today's week |
| AC-5.5 | component | previous / next / this week change `week` and the read's span |
| AC-5.6 | unit | `weekGrid.test.ts`*: two entries on one project on two days → one row; a project, a deal, a meeting and two categories → five rows |
| AC-5.7 | unit | an entry on a meeting whose `deal` is linked and visible → on the meeting's row, the deal's row unchanged |
| AC-5.8 | unit | rows come projects, deals, meetings, other work; by name inside each; unnamed after named |
| AC-5.9 | unit + component | a cell = the sum of its entries; a day with none has no cell and renders empty |
| AC-5.10 | unit | vectors: Σ cells = row, Σ rows = `totalMinutes` = Σ `dayMinutes`; each entry in exactly one cell |
| AC-5.11 | component | the Week shows no target, no "incomplete", no comparison: only durations from `weekGrid` (asserted against a 42 h week and a 1 h week, same markup) |
| AC-5.12 | component | an empty cell of today / yesterday opens `EntryDialog` with that day and the row's target selected |
| AC-5.13 | component | that dialog's Day and target are editable; a save after changing both posts the changed values |
| AC-5.14 | component | tomorrow's cells have no button; a future week's grid has none |
| AC-5.15 | component | a cell with hours opens `WeekCellDialog` listing its entries through `EntryRow` (same text as the list) |
| AC-5.16 | component | Edit → `EntryDialog` with the entry → PATCH with the changed members only |
| AC-5.17 | component | Delete → `DeleteEntryDialog`; DELETE only after Confirm; Cancel sends nothing |
| AC-5.18 | component | Add hours in the cell's list → `EntryDialog` with the day and the row's target |
| AC-5.19 | component + e2e | recording from My hours' Record hours on a target not in the week → the week is read again and has its row; e2e F |
| AC-5.20 | component | after a save, an edit and a delete from the Week the read runs again and the cell, row, day and week figures change without a reload |
| AC-5.21 | component | with category, work type, recorded on, project and deal set, the week's read carries `categoryId`, `workTypeId`, `target`, `projectId`, `dealId` |
| AC-5.22 | component | switch List → Week → List: the URL keeps `category`/`workType`/`target`, the picked project and deal stay chosen |
| AC-5.23 | unit + component | an entry `visibility: 'hidden'` → row `name: null`; the row reads as the list reads it (`rowName`) |
| AC-5.24 | component | that row's empty cells have no button and its cell list has no Add hours (Edit and Delete stay) |

**e2e journeys** (`shell/e2e/hours-in-place.spec.ts`, per-run `hip-*@operai.test` people, entries deleted at the end):
A. Project page: a team member records 2 h 30 with a work type and a note → message, link, My hours lists it
   (AC-1.1, 1.2, 4.1, 4.3); a salesperson reading the project sees no button.
B. Deal page: the owner records from the header; the assignee of the deal's task sees none in the header and
   one on their task's row (AC-2.1, 2.2, 3.1).
C. Project Tasks card: the task's assignee records from the row → the entry points at the task (AC-3.1, 3.2).
D. CRM company task without a deal → other work with a category, no task (AC-3.4, 3.5).
E. hours remote down → pages load with the link (AC-4.5).
F. Week: entries on two projects across three days → cells and totals; an empty past cell records; a cell's
   Edit changes it; figures follow (AC-5.12, 5.16, 5.19, 5.20).

Existing suites must stay green: hours-ui (1504), shell (659), projects-ui, crm-ui, operai-ui (290),
`shell/e2e/hours.spec.ts` + `hours-owners.spec.ts` (10/10).

## Risks

| Risk | Mitigation | Early check |
|---|---|---|
| R1 A long task list mounts many `HostExtension`s (a 5 s timer and a boundary each) | Only rows the person may record on render one; the module import is cached after the first | component test: 100 rows, one import; e2e C logs the Tasks card's render time |
| R2 Deploy order: a host on a shell without `hours.recordHours`, or a shell before hours-ui's expose | Both degrade to the host's fallback (unknown name → fallback, `extensions.tsx:92-93`; failed import → fallback). Deploy hours-ui → shell → projects-ui, crm-ui | `extensions.test.tsx` unknown-name case; e2e E |
| R3 `./RecordHours` drags in hours-ui's heavy code (exceljs, the pages) | It imports only `EntryDialog`, `hoursApi`, `searchers`, strings; `exceljs` stays behind its lazy import | the build's chunk for `./RecordHours` is checked in the T-task's done-when (no `exceljs` in its graph) |
| R4 A new `@operai/ui` component for the switch or the grid is used by hours-ui before the live shell provides it (ADR 20261114-operai-ui-shared-singleton-provided-by-the-shell) | Prefer existing components; any addition ships in the shell first, its own push | design names any NEW component; tasks order it before hours-ui |
| R5 The widget's message in a task row breaks the row's layout on a phone | Placement decided in the design with the row's slots (`TaskRow` `actions`/`children`) | design screenshot at 375 px; component test that the message is inside the row |
| R6 The Week's browser sums and the List's server day totals could show different figures for the same day if entries change between reads | Each view reads at its own moment and re-reads after its writes; they are never on screen together | none needed beyond AC-5.20's test |
| R7 A week holding more than 500 entries | `readAllEntries` walks every page (a week of 30-minute entries is at most 336 if no day passes 24 h; nothing caps a day, so the walk, not one page, is the rule) | `weekGrid` vector with 2 pages in the component test |
| R8 The widget runs on `/projects` and `/crm` pages: CSP `connect-src` must already allow hours-api there | The shell's CSP is document-wide and already names hours-api for `/hours` | e2e A–D pass only if it does |
| R9 `EntryDialog` changes regress My hours | `preset`/`fixed`/`focus` are optional and absent from every existing call; the 1504 tests stay | hours-ui suite green after the dialog task, before any page work |
| R10 The widget shows `targetName` and records on `targetId` and cannot check they belong together: a host bug could show one project's name over another's id | Each host builds all six props from ONE object in one pure function (`recordHoursPropsOf`), never assembled at the call site; the saved entry is what hours-api checked and what My hours shows | the hosts' `recordHours.test.ts` assert id and name come from the same record for every task and page shape |

## Security

**Security-sensitive: YES** — personal data about workers (hours), and a write path into hours-api now offered
on other tools' pages. Nothing widens: no new route, permission, scope or credential.

What the owasp pass checks:
- **A01 access control.** The host's rule (decision 3) decides only whether a button shows; every save is
  still decided by hours-api as the caller, failing closed (`not_on_project`, `not_involved_in_deal`,
  `host_unavailable`). A forged prop (another project's id) reaches the same check. The Week reads
  `whose=mine` only; no `userId`, no oversight path.
- **Data across the seam.** Props are ids and names the host already shows to this person; nothing about
  hours goes back to the host. The widget reads no entries.
- **A03 injection / XSS.** Names render as React text; the link is a fixed path through `navigateSuite`;
  no HTML from any answer.
- **No new origin.** The widget calls hours-api and, for the activity field, activities-api — origins the
  shell's CSP already allows; `apiFetch` attaches the JWT to trusted origins only.
- **Logging.** No new log line; no note or name in a URL (the Week's address carries a day and the existing
  filter ids only).

## ADR candidates

- **R1 — A view may sum its own figures in the browser only over a complete, all-or-nothing read of a bounded
  span.** The Week view of My hours folds one person's week, read in full by the export's walk; a partial
  read is an error, never a grid. Narrows the time-tracking design convention "No figure on screen is computed
  in the browser" for this view. *Rejected:* a two-dimension totals grouping or a week route in hours-ui's
  API; server day totals beside browser cells; sums over the loaded pages.
  → `docs/adr/20261116-week-view-sums-a-complete-read-in-the-browser.md`
- **R2 — Recording hours on another tool's page is hours-ui's own widget through the shell's `HostExtension`,
  plain strings in and nothing back.** The host decides only whether to show it; the widget owns the dialog,
  the write and its message; the host's fallback is a link to My hours. *Rejected:* a copy of the dialog per
  host; `EntryDialog` in `@operai/ui`; a prefilled link into My hours; a host callback or a shell toast API.
  → `docs/adr/20261116-record-hours-widget-through-the-host-extension-seam.md`
