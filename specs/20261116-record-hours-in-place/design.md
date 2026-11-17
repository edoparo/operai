---
spec: 20261116
status: draft
---

# Design: Record hours in place, and a Week view of My hours

Inputs read: `spec.md` (approved, amended and re-approved 2026-11-16: US-1–US-5, 41 ACs, C1, A1–A7, WA1–WA10),
`ledger.md` (D1–D11), `plan.md` (approved; binding: Components table, "Decisions this plan makes", the
`hours.recordHours` / `EntryDialog` / `weekGrid` contracts, R1, R4, R5, R10), `operai-ui/docs/{building-pages,design-system}.md`,
`operai-ui/src/index.ts`, `specs/20261112-time-tracking/design.md` (S1 My hours, S2 entry dialog, F1–F3; this design
extends it and follows its voice), and the code it is drawn against: `hours-ui` (`MyHoursPage`, `EntryDialog`,
`EntryDialogModel`, `ActivityField`, `EntryDayList`, `HoursFilters`, `HoursShell`, `SuccessBanner`,
`DeleteEntryDialog`, `HoursBanners`, `strings/*`), `projects-ui` (`ProjectDetailPage`, `TasksCard`,
`ProjectTaskItem`, `MyTasksPageRow`), `crm-ui` (`DealDetailPage`, `TasksPage`, `ActivityItem`, `MeetingsSection`,
`LoadState`), `shell/src/lib/extensions.tsx`, and `TaskRow`, `Tabs`, `DataTable`, `Banner`, `Dialog`, `Card`,
`ToolLayout` in `operai-ui`.

**Inspected first-hand.** The dev stack answered on `:5173`; a dev test-auth session (`admin@operai.test`) was
used (no Google sign-in). I looked at My hours (1440 px), a project page (header with its state actions, the Tasks
card and a task row), the CRM Tasks page and EstimAI's estimate workspace (C1's reference width). Where the
design depends on how something lays out, I injected throwaway DOM built from the library's own classes (a
success banner in the project header and in a task row at 1440, 1024 and 375 px; a Week-shaped `DataTable` in the
My hours page at 1440 and 375 px) and read the result; nothing was written to the repo (the screenshots are
in the git-ignored `.playwright-mcp/`). Findings from those checks are marked **(checked)**. The 2026-11-17
amendment (after the QE verdict) re-measured the Week on a live week at 375, 960 and 1024 px, changing the row-label
floor at run time to compare candidates; nothing was written to the repo.

Surfaces: **two pages change** (My hours gains a view; a project page and a deal page gain one button),
**two lists change** (project and CRM task rows gain one button; My tasks too), **three dialogs** (the entry
dialog in two new modes, the new cell dialog; the delete confirmation is reused unchanged) and **one new message**.
Page types from `operai-ui/src/pages`: the Week is an *Item list* variant (a table of comparable cells in a card);
Record hours in place is the *Quick create in a dialog* page type reached from other tools' pages. Library in use:
**`@operai/ui`** with Tailwind token utilities (ADR 20261031-shared-ui-library-consumed-as-source,
20261031-one-styling-dialect-token-utilities); not Mantine. No visual direction section: the project has a design
system and it wins.

Conventions that hold on every screen below (not repeated): all copy is an `en` catalog plus a complete
`it: typeof en` through `selectStrings`, sentence case, parity and hardcoded-copy tests (AC-4.6); durations only
through `formatDuration(minutes * 60_000, { style: 'short' })` ("2 h 30"; the existing `aria-label`s use the same
short form, so do these); dates only through `formatDate` (dd.mm.yyyy) and `formatDateLong`; "today" is
`todayZurich()`; weeks start on Monday (WA1); colour only as token utilities; no `--muted` for text; icons only
through `Icon`; statuses and kinds through `Badge`/`StatusBadge`. **Weekday names are copy, not a date format**
(the library has no weekday formatter): a catalog of seven short and seven long names, en and it. **A week is
written as two `formatDate`s with an en dash**, "16.11.2026 – 22.11.2026"; a compact "16–22.11.2026" would need a
new library formatter (R4: library first) and nothing here needs it. A name a viewer may not read is never shown
and no screen displays an entity id (time-tracking design, "Names the viewer cannot read"; AC-5.23). The Week is
the one view that sums in the browser (plan decision 1, ADR candidate R1); it still shows no target, no
"incomplete" mark and no comparison (AC-5.11).

---

## Flows

Six flows. Every one maps to the ACs it serves; refusals are the existing ones (S2 of time tracking), unchanged.

### F1 Record hours in place — US-1, US-2, US-3, US-4, AC-1.1–1.3, 2.1–2.3, 3.1–3.6, 4.1–4.4, 4.6

Entry points (the host decides whether each shows, D4; hours-api decides every save):

| Entry point | Where | Records on | Notes |
|---|---|---|---|
| **Record hours** in the page header | project page; deal page | that project / deal | AC-1.1, 2.1 |
| **Record hours** on a task row | project Tasks card; My tasks (project and pre-sales rows); CRM Tasks page; every CRM activity timeline (deal, company, contact) | a project task → project + the task; a task about a deal → deal + the task; a task about a company with no deal → **other work**, no category chosen, no link to the task | AC-3.1–3.6; done tasks as open ones (A4) |

1. The host renders the offer only for a person its data says may record (project: manager or team; deal: owner or
   technical contact; task: assignee or participant). Everyone else sees nothing (AC-1.2, 2.2; the author of a task
   alone gets nothing).
2. The widget loads with **no placeholder**: nothing shows until hours-ui answers, then the button appears (in a
   right-aligned cluster a new leftmost button does not move the ones already there, by the header's
   `space-between` layout). After 5 s without an answer the host's fallback link takes its place (F2).
3. **Record hours** opens the entry dialog in `fixed` mode (S4): Day = today, **focus on Duration**, the target
   (and, from a task row, the task) shown as read-only text.
4. The person types a duration; may change the day, the work type, the activity (page-opened only) and the note;
   a deal-less CRM task also needs a **category** (S4).
5. **Save entry.** Success exit: the dialog closes, focus returns to Record hours (the library does it), and the
   message of S3 appears where the person acted: "2 h 30 recorded on <name>." with **See in My hours**.
   Nothing else on the host page is read again or redrawn (AC-4.3).
6. Error exits (dialog stays open, every value kept, same words as My hours, AC-4.2): `invalid_minutes`,
   `future_day`, `note_*` at the field; `not_on_project`, `not_involved_in_deal` and a vanished target at the
   **form level** (there is no picker to carry them, S4 *Errors*); `host_unavailable` fail-closed as in S2.
7. After the message: **See in My hours** (shell transition to `/hours`) or **×** (dismiss); it does not lapse on its own (S3, G1).
   An entry is changed or deleted only in My hours (AC-4.4): no Edit, no Delete, no Undo anywhere in this flow.

### F2 The hours screens cannot be loaded — AC-4.5, A1

The project page, the deal page and every list of tasks load and work exactly as before. Where Record hours would
be, **only for a person who would have been offered it**, the host shows its own fallback link, "Record hours in
My hours" (S5), after the widget failed to load, threw, or did not answer in 5 s. Not while loading. A host on a
shell that predates `hours.recordHours` (unknown name) gets the same link at once (plan R2). The link is a plain
anchor to `/hours`: when hours-ui is down it lands on the shell's own remote-failure state, which is the right
place to retry.

### F3 Open the Week and move between weeks — US-5, AC-5.1–5.5, 5.21, 5.22

1. My hours opens on the **List**, as before (AC-5.1). A **List | Week** switch sits under the page header (S6).
2. **Week** (click or arrow key) sets `?view=week` (the address, AC-5.2). The page stays mounted, so the project
   and deal picks, the Recorded on, Category and Work type filters are all still set (AC-5.22). The container
   goes full width (C1). Period (and its From / To) leave the Filters card; the Totals and Entries cards and
   Export are not shown (WA5, WA10).
3. The Week card shows the **current week** (AC-5.4) read in full, then the grid (S7). `‹` / `›` step one week;
   **This week** returns (AC-5.5). The week is in the address (`&week=<Monday>`), so a bookmark or a reload keeps it.
4. Any filter change reads the week again with the same span; "Clear filters" keeps the view and the week.
5. **List** goes back; the List's own Period is as the person left it (kept in the URL, unread in the Week).
6. Exits: loading, empty (no hours, or none matching the filters), error with Retry, the deal-filter refusal
   (AC-4.11 of time tracking), and the source-down notes — S7 *States*. **After a Retry that works, focus goes to the
   Week card's heading** (the Retry button went with the error); if the read fails again, focus goes to the banner
   that replaced it (S7 *Focus after a write or a Retry*).

### F4 Record on an empty cell — AC-5.12–5.14, 5.19, 5.20, WA6, WA7

1. An empty cell of **today or an earlier day** on a readable row is a button (a plus). A future day's cell has
   no button; neither has an empty cell of an unreadable row (nor of a retired category's row: AC-5.24 as amended, G4).
2. It opens **My hours' own entry dialog** (S9) with that day and the row's project, deal, meeting or category
   set — still changeable (AC-5.13) — and focus on Duration.
3. Save: the dialog closes, the week is read again, the cell, its row total, its day total and the week total show
   the new figures without a reload (AC-5.20), a compact "Entry saved." confirms, and **focus goes to the same
   cell** (now holding hours); if the person changed the day or the row and the cell is no longer there, to the
   Week card's heading. Changed to a day outside the week shown: the confirmation says so (S7).
4. Errors: as S2; the dialog stays open.

### F5 Work on a cell's entries — AC-5.15–5.18, 5.20, 5.24

1. A cell that holds hours is a button showing its total. It opens the **cell dialog** (S8): the entries of that
   row on that day, each exactly as My hours' list shows it, each with Edit and Delete; **Add hours** (not on an
   unreadable row, nor on a retired category's: AC-5.24 as amended).
2. **Edit** opens the entry dialog on that entry, *over* the cell dialog (the library stacks dialogs). Save: it
   closes, the week is read again, the figures follow (AC-5.20), focus returns to the entry's Edit button.
3. **Delete** opens the existing confirmation over the cell dialog; only Confirm deletes (AC-5.17); Cancel sends
   nothing. A 404 is "already gone", as in My hours.
4. **Add hours** opens the entry dialog (S9) with that day and row set; the cell dialog stays open behind it and
   shows the new entry once saved.
5. **When the last entry leaves the cell** (deleted, or edited to another day or row): the cell dialog **closes**
   after the new figures arrive, focus goes to the cell button (now empty) or, if its row is gone, to the card's
   heading, and the page says what happened ("Entry deleted." / "Entry saved."). An empty list in a dialog is a
   dead end; closing lands on the cell, one Enter from recording again.

### F6 Record with the page's Record hours while the Week is shown — AC-5.19, 5.20

**Record hours** in the page header (S6) is the List's: the dialog opens as in time tracking F1 (nothing preset,
today). Save reads the week again; if the day is in the week shown, the row appears (or the existing row's figures
change), AC-5.19; focus returns to Record hours. If the day is outside the week shown, the confirmation says so
("Entry saved. 16.11.2026 is outside the week you are viewing.", the Week's twin of the List's
`savedOutsidePeriod`). A row exists only for what holds hours that week (D9): there is no "Add row".

---

## Screens & states

Nine. S1–S5 are the in-place offer, S6–S9 the Week.

### S1 Record hours in a page header — project page, deal page (AC-1.1, 1.2, 2.1, 2.2, 4.5)

```
‹ Back to projects
Alpenstrom — portale clienti  [Active]             [Record hours] [Put on hold] [Close] [Cancel project]
Details …                                           ↑ secondary     ↑ the manage actions, only for those who manage
```

- **Where.** First item of the header's `actions`, ahead of the manage actions. The two groups mean different
  things (my own time vs managing the record) and the second is shown only to some people, so Record hours is
  the one item that is always at the left end of the cluster for everyone who has it: a non-manager sees it
  alone, a manager sees it with their state actions to its right. On the deal page, `actions` becomes a fragment
  (`<RecordHoursAction/>` then `{canManage && …}`) so a technical contact without `deal:manage` still gets it.
- **Variant.** `secondary`, default size, label "Record hours" (the string My hours already uses). Never
  `primary`: the project's primary is its state move ("Start project") and the deal's is "Move stage"; a header
  has at most one. `aria-haspopup="dialog"`, a plain button, not a toggle.
- **Owner.** Rendered by hours-ui (`placement: 'page'`) inside `HostExtension`; the host owns the slot and the
  fallback (S5). The host passes plain strings only (plan contract); nothing comes back.
- **States.** *Not offered* (everyone else): no element, no placeholder, no explanation. *Loading*: nothing.
  *Ready*: the button. *Dialog open*: the button stays (the dialog is modal). *Saved*: S3. *Failed to load or
  timed out*: S5, for people who would have had the button. *Throws at render* (an invalid prop set, plan R10):
  the host's boundary shows S5.
- **Not designed here:** a count or "my hours on this project" beside it (a non-goal, spec § Non-goals).

### S2 Record hours on a task row — project Tasks card, My tasks, CRM Tasks page, CRM timelines (AC-3.1, 3.6, 4.5)

```
[Open] Send the offer
Due 18.11.2026 · Assigned to Anna Rossi
[Mark done] Edit Delete [Record hours]        ← actions group: "Actions for Send the offer"
```

- **Where.** The **last** item of the row's `actions` (after Edit / Delete / "Open in CRM"), so the button and the
  message that follows it (S3) are the last things in the group and **nothing the person is already using is
  displaced when the message opens** (**checked** in the project Tasks card at 1440 and 375; the alternative,
  between Mark done and Edit, would push Edit and Delete down a line while the message shows, by the group's
  `flex-wrap`). `TaskRow` renders Mark done first, then `actions`.
- **Variant and size.** `secondary` `sm`, the same weight as Mark done; label "Record hours". A done task's
  row offers it exactly as an open task's (AC-3.6): no difference in label, variant or position.
- **Name.** Visible text "Record hours". The accessible name is "Record hours on <task subject>" when the host
  gives a task name (project and deal tasks), so a list of buttons read out of context tells the rows apart (the
  label contains the visible text, WCAG 2.5.3). For a CRM task with no deal the host passes the subject as
  `activityName` too, for the name only — never sent (G3, plan amendment 2026-11-17): "Record hours on <subject>".
- **Per row, not per list.** In one list some rows have the button (mine) and some do not (someone else's, or I
  only authored it): the group simply has one item fewer. In the CRM Tasks page, the "Assigned to" filter showing
  someone else's tasks shows those rows without it.
- **States.** As S1 (no element when not offered; nothing while loading; S5 on failure). One widget per
  offered row: a 25-row page mounts at most 25, one cached module import (plan R1).

### S3 The success message — page and row (AC-4.3, R5)

- **What it is.** A compact `Banner tone="success"` (`role="status"`, polite) rendered by the widget, one at a
  time per widget (a second save replaces it and restarts its timer).
- **Text.** "<duration> recorded on <name>." — "2 h 30 recorded on Alpenstrom — portale clienti." For other work:
  "2 h 30 recorded on other work: Training." With no name from the host: "… on this project." / "… on this deal."
  Then the link **See in My hours**, inline in the message (a `.link` anchor, design-system rule 4: inline
  navigation is a text link, not a button): a real `<a href="/hours">` whose click is a shell transition
  (`navigateSuite('/hours')`), so open-in-new-tab and middle-click still work. No day is repeated in the message
  (the person chose it a moment ago; the List and Week show it).
- **Where on a page.** Inside the header's action row, **immediately before Record hours** (DOM order and visual
  order: message, then button), so it appears beside the button the person pressed and grows into the free space to the
  left of the right-aligned cluster, so **when the header has room it moves none of the buttons**. Maximum width
  ~24 rem (`max-w-sm`); the message wraps inside it.
  - When the header cannot hold title + message + buttons on one line (**checked**: a long project name at 1440, or
    anything at 1024), the browser wraps the whole action row under the title for as long as the message shows;
    nothing overlaps and nothing is lost. The suite's `Saved` banners already push the cards down; this is the
    same cost, paid for a moment.
  - On a phone (**checked** at 375, content ≈ 263 px) the message becomes a full-width banner above the buttons;
    Banner's own wrapping drops the × to a second line.
- **Where on a row.** Inside the row's `actions` group, after the buttons, on **its own line**
  (`basis-full`), full row width (**checked** at 1440 and 375). It is the last element of the group, so nothing
  moves, and the row grows by one banner height. Focus is not in the row's later content, so DOM order = visual
  order.
- **Dismissal.** × (`dismissLabel` = "Dismiss", `strings.common.dismiss`) removes it and **returns focus to
  Record hours** (the × is gone, so focus would otherwise fall to the page). **No auto-dismiss** (G1, plan amendment 2026-11-17):
  a link that disappears in 3 s cannot be reached by a keyboard or screen-reader user (WCAG 2.2.1). The message
  goes by ×, by the next save (replaced), or by leaving the page.
- **Announcement.** `role="status"`; QE checks the readback in NVDA and VoiceOver (a status inserted with its
  text already in it is not announced by every combination; the suite's other success banners work the same way).
- **Never.** Not the shell's `ToastHost` (reserved for notifications from elsewhere, design-system § Feedback);
  no Undo; no Edit link; no hours shown on the host page (spec § Non-goals).

### S4 The entry dialog opened from a page — `fixed` (AC-1.3, 2.3, 3.2–3.5, 4.1, 4.2)

The same `EntryDialog` as My hours (title "Record hours", `FormDialog` `size="lg"`, "Save entry"), recording mode,
with `preset` + `fixed` + `focus: 'duration'`. Same rules, same refusals, same body sent (`toInput`).

```
Record hours                                                              ×
Recording hours on the project  Alpenstrom — portale clienti.        ← read-only, announced as the dialog's description
Day  [16.11.2026]            Duration * [          ]  ← focus here          "= 2 h 30" as you type
ACTIVITY                                                      ← only from a task row (S4 "the fixed task")
Write the offer
Hours are recorded on this task. It can't be changed here.
Work type [No work type ▾]                                    ← project / deal
Note [                                  ]
                                              [Cancel] [Save entry]
```

- **How a fixed target reads.** As **text**, not as a disabled picker: the dialog's `description` (the line under the
  title, which the library uses as the accessible description, so it is announced when the dialog opens even though
  focus lands on Duration): "Recording hours on the project **<name>**." / "… on the deal **<name>**." — the name in
  `font-medium text-text`. The "What was it on" radio group and the picker are **not rendered**. With
  `targetName === ''` (the host could not name it): "Recording hours on this project." / "this deal." — never a
  blank, never an id (plan R10: the host builds name and id from one object).
- **Day.** Today, editable, `max` today, the floor and every rule of S2 unchanged (AC-4.2: a future day is refused
  with the same `future_day` words). **Duration** has `data-autofocus`; Day stays first in tab order (the dialog is
  the same, only where focus starts changes, AC-1.3).
- **The fixed task** (`ActivityField` `lock: 'fixed'`, a variant **distinct from the "not visible" one**): the field
  keeps its place and its label "Activity" (the word My hours' list uses afterwards, "Activity: <subject>"), but is a
  read-only fact — a one-item `FactList` (`grid-cols-1`: term "Activity", value the task's subject) with the hint
  "Hours are recorded on this task. It can't be changed here." No select, no `aria-disabled`, no read of
  activities-api. It is placed directly under the description (before Work type) so the fixed things read
  together. The "not visible" variant stays as it is (a disabled select with the entry's pointer, for an entry
  whose target the author cannot read); the two share a prop (`lock: 'hidden' | 'fixed'`) and nothing else.
  A task with an empty subject reads "This task".
- **Opened from a page (no task).** Everything above except the Activity fact: the **Activity select works as in My
  hours**, listing the fixed project's / deal's activities, optional.
- **A deal-less CRM task (kind fixed to Other work).** The description reads: "This task is about a company, not a
  deal, so its hours are recorded as other work. They are not linked to the task." (AC-3.4, 3.5: honest about the
  missing link, which the person would otherwise look for in My hours). No radio, no Activity field. **Category** is
  the S2 `select`, required, **nothing chosen** (A3), listing non-retired categories; with none available the
  field says what S2 says and Save is blocked; a category that requires a note makes Note required, as in S2.
- **Work type** (project / deal) and **Note**: as S2.
- **Errors — "same surfaces, same words" (AC-4.2).** Field errors (Day, Duration, Category, Note, and Activity **when
  it is a select**, i.e. a dialog opened from a page with no task) land on their fields exactly as in S2. What S2 puts
  on a control this dialog does not have appears in the dialog's form-level `.form-error` (`role="alert"`, above the
  footer), same sentences: the three errors S2 puts on the entity picker — `not_on_project`, `not_involved_in_deal`
  (the person is not, or no longer, on it: A7) and `404` (target gone) — and, **when a task is fixed**,
  `activity_not_allowed` (the Activity is a fact with no field to carry it; S2's sentence, "This activity does not
  belong to the chosen project." / "…deal."). **G2:** S2's 404 sentence ends "Choose another.", which cannot be done
  here: fixed mode uses "This project is no longer available to you." / "…deal…" (a one-clause variant).
  `host_unavailable` fail-closed and "Something went wrong" are the form error as in S2. Values are kept on every
  failure; Save is pressed again to retry.
- **Focus after a form-level refusal.** Save is `busy` (disabled) while the request runs, and a disabled control cannot
  keep focus, so when a refusal that has no field arrives (every form-level error above) **focus returns to Save**, the
  control the person pressed: the next Enter retries, and a keyboard user keeps their place instead of starting from
  the dialog's ×. The alert is announced by its own role; focus does not move onto the alert's text. A refusal that
  has a field keeps the rule of S2 (the first invalid field is focused; an entity refusal in a dialog that has a
  picker focuses the picker). This is how `EntryDialog` behaves wherever it opens: a page, a task row, a week cell,
  My hours' own button.
- **Loading / error of the lists.** The dialog opens at once; the Category and Work type selects show S2's "Loading…"
  hints, then fill; if `GET /time-lists` fails they say "could not be loaded" with **Try again** (S2), and a
  project / deal entry can still be saved without a work type. Same strings.
- **Saving.** `busy` on Save, dialog not dismissible, as in the library.

### S5 The host fallback link (AC-4.5)

`<a href="/hours" className="link text-sm">Record hours in My hours</a>` in the slot Record hours would occupy: first
in the page header's `actions` (it aligns with the buttons, `align-items:center`), last in a row's `actions`
(the "Open in CRM" row link in My tasks is the precedent: `link self-center text-sm`). Shown only on failure,
throw or timeout, only to someone who would have been offered the button, never while loading. No retry affordance:
a failed module import is cached, so the link is the whole offer (the `MeetingsSection` posture); reloading the page
retries. No message, no banner: the page works, one link is the only difference.

### S6 My hours with the List | Week switch (AC-5.1, 5.2, 5.4, 5.21, 5.22, C1, WA5, WA10)

```
Hours                                                  (h1)   [My hours | Everyone's hours | Settings]   ← holders only, unchanged
My hours                                               (h2)                                [Record hours]
Time worked on two things at once counts in full …
[ List | Week ]                                        ← Tabs, a tablist of views of the SAME page
[ notice: "Entry saved." ]  [ HoursBanners ]           ← inside the panel
┌ Filters ─ [Clear filters] ┐   Period is shown in the List only
│ (Period) Recorded on  Project  Deal  Category  Work type │
└─────────────────────────┘
<the List's Totals + Entries>   or   <the Week card (S7)>
```

- **Control: `Tabs` (existing).** The design system reserves `Tabs` for "switches views of the SAME page without
  navigating" (EstimAI's Activities / Summary / Parameters, the CRM's Open / Done); `TabNav` is for pages with their
  own URL, and the plan rejected a route (`/hours?view=week`, decision 5). **Nothing new in the library.** The
  panel wrapper uses `tabPanelProps`. The tab list is named "View of your hours"; the two tabs "List" and "Week".
  A selected tab sets/clears `view` in the search (replace navigation); List is the default and is left out of the
  URL. Arrow keys switch (automatic activation, the `Tabs` contract); with two tabs that is acceptable even though
  the Week then reads.
- **Where.** Directly under `PageHeader` (its description stays: the "counts in full on each" sentence is as true of
  a week), above the notices and Filters, so both views share everything above the panel. The tool's own `TabNav`
  (holders only) is above the page, in the tool header, and looks the same as `Tabs`; the CRM's Tasks page and
  EstimAI already stack the two.
- **Filters card in the Week.** Period and its From / To are not rendered (the week replaces them, WA5); the
  other controls reflow; "Clear filters" appears only when a **visible** filter differs from the default (**G5**:
  the List's `isFiltered` counts `period`, which is hidden in the Week; the Week must ignore it, and
  `clearFilterSearch` keeps `view` and `week`). Recorded on, Project, Deal, Category and Work type keep what the
  person set and apply to the Week (AC-5.21, 5.22).
- **Width (C1).** `HoursShell` gives `ToolLayout width="wide"` while `view=week`, `default` otherwise: the CRM's
  per-route precedent (`CrmShell`: `wide` on the pipeline). The tool title, the tool's tabs and the page all
  follow, so the columns of the header and the grid line up (EstimAI's workspace runs edge to edge with the same
  24 px gutter; **checked**). The List keeps 80 rem (whether the List also widens is the user's call; C1 reads as
  the Week).
- **States.** The Tabs, the header and the Filters are always shown (as in time tracking S1). The panel is one state
  per region, as S7. A person who lands on `/hours?view=week` with a `week` that is not a real day gets this week.
- **Everyone's hours** has no view switch (WA4).

### S7 The Week grid — `/hours?view=week[&week=<day>]` (US-5, AC-5.3–5.14, 5.20–5.24, WA1–WA3, WA7–WA9)

```
┌ Week 16.11.2026 – 22.11.2026 ──────────────────────────────────── [‹] [This week] [›] ┐   (h3 + Card action)
│ RECORDED ON                     MON        TUE        WED        THU    FRI   SAT   SUN       TOTAL │
│                              16.11.2026 17.11.2026 18.11.2026 …                                  │
│                                         [Today]                                                  │
│ [Project] Alpenstrom — porta…    4 h        5 h         +                                9 h     │
│ [Project] Operai — strumenti…     +         1 h       2 h 30                              3 h 30   │
│ [Deal] Brera — configuratore…     +          +         1 h                                 1 h     │
│ [Meeting] Retrospettiva sprint 4 1 h         +          +                                  1 h     │
│ [Other work] Training             +          +          +        2 h   (future: blank)    2 h     │
│ [Project] Not visible to you      +         2 h         +                                  2 h     │
│ Total                            5 h        8 h       3 h 30      2 h    —     —     —    16 h 30 │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

(The mock above and its figures are illustrative; the shape was **checked** as injected DOM at 1440 and 375.)

- **Container.** One `Card` (title = the week, h3; `action` = the navigator) holding one `DataTable`
  (`caption` and `regionLabel` "Hours by project, deal, meeting and other work, 16.11.2026 – 22.11.2026"). A
  `DataTable` is the right primitive: comparable cells, `scope` headers, a keyboard-scrollable region. The design
  system's one exception to "never a raw table" is an *editing grid* with inline inputs; this grid has none (a
  cell opens a dialog, it is not typed into, spec § Non-goals), so it is a data table of buttons.
- **Navigator** (`WeekNavigator`, in the card header): `‹` Previous week (`iconOnly`, `ghost`, `sm`,
  `aria-label` "Previous week"), **This week** (`secondary`, `sm`), `›` Next week (icon only). The group is
  `role="group"` named "Choose a week". **This week** is `aria-disabled="true"` while the current week is shown
  (it stays reachable and keeps focus after a click, instead of `disabled` dropping focus). `Next week` is always
  offered (AC-5.5): a future week is a blank grid with the "not started" state below. The week label is the card's
  heading, "Week 16.11.2026 – 22.11.2026", so a screen reader on the heading hears which week; on a phone the
  heading wraps to three short lines (**checked**) and the three buttons stay on the right.
  *Why in the card and not in the Filters card, where "the week takes the place of Period" (WA5):* the stepper
  navigates the grid it sits on, a Filters card with a gap where Period was would shift the other controls, and
  "Previous" belongs next to the week it leaves. WA5 states what is replaced, not where; flagged, not a drift.
- **Columns.** First: **Recorded on** (row header: the kind `Badge` — Project, Deal, Meeting, Other work, the same
  words and badge as the List's rows, AC-5.8's kind marker — then the name). Then seven day columns, Monday to Sunday
  (AC-5.3): header line 1 the short weekday (+ a **Today** `Badge tone="accent"` inline for today), line 2
  `formatDate(day)` ("16.11.2026": unambiguous across a month boundary, no date built by hand). Then **Total**.
  Day and Total columns are `numeric` (right-aligned DM Mono, tabular). The row-header cell has a floor width of
  **`min-w-28` (7 rem, 112 px)**, so a name is never squeezed to a word or two per line, and no wider: the floor
  decides whether a day is visible on a phone and how wide a screen the grid fits. A name wraps to two or three lines
  (**checked**: "Alpenstrom — portale clienti" in two at 375 px). The widths below were **checked** on a live week by
  changing the floor at run time; the sums for longer Totals follow from them.
  - **At 375 px (QE observation → defect, 2026-11-17).** The Week card is 258 px wide inside the shell's 64 px rail and
    its grid region is **220 px** (the first draft reasoned from 263 px). Every day column is about 88 px (an 11 px
    mono date, nowrap) and the label column is the floor plus 16 px of cell padding. A 176 px floor (`min-w-44`, the
    first draft) showed 28 px of the Monday column and no figure; 144 px showed 60 px, 128 px showed 76 px, still no
    figure; **112 px shows the whole Monday column, header and figures**, with Tuesday starting 5 px beyond the edge.
    The first draft left a phone with a column of names, no day figure and no sign that the grid scrolls; G10 accepted
    the scroll, not that. The sign is the hint under *Phone* below.
  - **At 1024 px (QE observation → defect, 2026-11-17).** The grid's minimum width is the sum of its columns: the
    label column, 7 × ~88 px for the days and the Total column (about 52 px for "5 h", 75 for "11 h 30", 83 for
    "100 h 30"). The grid region is the viewport minus 155 px in this layout (869 px at 1024). With the 176 px floor
    the minimum was 858 px for a week of small totals and about 880 px once a total reached ten hours (the QE measured
    879 against 869): the Total column's last character sat under the card's edge and a sideways scrollbar appeared
    for 10 px. With the 112 px floor the minimum is 794 px, 825 px with a three-digit-hour Total: it fits at 1024 with
    44 px or more to spare and at 960 (805 px) for a short Total. The grid fits without a sideways scroll from about
    980 px up; below that it scrolls inside the card, as designed.
- **Rows.** Exactly one per project, deal, meeting and category of other work the person has hours on in the week
  (AC-5.6), a meeting's hours on the meeting's row even when it counts for a deal (AC-5.7), ordered projects, deals,
  meetings, other work, by name inside each, unnamed after named (AC-5.8, `weekGrid`). A row label:
  - readable: the name as the server sent it (never translated, never an id). Other work: the category's name, a
    retired one as the list writes it, "Training (retired)" (`strings.entries.retired`).
  - not readable: the List's words, "Not visible to you" / "Name unavailable" (`strings.names`), with the kind
    badge still there (AC-5.23). Two unreadable rows read the same and are told apart by position only, as in the
    List (D44: no id is shown).
  - No link on the name (the List links a readable name to its page): the plan's `WeekRow` carries no `href` and no
    AC asks for one; a link per row would also add a tab stop per row. Deliberate (G6).
- **Cells** (AC-5.9, 5.12, 5.14, 5.15, 5.24). By day, from today backwards only:

  | Cell | Shows | Is | Accessible name |
  |---|---|---|---|
  | holds hours (past or today, any row) | the total, "2 h 30" (DM Mono) | `Button ghost sm`, `aria-haspopup="dialog"`, opens S8 | "2 h 30 on Alpenstrom — portale clienti, Wednesday 18 November 2026, 2 entries" ("1 entry"); an unreadable row: "2 h on a project not visible to you, …" (the List's `onPhrase`) |
  | empty, today or earlier, readable row | a plus (`Icon plus`, `iconOnly`) | `Button ghost sm iconOnly`, `aria-haspopup="dialog"`, opens S9 | "Record hours on Alpenstrom — portale clienti, Thursday 19 November 2026" |
  | empty, an **unreadable** row (AC-5.24) | nothing | not a control | — |
  | empty, a **future** day (AC-5.14, WA7) | nothing | not a control | — |

  Empty cells show a visible plus rather than reveal one on hover: hover does not exist on a phone and a hidden
  control is not discoverable. The row label text and the weekday are inside each name because a button reached by
  Tab or a screen reader's buttons list is out of its table context. A cell shows no entry count visually: the
  number of entries is in the cell dialog, and a second figure per cell would be noise.
- **Totals** (AC-5.10). A **Total** column (row totals, `font-medium`) and a last row **Total** (row header) with the
  seven day totals and, in the corner, the week's grand total. A day with nothing shows an en dash "—"
  (`strings.common.none`), never "0" and never an empty `td` that could read as missing. `DataTable` has no
  `tfoot`, so the totals row is the last `tbody` row. Every figure is a sum over the one complete read; all agree
  by construction (plan decision 1).
- **AC-5.11 — nothing compares a day with a target.** No threshold, tint, icon, "complete / incomplete", "x of 42 h"
  or colour change depends on a figure. The only emphasis anywhere is `font-medium` on totals, applied identically
  to 1 h and 42 h; the Today badge is about the calendar, not the hours. The component test of the plan (a 42 h week
  and a 1 h week, same markup) is the guard.
- **Today and the future.** Today's column has the Today badge in its header (text, so colour is never the only
  signal); the rest of the column is not tinted (`DataTable` does not style cells, and restyling is forbidden). Days
  after today are blank.
- **Announcements.** When a week (or filters) finish loading, one polite status: "Week 09.11.2026 – 15.11.2026:
  38 h 30 in total." Focus does not move.

States (exactly one per region; Tabs, Filters, header and the card's heading + navigator are always shown)

| Region | Loading | Empty | Error / partial |
|---|---|---|---|
| The grid | `SkeletonRows` (4 rows, `aria-hidden`) + `VisuallyHidden live` "Loading your week…". A week or filter change shows it at once: the previous week's figures are never on screen under the new span | **No filter:** `StatePanel` (h4) "No hours recorded this week" / "Record the hours you worked and they appear here, by project and day." — no action, the header has it (as the List). **A future week:** "This week has not started" / "You can record hours on a day once it has come." **Filters set:** the List's "No entries match these filters" + **Clear filters** (reuse `entries.emptyFiltered`, `filters.clear`) | `ErrorBanner` (warning) "Your hours could not be loaded" + **Retry**, **no partial grid** (the read is all or nothing). A 503 `host_unavailable` **with a deal filter set** is the List's `DealFilterUnavailable` (same words, Retry, "Clear the deal filter"), replacing the grid; nothing is drawn until the link can be read (time-tracking AC-4.11) |
| After a write (save, edit, delete) | the same read runs again, with the same skeleton: no old figure stays under a new answer. If a dialog is open (S8) it keeps the last loaded cell until the new grid lands (S8) | — | as above; a failed re-read after a write that worked shows the error with Retry (honest: the figures on screen would be stale) |
| Source down (`unavailable[]`) | — | — | `HoursBanners` as the List: one polite info banner naming the sources; the rows then read "Name unavailable" |
| Names not visible (AC-5.23) | — | — | the same standing `live="off"` note as the List, whenever any row is unreadable |

- **Retired category row (G4; AC-5.24 as amended 2026-11-17).** Its cells that hold hours open S8 without Add hours, and its empty cells
  are not controls: a retired category is not offered for a new entry (time-tracking AC-3.4), and a preset the
  dialog would then show as "unchosen" is a trap. The row is labelled with "(retired)".
- **Focus after a write or a Retry** (F3, F4, F5). The grid is replaced while it reloads, so the library's "focus
  returns to the opener" would land on nothing: the page asks for focus on `[data-cell=<row>:<day>]` once the new grid
  is there, else on the card's heading (`focusableHeading`). The same `focusRequest` pattern `MyHoursPage` already
  uses for the List ("heading after a delete, Record hours after an edit"). After a **Retry** of a failed week read
  (the error banner's and the deal-filter refusal's alike) the Retry button is gone with the error: when the read
  works, focus goes to **the Week card's heading**; when it fails again, to the banner that replaced it (the
  deal-filter refusal's existing behaviour). Never to `body`.
- **Phone (R5-style check).** The `DataTable` region scrolls horizontally inside the card (focusable, keyboard
  scrollable), the page does not (**checked** at 375). **A visible cue (QE observation → defect, 2026-11-17):** below
  `lg` (1024 px) one line of hint text sits between the card's heading and the grid, "Scroll sideways to see all
  seven days." (`week.scrollHint`), a plain `<p className="mb-3 text-xs text-soft lg:hidden">` (the footnote of
  `TimeListCard` is the precedent). It is shown only with a grid (not while loading, on an empty week, on an error or
  on a replaced state), has no control and no dismissal, and is `aria-hidden="true"`: a cue for the eye, while the
  region is already a labelled, focusable scroll region and a screen-reader user moves by table cell. A sentence
  rather than a shadow at the region's edge: the library draws none (a library change, R4), and 5 px of Tuesday is not
  a cue. Between about 980 and 1023 px it shows although the grid fits; accepted, a breakpoint is sturdier than a
  width measured against figures that change with a longer total. The hint is the removable half of this fix: the
  floor alone already puts a day on a phone's first screen. Both classes (`min-w-28`, `lg:hidden`) are new to the
  suite's one Tailwind sheet, which the shell emits from `hours-ui/src`. The row label is **not sticky** —
  `DataTable` has no sticky column and adding one is a library change that would have to ship in the shell first
  (R4); a cell scrolled away from its label still names its row and day in its accessible name and in its dialog's
  title. If the phone use proves common, an optional `DataTable` prop is the follow-up (not in this feature).

### S8 A cell's entries — the cell dialog (AC-5.15–5.18, 5.20, 5.24)

```
Project: Alpenstrom — portale clienti                                          ×
Wednesday 18 November 2026 · 2 entries, 6 h 30
┌ [Project] Alpenstrom — portale clienti                    4 h  [Edit] [Delete] ┐   ← EntryRow, exactly the List's
│ Development · Activity: Write the offer                                          │
│ Kick-off notes                                                                   │
├ [Project] Alpenstrom — portale clienti                  2 h 30  [Edit] [Delete] ┤
│ Support                                                                          │
└──────────────────────────────────────────────────────────────────────────────────┘
                                                              [Close] [Add hours]
```

- **Dialog, not Drawer, not popover.** `Dialog` `size="lg"` (a plain `dialog`). A `Drawer` is "reference content
  read next to the page, never a form or a confirmation", and this holds Edit and Delete; the library has no popover
  and a menu is for choosing an action, not for listing records. A modal also gives the stack the library already
  handles: Edit's `EntryDialog` and Delete's `ConfirmDialog` open over it, take the keyboard, and hand it back.
- **Title and description.** Title "Project: Alpenstrom — portale clienti" (`<kind>: <name>`; "Other work: Training";
  for an unreadable row "Project: Not visible to you"); description "Wednesday 18 November 2026 · 2 entries, 6 h 30"
  (the dialog's accessible description). Heading and description name the row and the day, which is all a person
  who opened the cell by keyboard needs to know where they are.
- **Rows.** `EntryRow` (moved out of `EntryDayList`, unchanged) in `ListRows`, labelled "Entries on 18 November
  2026" (`entries.dayList`): the kind badge, the name (a link only where the List makes one), work type or category,
  activity, the deal a meeting counts for, the note, the duration, **Edit** and **Delete** with the same
  `aria-label`s as the List. Entries are in the server's order. Edit and Delete exist on every entry, readable or not
  (the author edits and deletes their own, time-tracking AC-2.12).
- **Footer.** `Close` (`ghost`, left) and **Add hours** (`primary`, right: the dialog's one primary). **Add hours is
  absent** on an unreadable row (AC-5.24), on a retired category's row (G4), and never relevant to a future day (a
  future day cannot hold entries). × and Escape close.
- **After a write.** The entries shown are the last grid that loaded (held by the page, not read from the hook's
  current state), so the list does not blank while the week is read again; when the new grid lands, the list updates in place (the same entry ids keep their DOM). **If the cell is
  now empty, the dialog closes** (F5 step 5). If the entry whose Edit or Delete button had focus is gone (it moved
  away or was deleted) focus goes to the dialog's heading, never to the page behind it.
- **States.** The dialog is only opened from a cell that holds hours, so it has no empty state of its own (it closes
  instead); *loading* is the re-read described above (the list stays, the buttons keep working); *error* of the
  re-read is the page's `ErrorBanner` behind the dialog, announced as an alert, with the dialog still usable.
  Edit, Delete and Add hours report their own refusals inside their own dialogs (S2, S3 of time tracking; an entry
  dialog's form-level refusal returns focus to its Save, S4).
- **Edit** opens `EntryDialog` with `entry`; **Delete** opens `DeleteEntryDialog`; both unchanged (AC-5.16, 5.17).

### S9 The entry dialog opened from a week cell (AC-5.12, 5.13, 5.18, WA6)

My hours' **own** dialog, `preset` only — not `fixed`: Day and the row's project, deal, meeting or category are
filled and **can still be changed** (the radio group and the picker are there, holding the row's target, the
Category select holding the row's category). Because the click already chose the day and the target, **focus starts on
Duration** (`focus: 'duration'`; the plan's default `day` is for My hours' own button; no AC asks for either, G7).
Opened from a cell the title is "Record hours" and there is no description. A meeting row's preset needs a meeting
choice with the title (it is on the row's entries); a project or deal row's needs the name (`companyName` null).
All errors on their own fields as in S2; a refusal with no field is the form-level error, with focus back on Save (S4).

---

## Copy

All catalogs en + `it: typeof en`, sentence case, in the strings modules named in the plan (`strings/recordHours.ts`,
`strings/week.ts`, additions to `strings/activity.ts`, `strings/entry.ts`; the hosts' own `strings`). Italian follows
hours-ui's words ("Registra ore", "Le mie ore", "Opportunità", "Riunione", "Altro lavoro", "Attività") and
crm-ui's ("azienda"); **a native speaker should read the Italian before release**.

| Key | en | it |
|---|---|---|
| `recordHours.button` | reuse `entry.record` — Record hours | Registra ore |
| `recordHours.buttonOn(task)` (aria-label) | Record hours on {task} | Registra ore su {task} |
| `recordHours.recorded(duration, name)` | {duration} recorded on {name}. | Hai registrato {duration} su {name}. |
| `recordHours.recordedOther(duration, category)` | {duration} recorded on other work: {category}. | Hai registrato {duration} su altro lavoro: {category}. |
| `recordHours.thisProject` / `thisDeal` | this project / this deal | questo progetto / questa opportunità |
| `recordHours.seeInMyHours` | See in My hours | Vedi in Le mie ore |
| `recordHours.dialog.onProject(name)` / `onThisProject` | Recording hours on the project {name}. / Recording hours on this project. | Stai registrando ore sul progetto {name}. / Stai registrando ore su questo progetto. |
| `recordHours.dialog.onDeal(name)` / `onThisDeal` | Recording hours on the deal {name}. / Recording hours on this deal. | Stai registrando ore sull'opportunità {name}. / Stai registrando ore su questa opportunità. |
| `recordHours.dialog.onOtherWork` | This task is about a company, not a deal, so its hours are recorded as other work. They are not linked to the task. | Questa attività riguarda un'azienda, non un'opportunità, quindi le ore vengono registrate come altro lavoro. Non sono collegate all'attività. |
| `activity.fixed.hint` | Hours are recorded on this task. It can't be changed here. | Le ore vengono registrate su questa attività. Qui non si può cambiare. |
| `activity.fixed.unnamed` | This task | Questa attività |
| `entry.errors.targetGoneFixed.project` / `.deal` | This project is no longer available to you. / This deal is no longer available to you. | Questo progetto non è più disponibile per te. / Questa opportunità non è più disponibile per te. |
| host fallback (projects-ui, crm-ui) | Record hours in My hours | Registra ore in Le mie ore |
| `week.view.label` / `.list` / `.week` | View of your hours / List / Week | Vista delle tue ore / Elenco / Settimana |
| `week.title(range)` | Week {range} | Settimana {range} |
| `week.nav.label` / `previous` / `next` / `thisWeek` | Choose a week / Previous week / Next week / This week | Scegli una settimana / Settimana precedente / Settimana successiva / Questa settimana |
| `week.weekday.short` | Mon Tue Wed Thu Fri Sat Sun | Lun Mar Mer Gio Ven Sab Dom |
| `week.weekday.long` | Monday … Sunday | lunedì … domenica |
| `week.today` | Today | Oggi |
| `week.grid.caption(range)` | Hours by project, deal, meeting and other work, {range} | Ore per progetto, opportunità, riunione e altro lavoro, {range} |
| `week.grid.total` | Total | Totale |
| `week.cell.record(on, day)` | Record hours on {on}, {weekday} {date} | Registra ore su {on}, {weekday} {date} |
| `week.cell.open(duration, on, day, n)` | {duration} on {on}, {weekday} {date}, 1 entry / {n} entries | {duration} su {on}, {weekday} {date}, 1 registrazione / {n} registrazioni |
| `week.loading` | Loading your week… | Caricamento della tua settimana… |
| `week.announce(range, total)` | {range}: {total} in total. | {range}: {total} in totale. |
| `week.empty.title` / `.body` | No hours recorded this week / Record the hours you worked and they appear here, by project and day. | Nessuna ora registrata in questa settimana / Registra le ore lavorate e compaiono qui, per progetto e giorno. |
| `week.emptyFuture.title` / `.body` | This week has not started / You can record hours on a day once it has come. | Questa settimana non è ancora iniziata / Puoi registrare le ore di un giorno quando è arrivato. |
| `week.cellDialog.title(kind, name)` | {kind}: {name} | {kind}: {name} |
| `week.cellDialog.description(day, n, total)` | {day} · 1 entry / {n} entries, {total} | {day} · 1 registrazione / {n} registrazioni, {total} |
| `week.cellDialog.add` | Add hours | Aggiungi ore |
| `week.savedOutside(date)` | Entry saved. {date} is outside the week you are viewing. | Registrazione salvata. Il {date} è fuori dalla settimana che stai guardando. |
| `week.scrollHint` | Scroll sideways to see all seven days. | Scorri di lato per vedere tutti e sette i giorni. |

**The Italian of the success message (QE observation → defect, 2026-11-17).** The first draft, "{duration}
registrate su …", made a participle agree with a duration: "registrate" is feminine plural, which suits "ore" but not
"1 h" or "30 min". "Hai registrato {duration} su …" puts the verb in the person (second singular, the voice of "Stai
registrando ore…" and "la settimana che stai guardando") and nothing agrees with the figure, so it is correct for
30 min, 1 h, 2 h 30 and 24 h, and for "altro lavoro: Formazione". `{duration}` is the short form ("2 h 30"), the same
text in both languages. The other Italian strings of this feature were re-read for agreement (ore, registrazione /
registrazioni, "quando è arrivato" for a day): no other case.

Reused unchanged: `entries.type.*`, `entries.retired`, `entries.dayList`, `entries.emptyFiltered`, `entries.error`,
`entries.edit*`/`delete*`, `names.*`, `filters.recordedOn.label`, `filters.clear`, `common.dismiss`/`close`/`retry`/`none`,
`entry.saved`, `entry.delete.*`, every `entry.errors.*` except the 404 sentence above.

---

## Component inventory

Library in use: **`@operai/ui`** (`operai-ui/`), Tailwind token utilities, TanStack Router, `shell/session` and
`shell/extensions`. Nothing is added to the library: R4 (a library change ships in the shell first) does not apply.

### Reused as they are

| Element | Reuse |
|---|---|
| The offer and the row | `Button` (`secondary`, `sm` on a row), `TaskRow` (`actions`; unchanged), `PageHeader` (`actions`; unchanged) |
| The message | `Banner tone="success" compact` (+ `onDismiss`; no `autoDismiss`, G1), the host's `Saved` shape is **not** reused (the message lives inside the widget) |
| The dialogs | `FormDialog` (via `EntryDialog`), `ConfirmDialog` (via `DeleteEntryDialog`), `Dialog` (the cell dialog); the library's dialog stack |
| The switch | `Tabs` + `tabPanelProps` |
| The Week | `Card` (+ `action`), `DataTable`, `Badge` (kind; Today, accent), `Icon` (`plus`, `chevron-left`, `chevron-right`), `StatePanel`, `SkeletonRows`, `VisuallyHidden`, `ListRows` (cell dialog) |
| The fixed task | `FactList` (one item, `grid-cols-1`), the library's `field-hint` text style for the sentence under it |
| In hours-ui already | `DeleteEntryDialog`, `HoursBanners`, `DealFilterUnavailable`, `ErrorBanner`, `SuccessBanner`, `EntryDayList`'s row (moved to `EntryRow`), `todayZurich`, `readAllEntries`, `lib/names.ts` (`rowName`, `onPhrase`) |
| In the hosts already | `MeetingsSection`'s seam shape (dynamic import of `shell/extensions`, feature check, own boundary) |

### Extended (existing in-repo files; each stays backwards compatible)

| Element | Change | Why |
|---|---|---|
| `EntryDialog` / `EntryDialogModel` | recording mode `preset`, `fixed`, `focus` (plan contract). Design adds: in `fixed` the description sentence (S4), no kind radio / picker, entity-field errors to the form-level error, the 404 variant | S4, S9 |
| `ActivityField` | `lock?: 'hidden' \| 'fixed'` (plan) — `fixed` renders the one-item `FactList` + its own hint, makes no read | AC-3.2, 3.3 |
| `HoursFilters`, `HoursFiltersState` | `view`: no Period (and From / To) in the Week; `isFiltered` ignores period in the Week (G5) | WA5 |
| `HoursShell` | `width="wide"` while `view=week` | C1 |
| `MyHoursPage` | the Tabs panel, the Week branch, focus requests for cells (plan) | US-5 |
| `projects-ui`/`crm-ui` pages and rows | `actions` of `PageHeader`, `TaskRow` (project and CRM task rows; the CRM deal page's header becomes a fragment) | S1, S2 |

### NEW (app level, hours-ui and the two hosts; no new library component)

| New | Why nothing fits |
|---|---|
| `hours-ui/src/RecordHours.tsx` (the widget) | The offer, the dialog wiring, the write and the message live in one remote and must cross the `HostExtension` seam as plain strings (plan decision 2); no library or host component can own a dialog that reads hours-api |
| `RecordHoursAction` ×2 (projects-ui, crm-ui) | The seam wrapper per host (plan decision 6): `@operai/ui` cannot import `shell/extensions` |
| `WeekView` (the card + the grid + its states) | Composition of `Card`, `DataTable`, `Badge`, `Icon`, `StatePanel`, `SkeletonRows`; no library component draws a rows × days grid of buttons, and an editing grid it is not |
| `WeekCellDialog` | Composition of `Dialog`, `ListRows` and the List's `EntryRow`; the one place that lists "the entries of a cell" |
| `WeekNavigator` | Three `Button`s in a group; thin, may live in `WeekView` |
| `ViewSwitch` | Binds `Tabs` to the `view` search param and the copy; thin, may stay inline in `MyHoursPage` |

Ratio: **~17 library components and ~10 in-repo pieces reused**, **6 in-repo files extended**, **6 NEW app-level compositions
(2 of them one thin file per host) and 0 NEW or EXTENDED library components**. None duplicates an existing one;
`WeekNavigator` and `ViewSwitch` are the two a reviewer may fold away.

---

## Accessibility

Common: one h1 (Hours), one h2 (My hours), cards h3, `StatePanel` titles h4, dialog titles h2 in their dialog; the
shell owns `<main>`; every icon-only button has an `aria-label`; icons `aria-hidden`; the focus ring is the
library's; QE checks both themes (no `--muted` text; token utilities only); `prefers-reduced-motion` is the library's.
Colour is never the only signal (kinds and Today are text badges). QE checks NVDA and VoiceOver readback of
"2 h 30" in the new `aria-label`s (the existing design's open point; fallback is the `spoken` style).

**Record hours on a page (S1, S2, S5).**
- Keyboard: the button is a tab stop in header or row order (page: first in the header's actions; row: after the
  row's other buttons); Enter or Space opens the dialog; the group "Actions for <task>" (already on all three hosts)
  names the row.
- Focus: dialog open → Duration; Escape / Cancel / Save → back to Record hours (the library). × on the message →
  Record hours. A fallback link is an ordinary link in the same order.
- ARIA: `aria-haspopup="dialog"`; `Record hours on <task>` as the accessible name where a task name exists (label in
  name); a deal-less CRM task's too (G3).
- No contrast concern: library button, library banner, `.link`.

**The success message (S3).**
- `role="status"`, polite, text complete in the message; the link and × are real controls.
- No auto-dismiss (G1), so "See in My hours" stays reachable (WCAG 2.2.1 Timing Adjustable); × returns focus to
  Record hours.
- A page header that rewraps while the message shows is not announced and moves no focus.

**The entry dialog from a page (S4).**
- Modal, labelled by its title, **described by the read-only sentence** ("Recording hours on the project …"), so the
  target is announced on open even though focus is on Duration. Trap, Escape, × and focus return are
  `useDialogBehavior`.
- The fixed task is a `dl` (term "Activity") in reading order after the description; it is not focusable and not
  `aria-disabled` (it is not a control). The kind radio and the pickers are absent, not disabled.
- Errors: field errors as S2 (`role="alert"`, linked by `aria-describedby`, first invalid field focused);
  the three entity errors (and, with a task fixed, `activity_not_allowed`) are the form-level `.form-error`
  (`role="alert"`); **after any refusal that has no field, focus returns to Save** (it is disabled while the request
  runs, so focus would otherwise be lost; the alert is announced by its role, focus does not move onto it). The same
  for `host_unavailable` and "Something went wrong", in every placement of the dialog (S4).

**My hours with the switch (S6).**
- `Tabs`: a real `tablist` named "View of your hours", one tab stop, ←/→ and Home/End, `aria-selected`; the panel
  is `tabPanelProps` (focusable region, as EstimAI and the CRM do).
- Selecting Week does not move focus off the selected tab; on load the polite "Week …: 38 h 30 in total" is read.
- Keyboard path of the Week: header (Record hours) → tabs → panel → Filters (Recorded on, Project, Deal, Category,
  Work type, Clear filters) → the card's navigator (Previous, This week, Next) → the table's scroll region → the
  cell buttons in row order, left to right.

**The Week grid (S7).**
- **Table semantics, not the ARIA `grid` role** (the decision the plan left). A `<table>` with `scope="col"` day headers and
  `scope="row"` row headers lets a screen reader announce "row header, column header, button" without custom
  keyboard code; it reuses `DataTable` (keyboard-scrollable region, caption, `th scope`). The ARIA `grid` role would need
  a roving tabindex with arrow-key movement, Home/End, PageUp/PageDown and its own tests, and changes how screen
  readers treat the table (they switch to forms mode inside a grid): a new interaction pattern the design system does
  not have, for a surface that is not an editing grid. **Cost, stated:** every cell button is a tab stop, in a typical
  week 30–45 of them. Upgrade path if QE or users find it long: a roving-tabindex layer inside `WeekView` only
  (one tab stop, arrows between cells), no change to the data or the dialogs.
- Accessible names carry row and day ("Record hours on …, Thursday 19 November 2026"; "2 h 30 on …, 2 entries"), so a
  button reached out of table context is complete. Day headers read "Mon 16.11.2026" (+ "Today"); the grid's caption
  names the week; the Total row's header is "Total".
- A future cell and an unreadable row's empty cell are not controls (no tab stop). They are blank `td`s; assistive
  technology reads "blank". Not an error: AC-5.14 and AC-5.24 ask for no offer.
- The week label is the card's heading; the navigator buttons keep focus after a step and "This week" is
  `aria-disabled` rather than `disabled` on the current week. Weeks load with an aria-hidden skeleton and one polite
  "Loading your week…"; errors are an `alert` (Retry: after one that works focus goes to the card's heading, after one
  that fails again to the banner that replaced it); the deal-filter refusal is the List's, `role="alert"`, focus as
  there.
- **Focus after a write:** the grid is replaced while it reloads, so the page restores focus to the cell acted on, or
  the card heading if the cell is gone (S7). Never to `body`.
- Scroll region: a focusable `role="region"` with a label, so a keyboard user can scroll sideways on a phone; the
  one-line scroll hint above it is `aria-hidden` (S7 *Phone*).
- Contrast: kind and Today badges and the plus icon are library tokens; day totals are `--text`.

**The cell dialog (S8) and the dialogs over it.**
- `dialog`, labelled by "<kind>: <name>", described by "<weekday date> · <n entries>, <total>". Focus opens on the first
  control (the library's `auto`: the first Edit); Escape and × close and return focus to the cell button.
- Edit / Delete open stacked dialogs; the library gives Escape and Tab to the topmost; on close focus returns to the
  button that opened it. If that button is gone (the entry moved or was deleted) focus goes to the dialog's heading;
  when the cell empties the dialog closes and focus goes to the cell (or the card heading).
- The list has `aria-label` "Entries on <date>"; each Edit / Delete names the entry (the List's labels), so two entries
  of one cell are told apart by duration and position, as in the List.
- Close then Add hours in DOM order; **Add hours** (`primary`) is the dialog's only primary.

---

## AC coverage and scope

All 41 ACs are accounted for.

| Surface | ACs |
|---|---|
| F1 · S1 | AC-1.1, 1.2, 1.3 (dialog opens fixed, today, focus Duration), 2.1, 2.2, 2.3 |
| F1 · S2 | AC-3.1, 3.6 (and 3.2–3.4 through the preset S4 variants) |
| F1 · S4 | AC-1.3, 2.3, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2 |
| S3 | AC-4.3 (message, link, "nothing else changes"), 4.4 (no Edit, no Delete offered) |
| F2 · S5 | AC-4.5 |
| every string | AC-4.6 |
| F3 · S6 | AC-5.1, 5.2, 5.4, 5.5, 5.21, 5.22 |
| S7 | AC-5.3, 5.6–5.11, 5.14, 5.19 (F6), 5.20, 5.23, 5.24 |
| F4 · S7 · S9 | AC-5.12, 5.13, 5.14, 5.19, 5.20 |
| F5 · S8 | AC-5.15–5.18, 5.20, 5.24 |

ACs with **no UI surface of their own** (a result, a computation or an absence): AC-4.1 and AC-3.5 (what the saved
entry is, visible only in My hours); AC-5.6–5.10 (computed by `weekGrid`; their surface is the grid of S7); AC-5.11
(an absence, guarded by a test); AC-4.4 (nothing is offered).

**UI added that no AC asks for (small, kept, reported — strike any):** the dialog's read-only description sentence and
the deal-less task's explanation of "other work, not linked" (S4); the 404 sentence variant without "Choose another"
(S4); focus on Duration also for dialogs opened from a week cell (S9); the Today badge; the Week's polite
"…: 38 h 30 in total"; the one-line scroll hint under 1024 px (S7); the "This week has not started" variant of the
empty state (S7); the "outside the week you are viewing" confirmation (F6); × returning focus to Record hours; `aria-disabled` on This week. None changes data, a
route or a permission.

**Not designed — scope creep or out of spec, reported:** typing hours into a cell (spec non-goal); "Add row", last
week's rows shown empty (non-goal); Everyone's hours in Week (WA4); export from the Week (WA10); a target, a 42 h mark or
any completeness cue (WA2); an Undo or Edit on the host page message (non-goal); Record hours on a meeting page (A6);
hours shown on the project or deal page (non-goal; specs/20261112-project-hours); drag to move an entry between cells;
copy last week; a roving-tabindex grid and a sticky first column (both noted as upgrade paths, S7, Accessibility);
name links in the Week's row labels (G6); a compact "16–22.11.2026" formatter.

---

## Gaps found in the spec and plan

Drift in the sense of the plan being binding: none of these is designed around; each is reported with the section
it touches and, where one exists, the smallest resolution. **None blocks the design.**

**Resolved 2026-11-17** (main loop, the user deciding G2 and G4): G1, G3, G5 and G7 adopted as recommended (plan,
first amendment); G4 adopted and AC-5.24 amended to cover a retired category's row (ledger D12); G2 read as
recommended and AC-4.2 amended to say so (ledger D13); G6, G8, G9, G10 and G11 stand as designed.

**Amended 2026-11-17** (after the QE verdict, `qe-report.md`): D2 — the claim that focus stays on Save "as it does
today" was false (it falls to `<body>`), so S4 *Errors* (new *Focus after a form-level refusal*, which also names the
fixed task's `activity_not_allowed` as a form-level error, D1's surface), S8, S9 and § Accessibility now state the
target, Save, as a behaviour; S7 and F3 add that after a successful Retry focus goes to the Week card's heading · the
Week at 375 px and the 10 px overflow at 1024 px are one defect with one fix (row-label floor `min-w-44` → `min-w-28`,
plus a scroll hint below 1024 px, `week.scrollHint`; G10 amended) · the Italian success message is "Hai registrato
{duration} su …" (§ Copy).

1. **G1 — the message's link vs its 3 s lifetime** (plan § `hours/RecordHours`, "gone after `CONFIRMATION_DISMISS_MS`";
   AC-4.3 "with a link that opens My hours"). A link inside a message that vanishes in 3 s is unreachable for keyboard
   and screen-reader users (WCAG 2.2.1) and the suite has no other auto-dismissing message with an action.
   *Recommended:* the widget's message has no `autoDismiss` (dismissed by ×, by the next save, or by leaving); one prop.
   The design is written to the plan and flags the line.
2. **G2 — AC-4.2 "refuses it in the same way, with the same message" vs a dialog with no pickers.** S2 puts
   `not_on_project`, `not_involved_in_deal` and the 404 on the entity picker; `fixed` has none, so those land in the
   form-level error with the same sentences, except the 404's "Choose another." (impossible here) which loses that
   clause (`entry.errors.targetGoneFixed`). Reading "same message" as "same refusal, same sentence where it can
   stand" needs the caller's nod.
3. **G3 — the props cannot name a deal-less CRM task** (plan § `hours/RecordHours`: "`activityName` only with
   `activityId`", `on: 'none'` has `activityId ''`). So its button cannot be named "Record hours on <task>" and a
   screen-reader buttons list shows several identical "Record hours". The row group label covers sequential use.
   *Recommended:* allow `activityName` (display only, for the name) with `on: 'none'`.
4. **G4 — a retired category's row** (plan § `weekGrid`: `preset` is `null` for an unreadable name only; spec
   AC-5.12/5.18 "the row's … category set"; time-tracking AC-3.4: a retired category is not offered for a new entry). An empty
   cell would open a dialog whose category reads as unchosen. *Recommended:* `preset: null` for a retired category too,
   so it behaves as an unreadable row (no empty-cell button, no Add hours); its hours stay listed, edited and deleted.
5. **G5 — `isFiltered` counts `period`** (`HoursFiltersState.ts`; plan § `HoursFiltersState.ts` says only "Period is not
   rendered in Week"). In the Week a hidden Period would make "Clear filters" appear (and `clearFilterSearch` reset a
   hidden control). The Week must ignore `period`, `from`, `to` and `group` when deciding `filtered`.
6. **G6 — name links.** The List links a readable name to its project / deal / meeting; plan § `weekGrid`'s `WeekRow` has
   no `href`, and no AC asks for a link in the Week. Designed without; one field to add if wanted.
7. **G7 — focus in dialogs from a week cell.** Plan § `EntryDialog` `focus` defaults to `day`; AC-5.12 is silent. Designed
   as `duration` for week cells (the day and target are known from the click). One argument.
8. **G8 — the re-read UX after a write.** Plan § Sequences says "readAllEntries again"; `useHoursQuery.reload()` goes to
   `loading` (documented in the hook). Designed accordingly (a skeleton, focus restored to the cell, the open cell dialog
   keeps the last loaded cell), which is the least invasive reading; keeping the old grid while it refreshes would need
   a different hook and is not asked for.
9. **G9 — WA5 says the week "takes the place of the Period filter".** The navigator sits in the Week card's header, not in
   the Filters card (S7 explains). Same behaviour, different home; strike if the filter bar is wanted.
10. **G10 — phone.** `DataTable` has no sticky first column, so a name scrolls away from its cells on a phone; mitigated by
    names in every cell's accessible name and dialog title; an optional library prop is the follow-up (R4 order).
    **Amended 2026-11-17 (QE observation):** accepting the scroll did not mean a phone with no figure on its first screen
    and no sign that the grid scrolls (the grid region is 220 px, not the 263 px this gap assumed): the label floor drops
    to `min-w-28` and a hint is shown below 1024 px (S7).
11. **G11 — A7 and S4.** A task row whose assignee is not on the project's team still shows the button and the save is refused
    by hours-api; in `fixed` mode the refusal appears in the form-level error with no way to choose another project, which
    is what A7 and AC-4.2 ask for (stated so QE does not look for a picker).
12. **Copy.** The Italian strings are drafted from hours-ui's and crm-ui's words and need a native reader before release.

No contradiction in the spec itself was found: AC-5.1–5.24, WA1–WA10 and C1 are consistent with each other and with the
plan's address and contracts.
