# Domain glossary

## Terms

### Hardware inventory (specs/015)
- **Asset**: one physical hardware unit owned by one entity, from registration until
  disposal; never a quantity (13 monitors are 13 assets). _Avoid:_ device (UI copy only),
  item, row.
- **Asset category**: the kind of asset, from a fixed list; for filtering and reporting
  only, never an input to depreciation. _Avoid:_ type, class.
- **Holder**: the Operai account an asset is currently assigned to; an asset with no
  holder is company stock. A party without an account is never a holder. _Avoid:_
  assignee, owner (the entity owns the asset).
- **Asset status**: exactly one of `ordered`, `in_stock`, `assigned`, `in_repair`, `lost`,
  `disposed`. `lost` (lost or stolen) is still on the books; only `disposed` is not.
- **Assignment**: the act of giving an asset to a holder; `pending` until the employee
  confirms receipt, then `confirmed`, `declined` or `cancelled`. Never expires.
  _Avoid:_ handover.
- **Depreciation rule**: the per-entity parameters (useful life, first-year share,
  low-value threshold, residual value) that turn a purchase price into a schedule;
  applies to assets purchased on or after its effective date and is never edited.
- **Schedule**: one asset's yearly depreciation amounts, from its purchase year until it
  reaches its residual value. _Avoid:_ plan, amortisation table.
- **Book value**: purchase price minus all depreciation booked so far, at a given date;
  zero from disposal onward.
- **Residual value**: the book value a schedule stops at (CHF 1.00 for `welld_ch`, zero
  for `welld_it`). _Avoid:_ memo value, pro-memoria.
- **Disposal**: the accounting act that takes an asset off the books, with a reason
  (`ceded_to_employee`, `sold`, `scrapped`, `returned_to_vendor`, `lost`); irreversible.
  _Avoid:_ cession, write-off (both are reasons or effects, not the act).
- **Fiscal year**: the calendar year, per entity; `open` or `closed`. A closed year is
  frozen and never reopened.
- **Roll-forward**: the per-entity, per-fiscal-year statement: opening book value −
  disposals + purchases − depreciation = closing book value.
- **Inventory manager**: the capability to register, assign, take back, repair and mark
  assets lost; sees purchase prices, not book values.
- **Hardware accountant**: the capability to see schedules and book values, maintain
  depreciation rules, dispose of assets and close fiscal years.

### Service-to-service credentials (specs/016)
- **Shared token**: the single static secret `auth`, `refund-api` and `estimai-api`
  used to present to the notification service's internal endpoints; retired by
  specs/016 (ADR-0049) and refused since. _Avoid:_ internal token, system token.
- **Service credential**: what a service client presents to the notification service:
  short-lived, issued by `auth` to that one client, carrying its identity and scopes.
  _Avoid:_ service token where the shared token could be meant.
- **Scope**: one named permission carried by a service credential: **push** (send an
  in-app notification) or **email** (send an email).
- **Caller**: a service that reaches the notification service's internal endpoints.
- **Transition**: the period in which the notification service accepted both the shared
  token and service credentials; it ended with specs/016's third push.

### Meetings (specs/021)
- **Meeting**: one conversation captured in Operai, with one source, a transcript,
  summaries and per-user conversations. _Avoid:_ call, session, recording (the recording
  is only its audio).
- **Host / host reference**: an Operai app that lets users start and list meetings about
  its own records; the `{app, entity type, entity id}` link from a meeting to such a
  record. _Avoid:_ parent, context, linked entity.
- **Standalone meeting**: a meeting with no host reference.
- **Source**: how a meeting's content arrived — `recorded`, `uploaded` or `text`; exactly
  one per meeting. _Avoid:_ input, channel.
- **Transcript / segment / speaker label**: the meeting as text, split into timed segments,
  each with a best-effort speaker label. _Avoid:_ notes, minutes (a template output).
- **Summary**: an AI-generated text produced from the transcript through a template; a
  meeting has several. _Avoid:_ minutes, report.
- **Summary template**: ordered sections (heading + instruction); built-in, shared or
  personal. _Avoid:_ prompt, format.
- **Conversation**: one user's private question-and-answer history with one meeting.
  _Avoid:_ chat, thread.
- **Consent attestation**: the recorded confirmation, before audio is captured or uploaded,
  that the people in the meeting were told and agreed.
- **Operai participant / external participant**: a participant with an Operai account / a
  participant who is only a name. _Avoid:_ attendee, guest.
- **Host-visible**: the creator's opt-in that makes a meeting readable to those who can
  open its host entity.
- **Host notice**: the content-free message an opted-in host receives when a meeting
  linked to its entity is created, changed, relinked, unlinked or deleted. _Avoid:_
  webhook, callback.
- **Frozen meeting**: a meeting whose creator's account is deactivated; still readable by
  participants, not editable, deletable only by a `meeting:erase` holder. _Avoid:_
  orphaned, archived.
- **Meeting activity**: the CRM activity of type `meeting` that a meeting linked to a deal
  creates on the deal. _Avoid:_ meeting log.
- **Host registry**: the list of hosts meetings-api accepts (app + entity type, whether it
  receives host notices); data in meetings-api, `crm/deal` only in production.
- **Host extension** (host panel): the Meetings-owned panel a host page embeds through the
  shell to start and list meetings for its entity.
- **Recording session**: one continuous browser capture of a recorded meeting, uploaded as
  a sequence of chunks.
- **Chunk**: one ~10 s slice of a recording session's audio, uploaded on its own.
- **Transcript part**: a span of one recording transcribed as one unit, with its own speaker
  numbering; labels from different parts are merged only by renaming. _Avoid:_ chunk (that is
  the ~10 s upload slice).
- **Transcription result**: the text output of transcribing a recording; the one item a
  processor may keep, for about 5 days (specs/021 A6).
- **Transient copy**: audio held in wellD-controlled EU/CH storage only for one
  transcription attempt (specs/021 AC-4.12). _Avoid:_ staging file, temp upload.
- **Live mode** (specs/022): a per-recording-session switch on a `recorded` meeting that makes
  provisional text and live questions available to the creator.
- **Provisional transcript** (live text): unlabelled, creator-only text produced during
  recording and replaced by the final transcript. _Avoid:_ transcript (that is the final one).
- **Settled text**: the part of the provisional transcript that will no longer change; only it
  is shown and used to answer.
- **Coverage point**: the recording time (mm:ss) up to which settled text exists; stated in
  every live answer.
- **Live gap**: a stretch of recording time captured but with no live text.
- **Live turn**: a question asked and answered during recording, from provisional text only.
- **Superseded**: the state of a live turn once the final transcript exists.
- **Passage**: the citation unit of a `text`-source meeting (the counterpart of a segment).
- **Processing stage**: one step of turning a source into a transcript (upload check,
  audio extraction, transcription).
- **Deletion entry**: the content-free "who deleted what, when" record a real deletion
  leaves behind.
- **AI request**: one summary generation or one question to a meeting — the unit of the
  per-user hourly limit.
### Access to the suite (specs/023)
- **Allowed domain**: an email domain whose holders may become Operai users at all —
  `welld.ch` and `welld.it`; matched exactly and case-insensitively, subdomains excluded.
  _Avoid:_ whitelist, company domain.
- **Access request**: the record created when a person with an allowed-domain email signs
  in without a live pending invitation; grants nothing, never a user, at most one per
  email. State `pending`, `approved` or `rejected`. _Avoid:_ sign-up, registration,
  pending user.
- **Waiting list**: the access requests in state `pending`. _Avoid:_ queue, backlog.
- **Approve** (an access request): creates an invitation for the requester through the
  invitation flow; it never creates a user by itself.

### Activities (specs/028)
- **Activity**: something that happened or must happen about a client relationship or a
  project, recorded by an Operai user; either pre-sales or operational. _Avoid:_ event,
  log entry, interaction.
- **Pre-sales activity**: an activity about a CRM company (optionally one of its contacts and
  deals): a note, call, meeting, email or task. _Avoid:_ CRM activity, sales activity.
- **Operational activity**: an activity about a project; only tasks. _Avoid:_ project
  activity, delivery task.
- **Task**: an activity someone must do, with exactly one assignee and an optional due date,
  open until done; pre-sales or operational. _Avoid:_ to-do, action item, ticket.
- **My tasks**: the tasks assigned to the caller or in which the caller takes part. The CRM
  shows only pre-sales ones; the project module shows both, pre-sales ones badged.
  _Avoid:_ inbox, my work.

### Projects hand-off (specs/026)
- **To-start queue**: the won CRM deals that have no purchase order yet; computed live from
  the CRM on every read, never stored; seen by `sales` and admins only. _Avoid:_ backlog,
  inbox.
- **Purchase order (PO)**: the delivery-side record of one won deal — its deal, client
  company, dates, terms, Bexio order id, estimate link, referent and ops-manager. A project
  has zero or one; a PO is born only from a won deal, together with its project, and is never
  added later nor deleted. Not the offer PDF. _Avoid:_ contract (its earlier name), order.
- **A PO's deal**: the won deal a PO was made from; the PO keeps the deal's id and its
  estimate id.
- **Terms**: the type-specific delivery terms (deadline and max effort, SLA, hour package,
  positions, licence period). Required by type on a PO; optional on a hand-made project.
- **Hand-made project**: a project created directly, not from a deal; it never has a PO, its
  creator is its project manager, and it may carry its type's terms.
- **Referent** (referente): the person at the client the delivery talks to — a CRM contact
  of the PO's company, optional; read live from the CRM, never copied onto the PO.
- **Ops-manager** (responsabile OPS): an entity-scoped role; a PO is assigned to one (or to
  an admin) at creation, who is notified and is the only one, besides an admin, who picks
  the project's project manager.
- **Awaiting a project manager**: a project made from a deal whose assigned ops-manager has
  not picked a project manager yet; it cannot become `active` until one is picked.

### Time tracking (specs/029)
- **Time entry**: one person's own declaration that they spent a duration, on one day, on
  one thing — a project, a deal, a meeting, or no entity (then with a category). Not an
  activity, but may point at one. _Avoid:_ timesheet row, worklog, booking.
- **Category** (time tracking): what a time entry on no entity is about (training, talk
  preparation, administration, …), from a list an admin manages. Not the inventory's
  **Asset category**. _Avoid:_ activity type.
- **Work type**: the optional kind of work of a time entry on a project or a deal, from one of
  two lists an admin manages (one for projects, one for deals). _Avoid:_ task type, service.
- **Contractual day**: 8 h 24 min, from 42 hours a week, Monday to Friday. Nothing checks a
  day against it in specs/029.
- **Suggested entry**: a time entry Operai offers a person from a Meetings meeting they took
  part in; it counts for nothing until the person confirms it (specs/031). _Avoid:_ proposal
  (ProposAI's word), draft entry.
- **Consumption**: the hours recorded on a project set against what its terms sold — the hour
  package, the max effort and estimated man-days, or the positions' planned man-days
  (specs/030). _Avoid:_ burn, usage.
- **Man-day**: 8 hours, in every comparison with what was sold — not the **Contractual day**.
- **Package period**: for a yearly hour package, each 12 months from its start date; for a
  capacity package, from its start date to its expiry. Unused hours never carry over.
- **Alert**: a project task Operai creates when a project reaches a moment that needs a
  decision (a package threshold, an end date, a deadline, idle hours). _Avoid:_ warning,
  reminder, notification (a notification is how notify-api tells a person).

## Relationships
- A won deal feeds at most one PO, which is born with its own project; a project has zero
  or one PO, and a project created without one never gets one.
- An **Asset** belongs to exactly one entity for its whole life and has at most one
  **Holder** and at most one `pending` **Assignment** at a time.
- An **Asset** has exactly one **Schedule**, produced by the one **Depreciation rule** in
  force for its entity on its purchase date.
- A **Roll-forward** belongs to one entity and one **Fiscal year**; each line is the sum
  of that year's per-asset figures.
- A **Meeting** has exactly one **Source**, at most one **Host reference**, one
  **Transcript**, up to 20 **Summaries** (each snapshotting its **Summary template**) and
  one private **Conversation** per user who asked.
- An **Access request** that is approved leads to exactly one invitation; the person
  becomes a user only by accepting it.
- A **Time entry** is on exactly one of a project, a deal, a meeting or no entity, and points
  at most at one **Activity**; one **Activity** may have any number of time entries.

## Open ambiguities
- Whether the `welld_ch` **Residual value** is kept until **Disposal** or written off the
  year after the **Schedule** ends (specs/015 O4) — owner: accounting.
