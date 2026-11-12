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
No remote and no caller of `/system/notifications` changes.

**Amended 2026-11-12 after QE round 0 / security review (D-1):** the feature now changes a **second backend, `auth`**:
the rate limit of `POST /system/users/contact` (ADR-0056) is keyed by the verified service
principal instead of the network address, with its own limit (§ API contracts, auth). Without
it, push makes that limit bite after about 20 notifications in 10 minutes, suite-wide, and
starves the existing email notices with it. Recorded as a candidate amendment of ADR-0056
(`docs/adr/0086-users-contact-limited-per-service-principal.md`, § ADR candidates).

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
| `notify-api/src/push/activityCheck.ts` (new) — **Amended 2026-11-12 after QE round 0 / security review (D-1)** | `createActivityCheck(contacts, { ttlMs: 30_000, now })` → `isActive(userId): Promise<"active" \| "inactive" \| "failed">`. Wraps the ADR-0056 `UserContactClient` for the push channel only: a `found` answer is remembered for 30 s per user (the user id and an expiry, never the address or name); `inactive` and `failed` are never remembered; concurrent checks for the same user share one lookup (single flight). Entries exist only for users auth answered `found` for, so the map is bounded by the number of active users; expired entries are dropped on access. The email-notice path keeps calling the client directly, uncached (ADR-0056: every email notice is a fresh lookup). `userContact.ts`'s failure log lines drop the words "email notice not sent" (the client now serves push too) and keep the HTTP status / error class only. |
| `notify-api/src/push/sendPool.ts` (new) — **Amended 2026-11-12 after QE round 0 / security review (S-M2)** | `createSendPool({ concurrency: 16, maxQueued: 1_000, maxQueuedPerRecipient: 100 })` → `run(recipientId, send: () => Promise<void>): Promise<"done" \| "dropped">` (never rejects; `send` errors are the channel's to log, as today). One process-wide pool for Web Push sends: at most **16 sends in flight** across all dispatches; a FIFO wait queue of at most **1 000** sends in total and at most **100** per recipient. A send that would exceed either queue bound is not queued (dropped, best effort, AC-2.6) and the dispatch logs one line `[push] backlog full — <n> sends dropped` (count only). notify-api runs one instance (ADR-0008), so process-wide is suite-wide. |
| `notify-api/src/push/devices.repo.ts`, `devices.routes.ts` — **Amended 2026-11-12 after QE round 0 / security review (S-M2)** | The 20-device cap moves INTO `upsertByEndpoint`'s transaction, behind a per-user advisory lock (§ Data model); the route's separate count-then-upsert is removed and the repo's `{ outcome: "limit" }` maps to the unchanged 409. `countByUser` is no longer used by the route. |
| `auth/src/system/userContact.routes.ts`, `auth/src/lib/rateLimiter.ts`, `auth/src/lib/env.ts`, `auth/.env.example` — **Amended 2026-11-12 after QE round 0 / security review (D-1)** | The limiter of `POST /system/users/contact` is re-keyed (§ API contracts, auth). `RateLimiter` gains `peek(key, now?)` (reports admission without recording an attempt). Two new optional variables. The `/system/service-token` limiter is unchanged. |
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
                          3. activityCheck.isActive(recipientId)  (ADR-0056 client behind a
                             30 s memo of `found` + single flight — amended 2026-11-12, D-1)
                               active   → continue (a `found` within the last 30 s, or a fresh one)
                               inactive → delete all of the user's devices, stop          (AC-5.2)
                               failed   → stop (fail closed, logged; includes auth's 429)
                          4. payload = {v:1,id,title,body,originApp,href}  (English, AC-2.5; body
                             truncated so the encrypted record fits the 4 KB Web Push limit)
                          5. per device, through the process-wide send pool (16 in flight;
                             queue ≤ 1 000 total, ≤ 100 per recipient, else dropped + one log
                             line — amended 2026-11-12, S-M2): web-push sendNotification
                             (aes128gcm, VAPID, TTL 86400, timeout 10 s)
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
  **Amended 2026-11-12 after QE round 0 / security review (D-1):** the lookup alone made every notification to a
  user with a device cost one call to auth, against a limit of 20 per 10 minutes keyed by
  network address. In production every service reaches auth over Railway's private network
  (`AUTH_BASE_URL=http://${{auth.RAILWAY_PRIVATE_DOMAIN}}…`), where there is no
  `X-Forwarded-For`, so `callerAddress()` returns `"direct"` for all of them: the key did not
  identify the caller at all. Chosen, both halves needed:
  1. **auth limits `users.contact` per verified service principal** (`sub`), 600 per 10 min,
     counted after the credential is verified; failed credentials are still limited per
     address. The bucket now bounds the one thing it can bound: what a holder of the scope
     does.
  2. **notify-api remembers a `found` answer for 30 s per user** (push only) and shares
     concurrent lookups. This bounds the cost per recipient regardless of who raises the
     notifications: an employee looping `POST /notifications` (self-raise, no rate limit,
     specs/005) to themselves costs at most 20 lookups per 10 minutes, so one person cannot
     drain the suite's bucket and stop everyone's push and email notices. 30 s is the bound
     the suite already accepts for "deactivated → refused" at the authorization-enforcing
     servers (ADR-0014's resolve cache, ADR-0012 amendment M2), and it is far tighter than
     notify-api's own in-app channel, where a deactivated user's open tab keeps receiving
     notifications over SSE until the 7-day JWT expires (ADR-0012 § 4). **This needs spec
     AC-5.2 amended** (proposed to the PO, R8); if the PO refuses, the TTL constant becomes 0
     and half 1 alone carries D-1, with the self-raise drain accepted as R9.

  *Rejected:*
  - **Raise the address-keyed limit only.** Every private-network caller is `"direct"`, so a
    bigger shared bucket is still not a per-caller bound, and any one consumer still starves
    the others.
  - **A memo in notify-api alone, auth unchanged.** Each recipient still costs at least one
    lookup per window whenever the TTL is ≤ the window, so 21 recipients with devices in
    10 minutes exhaust 20; a TTL long enough to help (hours) is a long-lived "still active"
    answer that AC-5.2 cannot carry.
  - **A dedicated, narrower auth endpoint (`POST /system/users/active` → boolean, new scope).**
    Data-minimal (push does not need the address), but it adds a scope, a production
    `SERVICE_CLIENTS` change with its deploy-order hazard (an unknown scope stops auth,
    ADR-0076) and a second fact endpoint, while the limiter problem is the same either way.
    notify-api already handles addresses for email notices and never logs or stores them.
    Trigger to build it: a second consumer that needs liveness only (e.g. ADR-0012's named
    resource-server liveness check).
  - **auth tells notify-api about a deactivation (push the event, drop the per-send check).**
    A lost message leaves a deactivated user receiving pushes indefinitely unless it gets an
    outbox and retries (ADR-0059 machinery); making it part of ADR-0012's synchronous delete
    cascade would make deleting a user depend on notify-api being up, which ADR-0012 refused
    ("resource servers do nothing at delete time").
  - **Look up only when the user's devices are older than N.** Device age says nothing about
    when the user was deactivated.
- **Atomic device cap and a bounded send pool** — **Amended 2026-11-12 after QE round 0 / security review (S-M2):**
  the original count-then-upsert let N concurrent `PUT`s at 19 devices create N rows, and
  `dispatch` sent to every device with an unbounded `Promise.all` while nothing bounded how
  many dispatches run at once. *Rejected for the cap:* a conditional `INSERT … SELECT … WHERE
  count < 20` (two READ COMMITTED transactions both see 19); `SERIALIZABLE` with retry (correct,
  but a retry loop for a one-row write); a per-user counter row with a CHECK (a new table to
  keep in step with every delete and prune). *Rejected for sends:* a per-dispatch bound only
  (a burst of dispatches is still unbounded in total); an unbounded queue (memory grows with a
  flood); no per-recipient bound (one recipient's flood fills the shared queue and drops
  everyone else's pushes). *Not added:* a per-user rate limit on `PUT /push/devices` — the
  atomic cap bounds stored rows at 20, the endpoint allowlist bounds where sends go, and a
  `PUT` never causes a send (only a raised notification does); a `PUT` loop costs one upsert,
  like any other authenticated write in notify-api, none of which is rate-limited. Revisit if
  `PUT` volume shows in the database's load.
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

**Amended 2026-11-12 after QE round 0 / security review (S-M2) — the cap is atomic.** No schema change. `upsertByEndpoint`
enforces the cap inside its own transaction:

```ts
// notify-api/src/push/devices.repo.ts
const PUSH_DEVICE_LOCK_NAMESPACE = 2901; // notify-api holds no other advisory lock today

db.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PUSH_DEVICE_LOCK_NAMESPACE}::int, hashtext(${userId}))`;
  const existing = await tx.pushDevice.findUnique({ where: { endpoint }, select: { userId: true } });
  if (existing?.userId !== userId) {                       // new to the caller: created or moved
    const owned = await tx.pushDevice.count({ where: { userId } });
    if (owned >= MAX_DEVICES_PER_USER) return { outcome: "limit" } as const;   // nothing written
  }
  /* upsert exactly as before → { outcome: "created" | "updated" | "moved", device } */
}, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
```

- Why it is complete: a row is only ever added to user U's count by a `PUT` whose JWT `sub` is
  U (create, or move to U), and every such `PUT` holds U's lock across its count and its write.
  Deletes, prunes and moves away from U only lower U's count and need no lock. A hash
  collision between two users only serialises them.
- **READ COMMITTED is pinned on purpose**: each statement takes a fresh snapshot, so the
  `count` after the lock sees the previous holder's committed row. Under REPEATABLE READ the
  snapshot would date from the lock statement's start, before the wait, and the race would
  return.
- Two concurrent `PUT`s of the same endpoint by different users take different locks; the
  unique index and Prisma's native `ON CONFLICT` upsert decide the final owner (last commit
  wins). Each caller's cap was checked under its own lock, so neither can exceed 20; the
  only imprecision is that one of them may answer 201 where 200 would describe the result.

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
  **Amended 2026-11-12 after QE round 0 / security review (S-M2):** decided atomically (§ Data model) — of N
  concurrent `PUT`s of distinct new endpoints by a caller with `k` devices, exactly
  `max(0, 20 − k)` answer 201 and the rest 409. "New" means not currently the caller's:
  a new endpoint, or one held by another account (a move). At 20, re-registering one of the
  caller's own endpoints is still 200; a move is 409 and the row stays with its current owner
  unchanged. A 409 writes nothing. Body unchanged: Problem JSON with `code: "device_limit"`.
- 503 `push_disabled`: `PUSH_ENABLED` is off.

### `GET /push/devices`
```json
200 { "items": [ { "id": "c…", "label": "Firefox · Windows", "createdAt": "…" } ] }
```
Caller's devices only, newest first. Endpoint and keys are never returned.

### `DELETE /push/devices/{id}`
- 204 deleted. 404 when the id does not exist **or** belongs to another user (identical,
  ADR-0005).

### auth `POST /system/users/contact` — limiter amended (Amended 2026-11-12 after QE round 0 / security review, D-1)

Request, responses, credential checks and the identical 401/404 bodies are unchanged
(ADR-0056, specs/019). Only the order and the key of the rate limit change:

```
1. failed-credential guard  key = callerAddress(X-Forwarded-For)   (unchanged helper; "direct"
                            on the private network)
                            peek: ≥ SERVICE_TOKEN_RATE_LIMIT failures in the window → 429
                            (nothing recorded for an admitted request)
2. service credential check (unchanged) — on ANY 401: record one failure for the address
3. principal limiter        key = verified `sub` (e.g. "system:notify-api")
                            consume: > USERS_CONTACT_RATE_LIMIT in USERS_CONTACT_RATE_WINDOW_MS → 429
4. body validation (400), lookup (200 / 404) — unchanged
```

```json
429 { "type": "https://httpstatuses.com/429", "title": "Too Many Requests", "status": 429,
      "detail": "Too many requests. Try again later.", "instance": "/system/users/contact",
      "code": "rate_limited" }            + header Retry-After: <whole seconds, ≥ 1>
```

- A request with a valid credential never touches the address bucket; a request with an
  invalid one never touches a principal bucket. The 429 body is the same at step 1 and step 3.
- A 400 still cannot be reached without a valid credential (validation stays after step 2).
- Each principal has its own bucket; today only `system:notify-api` holds `users.contact`.
- Rejected attempts are not recorded (existing limiter semantics), so retrying during a 429
  does not delay recovery.

| Variable (auth) | Rule |
|---|---|
| `USERS_CONTACT_RATE_LIMIT` | optional positive integer, default **600** |
| `USERS_CONTACT_RATE_WINDOW_MS` | optional positive integer, default **600000** (10 min) |

Sizing: with the 30 s memo a recipient costs at most 20 push lookups per 10 minutes, so 600
is only reached with about 30 recipients each receiving a notification more often than every
30 s for ten minutes, or a few hundred email notices — well above wellD's volume. auth-local
and optional, so no env-doctor manifest entry (like `SERVICE_TOKEN_RATE_*`); listed in
`auth/.env.example` and `infra/README.md`. auth runs one instance (rateLimiter.ts); a second
instance would only double the budget.

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
| AC-2.1 under load — **Amended 2026-11-12 after QE round 0 / security review (D-1)** | integration (notify-api, REAL client) | `push.capacity.test`: the REAL `createUserContactClient` (no stub) against a fake auth on `Bun.serve` that enforces the **amended** contract (per-`sub` bucket, 600/10 min, 429 + `Retry-After`) — it also serves `/system/service-token`, so the real token provider runs too — and counts calls; injected clock. (a) 100 `POST /system/notifications` for 5 recipients with devices inside 30 s → every device sent to 20 times, and auth saw **exactly 5** contact lookups (a build without the memo makes 100 and fails); (b) 40 distinct recipients in one window → all pushed (the old 20-per-address rule would have refused #21); (c) the fake answers 429 → `failed`: no send, devices kept, `[user-contact] … HTTP 429` logged, the notification still 201 |
| AC-2.1 under load — auth side (D-1) | contract (auth, `userContact.routes.test`) | replaces the per-address test: (a) 25 valid calls as `system:notify-api` from one address → all 200/404, none 429; (b) `USERS_CONTACT_RATE_LIMIT + 1`-th valid call (limit set to 3 in the test router) → 429 `rate_limited` + `Retry-After`; (c) a second principal (test key, scope `users.contact`) still answered while the first is limited; (d) 20 invalid credentials from one address → 401 ×20 then 429, and a valid credential from that address is then 429 too (documented cost); (e) 25 valid calls do not consume the failure bucket: 20 invalid ones after them are still 401; (f) a malformed body with no credential is 401, never 400 |
| auth `RateLimiter.peek` (D-1) | unit (auth, `rateLimiter.test`) | `peek` reports `allowed:false` + `retryAfterMs` exactly when `consume` would, and records nothing (20 peeks then 20 consumes all admitted) |
| QE re-measure (D-1) | live (dev stack) | > 20, then > 100 notifications in 10 min for users with devices through the real stack: every one pushed, auth logs no 429 |
| AC-2.2 | integration | notification with `toastWorthy:false` (system route) and `true` (user route) both dispatched |
| AC-2.3 | unit (service worker) | fake `clients.matchAll` with a visible window → `showNotification` not called; hidden only → called; visible window + subscription endpoint on `web.push.apple.com` → called |
| AC-2.4 | integration + unit (SW) | two devices → two sends; SW uses `tag = id` |
| AC-2.4/2.6 send pool — **Amended 2026-11-12 after QE round 0 / security review (S-M2)** | unit (`sendPool.test`, fake sender whose sends resolve only when released) | 3 dispatches × 20 devices → never more than 16 sends in flight; releasing one starts the next in FIFO order; 1 001st queued send overall and 101st for one recipient are dropped with one `backlog full — <n> sends dropped` line and no device id; another recipient's sends are still queued while one recipient is at its bound; `dispatch` resolves and never rejects when sends are dropped; 404/410 still prune through the pool |
| AC-2.5 | integration | notification with `it` variant → decrypted payload has the English text |
| AC-2.6 | integration | fake sender throws / returns 500 → `POST /system/notifications` still 201, row persisted, SSE event published |
| AC-2.7 | integration | fake sender 410 and 404 → device row deleted; 500 → row kept |
| Device cap — **Amended 2026-11-12 after QE round 0 / security review (S-M2)** | integration (notify-api, real Postgres, `devices.repo.test` + `devices.routes.test`) | user with 19 devices, 10 concurrent `upsertByEndpoint` of distinct new endpoints → exactly 1 `created`, 9 `limit`, final count 20; with 0 devices, 25 concurrent `PUT`s → exactly 20 × 201 and 5 × 409 `device_limit`; at 20, `PUT` of an own endpoint → 200 (keys replaced); at 20, `PUT` of another user's endpoint → 409 and that row still belongs to the other user, keys unchanged; two concurrent `PUT`s of the same new endpoint by the same user → one 201, one 200, one row |
| AC-3.1 | component + integration | list renders label, `formatDate(createdAt)`, "this browser" marker by stored device id; `GET` returns caller's rows only, no endpoint/keys in body |
| AC-3.2 | component + integration | Remove → `DELETE` 204, row gone, other devices still dispatched to |
| AC-3.3 | integration | user B `GET` sees none of A's; `DELETE` A's id as B → 404, row intact |
| AC-4.1 | unit (SW) | click with `href` and an existing window → `focus()` + `postMessage({navigate})`; none → `openWindow(href)` |
| AC-4.2 | unit (SW) | click without `href` → target `/notify` |
| AC-4.3 | e2e (shell, Playwright) | signed-out visit to a deep link lands on sign-in and returns to it (existing guard; the SW only opens the URL) |
| AC-5.1 | unit (`session.ts`, `push.ts`) | `signOut()` awaits the before-sign-out step: `DELETE` sent with the JWT before the cache clears; times out at 2 s without blocking sign-out |
| AC-5.2 | integration | `userContact` stub → `inactive`: no send, all the user's devices deleted; `failed`: no send, devices kept |
| AC-5.2 memo — **Amended 2026-11-12 after QE round 0 / security review (D-1; holds only with the proposed AC-5.2 amendment, R8)** | unit (`activityCheck.test`, injected clock) | `found` reused for 29 999 ms, looked up again at 30 000 ms; `inactive` and `failed` never reused (next call looks up); 10 concurrent `isActive` for one user → 1 lookup, all 10 get its answer; a rejected/failed shared lookup is not reused by the next call; integration: user deactivated (fake auth flips to 404) → a notification 30 s later sends nothing and deletes every device; the email-notice path still looks up once per email (memo not used, ADR-0056) |
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
| R5 | A deactivated user's devices keep receiving if the auth lookup is down | Fail closed: no send on `failed` (AC-5.2 holds); the cost is no push during an auth outage. **Amended 2026-11-12 after QE round 0 / security review (D-1):** the plan considered only an auth outage, not a self-inflicted 429 from auth's own limiter; that is D-1, fixed by the per-principal limit and the memo. A 429 is still `failed` (fail closed). |
| R6 | Service-worker build path (classic script, stable name) fights the MF build or Vercel rewrites | Static files win over the SPA rewrite on Vercel; `/push-sw.js` already falls under the `no-store` header rule. Verify in `mise run dev:preview` |
| R7 | VAPID key rotation silently invalidates every subscription | Documented runbook; boot reconciliation re-`PUT`s only rows still valid |
| R8 — **Amended 2026-11-12 after QE round 0 / security review** | The 30 s memo lets a push reach a deactivated user's devices for up to 30 s after deactivation, which spec AC-5.2 as written does not allow | **Spec amendment proposed to the PO** (not made here): AC-5.2 "…when a notification is raised for them 30 seconds or more after the deactivation, then no push notification is sent…". If refused: set the TTL constant to 0 (one line, the memo tests switch to "never reused"), keep single flight and the auth change; R9 is then accepted as is |
| R9 — **Amended 2026-11-12 after QE round 0 / security review** | One user floods `POST /notifications` (self-raise, no rate limit) or a caller loops on one recipient, draining the shared `users.contact` budget or the send queue | Bounded per recipient: ≤ 20 lookups per 10 min (memo) and ≤ 100 queued sends (pool). Draining the 600 budget needs about 30 such recipients at once. The flood is visible in notify-api's `[user-contact] … HTTP 429` and `backlog full` lines |
| R10 — **Amended 2026-11-12 after QE round 0 / security review** | The device-cap lock is silently weakened by a later isolation change (REPEATABLE READ) or by a new code path that adds rows to a user outside `upsertByEndpoint` | Isolation pinned in code with a comment; the concurrency test fails under REPEATABLE READ; the repo header names `upsertByEndpoint` as the only insert path |
| R11 — **Amended 2026-11-12 after QE round 0 / security review** | The auth limiter change ships after notify-api, or auth's 429 in another environment still reads 20/10 min | Deploy auth first (notify-api's memo works with either auth); `PUSH_ENABLED` stays off in production until T12, where the QE re-measure (> 20 notifications in 10 min) runs on the deployed pair |

## Security

**YES.** New user-JWT routes that store per-user data, a server that POSTs to URLs supplied
by clients (SSRF — mitigated by the host allowlist and `https` only), a new secret
(`VAPID_PRIVATE_KEY`), cross-user isolation of devices (404 on another user's id), the
sign-out and user-switch paths, a service worker that opens URLs (only relative `href`,
same origin), and business content leaving the EU encrypted (ADR-0084). Schedule the
owasp-reviewer in parallel with QE.

**Amended 2026-11-12 after QE round 0 / security review:** add to the review surfaces auth `POST /system/users/contact`
(credential verification now runs before the principal limiter; the address bucket counts only
failed credentials — check that an unauthenticated flood is still refused before any key or
database read, and that the 429 does not tell a failed credential from an exhausted principal),
the advisory-lock cap in `devices.repo.ts`, and the send pool's drop path (no device id, user
id or text in its log line).

## ADR candidates

- **ADR-0084** — Web Push with payloads encrypted by notify-api, over FCM (rejected: FCM,
  content-free push with fetch-on-show).
- **ADR-0085** — push suppression decided by the browser's service worker (rejected: SSE
  presence on the server, tab visibility reported to the server).
- **ADR-0086** (Amended 2026-11-12 after QE round 0 / security review, D-1) — `docs/adr/0086-users-contact-limited-per-service-principal.md`,
  **amends ADR-0056**: a rate limit is keyed by the identity it is meant to bound — `users.contact`
  is limited per verified service principal (600/10 min), with the address kept only for
  failed credentials, because on the private network every service is `"direct"`; and the
  push channel reuses a `found` answer for 30 s per user (the ADR-0014 bound), while email
  notices stay a fresh lookup. Rejected: raising the address-keyed limit; a notify-api cache
  alone; a dedicated `users.active` endpoint and scope (trigger to build it: a second
  liveness-only consumer); auth pushing deactivations to notify-api; device-age heuristics.
  Not ADRs (local, reversible): the advisory-lock device cap and the send-pool numbers.
