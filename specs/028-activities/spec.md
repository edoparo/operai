---
id: 028
slug: activities
status: done
done: 2026-11-11
rigor: production
created: 2026-11-10
approved: 2026-11-10
depends-on: 017, 025
---

# Activities — one place for CRM and project activities and tasks

> **Origin.** Decided on 2026-11-10 while reviewing PR #7 (specs/025): the CRM's activities
> and tasks (specs/017 US-4, US-6, US-8) and the project tasks of specs/027 US-1 are the same
> concept, an **activity**, and are kept in one place shared by both tools. This spec takes
> over specs/027 US-1 (project tasks); specs/027 keeps the discussion threads.

## Problem

The CRM already records activities and follow-up tasks, and the project module is about to
need tasks of its own (specs/027). Built twice, the two would drift apart in rules, look and
behaviour, and a person who works on both a deal and a project would have two unrelated to-do
lists. When a deal is won and becomes a project, nothing tells the people involved which work
was pre-sales and which is delivery. The CRM's existing records must keep working exactly as
they do today while this changes.

## Domain language

- **activity** — something that happened or must happen about a client relationship or a
  project, recorded by an Operai user. Either **pre-sales** or **operational**.
- **pre-sales activity** — an activity about a CRM company (and optionally one of its contacts
  and deals): a note, call, meeting, email or task (specs/017 US-4).
- **operational activity** — an activity about a project (specs/025). Only tasks.
- **task** — an activity someone must do, with one assignee and an optional due date, open
  until done (specs/017 AC-4.3).
- **My tasks** — the tasks assigned to the caller or in which the caller takes part
  (specs/017 AC-8.2).

## User stories

### US-1 The CRM keeps working as it does today
As a CRM user, I want every activity and task behaviour I rely on to stay the same, so that
moving activities to a shared place costs me nothing.

- AC-1.1 Given the change is deployed, when a CRM user uses activities and tasks, then every
  acceptance criterion of specs/017 US-4 (activities and tasks), US-6 (blocked tasks) and
  US-8 (participants) still holds, verified by the same scenarios as before the change,
  except the one narrowing accepted by the owner and recorded in Amendments 2026-11-11 (the
  context line of the unblocked-task notice when the completion comes from EstimAI).
- AC-1.2 Given a deal whose estimate was requested (specs/017, specs/019), when the estimate
  request succeeds, then the deal has an open estimate task assigned to the technical
  contact; when the estimate request fails at any step, then no estimate task is left behind.
- AC-1.3 Given an estimate task, when the estimate is closed in EstimAI, then the task is done;
  when it is reopened in EstimAI, then the task is open again (ADR-0073); a notice that is
  repeated or arrives out of order changes nothing.
- AC-1.4 Given a meeting linked to a deal (specs/021 US-14), when it is linked, changed,
  relinked, unlinked or deleted in Meetings, then the deal's meeting activity is created,
  updated, moved or removed exactly as before.
- AC-1.5 Given the CRM pages (company, contact, deal, Tasks), when the activities cannot be
  reached, then the page still loads and shows that activities are unavailable, instead of
  failing as a whole.

### US-2 Existing CRM activities move without loss
As a CRM user, I want the activities and tasks recorded so far to be there after the change,
so that no history is lost.

- AC-2.1 Given the CRM activities, participants and "blocked by" links recorded before the
  change, when the move completes, then each one exists afterwards with the same author,
  type, text, dates, company, contact, deal, assignee, completion, participants and blockers,
  and the CRM shows the same lists as before.
- AC-2.2 Given the move has run once, when it runs again, then nothing is duplicated or
  changed.
- AC-2.3 Given the move, when it completes, then it reports how many activities, participants
  and blockers it found and moved, and any record it could not move with the reason; a move
  that cannot account for every record does not remove anything from the CRM.
- AC-2.4 Given an estimate task or a meeting activity that existed before the move, when it is
  moved, then AC-1.3 and AC-1.4 keep working for it.
- AC-2.5 Given the activities are being moved, when the move is under way, then recording and
  changing activities and tasks may be paused for a short, announced time; while paused, every
  CRM page still loads and says that activities are unavailable (AC-1.5), and no activity or
  task can be recorded or changed in the CRM or in Projects; every activity and task recorded
  before the pause is still there afterwards, unchanged, and recording and changing them works
  again once the move is complete and accounted for (AC-2.3).

### US-3 Project tasks
As a project manager, I want to list what is left to do on a project and who does it, so that
the team works from one list. (Takes over specs/027 US-1.)

- AC-3.1 A project task has a title (required), an optional due date and an optional
  assignee; when none is given it is assigned to its author, as in the CRM (owner,
  2026-11-10). An assignee chosen explicitly must be the project's project manager or a team
  member (specs/027 AC-1.1).
- AC-3.2 Creating, editing, reassigning and deleting a project task requires the
  manage-projects capability for the project's entity (specs/027 AC-1.2); without it the
  action is refused and nothing changes.
- AC-3.3 The assignee of a project task can mark it done or not done without the
  manage-projects capability (specs/027 AC-1.3).
- AC-3.4 The project page lists open tasks, earliest due first and no due date last, marks
  overdue ones, and can show done ones instead (specs/027 AC-1.4).
- AC-3.5 Every holder of the project module's access reads every project's tasks
  (specs/027 AC-3.1).
- AC-3.6 A project task can only be about a project; it is never a note, call, meeting or
  email — such a request is refused.
- AC-3.7 Given the assignee of an open project task leaves the project's team, or the project
  manager changes, then the task keeps its assignee and stays listed until someone who may
  edit it reassigns it; the project-manager-or-team rule applies only when a task is assigned
  (owner, 2026-11-10).
- AC-3.8 Given a project that is closed or cancelled, then its tasks stay readable and can
  still be marked done or not done (AC-3.3), but creating, editing, reassigning and deleting
  them is refused and nothing changes (owner, 2026-11-10).

### US-4 Project tasks blocked by other tasks
As a project manager, I want to record that a task can only start after others, so that
nobody acts too early and the person waiting knows when to go ahead.

- AC-4.1 A project task may be blocked by up to 10 other tasks of the same project, set by
  whoever may edit it (AC-3.2). A task cannot block itself, a choice that would make tasks
  wait on each other is refused, and deleting a task removes it as a blocker.
- AC-4.2 While any blocker is open the task shows as **Blocked**, lists what it waits on, and
  cannot be marked done (refused as blocked). Reopening a blocker blocks an open task again;
  a task already done stays done.
- AC-4.3 A pre-sales task and a project task never block each other.

### US-5 Colleagues who take part in a project task
As a project manager, I want to record which colleagues take part in a task, so that the
record says who is involved.

- AC-5.1 A project task may name up to 10 participants: Operai users with access to the
  project module, set by whoever may edit it (AC-3.2). The task keeps exactly one assignee.
- AC-5.2 The task shows its participants ("With …").

### US-6 Notifications for project tasks
As a project team member, I want to hear when a project task concerns me, so that I do not
have to check the list.

- AC-6.1 Given a project task is assigned to someone other than the person assigning it, then
  the assignee is notified in-app and by email, and the notification opens the project.
- AC-6.2 Given a colleague is added as a participant by someone else, then they are notified
  in-app only.
- AC-6.3 Given the last open blocker of a project task is done, then the task's assignee is
  notified in-app and by email, unless they completed it themselves.
- AC-6.4 Notification copy exists in English and Italian; a notification that cannot be sent
  never undoes or blocks the action it announces.

### US-7 My tasks in each tool
As someone who works on deals and projects, I want my tasks where I work, so that I do not
miss what is mine.

- AC-7.1 Given the CRM's Tasks list, then it shows pre-sales tasks only, never project tasks.
- AC-7.2 Given the project module's My tasks list, then it shows the caller's project tasks
  and the caller's pre-sales tasks together, in the same order as AC-3.4, and every pre-sales
  task carries a visible **Pre-sales** badge.
- AC-7.3 Given a pre-sales task in the project module's list, then the caller can mark it done
  or not done there under the CRM's rules (specs/017 AC-4.3, AC-6.2), and can open it in the
  CRM for anything else; no other change to it is possible from the project module.
- AC-7.4 Given a caller who cannot read the CRM, then no pre-sales task appears in their
  project module list.
- AC-7.5 Given the CRM cannot be reached, then the project module's list still shows the
  caller's project tasks and says that pre-sales tasks could not be loaded.

### US-8 Who sees and changes an activity
As the owner of client and project data, I want activities to follow the access rules of the
tool they belong to, so that sharing the storage shares nothing else.

- AC-8.1 A pre-sales activity is read and changed only under the CRM's rules (specs/017 US-4,
  US-5); a project task only under the project module's rules (US-3).
- AC-8.2 Given the tool an activity belongs to cannot confirm the caller's access, then the
  read or change is refused and nothing changes (never allowed by default).
- AC-8.3 Given a caller with no access to an activity, then the answer is the same as for an
  activity that does not exist.
- AC-8.4 Given a CRM contact is erased (specs/017), then no activity refers to it afterwards;
  if that cannot be ensured, the erasure is refused and the contact is unchanged.

## Non-goals

- **Operational activities other than tasks** (notes, calls, meetings, emails on a project):
  project discussions are specs/027's threads.
- **Turning a pre-sales activity into an operational one** or moving activities when a deal
  becomes a project (specs/026 hand-off may revisit).
- **Editing a pre-sales task from the project module** beyond done/not done (AC-7.3).
- **A suite-wide My tasks screen** outside the CRM and the project module.
- **Changing CRM activity rules or copy**: US-1 is a move, not a redesign (except as recorded
  in Amendments 2026-11-11).
- **Time tracking, effort or due-date reminders** on any task.
- **Deleting companies or deals** (the CRM does not delete them today); if it ever does, its
  activities must be handled by that future change.

## Constraints

Technical decisions taken by the user on 2026-11-10, recorded verbatim in substance:

- A new backend-only service, `activities-api` (Bun + Hono + Prisma, own database
  `activities`, EU region, port 8087), owns all activities; it has no frontend of its own.
- `crm-ui` and `projects-ui` call `activities-api` directly through `shell/session`; the CRM
  and the project module do not proxy it.
- `activities-api` delegates every access decision to the tool the activity belongs to, asked
  as the caller (ADR-0059 resolve pattern), and fails closed.
- Pre-sales activities keep the types note, call, meeting, email and task; operational
  activities are tasks only.
- Production holds few CRM activity records and very few users: a one-off, re-runnable import
  that keeps record identities, then the CRM's activity storage is removed
  (expand → copy → contract).
- crm-api stays the Meetings host and forwards meeting changes; notifications are sent by
  `activities-api` as its own service principal.
- The task row becomes a shared `@operai/ui` component and the CRM adopts it in this change
  (owner, 2026-11-10, design stage); the CRM's behaviour and copy stay as US-1 requires.
- Implemented on branch `feat/projects` (PR #7).

## Amendments

- 2026-11-10 (design stage, owner): AC-3.1 assignee optional with the author as default;
  AC-3.8 added (closed/cancelled projects); shared task row adopted by the CRM (Constraints).
- 2026-11-11 (drift fix, QE D5): AC-2.5 written. It records the owner's 2026-11-10 decision
  (a short announced pause in recording activities during the move is accepted), which Open
  questions, the plan, tasks, the runbook and ADR-0083 already cited but the spec never
  stated. No new scope.
- 2026-11-11 (implementation drift, owner): accepted exception to US-1 / AC-1.1 and to the
  Non-goal "Changing CRM activity rules or copy". Before this spec, the `task_unblocked`
  notice (specs/017 AC-6.3) labelled each freed task with its own deal ("Deal: <its title>.").
  When the completion of an estimate task comes from EstimAI (the estimate is closed,
  ADR-0073, AC-1.3), the notice now labels a freed task with the completed task's deal if the
  freed task is on that same deal, and otherwise with its company ("Company: <name>."). It
  therefore differs from before only for a task blocked by an estimate task that sits on a
  different deal of the same company. Unaffected: completions made by a user in the CRM or in
  Projects, which keep the full labels, and every other notice and rule. This is a correction
  recorded after the fact, not new scope and not a new AC. See plan.md § System routes
  ("Completion `context`", "Known narrowing") and ADR-0082 (amendment 2026-11-11).

## Open questions

- None. Resolved by the owner on 2026-11-10: a short pause in recording CRM activities during
  the import is accepted (AC-2.5); a project task keeps its assignee when they leave the team
  (AC-3.7).
