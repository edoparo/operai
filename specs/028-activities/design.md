---
spec: 028
status: approved
approved: 2026-11-11
---

# Design: Activities — project tasks, My tasks, CRM unavailable state

Component library in use: **`@operai/ui`** (`operai-ui/`, ADR-0050) with Tailwind token utilities (ADR-0051), read
from AGENTS.md and `operai-ui/docs/{building-pages,design-system}.md`. Frontends are federated remotes
(`projects-ui`, `crm-ui`), mounted by the shell. No visual direction section: the design system wins.

Surfaces: **(A)** Tasks card on the project page and its task dialog (projects-ui), **(B)** My tasks page at
`/projects/tasks` (projects-ui), **(C)** the "activities unavailable" state in crm-ui. Notifications (US-6) have no screen:
the only UI fact is the href `/projects/<id>` (the project page, which lands on the Tasks card; no task deep link).

## Flows

Permissions in the UI are UX gating only; the server's 403/409 is the gate (ADR-0014). Each task view carries
`may {edit, delete, complete}`; every row button is gated on those flags, never inferred from scope or assignee. The only
inferred flag is the card's "Add task", which uses `useScope().canManageEntity(project.entity)` and the project state
(no task view exists yet when the list is empty). Errors are branched on the Problem `code`, not the status. Links are built
from ids, never from server hrefs.

### F1 Read a project's tasks (US-3 AC-3.4, AC-3.5)
Project page -> **Tasks** card (below Team, above Contracts) loads on its own, independent of the project resource.
Every `projects:access` holder sees it (AC-3.5). Default view **Open**: earliest due first, no due date last, overdue
rows carry the Overdue badge; a Blocked task carries the Blocked badge and a "Waiting on ..." line (AC-4.2). The
**Done** tab swaps the list for done tasks. Exits: loaded list / empty / card-local error (see Screens). The rest of
the page renders regardless.

### F2 Create or edit a task (AC-3.1, AC-3.2, AC-3.6, AC-3.7, AC-4.1, AC-5.1, AC-5.2)
Needs `canManage` on a writable project (open states) for Add; `may.edit` for Edit. "Add task" (card action) or "Edit" on a row opens `TaskFormDialog`: title, due date, assignee,
blocked by, participants. Submit -> busy -> dialog closes, list reloads, polite "Task added" / "Task saved".
Errors stay inline and keep every typed value (dialog rules). Task type is never offered (AC-3.6 has no UI surface:
the dialog can only create a task). Assignee is optional (AC-3.1): empty means the author (the person saving). Edit of a
task whose assignee left the team (AC-3.7): the assignee select still shows them, marked, and saving without changing it is
accepted by the server (resent unchanged assignee is not revalidated); picking anyone else restricts to PM + team.

### F3 Reassign (AC-3.2, AC-3.7)
Same dialog, assignee select. A departed assignee remains selected until the editor picks someone else; once changed,
the departed person is no longer an option.

### F4 Complete / reopen (AC-3.3, AC-4.2)
Shown when `may.complete` (assignee or manager, also on a closed/cancelled project, AC-3.8). Anyone else: no button. A blocked open task: the
button stays reachable but `aria-disabled`, described by the "Waiting on ..." line. Success -> row leaves the current
view, polite confirmation. 409 `task_blocked` (a blocker reopened meanwhile) -> row-level alert naming
`extras.blockers`, list reloads. 403 `forbidden` -> row alert "You can no longer change this task".

### F5 Delete (AC-3.2, AC-4.1)
`may.delete`. Row "Delete" -> `ConfirmDialog` (danger) naming the task; body says it is also removed as a blocker of
other tasks. Success -> list reloads, confirmation. Failure -> inline in the dialog, dialog stays.

### F6 Blockers and participants (US-4, US-5)
Edited inside F2. Blockers: checkbox list of the project's other open tasks (plus any current blocker already done),
at most 10. Participants: `PersonPicker` (directory filtered to projects access) + removable chips, at most 10; the
assignee is not a participant picker concern (one assignee, separate field). Read side: "With A, B" on the row (AC-5.2).

### F7 My tasks (US-7 AC-7.1 - 7.5)
Tab **My tasks** in the projects tool nav -> `/projects/tasks`. One list, caller's project tasks and caller's pre-sales
tasks (assigned or participating), AC-3.4 order, Open/Done tabs. A pre-sales row carries a **Pre-sales** badge, can be
marked done / not done (CRM rules), and has an **Open in CRM** link; nothing else (AC-7.3). A project row links to its
project and behaves like F4 (toggle whenever `may.complete`; a participant-only row without it is read-only). Caller cannot read the CRM: no pre-sales rows,
no notice (AC-7.4, silent by design). CRM unreachable: project rows still render plus a warning banner "Pre-sales tasks
could not be loaded" with Retry (AC-7.5).

### F8 CRM activities unavailable (AC-1.5; crm-ui)
Company/contact/deal Activity card and the Tasks page: on 503 `host_unavailable` or `maintenance`, the list area shows a
warning banner with Retry and a code-specific line; the page header, other cards and the Tasks filters/tabs stay.
Nothing else in crm-ui changes visually (spec non-goal).

### F9 Notifications (US-6) - no screen
Copy and href live in activities-api. UI note: the bell opens `/projects/<id>`; the project page must be reachable and
show the Tasks card without extra navigation.

## Screens & states

### S1 Tasks card (projects-ui, `ProjectDetailPage`)
- Card title "Tasks" (h3), action "Add task" (secondary, sm, `aria-haspopup="dialog"`) for `canManage` on an open-state project.
- `Tabs` inside the card: Open / Done (views of the same card, no navigation, as crm-ui's TasksPage).
- Data: `GET /tasks?projectId=&status=open|done` (open: due date asc, none last; done: most recent first), paginated.
- Row (`TaskRow`): state badge (Open / Blocked / Overdue / Done), title, meta "Due 12.11.2026 or No due date - Assigned to
  X - With A, B", "Waiting on T1, T2. Finish those first." when blocked, and an actions group: Mark done/Reopen; Edit and
  Delete ghost buttons per `may.edit` / `may.delete`.
- Loading: `Loading` rows + visually-hidden live "Loading tasks...". Empty (Open): "No open tasks" + body; for managers
  the body points at Add task; (Done): "No tasks done yet". Pagination (25) when total exceeds a page.
- Error: card-local `Banner tone="warning"` with Retry. `host_unavailable`: "Tasks cannot be shown right now. The project
  module could not confirm your access. Try again in a moment." `maintenance`: "Tasks are paused for a short
  maintenance. They will be back shortly." Other: Problem detail. 403: `PermissionDenied`-style panel inside the card.
- Closed or cancelled project (AC-3.8): no "Add task" in the card action; rows have no Edit/Delete (`may.edit/delete` false);
  Mark done / Reopen stays where `may.complete`. A one-line `text-soft` explanation under the tabs: "This project is closed or
  cancelled. Tasks can be marked done or not done, nothing else." An empty list shows the empty state without the add pointer.
- Read-only viewers (no manage): the page already shows the "read only" info banner; no Add; rows follow `may`.

### S2 TaskFormDialog (create / edit)
`FormDialog`, title "Add task" / "Edit task", submit "Add task" / "Save", busy "Saving...", focus on Title.
Fields (all `Field`): Title (required, <= 200), Due date (`DateInput`, optional), Assignee (optional `select`, no required
marker: first option "Me (the author)" when empty is allowed, then project manager and team members via `personName`; on
create it defaults to the current user if they are PM or team, otherwise to the empty option, hint "Left empty, the task is
assigned to you"; a departed current assignee is appended as "Name (no longer on the project)"), Blocked by (`CheckboxGroupField`, legend shows "n of 10", extra options disabled at 10; empty list -> hint
"No other open tasks on this project"), Participants (picker + chips, cap message at 10).
Loading of the blocker options: `Spinner`/hint in the field; failure -> field hint with Retry, submit still allowed for
other fields only if the blocker set was not touched (edit sends it unchanged).
Server error mapping (inline, dialog stays open, values kept):

| Code / status | Shown |
|---|---|
| 422 validation `extras.field` | on that field |
| `assignee_not_on_project` | Assignee: "Choose the project manager or a team member" (only for an explicit, changed choice) |
| 409 `host_read_only` | dialog alert "This project is closed or cancelled; its tasks can no longer be changed" (project closed meanwhile; list reloads) |
| `blocker_cycle`, `blocker_is_self`, `blocker_not_in_host` | Blocked by: cycle -> "These tasks would wait on each other"; others generic |
| `owner_not_app_user` / participant not a projects user | Participants field |
| `type_not_allowed` | not reachable; generic dialog alert |
| 403 `forbidden` | dialog alert "You are not allowed to change this project's tasks" |
| 404 | dialog alert "This project or task no longer exists" |
| 503 `host_unavailable` | dialog alert "Your access could not be confirmed. Nothing was saved. Try again." |
| 503 `maintenance` | dialog alert "Tasks are paused for maintenance. Nothing was saved." |

### S3 Delete confirmation
`ConfirmDialog tone="danger"`, title "Delete task?" (names it), confirm "Delete task" / busy "Deleting...", error inline.

### S4 My tasks page (`/projects/tasks`)
`PageHeader` (h2 "My tasks", description "Tasks assigned to you or where you take part, from projects and from the CRM"),
no page action (no "New task": scope). `Tabs` Open / Done. List of `TaskRow`:
project row -> badge state, title, meta + "Project: <name>" (router `Link`, id-built); pre-sales row -> `Pre-sales` neutral badge before
the title, "Company: <name>", actions: Mark done/Reopen (when `may.complete`) and "Open in CRM" (plain `<a>` to `/crm/companies/<id>`, built from the
id, outside this router's basepath, like crm-ui's meeting link).
- Loading: `Loading`. Empty: "Nothing on your list" (Open) / "No finished tasks yet" (Done).
- Partial: warning `Banner` above the list when `unavailable` includes `crm` (AC-7.5), role status, Retry reloads.
- Failure of the whole call: `LoadFailure`-style banner with the same two 503 variants as S1.
- A row action error shows inline in that row (`role="alert"`), as in crm-ui's ActivityItem.

### S5 CRM unavailable (crm-ui)
`ActivityTimeline` and `TasksPage` replace `LoadFailure` for Problem `code` `host_unavailable`/`maintenance` (not any 503) with the two messages of S1
under CRM wording ("Activities cannot be shown right now ..."). Works with existing `Banner` + Retry; the card/page frame
renders. Dialog-save errors for the same codes mirror S2's last two rows.

### S6 Navigation
`ProjectsShell` currently has no tabs. Add `TabNav` ("Projects", "My tasks") exactly like `CrmShell` (`tabLinkClassName`,
visible to all `projects:access` holders, no hidden tabs). Route `/tasks` added to `router.tsx` (static beats `/$id`).

## Component inventory

Library: `@operai/ui` (from AGENTS.md / `operai-ui/src/index.ts`).

### Decision: what is lifted into `@operai/ui`
AGENTS.md: a pattern a second app needs goes into the library with a story and a test; never copied. projects-ui needs
the same task row (state, meta, waiting hint, actions) and the same participant chips as crm-ui. So **lift only the
presentational parts**; everything bound to an API, a permission rule or an app's strings stays app-side:
- **Lift** `TaskRow` and `PersonChips`.
- **Keep app-specific**: the item wrapper that calls `complete/reopen/delete` (differs by rule: CRM any reader / author-only;
  projects assignee-or-manager / manager), `TaskFormDialog` (CRM: type, company, contact, deal, `PersonPicker` for assignee;
  projects: assignee limited to PM + team, no type/company), Tasks card, My tasks page, state-badge map (a 4-entry map
  per app, the house rule "one domain-to-meaning map per app").
- **Not lifted**: blocker picker (the library's `CheckboxGroupField` already is it) and the assignee picker (a plain
  `select` over a list the project already holds; the library `PersonPicker` is for directory lookups).
- **crm-ui adopts both now** (owner decision): `ActivityItem` renders through `TaskRow` (its meeting link, body, company link,
  author line and CRM copy fill the row's slots, so output is unchanged) and `ParticipantsField` renders its chips through
  `PersonChips`. Guard: `ActivityItem.test.tsx`, `CrmShell.test.tsx` and the CRM e2e (activities, tasks, blockers) stay green
  unchanged; CRM strings are untouched (US-1). Deliberate visible delta: a blocked Mark done becomes `aria-disabled` instead
  of `disabled` (it joins the tab order and its hint is read), so both apps follow design-system rule 5; if an existing test
  asserts the `disabled` attribute it is updated to `aria-disabled` and the click is still ignored.

| Element | Component | Source |
|---|---|---|
| Tasks card frame, title, action | `Card` | `@operai/ui` |
| Open/Done views | `Tabs`, `tabPanelProps` | `@operai/ui` |
| Row list | `ListRows`, `listRowClassName`, `listRowMetaClassName` | `@operai/ui` |
| Row layout | `TaskRow` | **NEW (library)**: second app (projects-ui) needs crm-ui's row structure; nothing generic exists |
| State badge | `StatusBadge` + app map (open pending/blocked attention/overdue attention-or-failed/done settled) | `@operai/ui` + projects-ui `Badges.tsx` entry |
| Pre-sales badge | `Badge tone="neutral"` (category metadata, like entity) | `@operai/ui`, entry in projects-ui `Badges.tsx` |
| Row buttons | `Button` (default / ghost, sm) | `@operai/ui` |
| Create/edit dialog | `FormDialog`, `Field`, `DateInput`, `CheckboxGroupField`, `focusFirstInvalid` | `@operai/ui` |
| Participant picker | `PersonPicker` adapter `projects-ui/src/components/PersonPicker.tsx` (`appId="projects"`) | in-repo |
| Participant chips | `PersonChips` | **NEW (library)**: lifted from crm-ui `ParticipantsField`; second app needs it |
| Delete confirmation | `ConfirmDialog` | `@operai/ui` |
| Errors, notices, confirmations | `Banner`, `Saved` (`LoadState.tsx`), `LoadFailure`, `Loading` | `@operai/ui` + in-repo |
| Empty states | `StatePanel` | `@operai/ui` |
| Pagination | `Pagination` | `@operai/ui` |
| My tasks header, nav | `PageHeader`, `TabNav`, `ToolLayout` | `@operai/ui` |
| Permissions, user | `useScope`, `useCurrentUserId`, `useResource` | in-repo (projects-ui `hooks/`) |
| Tasks card | `TasksCard` | **NEW (projects-ui)**: composition; the project page has no tasks today |
| Task item wrapper | `ProjectTaskItem` | **NEW (projects-ui)**: binds `TaskRow` to activities-api and the project rules |
| Task dialog | `TaskFormDialog` | **NEW (projects-ui)**: fields and rules differ from `ActivityFormDialog` |
| My tasks page | `MyTasksPage` | **NEW (projects-ui)**: new route, merges two task kinds |

Reuse/NEW: 22 reused entries, 6 NEW (2 library lifts, 4 projects-ui compositions), unchanged. crm-ui: 0 NEW; `ActivityItem`
and `ParticipantsField` now consume `TaskRow` / `PersonChips`, plus the S5 states.

New strings: projects-ui `strings/tasks.ts` (en + complete it, sentence case) and `nav` additions; crm-ui: two unavailable
messages. Dates via `formatDate`; icons via `Icon`; no emoji.

## Accessibility

- **Tasks card / tabs**: card title h3 under the page h2; `Tabs` is a real tablist (arrow keys, Home/End), panel via
  `tabPanelProps`. Add task and Edit/Delete have `aria-haspopup="dialog"`; each row's action group is
  `role="group"` with an `aria-label` naming the task (Edit and Delete are otherwise ambiguous across rows).
- **Blocked state** (hotspot): Blocked is a badge with glyph + text (not colour alone). The disabled-looking Mark done uses
  `aria-disabled="true"` with `aria-describedby` pointing at the visible "Waiting on ..." line (design-system rule 5: the user
  must reach it to learn why); the handler ignores the click. Overdue likewise badge + text. (Shared `TaskRow`, so crm-ui gets the same
  behaviour.)
- **Focus after row actions** (hotspot): when Mark done / Delete removes the row from the current view, focus moves to the
  selected tab (stable, visible), never to `body`; the confirmation is a polite live region (`Saved`). On a failed action
  focus stays on the button and the row `role="alert"` is announced.
- **Dialogs**: standard `useDialogBehavior` (trap, Escape, focus return to the opener; after delete/edit success to the
  tab). Focus on Title; on invalid submit `focusFirstInvalid`. Errors are text, tied to fields by `Field`.
- **Blocker checkbox group** (hotspot): fieldset + legend ("Blocked by, n of 10 selected"); at the cap the remaining boxes
  are disabled with a visible reason; done blockers are labelled "(done)".
- **Participant chips**: list with `aria-label`, each remove button `aria-label="Remove <name>"`; adding announces via the
  picker's results live region; removal returns focus to the picker input.
- **Assignee select**: native select; the departed-assignee option text states why it is special (text, not colour).
- **My tasks**: Pre-sales is text in a badge, placed before the title so it is read first; "Open in CRM" is a link whose
  text includes the task title via `aria-label`/visually hidden text (many identical links otherwise). The partial-unavailable
  banner is `role="status"` so it is announced on load; Retry is a button.
- **Nav**: `TabNav` labelled landmark, `aria-current="page"` from the router link.
- **Both themes**: all colours via tokens and `*-text`; no `--muted` text.

## Self-critique

One pass against the design.md checklist: loading/empty/error states exist for S1, S2, S4 and S5; every NEW has a
justification; flows map to ACs; changed parts (assignee optional, host_read_only state, may flags, TaskRow adoption) re-checked: each has its state, copy and a11y note (table below); a11y items are concrete. Fixes made in the pass: added the focus rule after a
row leaves the view; separated "cannot read CRM" (silent) from "CRM down" (notice).

AC coverage: AC-3.1/3.2/3.7/3.8/4.1/5.1 -> F2/F3/F5/F6 and S1; 3.3/4.2 -> F4; 3.4/3.5/5.2 -> F1; 7.1-7.5 -> F7 (7.1 is crm-ui, behaviour
unchanged); 1.5 -> F8. No UI surface: AC-3.6 (UI only offers tasks), 4.3, 6.x, 8.x, all of US-2 and AC-1.1-1.4.

Scope notes: not designed because no AC asks for them: a task description/body field, an assignee filter or "New task" on My
tasks, task counts on the projects list, a per-task deep link, a departed-assignee marker on the list. Added although not
named by an AC (needed to reach/operate a named one): the My tasks tab (access path), the Done tab on My tasks (AC-7.3
"not done"), the "(no longer on the project)" label in the edit dialog only (AC-3.7 needs the editor to see it), and the closed-project
explanation line (AC-3.8 needs the user to learn why actions are missing).
