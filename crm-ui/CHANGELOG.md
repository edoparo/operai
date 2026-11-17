# @operai/crm-ui

## 0.4.0

### Minor Changes

- 4b6e43e: The offer wizard shows the letterhead service's pages when `GET /scope` says `letterheadService` (specs/20261116-letterhead-service): a `ServicePreview` built on `PagePreview` and `useServicePreview` (the latest result wins, with busy and refused states), a `LetterheadNotice` for an entity with no letterhead or a value too long for the header or footer, linking to Letterheads, the same pages in Try the wizard in the template editor, generate errors for the service path, and Settings without the letterhead upload card (the service owns the letterhead). Offers carry `letterheadVersion` in their type, an over-long section is refused like generate does, and English and Italian strings cover the new states. With the switch off, or an older crm-api, the browser-drawn preview and the upload card stay.

### Patch Changes

- 87fe5cf: The company, contact and deal dialogs now move focus to the field the server refused (scrolled into view, marked invalid and described by the message), or to the announced error banner when the refusal names no field, on create and on edit. Before, focus stayed on `<body>` and a refused field in a tall dialog was out of sight.
- 07dca8d: The 503 of the isolated PDF checks is documented and translated. crm-api's OpenAPI now names `pdf_check_busy` and `pdf_check_unavailable` on the six routes that can answer them (letterhead confirm and link, attachment confirm, offer generate and edit, draft generate), and crm-ui says both in English and Italian instead of showing the server's English detail.
- bc1bf94: Patch the `zod` and `undici` advisories in the frontends' lockfiles: `zod` (reached through better-auth and eslint-plugin-react-hooks) moves to 4.6.7 and `undici` (reached through jsdom, tests only) to 7.30.1. Lockfile-only, both within the parents' existing ranges; no package.json change.

## 0.3.0

### Minor Changes

- 33ebd92: CRM offer wizard (specs/20261115-crm-offer-wizard): an offer is now built step by step from a
  template that declares what it asks for, instead of editing a long contract text by hand.
  Pick a template for the deal's entity and language, fill in its fields, lists, tables and optional
  blocks, check the cost table and generate the PDF. The draft lives on the server, so it resumes
  after a reload or on another device; a missing or invalid answer blocks generation and says where.
  An unsent offer can be edited under the same reference and a sent one revised as the next `rN`; a
  legacy contract offer still opens the classic dialog. Administrators write wizard templates in
  Settings (self-describing markup with live problems) and try them on sample answers before
  saving; the seven standard templates are seeded per entity and language.

  - **crm-api:** a new migration (`20261115120000_offer_wizard`, apply it before the UI ships);
    template format `wizard` alongside the classic one, with supersession per entity and language;
    draft routes (create, resume, save with If-Match, discard) and generation from the stored draft;
    renderer support for several total rows and option lines in the cost table.
  - **crm-ui:** the offer wizard page, the deal page's offers card (draft row, Continue, Discard,
    Edit, New revision) and the template editor with its "Try the wizard" view.
  - **ui:** new paper tokens used by the offer document and wizard preview.
  - **shell:** patch only: it ships the library with the new tokens.

  The wizard's preview draws the entity's letterhead behind its first page (pdf.js in the browser, fetched
  from the CRM's own bucket), and the seeded templates name the issuer — legal name and address — from the
  entity profile instead of their text; seeds created earlier and never edited are upgraded once in place.

  The preview is laid out as real A4 pages inside the PDF's frame, with the letterhead behind every page and
  page breaks approximating the PDF's. Uploaded letterheads are bounded by decoded size before any parser
  runs, stored as the checked bytes, and refused (409 `letterhead_unusable`) when a stored one fails the bound.

- 0d8b9df: Projects hand-off (specs/20261103-projects-handoff, ADR 20261104-projects-handoff-live-reads-between-crm-and-projects-over-service-credentials to 0094): a won deal reaches OPS "in series".
  Sales (and admins) see a to-start queue of the CRM's won deals that no project has taken, read live
  (a reopened deal leaves it, a re-won one returns), and turn one into a new project with its purchase
  order (PO): type, dates and terms, an optional referent among the company's CRM contacts, and the
  ops-manager the PO is assigned to. The project starts without a project manager; the ops-manager is
  notified and picks one (an admin may in their place), and `planned` to `active` is refused until then.
  A project has 0..1 terms and 0..1 purchase order: a PO is born only from a won deal, and a hand-made
  project may be of any type and carry terms but never a PO. A fixed-price PO from
  a deal with an estimate copies the estimate's man-days once, and they cannot be edited. The PO shows its
  deal, a "no longer won" notice, the estimate link and the referent's name, job title, email and phone,
  read live from the CRM and never stored; the CRM deal page shows its project and the PO's Bexio order id,
  read-only.
  - **auth:** the `projects` catalog gains `purchase-order:bexio` (held by `accounting`: the PO's Bexio
    order id), `purchase-order:receive` and `handoff:take`; new `ops-manager` system role; `sales` gains
    `handoff:take`. New `GET /authz/users/holders`, gated on `handoff:take`, lists the holders of
    `purchase-order:receive` for an entity as `{ id, name, unconditioned }` (ADR 20261105-handoff-take-and-purchase-order-receive-capabilities-auth-holders-listing-amends-0047 amends ADR 20261006-user-directory-endpoint-capability-gated). New
    service scopes `crm.deals.read`, `crm.contacts.read`, `estimai.estimates.read` and
    `projects.purchase-orders.read`.
  - **estimai-api:** its first `/system/*` route, `GET /system/estimates/{id}/summary`, returns only
    `{ id, name, manDays }` to a service credential with `estimai.estimates.read`; new optional
    `SERVICE_AUDIENCE`.
  - **crm-api:** new `GET /system/deals` (`crm.deals.read`, no amounts) and `GET /system/contacts`
    (`crm.contacts.read`, minimal shape per mode) for projects-api; the deal read gains `delivery` and
    `deliveryKnown`, read from projects-api's `GET /system/purchase-orders`; `SERVICE_CLIENT_ID` /
    `SERVICE_CLIENT_SECRET` are now required with either `NOTIFY_INTERNAL_URL` or the new optional
    `PROJECTS_INTERNAL_URL`.
  - **crm-ui:** a read-only "Delivery" card on the deal page.
  - **notify-api:** `system:projects-api` may raise `projects` notifications.
  - **notify-ui:** the notification centre labels the `projects` origin "Projects" / "Progetti".
  - **projects-api:** one new migration on top of the Projects module's own; the take (`POST /queue/{dealId}/project`) behind
    `handoff:take`, with ops-manager candidates from auth, referent contacts from the CRM and a best-effort
    notification; `GET /queue`, the terms and purchase-order routes, the referent and the project-manager
    pick, hand-made projects with optional terms, and `GET /system/purchase-orders`; `GET /scope` gains
    `take` and `oversees`; new `ESTIMAI_INTERNAL_URL`, `NOTIFY_INTERNAL_URL` and `SERVICE_AUDIENCE`.
  - **projects-ui:** the queue (sales only), "New project" from a deal with the ops-manager and referent
    pickers, the purchase-order and terms cards, the awaiting notice with "Pick project manager", the
    list's "Awaiting project manager" state and filter, and hand-made creation with optional terms.

### Patch Changes

- 0d8b9df: The browser's back and forward buttons show the page of the address in every module,
  within a module and between modules. Each module now builds its router when it mounts,
  so coming back from another module no longer shows a page matched from that module's
  address (a project named "admin", "This page does not exist"). The router also follows
  the address while the shell hides the module behind its pending fallback, so back from
  "To start" or from a company shows the list it was opened from, not the page it left.
- 66ef8fa: The design system `@operai/ui` is compiled once, by the shell, and shared with every remote as a Module Federation singleton: remotes declare it with `import: false` and no longer bundle it (ADR 20261114-operai-ui-shared-singleton-provided-by-the-shell). The rich-text entry is still compiled by crm-ui, meetings-ui and projects-ui.

## 0.2.0

### Minor Changes

- 4f8e70f: Add activities-api (specs/20261110-activities, ADR 20261110-activities-service-access-delegated-to-host/0082/0083): one backend-only service for the activities, tasks and
  task blockers of the CRM and of Projects, with no permission catalog of its own, so every access decision is
  asked of the host (`crm-api`, `projects-api`) as the caller and fails closed. `crm-api` moves its activities,
  participants, blockers and meeting host state out (they are copied in once by
  `activities-api/scripts/import-crm-activities.ts`, a later push drops the old tables) and calls
  `activities-api` with the new service scope `activities.write`; `projects-api` becomes a host. `auth`
  registers the scope and the `activities-api` service client; `notify-api` accepts the `projects` origin and
  binds `system:activities-api` to `crm` and `projects`; `notify-ui` tags it. The shell trusts the
  activities-api origin; `crm-ui` reads activities from it; `projects-ui` gains a Tasks card on a project and a
  My tasks page.
- 66c46c2: CRM activities name the colleagues who took part (specs/20261101-crm US-8). A call, a meeting, a note or a task can list up to 10 participants with CRM access, for example "Meeting at the client, with Paro". The activity shows them, a task appears in the task list of everyone taking part, and a colleague added by someone else is notified in-app. A task still has one assignee, who answers for it.
- e6fcd41: CRM company status follows the deals (specs/20261101-crm AC-1.8, AC-1.9):
  - **Won → customer:** moving a deal to won makes its company a customer if it was a prospect or a former client.
  - **Inactive → former client:** a customer with no deal won in the last 12 months and none open reads as a former client, in the record, the list and the status filter. It is derived on read, never written, and the company page says why. A new deal makes it a customer again.
- 2df31ab: CRM companies and deals record where they came from (specs/20261101-crm US-7): direct inbound, direct outbound, event, referral or other. For an event, a referral or other, a detail can name which event or who referred it. A new deal starts from its company's source, and both pages show it, for example "Event · Swiss Digital Day 2026".
- bc428e8: CRM offer document (specs/20261102-crm-offer-document, ADR 20261102-crm-api-reads-attachment-bytes-for-offer-annexes):
  - **Letterhead:** each entity uploads its letterhead PDF in Settings; every offer page is printed on it.
  - **Offer templates:** wellD's contract structure as editable templates per entity and language (14 seeded from wellD's own offers, Italian and English), with a template editor in Settings.
  - **Generate dialog:** starts from a template; the draft is prefilled from the estimate (epics, phases, timing per release, man-days, amount split per release); cost lines with unit price, quantity, yearly lines and discounts (amount or percentage); deal PDFs can be appended as annexes; optional Annex A with the effort detail.
  - **Numbering:** `0017/2026`, then `0017/2026r1` for later revisions of the same deal.
  - **Companies:** legal name, street and postal code.
  - **Fix:** estimate activities are matched to their release by name as well as id, so the effort no longer lands under "Other".
- 3fc487d: CRM offers are edited until they are sent, then revised (specs/20261102-crm-offer-document US-7). While the newest offer has not been marked sent, "Edit" opens it with its own content and regenerates its PDF under the same reference. Marking it sent records when and by whom, and freezes it. After that, "New revision" starts from the sent offer and adds `r1`, `r2`… instead of starting again from the template. Offers of deals already at "Offer sent", won or lost count as sent.
- c867f3c: CRM offer numbering can continue from wellD's document system (specs/20261102-crm-offer-document US-8). Settings has an "offer numbering" card per entity that sets the next offer number of the year, so the next new offer is, for example, `0019/2026` instead of `0001/2026`. It can never be set to a number an offer already carries, so references never collide.
- c83bee6: CRM (specs/20261101-crm AC-2.3, AC-3.2):
  - **Deal amount optional:** a deal can be created without an amount, which is often only known after the estimate or qualification. It can be set or cleared later. The deal page shows "Not set yet", the pipeline counts the deal without adding it to the totals, and an offer drafted from it leaves the prices blank.
  - **Edit a contact from the company:** each contact on a company page has an Edit button that opens the contact form there, without going to the contacts list.
- 7d68d9a: The CRM pipeline board can show another calendar year (specs/20261101-crm AC-3.6). A "Won and lost in" picker chooses whose won and lost deals, and their totals, the board shows. It offers this year and every year a deal was closed in. Open deals still show whatever year they started in.
- bc428e8: CRM sales flow (specs/20261101-crm-sales-flow, ADR 20261101-crm-financial-visibility-permission/0055):

  - **Technical role:** a new `crm-technical` role that sees the CRM without the money. The new
    `deal:financials` permission is held by `admin` and `sales`.
  - **Estimates:** technical estimates are requested from a deal and created in EstimAI with the
    technician as editor. A deal reaches Proposal only once its estimate is marked ready; an
    admin can override that.
  - **Offers and attachments:** offer PDFs are generated and versioned, and files can be
    attached to a deal. Both live in the CRM's own EU bucket.
  - **Pipeline:** a card shows a badge while the deal waits for its technical estimate.
  - **CRM users only:** owners and task assignees must be users who can open the CRM.

  `auth`'s app-access check also answers by user id, and the user directory can be filtered by
  app.

  The `proposal` and `negotiation` stages are now shown as "Offer in preparation" and "Offer sent", and the newest offer has a "Mark as sent" action that moves the deal to "Offer sent".

- 624596d: CRM lists can be sorted and filtered (specs/20261101-crm US-9). Companies sort by name, status, entity, industry or city, and contacts by name, company, job title or email, by clicking the column header. The order is applied by the server, so it holds across every page. Companies also gain an owner filter: anyone, "mine", or one of the people who own a company.
- 5909c75: The event, referral and "other" detail of a company or deal suggests the details already written for that source (case, accents and spacing ignored), so the same event is not recorded three ways. New `GET /source-details?source=` in crm-api, readable by every `crm:access` holder.
- b8fe638: CRM tasks can be blocked by other tasks (specs/20261101-crm US-6). When a task is created or edited, it can wait on up to 10 open tasks of the same company, for example the deal's estimate task. While one of them is open, the task shows as Blocked, lists what it waits on and cannot be marked done. When the last one is done, including when the estimate is marked ready, the assignee is told in-app and by email.
- bc428e8: Add the CRM (specs/20261101-crm, ADR 20261101-crm-tool-shape-and-authorization/0053): companies, contacts, deals through a stage
  pipeline with per-currency weighted totals, activities and follow-up tasks. New services
  `crm-api` and `crm-ui`; `auth` registers the `crm` catalog and the `sales` role and lets
  `deal:manage` holders read the user directory; the shell mounts the tool at `/crm`.
- d549baf: A technical estimate is finished when it is closed in EstimAI. The owner or an editor closes it from the estimate page, after which it is read-only until someone reopens it. The CRM follows on its own: the deal's estimate turns ready, its task is completed, and the requester and the deal owner are told; reopening it in EstimAI reverses that. The CRM no longer has its own "Mark ready" and "Reopen" buttons. Needs `estimate-notices.send` on estimai-api's service client in auth, `CRM_INTERNAL_URL` on estimai-api and `SERVICE_AUDIENCE` on crm-api.
- c30a110: Meetings on CRM deals (specs/20261104-meetings, US-14, ADR 20261104-meeting-host-contract-resolve-and-notices/0060):
  - **crm-ui:** the deal page embeds a Meetings panel, so you can start a meeting about a deal and list the ones already linked. If Meetings is unavailable the page shows its own fallback and keeps working. The company page does not roll up its deals' meetings in this release.
  - **crm-api:** a deal's meetings appear in its activity timeline as a "meeting" activity, kept in step when the meeting is linked, changed, relinked, unlinked or deleted. The activity carries no meeting content, and nothing with a title outlives a deletion. New routes: service-authenticated `POST /system/meeting-host/v1/notices` and `POST /meeting-host/v1/resolve`, which tells meetings-api whether the caller may open a deal. A migration adds `activity.meetingId` and a content-free ordering table, so duplicated or reordered notices are harmless.
  - **Operators:** crm-api needs `SERVICE_AUDIENCE` (the same value as notify-api's, different from `AUTH_AUDIENCE`). Without it the notice route answers 401 and the rest of the service is unaffected.
- 48de67f: Tasks have a rich description with pictures and attachments (ADR 20261113-task-description-files-in-activities-api-bucket). In the CRM and in Projects a task's text is now formatted (bold, lists, check lists…); pictures can be chosen, pasted or dropped into it, and files (PDF, Office, text, CSV, pictures) attached under it. Files are uploaded when the task is saved, live in activities-api's own EU bucket and are shown to whoever can read the task. A task's existing plain text becomes its description.

### Patch Changes

- c2c3b88: Editing a CRM activity now covers its contact and deal (specs/20261101-crm AC-4.2). They can be changed or cleared, among the activity's company's own, whereas before they were fixed once the activity was logged.
- cc7be44: The company picker's list closes when focus leaves the field, and a pipeline card keeps the deal title's style on the title (the company above it in the smaller, softer style).
- 41824c4: Unlinking a deal's technical estimate deletes the task the request created, as long as it is still open; a completed one stays on the timeline. On the deal page, the activity list reloads after an estimate is requested, marked ready, reopened or unlinked, so the task shows up without a page refresh.
- ecf60f1: On a company's page, "Add existing" finds a contact already in the CRM and adds it to the company. A contact at another company is moved, and the dialog says so first.
- 6d9e36c: A deal an admin let go without a technical estimate can now have an offer. The draft leaves the scope, man-days and timeline empty, and the generate dialog hides the AI-assisted and annex choices and says so; the person writes the scope and sets the costs.
- 6411dd8: "Proceed without estimate" is open to every salesperson who manages the deal (deal:manage for its entity), not only to admins. The reason is still required and kept on the deal's timeline; a deal of another entity is refused (403 out_of_scope).
- cf23e2f: The pipeline can be filtered by company, and its counts and totals follow the filter. A deal card now shows the company first and the deal's title under it.
- e1fa2ed: On the CRM pipeline board, a column with deals in two currencies shows each total on its own line instead of side by side, where it was cut off in the narrow column.
- 2ac6aee: Offer numbering settings: the hint states the saved next number, and a number typed but not saved shows a warning, so an unsaved change no longer reads as applied.
- 59e9b48: Dependency security update. better-auth moves to 1.7.18 everywhere, closing the advisory that let an OAuth state be used as a magic link to sign in as another user. The frontends move to vitest 4 and refreshed lockfiles, which clears the critical seroval and tinypool advisories. auth gains a migration adding three optional key columns that better-auth 1.7 expects on its signing-key table.
- 039ba3f: Lists no longer blank to a loading skeleton when you come back to them or when they reload after a change: they show what was last loaded at once and refresh it in the background (Meetings list, templates and folders; CRM companies, contacts, pipeline and tasks; Projects list and My tasks). Kept in memory only, for the open tab.
- a1c2b2c: The person picker's list closes when focus leaves the field, instead of staying open over the fields below it (only Escape, Tab or a choice closed it). A click inside the open list, on its scrollbar or its empty line, no longer counts as leaving the field.
- c4ba4c3: Pages use more of a wide screen: the default tool column grows from 64rem to 80rem and the wide one (the CRM pipeline) fills the width beside the sidebar; single forms stay at 40rem.
