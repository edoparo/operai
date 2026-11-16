# @operai/projects-ui

## 0.3.0

### Minor Changes

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
- 4f8e70f: Add the Projects module (specs/20261103-projects, ADR 20261103-projects-tool-shape-and-authorization/0080): the delivery work wellD runs. A
  project has a type (T&M, fixed price, maintenance, SaaS, internal), a state, a project manager and
  a team; its contracts record what each client bought as structured delivery terms (deadline and
  max effort, SLA, hour package, T&M positions, licence period), and `accounting` records the Bexio
  order id on each contract. No money anywhere in the module. New services `projects-api` and
  `projects-ui`; the shell mounts the tool at `/projects`.
  - **auth:** registers the `projects` catalog (`projects:access`, entity-scoped `project:manage`,
    `contract:bexio`) and the `project-manager` role; `sales` gains access and entity-scoped manage,
    `accounting` gains access and the Bexio order capability; `project:manage` holders can read the
    user directory; new service scope `crm.companies.read`.
  - **crm-api:** new `GET /system/companies`, readable only with a service credential carrying
    `crm.companies.read` (the first `/system/*` route on the CRM).
- 48de67f: Tasks have a rich description with pictures and attachments (ADR 20261113-task-description-files-in-activities-api-bucket). In the CRM and in Projects a task's text is now formatted (bold, lists, check lists…); pictures can be chosen, pasted or dropped into it, and files (PDF, Office, text, CSV, pictures) attached under it. Files are uploaded when the task is saved, live in activities-api's own EU bucket and are shown to whoever can read the task. A task's existing plain text becomes its description.

### Patch Changes

- 039ba3f: Lists no longer blank to a loading skeleton when you come back to them or when they reload after a change: they show what was last loaded at once and refresh it in the background (Meetings list, templates and folders; CRM companies, contacts, pipeline and tasks; Projects list and My tasks). Kept in memory only, for the open tab.
- f494bbc: Pin `@tanstack/react-router` to 1.170.17 like every other frontend, so the suite resolves one router for the Module Federation singleton (specs/20261111-push-notifications E-1).
- c4ba4c3: Pages use more of a wide screen: the default tool column grows from 64rem to 80rem and the wide one (the CRM pipeline) fills the width beside the sidebar; single forms stay at 40rem.
