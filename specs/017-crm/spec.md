---
id: 017
slug: crm
status: in-progress
rigor: mvp
created: 2026-11-01
approved: 2026-11-01
---

# CRM — companies, contacts, pipeline and activities

> **Approval note.** This spec was written and approved in one autonomous session: the
> product owner (Matteo Codogno) asked for the CRM to be built end to end on a branch
> "in complete autonomy, taking the decisions and documenting them all". Every choice a
> spec gate would normally put to the user is recorded, with its reason and the
> alternative rejected, in [decisions.md](./decisions.md). Treat that file as the list
> of things to review before merging. Rigor is `mvp`: tests on the domain rules and the
> authorization matrix, no eval gate yet.

## Problem

wellD sells consulting projects from two legal entities (wellD CH, wellD IT). Who the
company talks to, which opportunities are open, what was said in the last call and who
promised to follow up live in personal mailboxes, spreadsheets and people's heads. When a
consultant is on holiday, nobody knows a client's last contact; the pipeline value the
partners discuss at the monthly meeting is assembled by hand. Operai already knows every
employee, both entities and the suite's permissions; it lacks the commercial side.

## Domain language

- **company** — an organisation wellD has, had or wants a commercial relationship with.
  Has a **relationship status**: `prospect` (no contract yet), `customer` (at least one
  engagement), `former` (no longer a client). Belongs to the wellD **entity** that holds
  the relationship (`welld_ch` | `welld_it`, as in specs/007).
- **account owner** — the Operai user responsible for a company (and, separately, for a
  deal). Always an Operai account; defaults to whoever created the record.
- **contact** — a person at (usually) a company: name, email, phone, job title. A contact
  is a **third party's personal data**, not an Operai user.
- **deal** — a sales opportunity with one company: a title, an amount in integer minor
  units with a currency (`CHF` | `EUR`), an expected close date and a **stage**.
- **stage** — `lead` → `qualified` → `proposal` → `negotiation` → `won` | `lost`. The
  first four are **open**; `won` and `lost` are **closed**. A closed deal may be reopened.
  Shown as "Offer in preparation" (`proposal`: the estimate is ready, the offer is being
  written or revised) and "Offer sent" (`negotiation`: the client has the offer). The
  boundary is sending the offer (specs/018 AC-4.6; owner, 2026-11-02).
- **win probability** — a fixed percentage per stage (lead 10, qualified 25, proposal 50,
  negotiation 75, won 100, lost 0) used for the **weighted amount** = amount × probability.
- **pipeline** — the open deals grouped by stage, with per-currency totals and weighted
  totals; plus the deals won and lost in the current calendar year.
- **activity** — something that happened with a company: a `note`, `call`, `meeting` or
  `email`, with a subject, an optional body and the moment it occurred. Optionally about one
  contact and/or one deal of that company.
- **task** — an activity of type `task`: something someone must do, with an optional due
  date and an **assignee**; it is open until completed.
- **archived** — a company or contact hidden from the default lists but kept with its
  history. Archiving is reversible; it is not deletion.
- **erasure** — the irreversible deletion of a contact's personal data (GDPR art. 17).

## User stories

### US-1 Companies
As a wellD employee with CRM access, I want one shared list of the companies we work
with, so that anyone can see who a client is and who owns the relationship.

- AC-1.1 The companies list shows name, status, entity, industry, city, owner, number of
  contacts and of open deals; it is paginated (25 per page) and sorted by name.
- AC-1.2 The list can be searched by name (case-insensitive, substring) and filtered by
  status; archived companies are hidden unless "show archived" is selected.
- AC-1.3 Creating a company requires a name, a status and an entity; website, industry,
  city, country (ISO 3166 alpha-2) and notes are optional. The owner defaults to the creator.
- AC-1.4 Company names are unique, case-insensitively, including archived companies. A
  duplicate is refused with a message naming the existing company and a link to it.
- AC-1.5 Any CRM user can edit a company, change its owner to another active Operai user,
  archive and unarchive it.
- AC-1.6 Two people editing the same company at once cannot silently overwrite each other:
  the second save is refused and the person is asked to reload (ADR-0038 posture).
- AC-1.7 The company page shows its details, its contacts, its deals and its activity
  timeline (newest first, paginated).
- AC-1.8 When a deal moves to `won`, its company becomes `customer` if it was `prospect`
  or `former` (a recorded change: the company's version goes up). A customer is untouched.
- AC-1.9 A `customer` with at least one won deal, none won in the last 12 months and no
  open deal reads as `former`, everywhere (the record, the list and the status filter),
  with a notice on its page saying why. Derived on read, never written (ADR-0013); a new
  open or won deal makes it a customer again. A customer that never won a deal keeps the
  status set by hand. (O2, owner, 2026-11-02.)

### US-2 Contacts
As a CRM user, I want to record the people we deal with, so that a colleague can reach
the right person.

- AC-2.1 A contact has a first and last name (required), and optional email, phone, job
  title, company and notes.
- AC-2.2 The contacts list is searchable by name or email, filterable by company, paginated,
  and hides archived contacts unless asked.
- AC-2.3 A contact can be edited, archived and unarchived by any CRM user, with the same
  concurrent-edit protection as companies. A contact can also be edited straight from its
  company's page, without leaving it (owner, 2026-11-04).
- AC-2.4 A holder of the **erase contact** capability can erase a contact: the contact row is
  deleted and every activity that referenced it loses the reference. Erasure is confirmed in
  a dialog that says it cannot be undone. Nobody else can erase.

### US-3 Deals and pipeline
As a salesperson, I want to track opportunities through stages, so that the partners see
the pipeline without a spreadsheet.

- AC-3.1 Creating, editing and moving a deal requires the **manage deals** capability,
  scoped to the deal's entity (ADR-0015 entity condition). Every CRM user can read deals.
- AC-3.2 A deal requires a company (not archived), a title and a currency. The amount is
  optional (≥ 0 when given) and can be set or cleared later: a lead often has no figure until
  the estimate or qualification (owner, 2026-11-04). A deal with no amount counts in its
  stage but adds nothing to the pipeline totals, and an offer drafted from it leaves the
  prices for the user to fill;
  the entity defaults to the company's; the stage defaults to `lead` and must be open at
  creation; the owner defaults to the creator.
- AC-3.3 A deal moves to any stage. Moving to `won`/`lost` records the closing moment;
  moving to `lost` accepts an optional reason. Moving a closed deal back to an open stage
  reopens it and clears the closing moment and reason. The stage dialog says what the chosen
  stage means and its win probability.
- AC-3.4 The pipeline screen is a board with one column per stage, Won and Lost included,
  with its deals (title, company, amount, expected close date, owner) and, per stage, what it
  means, the count and per-currency total; open stages also show the win probability and the
  weighted total. Won and Lost hold the deals closed this year. Currencies are never summed
  together. A deal the user may manage moves by dragging its handle to another column, with
  the pointer or the keyboard; a drop on Lost asks for the optional reason first (amended
  2026-11-01, D-25).
- AC-3.5 A user without the capability, or outside its entity scope, sees deals but no
  create/edit/move controls; the server refuses such a write with 403.

### US-4 Activities and tasks
As a CRM user, I want to log calls, meetings, emails and notes and to set follow-up tasks,
so that the history of a relationship is in one place.

- AC-4.1 An activity belongs to a company and may reference one of its contacts and/or one
  of its deals (a reference to another company's contact or deal is refused).
- AC-4.2 Only the author can edit or delete an activity.
- AC-4.3 A task has an optional due date and an assignee (default: the author, any active
  Operai user otherwise). Any CRM user can complete or reopen a task.
- AC-4.4 "Tasks" lists the caller's open tasks by default, or everyone's, or one colleague's
  (an "Assigned to" filter whose colleagues are the people tasks were assigned to; D-26), earliest due first (no due date last),
  marks overdue ones, and can show completed ones instead. It also creates a task directly:
  the user picks the company in the dialog (added 2026-11-01 after the first local use, when
  creating a task only from a company, contact or deal page proved hard to find).
- AC-4.5 The company, contact and deal pages each show the activities that concern them.

### US-5 Access
- AC-5.1 The CRM appears in the suite only for holders of `crm:access` (ADR-0007); every
  API route requires it (403 otherwise) and an `auth` outage is a 503, never an allow
  (ADR-0014).
- AC-5.2 Admins hold every CRM capability unscoped. A new system role `sales` holds
  `crm:access` and entity-scoped `deal:manage`. Employees get nothing by default.
- AC-5.3 People are displayed by their live Operai name (ADR-0039); a deleted user shows as
  such, never as a stale name.
- AC-5.4 All copy exists in English and Italian (INC-24/25); dates and amounts use the
  library formatters.

### US-6 Tasks blocked by other tasks
As a CRM user, I want to record a task today that can only be done after other tasks, so
that nobody acts too early and the person waiting knows when to go ahead (owner,
2026-11-04). Example: "Organise a call with Avanzato" waits on the deal's estimate task.

- AC-6.1 A task may be **blocked by** up to 10 other tasks of the same company (on any of
  its deals or none), chosen among its open tasks when the task is created or edited by its
  author. A task cannot block itself, and a choice that would make tasks wait on each other
  is refused. Deleting a task removes it as a blocker.
- AC-6.2 While any blocker is open the task shows as **Blocked**, lists what it waits on,
  and cannot be marked done (the API answers 409 `task_blocked`). Reopening a blocker blocks
  an open task again; a task already done stays done.
- AC-6.3 When the last open blocker is done (marked done, or the estimate task closed by
  marking the estimate ready), the blocked task's assignee is notified in-app and by email,
  unless they did it themselves.

### US-7 Where a company or a lead came from
As a salesperson, I want to record how a company and each lead reached us, so that we know
which channels bring work (owner, 2026-11-04).

- AC-7.1 A company and a deal each have an optional **source**: direct inbound, direct
  outbound, event, referral or other. For an event, a referral or other, an optional
  **detail** (≤ 200 characters) names which event, who referred it, or what else; changing
  to a source that takes no detail, or clearing the source, drops the detail.
- AC-7.2 A new deal starts from its company's source and detail, and can change them. The
  source is not money: every CRM user reads it, and anyone who may edit the record edits it.
- AC-7.3 The company and deal pages show the source with its detail ("Event · Swiss
  Digital Day 2026"), or "—" when it is not known.

### US-8 Colleagues who took part in an activity
As a CRM user, I want to record which colleagues took part in a call, a meeting or a task,
so that the record says who was there (owner, 2026-11-04; the base for time tracking later).
Example: "Meeting at the client tomorrow, with Paro".

- AC-8.1 Any activity may name up to 10 **participants**: Operai users with CRM access,
  chosen and changed by the activity's author. They are wellD colleagues, never the
  client's contacts. A task keeps exactly one assignee, who answers for it.
- AC-8.2 The activity shows its participants ("With …"). "Tasks" lists, for a person, the
  tasks assigned to them and those they take part in.
- AC-8.3 A colleague added as a participant by someone else is notified in-app (no email).

## Non-goals (v1)

- Email/calendar sync, inbox integration, attachments on activities.
- Notifications (task assigned to you, deal stage changed) — see decisions D-14.
- Linking a deal to an EstimAI estimate, generating offers or invoices.
- Custom fields, configurable stages or probabilities, multiple pipelines.
- Import/export (CSV), duplicate merging, record-change audit trail beyond the activity log.
- Per-record visibility (private deals): every CRM user reads everything.

## Open questions (for the product owner)

- O1 Are the default win probabilities right for wellD? (fixed in code today, D-8)
- ~~O2 Should `former` be set automatically when a customer has had no won deal for N months?~~
  Resolved 2026-11-02 (owner): yes, after 12 months with no won and no open deal, derived on
  read (AC-1.9); and winning a deal makes the company a customer (AC-1.8).
- O3 Who besides admins should hold **erase contact** (a privacy officer role)?
- O4 A task can be assigned to any active Operai user, including one without `crm:access`, who
  then cannot see it. Should the assignee be limited to CRM users? (D-26)
