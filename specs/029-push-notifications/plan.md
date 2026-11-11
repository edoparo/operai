---
spec: 029
status: approved
approved: 2026-11-11
---

# Plan: Push notifications

## Architecture

Push is a **third delivery channel of notify-api**, beside `inApp` (SSE) and `email`
(ADR-0011), using **standard Web Push** (RFC 8030 transport, RFC 8291 payload encryption,
RFC 8292 VAPID) — not Firebase Cloud Messaging. The browser side lives in the **shell**:
a service worker, the subscription logic, and a "Push notifications" section in My profile.
No remote, no other backend, and no caller of `/system/notifications` changes.

Decisions recorded as ADRs (written with this plan):
- `docs/adr/0084-web-push-encrypted-payloads-not-fcm.md` — standard Web Push with
  payloads encrypted by notify-api, over FCM.
- `docs/adr/0085-push-suppression-decided-by-the-browser.md` — "is an Operai tab visible?"
  is answered by the service worker, never by the server.

### Components

| Component | Change |
|---|---|
| `notify-api/src/channels/push.channel.ts` (new) | `pushChannel.dispatch(recipientId, notification)` — loads the recipient's devices, checks the recipient is active, encrypts and sends, prunes dead devices. Never throws. |
| `notify-api/src/channels/inApp.channel.ts` | After `eventBus.publish`, calls `pushChannel.dispatch(...)` **without awaiting** it. Every notification persisted by either route (`POST /notifications`, `POST /system/notifications`) passes here, so both are covered in one place (spec AC-2.1/2.2: every notification). |
| `notify-api/src/push/` (new) | `devices.routes.ts` (user-JWT routes below), `devices.repo.ts`, `devices.schemas.ts`, `pushEndpoint.ts` (endpoint allowlist), `deviceLabel.ts` (User-Agent → "Chrome · macOS"), `webPushSender.ts` (thin wrapper over the `web-push` library, injectable). |
| `notify-api/src/lib/env.ts` | New push group (below), validated at startup, process exits on a partial group. |
| `notify-api/prisma/` | New `PushDevice` model + migration. |
| `shell/src/sw/push-sw.ts` (new) | The service worker: `push` → show or suppress; `notificationclick` → focus/open the target. Built as a classic (non-module) script emitted at the stable path `/push-sw.js`, because Firefox does not reliably run module service workers. |
| `shell/vite.config.ts` | A second build entry for the service worker with a fixed, unhashed output name, plus a dev-server middleware serving the same bundle at `/push-sw.js`. |
| `shell/src/lib/push.ts` (new) | Support detection, permission state, enable/disable, boot reconciliation, sign-out release. Talks to notify-api through `apiFetch` (ADR-0001). Stores `{deviceId, userId}` in IndexedDB (not a credential; ADR-0001 is about the JWT). |
| `shell/src/lib/session.ts` | `signOut()` gains an awaited, time-boxed **before-sign-out** step (≤ 2 s) so the device is deleted while the JWT is still valid; existing synchronous `onSignOut` hooks are unchanged. |
| `shell/public/push-icon.png` (new) | 192×192 PNG of the Operai mark: Chrome, Edge and Safari do not reliably render an SVG notification icon (design G5; verified in the R1 spike). |
| `shell/src/components/PushSettings.tsx` (new) + `AccountScreen.tsx` | A second section on My profile: the "this browser" control, its unavailable/blocked states, and the device list with Remove (`ConfirmDialog`). `@operai/ui` has no switch component, and the action is asynchronous and can be refused by the browser, so the control is a status line plus one `Button` ("Turn on" / "Turn off") — no new library component. The section is a SIBLING of `account-address-region`, never inside it: specs/012 AC-6.2's test asserts that region has no interactive element (design G6); the screen's "read-only" module comment is updated. `@operai/ui` components only; copy in `shell/src/strings.ts` (en + it). |
| `tools/env-doctor/manifest.ts` + templates | The new notify-api variables; `VAPID_PRIVATE_KEY` classed as a secret. |

### Send sequence

```
caller ─POST /system/notifications─► notify-api
  inAppChannel.send: persist row → eventBus.publish (SSE, unchanged) → respond 201
                     └─ pushChannel.dispatch(recipientId, dto)   (not awaited)
                          1. PUSH_ENABLED off, or originApp ∈ PUSH_EXCLUDED_ORIGINS → stop   (AC-6.1, 6.4)
                          2. devices = PushDevice where userId = recipientId; none → stop
                          3. userContact.lookup(recipientId)  (ADR-0056 client, reused)
                               inactive → delete all of the user's devices, stop          (AC-5.2)
                               failed   → stop (fail closed, logged)
                          4. payload = {v:1,id,title,body,originApp,href}  (English, AC-2.5; body
                             truncated so the encrypted record fits the 4 KB Web Push limit)
                          5. per device: web-push sendNotification (aes128gcm, VAPID, TTL 86400,
                             timeout 10 s)
                               201         → ok
                               404 / 410   → delete that device                           (AC-2.7)
                               other/error → log (device id + status only), no retry      (AC-2.6)
browser push service ─► service worker (push event)
   a visible window client of the shell origin exists AND this browser's subscription
     endpoint is not Apple's (web.push.apple.com) → do nothing                           (AC-2.3)
     (Safari: always show — it cancels subscriptions after pushes that show nothing)
   else showNotification(title, {body, tag: id, data: {href}, icon: /push-icon.png})      (AC-2.1, 2.4)
user clicks ─► notificationclick: target = href ?? "/notify"
   a shell window exists → focus it and post {navigate: target} (the page calls navigateSuite)
   else clients.openWindow(target)  → signed out? the shell's guard sends to sign-in with
                                       redirect=<target> (router.tsx, unchanged)          (AC-4.1–4.3)
```

### Enable / disable / sign-out (shell)

- **Support** (AC-1.6): `serviceWorker`, `PushManager` and `Notification` exist **and** the
  device is not mobile (`navigator.userAgentData.mobile`, else a UA test for
  Mobi/Android/iPhone/iPad). iPhone/iPad Safari outside a home-screen app has no
  `PushManager`, so it falls out naturally.
- **Shown only when enabled** (AC-6.1): the section asks `GET /push/config`; `enabled:false`
  → the section is not rendered.
- **Enable** (AC-1.2, 1.3): on the switch's click (a user gesture, required by Safari) →
  `Notification.requestPermission()`; granted → register `/push-sw.js` (scope `/`) →
  `pushManager.subscribe({userVisibleOnly: true, applicationServerKey: vapidPublicKey})` →
  `PUT /push/devices` → store `{deviceId, userId}`. Refused/dismissed → no subscription,
  nothing sent to the server, blocked message.
- **Never prompt on load** (AC-1.1): `requestPermission` is called only from the switch.
- **Reload/sign-in again** (AC-1.7): the switch is "on" iff a browser subscription exists,
  the stored `userId` is the current user, and `deviceId` is in `GET /push/devices`.
  If the browser subscription exists but the server has no row (pruned), the shell
  re-`PUT`s it silently (permission is already granted; no prompt).
- **Another user signs in** (AC-5.3): at shell boot, a stored `userId` ≠ current user →
  `subscription.unsubscribe()` and clear the store. The old endpoint is then dead at the
  push service; the next send to it returns 410 and notify-api deletes the row (AC-2.7).
  Additionally `PUT /push/devices` with an endpoint already owned by another user
  **moves** the row to the caller — possessing the browser subscription is the proof.
- **Permission revoked in the browser settings** (design G4): at boot, a stored `deviceId`
  with `Notification.permission !== 'granted'` → `DELETE /push/devices/{deviceId}` (404 counts
  as success) → `unsubscribe()` → clear the store; the section then shows the blocked or off
  state. Any failure after a browser subscription exists (e.g. the `PUT` fails) also calls
  `unsubscribe()`, so "no server row" always means "no browser subscription".
- **Config failure** (spec AC-1.8): `GET /push/config` failing → a warning `Banner` with
  retry inside the push section only.
- **Sign-out** (AC-5.1): before-sign-out step → `DELETE /push/devices/{deviceId}` (2 s
  budget) → `unsubscribe()` → clear store. If the DELETE fails, the unsubscribe still kills
  the endpoint, so the row is pruned on the next send.
- **Disable / Remove** (AC-1.5, 3.2): `DELETE /push/devices/{id}`; for "this browser" also
  `unsubscribe()`.

### Why this shape (and what was rejected)

- **Web Push with our own encryption, not FCM** (ADR-0084): with FCM the server hands Google
  the plaintext; with RFC 8291 every push service (Google for Chrome, Microsoft for Edge,
  Mozilla, Apple) carries ciphertext only — spec AC-6.3. No Firebase project, no Google
  credential, no SDK in the shell. *Rejected:* FCM (plaintext at Google, a new processor
  sign-off); content-free push + fetch on show (service worker would need a credential —
  ADR-0001 forbids persisting the JWT — and the user chose full text).
- **Suppression in the service worker, not server presence** (ADR-0085): an open SSE stream
  says a tab exists, not that it is visible; only the browser knows visibility. *Rejected:*
  skipping push when the user has an SSE stream (a background tab would swallow the push);
  tabs reporting visibility to the server (chatty, racy, still wrong across tab switches).
- **Hook in `inAppChannel.send`, not in each route and not as an `eventBus` listener**: one
  place covers both routes; the event bus is per-recipient SSE fan-out and has no
  "all recipients" subscription.
- **Activity check via the existing `userContact` lookup** (ADR-0056): already there, already
  fail-closed-able, called only when the user has devices.
- **`web-push` library over a hand-written RFC 8291 implementation**: the encryption is
  exactly where hand-rolled code goes wrong; the library is the reference implementation.
  Its Bun compatibility is risk R1, checked first.

## Data model

notify-api, new Prisma model and one new migration (existing migrations untouched):

```prisma
model PushDevice {
  id        String   @id @default(cuid())
  userId    String                          // JWT sub of the owner
  endpoint  String   @unique                // push-service URL; allowlisted host, https only
  p256dh    String                          // browser public key (base64url)
  auth      String                          // browser auth secret (base64url) — never logged or returned
  label     String                          // "Chrome · macOS", derived server-side from User-Agent
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId])
  @@map("push_device")
}
```

At most 20 devices per user. Rows are deleted, never soft-deleted. No delivery log
(spec non-goal).

## API contracts

All new routes are on notify-api, **user JWT** (`jwtMiddleware`, `aud=AUTH_AUDIENCE`),
scoped to `sub`, each with its own exact-path `.use(...)` (never `"*"`, per the existing
router headers). Errors are RFC 7807 Problem JSON. Body limit 8 KiB.

### `GET /push/config`
```json
200 { "enabled": true,  "vapidPublicKey": "BOr…base64url" }
200 { "enabled": false }
401 Problem
```

### `PUT /push/devices` — register (idempotent by endpoint)
```json
request  { "endpoint": "https://fcm.googleapis.com/fcm/send/…",
           "keys": { "p256dh": "B…", "auth": "…" } }
200/201  { "id": "c…", "label": "Chrome · macOS", "createdAt": "2026-11-11T09:00:00.000Z" }
```
- 201 new row; 200 when the endpoint already existed (owner set to the caller, keys
  replaced).
- 400 `invalid_body`: missing field, endpoint > 2000 chars, keys not base64url of the RFC
  lengths (p256dh 65 bytes decoded, auth 16 bytes).
- 422 `endpoint_not_allowed`: not `https:`, or host not in the allowlist:
  `fcm.googleapis.com`, `*.push.services.mozilla.com`, `web.push.apple.com`,
  `*.notify.windows.com`. (notify-api POSTs to this URL; the allowlist is the SSRF guard.)
- 409 `device_limit`: the caller already has 20 devices and this endpoint is new.
- 503 `push_disabled`: `PUSH_ENABLED` is off.

### `GET /push/devices`
```json
200 { "items": [ { "id": "c…", "label": "Firefox · Windows", "createdAt": "…" } ] }
```
Caller's devices only, newest first. Endpoint and keys are never returned.

### `DELETE /push/devices/{id}`
- 204 deleted. 404 when the id does not exist **or** belongs to another user (identical,
  ADR-0005).

### Push payload (encrypted, aes128gcm; what the service worker receives)
```json
{ "v": 1, "id": "c…", "title": "…", "body": "…", "originApp": "crm", "href": "/crm/deals/…" }
```
`href` present only when the notification has a relative link (already open-redirect-guarded
by `LinkSchema`). `body` truncated with "…" so the JSON is ≤ 3 000 bytes UTF-8. Nothing
else (spec AC-6.2).

### Environment (notify-api)

| Variable | Rule |
|---|---|
| `PUSH_ENABLED` | literal `"true"` enables; anything else off (same parsing as `EMAIL_ENABLED`). Default off. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | required when enabled; P-256, base64url; startup checks that the private key derives the public key. Private key in 1Password. |
| `VAPID_SUBJECT` | required when enabled; `mailto:` or `https:` URL. |
| `PUSH_EXCLUDED_ORIGINS` | optional CSV of `originApp` values (validated against `OriginAppSchema`); default empty. |
| email-notice group (`APP_BASE_URL`, `AUTH_BASE_URL`, `SERVICE_CLIENT_ID`, `SERVICE_CLIENT_SECRET`) | required when `PUSH_ENABLED` (the activity check, AC-5.2). |

Generate keys once with `bunx web-push generate-vapid-keys`. Rotating the keys invalidates
every subscription (each was made against the public key); the shell re-subscribes on the
next visit only after the user turns push on again — documented in `infra/README.md`.

## Test strategy

| AC | Level | Test |
|---|---|---|
| AC-1.1 | component (shell, Vitest) | `PushSettings`: off state rendered; `Notification.requestPermission` spy not called on mount |
| AC-1.2 | component + integration | switch on → permission granted (stub) → `PUT /push/devices` sent with the subscription; device appears in the list. notify-api: `PUT` 201 persists row, label derived |
| AC-1.3 | component | after prompt: `denied` → blocked message, no Turn on; `default` → "not allowed" message, Turn on still offered; neither sends a `PUT` |
| AC-1.4 | component | `Notification.permission === 'denied'` on mount → unavailable state, no switch action |
| AC-1.5 | component + integration | switch off → `DELETE` + `unsubscribe()`; notify-api: deleted device receives no send (fake sender) |
| AC-1.6 | unit (shell) + component | `isPushSupported()` table: Chrome/Edge/Firefox/Safari desktop true; Android Chrome, iPhone Safari, missing `PushManager` false; component shows "not available", no Turn on, device list + Remove still rendered |
| AC-1.7 | unit (shell `push.ts`) | existing subscription + matching stored user + id in server list → on; server row missing → silent re-`PUT`, no prompt |
| AC-1.8 | component | `GET /push/config` rejects → warning `Banner` with retry in the push section; address section still rendered; retry refetches |
| AC-2.1 | integration (notify-api) + manual | `POST /system/notifications` → fake sender called once per device with a payload that **decrypts** (test holds the subscriber private key) to the English title/body. Manual go-live check on real Chrome, Edge, Firefox, Safari with Operai closed |
| AC-2.2 | integration | notification with `toastWorthy:false` (system route) and `true` (user route) both dispatched |
| AC-2.3 | unit (service worker) | fake `clients.matchAll` with a visible window → `showNotification` not called; hidden only → called; visible window + subscription endpoint on `web.push.apple.com` → called |
| AC-2.4 | integration + unit (SW) | two devices → two sends; SW uses `tag = id` |
| AC-2.5 | integration | notification with `it` variant → decrypted payload has the English text |
| AC-2.6 | integration | fake sender throws / returns 500 → `POST /system/notifications` still 201, row persisted, SSE event published |
| AC-2.7 | integration | fake sender 410 and 404 → device row deleted; 500 → row kept |
| AC-3.1 | component + integration | list renders label, `formatDate(createdAt)`, "this browser" marker by stored device id; `GET` returns caller's rows only, no endpoint/keys in body |
| AC-3.2 | component + integration | Remove → `DELETE` 204, row gone, other devices still dispatched to |
| AC-3.3 | integration | user B `GET` sees none of A's; `DELETE` A's id as B → 404, row intact |
| AC-4.1 | unit (SW) | click with `href` and an existing window → `focus()` + `postMessage({navigate})`; none → `openWindow(href)` |
| AC-4.2 | unit (SW) | click without `href` → target `/notify` |
| AC-4.3 | e2e (shell, Playwright) | signed-out visit to a deep link lands on sign-in and returns to it (existing guard; the SW only opens the URL) |
| AC-5.1 | unit (`session.ts`, `push.ts`) | `signOut()` awaits the before-sign-out step: `DELETE` sent with the JWT before the cache clears; times out at 2 s without blocking sign-out |
| AC-5.2 | integration | `userContact` stub → `inactive`: no send, all the user's devices deleted; `failed`: no send, devices kept |
| AC-5.3 | unit (`push.ts`) + integration | stored `userId` ≠ current → `unsubscribe()` at boot; notify-api `PUT` of an existing endpoint by another user moves the row |
| AC-6.1 | unit (env) + integration + component | env: off by default, partial group exits; `PUT` → 503; dispatch never calls sender; `GET /push/config` `enabled:false` → section absent |
| AC-6.2 | integration | decrypted payload keys are exactly `v,id,title,body,originApp[,href]` |
| AC-6.3 | integration | the bytes handed to the HTTP layer are an RFC 8291 `aes128gcm` record (header + ciphertext); the plaintext title does not occur in them; decryption with the subscriber key succeeds |
| AC-6.4 | integration | `PUSH_EXCLUDED_ORIGINS=meetings` → a meetings notification is not sent, a crm one is |
| AC-6.5 | review gate | ADR-0084 carries owner + date of the go-live decision; checked by QE before `PUSH_ENABLED=true` in production |

Also: endpoint allowlist unit table (allowed hosts, look-alikes `fcm.googleapis.com.evil.io`,
`http:`, IP literals, userinfo tricks); `deviceLabel` unit table; strings parity and
no-hardcoded-strings tests already in the shell cover the new copy.

E2E note: headless Chromium cannot obtain a real push subscription, so Playwright covers the
My profile flow with an init-script fake `PushManager`; real delivery is the manual
cross-browser check in AC-2.1.

## Risks

| # | Risk | Early check / mitigation |
|---|---|---|
| R1 | `web-push` relies on Node crypto (ECDH P-256, HKDF, AES-GCM) and `https`; a Bun gap breaks sending | **First task:** send from Bun to a real Chrome subscription. Fallback: implement RFC 8291 on WebCrypto + `jose` (already a dependency) for VAPID |
| R2 | Safari may revoke push permission when a push arrives and no notification is shown (the suppression of AC-2.3) | Check on Safari in the R1 spike. Fallback: on Safari always show, with `tag = id` (still no duplicate); amend AC-2.3 via the drift rule if needed |

**Spike result (T1, 2026-11-11, Safari on macOS):**
- R1 — `web-push` on Bun 1.4.2: `aes128gcm` + VAPID, plaintext absent from the body; delivered by `web.push.apple.com` (201) to a closed tab. Import it as `import * as webpush from "web-push"` — the default import fails under Bun. ✅
- R2 — **confirmed.** Three pushes suppressed with a visible tab → Safari cancelled the subscription (permission still `granted`); later sends still got 201 from Apple but never reached the browser. "Show then `close()` at once" does not help: the notification stays in Notification Center. → **Fallback taken: Safari always shows** (spec AC-2.3 amended). Safari is recognised in the service worker by its subscription endpoint host `web.push.apple.com`. Because Apple keeps answering 201 for a dead subscription, the shell's boot reconciliation (T8) is what detects it on Safari.
- G5 — Safari ignores `icon` (always the Safari compass, PNG and SVG alike); the icon matters only on Chrome/Edge/Firefox.
- Click → focus existing window + `postMessage({navigate})` works on Safari. ✅
- Chrome, Edge, Firefox: **deferred to T12** (not installed on the spike machine; user decision 2026-11-11). Known behaviour, to be confirmed there: Chrome/Edge tolerate pushes that show nothing while a tab is visible; Edge endpoints on `*.notify.windows.com` (WNS); Firefox's quota on silent pushes does not apply to a visible tab. Any deviation is a one-line change in T4's allowlist or T7's service-worker rule, through the drift rule.
- Chromium forks (Dia, tested): permission and service worker work but nothing is delivered — forks without Google's push credentials have `PushManager` and no working push service. Out of scope (AC-1.6 lists supported browsers); design.md's "subscribe failed" copy covers forks whose `subscribe()` throws, a fork that subscribes but never delivers cannot be detected.
- Icon: `shell/public/push-icon.png` (192×192, rendered from `operai.svg`) added.
| R3 | Edge's WNS endpoint hosts differ from `*.notify.windows.com` | Verify on real Edge during the spike; the allowlist is one constant |
| R4 | Payload over the 4 KB Web Push limit | Body truncation with a byte-budget unit test |
| R5 | A deactivated user's devices keep receiving if the auth lookup is down | Fail closed: no send on `failed` (AC-5.2 holds); the cost is no push during an auth outage |
| R6 | Service-worker build path (classic script, stable name) fights the MF build or Vercel rewrites | Static files win over the SPA rewrite on Vercel; `/push-sw.js` already falls under the `no-store` header rule. Verify in `mise run dev:preview` |
| R7 | VAPID key rotation silently invalidates every subscription | Documented runbook; boot reconciliation re-`PUT`s only rows still valid |

## Security

**YES.** New user-JWT routes that store per-user data, a server that POSTs to URLs supplied
by clients (SSRF — mitigated by the host allowlist and `https` only), a new secret
(`VAPID_PRIVATE_KEY`), cross-user isolation of devices (404 on another user's id), the
sign-out and user-switch paths, a service worker that opens URLs (only relative `href`,
same origin), and business content leaving the EU encrypted (ADR-0084). Schedule the
owasp-reviewer in parallel with QE.

## ADR candidates

- **ADR-0084** — Web Push with payloads encrypted by notify-api, over FCM (rejected: FCM,
  content-free push with fetch-on-show).
- **ADR-0085** — push suppression decided by the browser's service worker (rejected: SSE
  presence on the server, tab visibility reported to the server).
