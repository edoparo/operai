# @operai/shell

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
- bc428e8: CRM notifications (specs/20261101-crm-notifications, ADR 20261101-notify-api-resolves-email-notice-address-from-auth):
  - **Notifications:** the CRM notifies people in the app when work is handed to them or concerns them: estimate requests and hand-backs, a new deal owner, an assigned task, a gate override, won and lost deals, a generated offer.
  - **Email notices:** estimate requested, ready or reopened, a new deal owner and an assigned task also send an email, in English. None of them contains any money.
  - **notify-api:** `POST /system/notifications` accepts `email: true`. The caller then needs the `emails.send` scope as well. notify-api looks up the recipient's address in auth and sends the new `notification_notice` email.
  - **auth:** new service endpoint `POST /system/users/contact` and new scope `users.contact`.
  - **Notification center:** `crm` is a new origin, shown in the bell and the notification center.
- bc428e8: Add the CRM (specs/20261101-crm, ADR 20261101-crm-tool-shape-and-authorization/0053): companies, contacts, deals through a stage
  pipeline with per-currency weighted totals, activities and follow-up tasks. New services
  `crm-api` and `crm-ui`; `auth` registers the `crm` catalog and the `sales` role and lets
  `deal:manage` holders read the user directory; the shell mounts the tool at `/crm`.
- 28872b4: Every tool now shares one look for actions, text and page layout: buttons and
  dialogs come from the shared library with the same meaning-based styles
  (primary actions meet contrast everywhere, cancel is quiet, destructive is
  red), text uses one type scale with an 11px minimum, labels drop their "+"
  and arrow prefixes, each tool has the same title bar, tabs and page header on
  a common width scale, and every detail page has a "Back to …" link. EstimAI's
  shortcuts, health and About dialogs are now real modal dialogs.
- 28872b4: The whole suite now speaks Italian as well as English: every tool has a
  complete Italian translation and follows the browser's language, chosen once
  for all tools. Dates read the same everywhere (31.10.2026), amounts show their
  currency code with the language's separators, statuses use one shared set of
  icons and colours so the same symbol always means the same thing, emoji and
  text symbols are replaced by real icons that render on every system, headings
  are in sentence case, loading and empty screens look the same in every tool,
  detail pages are organised in cards, and EstimAI's views are proper tabs.
- c30a110: Add Meetings (specs/20261104-meetings, ADR 20261104-meetings-tool-shape-visibility-by-participation to ADR 20261104-default-employee-grant-meetings-access): record, transcribe, summarise and question meetings from anywhere in Operai. New services `meetings-api` and `meetings-ui`.
  - **Capture:** record in the browser (microphone, plus the audio of a shared tab where the browser allows it), upload a recording, or paste text. The person who records attests consent, and that attestation is stored on the meeting.
  - **Transcripts and summaries:** meetings are transcribed in Italian or English, summarised from shared or personal templates, and can be questioned one at a time, with answers citing transcript passages. Questions and answers are private to the asker. Audio is kept for 30 days; transcripts and summaries live until the meeting is deleted. AI providers run in the EU with zero retention.
  - **Visibility:** a meeting is visible to its creator and its Operai participants. The creator can optionally open it to everyone who can open the host record. A meeting whose creator is deactivated is frozen, not orphaned.
  - **auth:** new `meetings` catalog (`meetings:access`, `template:manage`, `meeting:erase`). `employee` now holds `meetings:access` by default, the first default grant on that role, and `admin` holds the other two. `meetings:access` also opens the user directory for the participant picker (ADR 20261104-user-directory-gate-meetings-access). New service client `meetings-api` and scope `host-notices.send`.
  - **shell:** the gated tool at `/meetings` and the ungated "My meetings" page at `/my-meetings`, so a participant without tool access can still read what was captured about them. Adds the host-extension seam that lets another remote embed a Meetings panel, and the meetings-api origin for the session.
  - **Operators:** `meetings-api` needs its own database, an EU bucket for audio and the env contract in `tools/env-doctor`.
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
- 1f14056: Push notifications: Operai now asks once, when it loads, whether to turn push notifications on (specs/20261111-push-notifications AC-1.9). The browser's own permission prompt still appears only after "Turn on". "No thanks", turning push off in My profile or removing this browser counts as an answer and the question is not shown again for that user on that browser. The setting in My profile is unchanged.
- 47ef6e2: While a meeting is being recorded you can move anywhere in Operai: a recorder widget stays visible above every page, with the elapsed time, live sound levels for the voice coming in (microphone) and going out (shared tab), Pause, Resume, Stop and a way back to the meeting. Drag it, or move it with the arrow keys, around the edge of the window. Leaving the meeting no longer asks for confirmation; closing or reloading the tab still does. New library component `FloatingPanel`.
- 23c2015: Add desktop push notifications (specs/20261111-push-notifications, ADR 20261111-web-push-encrypted-payloads-not-fcm/0085/0086/0087): `notify-api` gains a Web Push channel with encrypted payloads (no Firebase), a `push_device` table, the user-JWT routes `GET /push/config`, `PUT`/`GET /push/devices` and `DELETE /push/devices/{id}`, and the settings `PUSH_ENABLED` (off by default), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `PUSH_EXCLUDED_ORIGINS`. It remembers a recipient's active answer for 30 s, shares one in-flight lookup per user and sends through a bounded pool. The shell serves the `/push-sw.js` service worker, releases the device on sign-out, and adds a push section to My profile to turn push on or off and to list and remove devices. Rotating the VAPID keys invalidates every subscription; see infra/README.md.

  `auth` limits `POST /system/service-token` and `POST /system/users/contact` per verified calling service instead of per address: new optional variables `SERVICE_TOKEN_SERVICE_LIMIT` (300), `USERS_CONTACT_SERVICE_LIMIT` (600), `SYSTEM_INVALID_CREDENTIAL_LIMIT` (20 invalid credentials per address) and `SYSTEM_RATE_WINDOW_MS` (600000), a 4 KiB body cap and a 4 096-character token cap, and one 429 with `Retry-After`. `SERVICE_TOKEN_RATE_LIMIT` and `SERVICE_TOKEN_RATE_WINDOW_MS` are retired: ignored with one startup warning, flagged by env-doctor; delete them from production once this `auth` is live. Deploy `auth` first and enable `PUSH_ENABLED` only after the live capacity re-measure (infra/README.md § Push notifications).

### Patch Changes

- 28872b4: The design system gains `Combobox` (suggestions while typing) and `Drawer` (a
  side panel for reference content). Admin's address and country fields and
  Inventory's holder and supplier pickers now share the one `Combobox`, which
  also keeps the highlighted suggestion in view in a long list. EstimAI's model
  reference opens in the library `Drawer`. Admin's user detail and mileage-rate
  pages read permissions from the shell instead of fetching them again. The
  suite's end-to-end tests look for the current Refund label instead of the old
  "Refund (Rimborsi)".
- 59e9b48: Dependency security update. better-auth moves to 1.7.18 everywhere, closing the advisory that let an OAuth state be used as a magic link to sign in as another user. The frontends move to vitest 4 and refreshed lockfiles, which clears the critical seroval and tinypool advisories. auth gains a migration adding three optional key columns that better-auth 1.7 expects on its signing-key table.
- 6e34649: The recorder widget no longer slides and resizes when it appears: `FloatingPanel` glides only when the person moves it (arrow keys or a drop), and a change of size is applied at once; the shell shows its loading fallback only when the widget takes longer than 400 ms to load.
- 28872b4: Tables, paging, forms and feedback now work the same in every tool: record
  lists are accessible data tables, long lists page the same way, every form
  marks required fields with an asterisk and explains errors next to the field
  (moving focus to the first one), amounts accept a comma or a dot, dates use
  the date picker, every save, invite and delete confirms where you acted,
  errors you can retry are orange and errors you must fix are red, EstimAI no
  longer uses browser alert boxes, and the page no longer scrolls behind an open
  dialog.
- 28872b4: One styling dialect across the suite (ADR 20261031-one-styling-dialect-token-utilities): colours and fonts are Tailwind
  utilities generated from the shared design tokens, never inline styles, and a
  lint rule keeps it that way. Hover and focus colours now apply where inline
  colours used to override them, date pickers follow the light theme, EstimAI's
  AI purple and tinted highlights follow the theme too, and each tool's
  standalone build uses the suite's real tokens instead of a stale copy.
- 28872b4: New shared design system `@operai/ui` (operai-ui/, ADR 20261031-shared-ui-library-consumed-as-source): the suite's tokens,
  themes and component classes move into it from the shell, together with React
  components (buttons, dialogs, banners, badges, fields, tables, page and tool
  layout, empty and loading states) and a Storybook. refund-ui is the first app
  built on it: its dialogs now share one focus and keyboard behaviour, its buttons
  follow the suite's variants, and its secondary text and status colours meet
  WCAG AA in both themes. Suite-wide, `font-mono` now renders DM Mono as intended,
  and the shell's Tailwind scan includes notify-ui.
- 9adfd4a: The refund tool's settings (mileage rates per entity and the accounting distribution email) move from Admin to a new Settings tab in Refund (`/refund/settings`), shown to whoever holds `rate:read` or `settings:read`. Admin no longer has a Refund section.
- 28872b4: The design system gains `Menu` (the header's logo and account menus, now with
  full keyboard support) and `CheckboxGroupField` (pick several options from a
  list), and `ConfirmDialog` can ask for an acknowledgement and hold fields.
  Refund's "Mark as paid" and Inventory's dispose, close-year and new-rule
  dialogs now share that confirmation; Admin's role and department checklists
  and Inventory's invoice linking share the checkbox group. Success messages
  dismiss themselves after the same time in every tool.
- bc428e8: The tool content area reserves the scrollbar's width, so switching between a short and a tall page no longer shifts the content sideways.
- 28a766f: Public `GET /version.json` on the shell answers `{"version":"<operai suite version>"}` without sign-in, so a release can be checked as online (RELEASING.md § After).
- 48de67f: Tasks have a rich description with pictures and attachments (ADR 20261113-task-description-files-in-activities-api-bucket). In the CRM and in Projects a task's text is now formatted (bold, lists, check lists…); pictures can be chosen, pasted or dropped into it, and files (PDF, Office, text, CSV, pictures) attached under it. Files are uploaded when the task is saved, live in activities-api's own EU bucket and are shown to whoever can read the task. A task's existing plain text becomes its description.
- c4ba4c3: Pages use more of a wide screen: the default tool column grows from 64rem to 80rem and the wide one (the CRM pipeline) fills the width beside the sidebar; single forms stay at 40rem.

## 0.1.0

### Minor Changes

- 621604b: Admins can now record and update an employee's home address from the Admin
  tool's Users section — with live, suggestion-assisted entry (Google Places,
  biased toward Switzerland and Italy) or fully manual typing, either way. Every
  change is captured in the existing audit trail. Employees gain a new "My
  profile" page (reachable from the account menu) where they can see their own
  address, read-only.
- 2b11a53: New Inventory tool (specs/20261006-hardware-inventory): a hardware register with assets, employee-confirmed
  assignment, a depreciation ledger with fiscal-year close, and invoice files.

  `inventory-api` and `inventory-ui` are new. The shell mounts the gated `/inventory` route
  and an ungated `/devices` route (a "My devices" screen for every signed-in user). `auth`
  gains the inventory permission catalog, a scoped service-token endpoint and a capability-gated
  user directory. `notify-api` accepts the scoped service JWT on `/system/notifications` and a new
  `inventory` origin app, which `notify-ui` renders. New environment variables must be set before
  deploying: see `infra/README.md` § `inventory-api` service.

  `auth GET /authz/resolve` now returns no permissions for a soft-deleted user, so a removed
  user loses access to `refund-api` and `inventory-api` within 30 seconds instead of keeping it
  until their token expires.

## 0.0.1

### Patch Changes

- 6a13795: The shell footer/About dialog was showing `@operai/shell`'s own package
  version (`0.0.0`) instead of the Operai suite's umbrella version — the two
  are different numbers, and only the umbrella one is meaningful to a user.
  The footer now reads the umbrella version from a committed, generated file
  (`shell/src/lib/suiteVersion.generated.json`, kept in sync by
  `scripts/version.mjs` at release time) instead of `shell`'s own
  `package.json`.

  The About dialog additionally gains a "Components" section listing each
  mounted remote's own version (EstimAI, Refund, Admin, Notify), each exposed
  via a small new federated `./version` module. A remote whose version can't be
  resolved — unreachable, cold-starting, or (going forward, since every app
  deploys independently) simply predating this change — degrades to a muted
  "—" rather than blocking the dialog or throwing.

- 590047b: Add the receipt-bucket origin (`https://t3.storageapi.dev`) to the shell CSP's
  `connect-src`. Receipt uploads POST directly to the object-storage bucket
  (ADR 20260716-eu-object-storage-refund-attachments), so that request is governed by the shell's CSP even though no
  Operai service is involved — without this pin the browser blocks every upload
  before it leaves the page, regardless of the bucket's CORS rule.
- 09025ee: Serve the SPA document with `Cache-Control: no-store`. CSP rides on a response
  header and a `304 Not Modified` does not carry it, so a browser holding a
  cached copy kept enforcing a stale policy — which left receipt uploads blocked
  for two days after the CSP fix was live and correct. `max-age=0,
must-revalidate` is not sufficient; it still permits the 304.
