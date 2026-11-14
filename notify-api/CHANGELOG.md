# @operai/notify-api

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
- c30a110: Bilingual system notifications (specs/20261104-meetings, ADR 20261104-bilingual-system-notifications):
  - **notify-api:** `POST /system/notifications` accepts an optional Italian rendering of the title and body (`it`). A notification without it renders exactly as before. A migration adds the column. Email notices stay English.
  - **notify-ui:** the bell and the notification center show the Italian text when the interface language is Italian and the notification carries it, and fall back to the original otherwise. `meetings` is a new origin.
- 8c55bad: First of three pushes that retire the shared notification token (specs/20261013-notify-service-credentials,
  ADR 20261013-auth-mints-own-service-credential-in-process/0049). `notify-api` now accepts a scoped service credential on both
  internal routes (`/system/notifications` with `notifications.push`,
  `/system/emails` with `emails.send`), logs which caller made each accepted call,
  and treats `NOTIFY_INTERNAL_TOKEN` as optional. `auth` knows the `emails.send`
  scope, reserves the client id `auth` and can mint its own credential in process.
  `SERVICE_AUDIENCE` is now required in both services. No caller changes yet: every
  caller still sends the shared token and it still works.
- 81f0af0: The shared notification token is retired. `notify-api`'s two internal routes,
  `POST /system/emails` and `POST /system/notifications`, now accept only a scoped
  service credential from the caller; the `X-Internal-Token` header is refused with
  401 and the `NOTIFY_INTERNAL_TOKEN` setting is no longer read, so a deployment that
  still has it set starts normally. `inventory-api`'s comments and example file no
  longer mention the shared token.
- 23c2015: Add desktop push notifications (specs/20261111-push-notifications, ADR 20261111-web-push-encrypted-payloads-not-fcm/0085/0086/0087): `notify-api` gains a Web Push channel with encrypted payloads (no Firebase), a `push_device` table, the user-JWT routes `GET /push/config`, `PUT`/`GET /push/devices` and `DELETE /push/devices/{id}`, and the settings `PUSH_ENABLED` (off by default), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `PUSH_EXCLUDED_ORIGINS`. It remembers a recipient's active answer for 30 s, shares one in-flight lookup per user and sends through a bounded pool. The shell serves the `/push-sw.js` service worker, releases the device on sign-out, and adds a push section to My profile to turn push on or off and to list and remove devices. Rotating the VAPID keys invalidates every subscription; see infra/README.md.

  `auth` limits `POST /system/service-token` and `POST /system/users/contact` per verified calling service instead of per address: new optional variables `SERVICE_TOKEN_SERVICE_LIMIT` (300), `USERS_CONTACT_SERVICE_LIMIT` (600), `SYSTEM_INVALID_CREDENTIAL_LIMIT` (20 invalid credentials per address) and `SYSTEM_RATE_WINDOW_MS` (600000), a 4 KiB body cap and a 4 096-character token cap, and one 429 with `Retry-After`. `SERVICE_TOKEN_RATE_LIMIT` and `SERVICE_TOKEN_RATE_WINDOW_MS` are retired: ignored with one startup warning, flagged by env-doctor; delete them from production once this `auth` is live. Deploy `auth` first and enable `PUSH_ENABLED` only after the live capacity re-measure (infra/README.md § Push notifications).

### Patch Changes

- 800aec6: Operai is now invitation-only. Signing in creates a user only for an email in an allowed domain (`ALLOWED_SIGNUP_DOMAINS`) that holds a valid invitation; an allowed-domain email without one sees a page explaining this and joins a waiting list, and an outside-domain email is refused with nothing recorded. Admins review these requests in a new waiting list in the Admin tool and approve one into an invitation or dismiss it, and are notified of new requests.
- c75b9eb: Tests only: the env-group test no longer picks up a local dotenv file, and the ogg probe fixture uses ffmpeg's built-in Vorbis encoder instead of the optional libvorbis.

## 0.2.1

### Patch Changes

- d46837c: Keep the notification stream open. The server closed every idle connection after
  10 seconds, which is shorter than the stream's 15-second heartbeat, so the live
  stream was dropped and reopened about every 12 seconds and the browser console
  filled with `ERR_HTTP2_PROTOCOL_ERROR`. The idle timeout is now 60 seconds.

## 0.2.0

### Minor Changes

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

- ceb22d1: An approve/reject decision on an expense request now also reaches the employee
  by email, alongside the in-app notification they already received.

  Two new notify-api templates — `refund_decision_approved` and
  `refund_decision_rejected` — rather than one with an outcome flag: only the
  approved variant carries money, so a split keeps each template's `data` shape
  closed and fixed, and a rejection can never carry a figure. The approved mail
  states the approved total per currency inline; the rejected mail carries no
  amount and, deliberately, not the rejection motivation — that stays behind
  sign-in in the app. Both link into the request rather than restating it, the
  same posture the compiled-batch email already takes.

  refund-api sends it from the decision path as a second, independent
  best-effort channel: an email outage cannot suppress the in-app notification,
  an in-app outage cannot suppress the email, and neither can fail or roll back
  the decision itself. No new environment variable and no new secret — the
  existing notify-api internal token and app base URL cover it.

## 0.1.1

### Patch Changes

- bdf998c: Bind backends to IPv6 (::) on Railway (when RAILWAY_PRIVATE_DOMAIN is set) so private networking (\*.railway.internal) can reach them. Enables moving cross-service call URLs (AUTH_JWKS_URL / AUTH_BASE_URL / NOTIFY_INTERNAL_URL) to internal DNS and shared/reference variables (Layer 2), reducing the env-var sprawl. Local dev unchanged (keeps Bun default IPv4).
