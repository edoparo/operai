# @operai/auth

## 0.3.0

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

- bc428e8: Add the CRM (specs/20261101-crm, ADR 20261101-crm-tool-shape-and-authorization/0053): companies, contacts, deals through a stage
  pipeline with per-currency weighted totals, activities and follow-up tasks. New services
  `crm-api` and `crm-ui`; `auth` registers the `crm` catalog and the `sales` role and lets
  `deal:manage` holders read the user directory; the shell mounts the tool at `/crm`.
- 3172659: EstimAI list (specs/20261108-estimate-list-oversight): an admin can list and open every estimate read-only (new `estimate:read-all` permission, seeded to `admin`; ADR 20261108-estimai-oversight-permission-amends-0036); closed estimates move from the default Open list to a Closed filter; an estimate linked to a CRM deal shows a Deal badge, kept up to date by crm-api's new deal-link notices (scope `deal-link-notices.send`, ADR 20261108-crm-pushes-deal-links-to-estimai). Deploy auth first, then add the scope to crm-api's `SERVICE_CLIENTS` entry, set `SERVICE_AUDIENCE` on estimai-api and `ESTIMAI_INTERNAL_URL` on crm-api, deploy both, and run `crm-api/scripts/backfill-estimate-links.ts --apply` once.
- d549baf: A technical estimate is finished when it is closed in EstimAI. The owner or an editor closes it from the estimate page, after which it is read-only until someone reopens it. The CRM follows on its own: the deal's estimate turns ready, its task is completed, and the requester and the deal owner are told; reopening it in EstimAI reverses that. The CRM no longer has its own "Mark ready" and "Reopen" buttons. Needs `estimate-notices.send` on estimai-api's service client in auth, `CRM_INTERNAL_URL` on estimai-api and `SERVICE_AUDIENCE` on crm-api.
- 800aec6: Operai is now invitation-only. Signing in creates a user only for an email in an allowed domain (`ALLOWED_SIGNUP_DOMAINS`) that holds a valid invitation; an allowed-domain email without one sees a page explaining this and joins a waiting list, and an outside-domain email is refused with nothing recorded. Admins review these requests in a new waiting list in the Admin tool and approve one into an invitation or dismiss it, and are notified of new requests.
- c30a110: Add Meetings (specs/20261104-meetings, ADR 20261104-meetings-tool-shape-visibility-by-participation to ADR 20261104-default-employee-grant-meetings-access): record, transcribe, summarise and question meetings from anywhere in Operai. New services `meetings-api` and `meetings-ui`.
  - **Capture:** record in the browser (microphone, plus the audio of a shared tab where the browser allows it), upload a recording, or paste text. The person who records attests consent, and that attestation is stored on the meeting.
  - **Transcripts and summaries:** meetings are transcribed in Italian or English, summarised from shared or personal templates, and can be questioned one at a time, with answers citing transcript passages. Questions and answers are private to the asker. Audio is kept for 30 days; transcripts and summaries live until the meeting is deleted. AI providers run in the EU with zero retention.
  - **Visibility:** a meeting is visible to its creator and its Operai participants. The creator can optionally open it to everyone who can open the host record. A meeting whose creator is deactivated is frozen, not orphaned.
  - **auth:** new `meetings` catalog (`meetings:access`, `template:manage`, `meeting:erase`). `employee` now holds `meetings:access` by default, the first default grant on that role, and `admin` holds the other two. `meetings:access` also opens the user directory for the participant picker (ADR 20261104-user-directory-gate-meetings-access). New service client `meetings-api` and scope `host-notices.send`.
  - **shell:** the gated tool at `/meetings` and the ungated "My meetings" page at `/my-meetings`, so a participant without tool access can still read what was captured about them. Adds the host-extension seam that lets another remote embed a Meetings panel, and the meetings-api origin for the session.
  - **Operators:** `meetings-api` needs its own database, an EU bucket for audio and the env contract in `tools/env-doctor`.
- 8c55bad: First of three pushes that retire the shared notification token (specs/20261013-notify-service-credentials,
  ADR 20261013-auth-mints-own-service-credential-in-process/0049). `notify-api` now accepts a scoped service credential on both
  internal routes (`/system/notifications` with `notifications.push`,
  `/system/emails` with `emails.send`), logs which caller made each accepted call,
  and treats `NOTIFY_INTERNAL_TOKEN` as optional. `auth` knows the `emails.send`
  scope, reserves the client id `auth` and can mint its own credential in process.
  `SERVICE_AUDIENCE` is now required in both services. No caller changes yet: every
  caller still sends the shared token and it still works.
- 0b3b843: Second of three pushes that retire the shared notification token (specs/20261013-notify-service-credentials,
  ADR 20261013-auth-mints-own-service-credential-in-process/0049). Every notify-api caller now authenticates as itself with a scoped,
  short-lived service credential and no longer reads `NOTIFY_INTERNAL_TOKEN`: `auth`
  mints its own `emails.send` credential in process for invitation emails,
  `refund-api` uses `notifications.push` for decisions and `emails.send` for the batch
  email, and `estimai-api` uses `notifications.push` for collaborator changes. A caller
  whose credential is missing or refused fails soft exactly as before. `notify-api` still
  accepts the shared token until it is deleted from the deployed services.
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
- 23c2015: Add desktop push notifications (specs/20261111-push-notifications, ADR 20261111-web-push-encrypted-payloads-not-fcm/0085/0086/0087): `notify-api` gains a Web Push channel with encrypted payloads (no Firebase), a `push_device` table, the user-JWT routes `GET /push/config`, `PUT`/`GET /push/devices` and `DELETE /push/devices/{id}`, and the settings `PUSH_ENABLED` (off by default), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `PUSH_EXCLUDED_ORIGINS`. It remembers a recipient's active answer for 30 s, shares one in-flight lookup per user and sends through a bounded pool. The shell serves the `/push-sw.js` service worker, releases the device on sign-out, and adds a push section to My profile to turn push on or off and to list and remove devices. Rotating the VAPID keys invalidates every subscription; see infra/README.md.

  `auth` limits `POST /system/service-token` and `POST /system/users/contact` per verified calling service instead of per address: new optional variables `SERVICE_TOKEN_SERVICE_LIMIT` (300), `USERS_CONTACT_SERVICE_LIMIT` (600), `SYSTEM_INVALID_CREDENTIAL_LIMIT` (20 invalid credentials per address) and `SYSTEM_RATE_WINDOW_MS` (600000), a 4 KiB body cap and a 4 096-character token cap, and one 429 with `Retry-After`. `SERVICE_TOKEN_RATE_LIMIT` and `SERVICE_TOKEN_RATE_WINDOW_MS` are retired: ignored with one startup warning, flagged by env-doctor; delete them from production once this `auth` is live. Deploy `auth` first and enable `PUSH_ENABLED` only after the live capacity re-measure (infra/README.md § Push notifications).

### Patch Changes

- 0648a4e: Invitation emails now retry once with a fresh service credential when notify-api answers 401, instead of reporting the send as failed straight away. A second 401 or any other failure is still the best-effort outcome; the invitation is never rolled back.
- 59e9b48: Dependency security update. better-auth moves to 1.7.18 everywhere, closing the advisory that let an OAuth state be used as a magic link to sign in as another user. The frontends move to vitest 4 and refreshed lockfiles, which clears the critical seroval and tinypool advisories. auth gains a migration adding three optional key columns that better-auth 1.7 expects on its signing-key table.
- 94f89d9: Access requests follow-ups: an invitation conflict (409) now names its cause in a `code` field (`active_user_exists` / `pending_invitation_exists`); in the Admin tool, deciding the last request on a page returns to the previous page instead of an empty list, and the list shows a focus ring when it takes keyboard focus after a decision.

## 0.2.0

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

### Patch Changes

- cc1e678: A refused Google sign-in now says what went wrong instead of showing a 404.

  Better Auth's default OAuth error destination redirects to the service's origin
  root, and `auth` registers no `GET /` — so a user whose session was refused
  landed on the RFC 7807 handler and saw raw Problem JSON
  (`{"status":404,"detail":"GET / does not exist"}`), with the real reason only in
  a query string. OAuth failures are now routed to the hosted sign-in page, which
  renders the reason as a sentence next to the provider buttons. The
  `unable_to_create_session` code — a deactivated account — is spelled out as such
  rather than falling through to a generic "please try again", which could never
  have worked.

  Refusals are also logged now: `session.create.before` emits a structured
  `auth.session_denied` event carrying a distinct reason per branch
  (`soft_deleted_no_pending_invitation`, `soft_deleted_email_unverified`,
  `user_row_missing`) and the user id. Previously every branch produced the same
  opaque client-side code and no server-side trace at all, making a deliberately
  refused user indistinguishable from a broken OAuth configuration. The user id is
  logged rather than the email, to keep personal data out of log retention.

## 0.1.1

### Patch Changes

- bdf998c: Bind backends to IPv6 (::) on Railway (when RAILWAY_PRIVATE_DOMAIN is set) so private networking (\*.railway.internal) can reach them. Enables moving cross-service call URLs (AUTH_JWKS_URL / AUTH_BASE_URL / NOTIFY_INTERNAL_URL) to internal DNS and shared/reference variables (Layer 2), reducing the env-var sprawl. Local dev unchanged (keeps Bun default IPv4).
