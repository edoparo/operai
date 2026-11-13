---
spec: 029
status: approved
approved: 2026-11-12
reopened: 2026-11-12
---

# Plan: Push notifications

## Architecture

Push is a **third delivery channel of notify-api**, beside `inApp` (SSE) and `email`
(ADR-0011), using **standard Web Push** (RFC 8030 transport, RFC 8291 payload encryption,
RFC 8292 VAPID) — not Firebase Cloud Messaging. The browser side lives in the **shell**:
a service worker, the subscription logic, and a "Push notifications" section in My profile.
No remote and no caller of `/system/notifications` changes.

**Amended 2026-11-12 after QE round 0 / security review (D-1):** the feature now changes a **second backend, `auth`**.
Without it, push makes auth's limiter bite after about 20 notifications in 10 minutes,
suite-wide, and starves the existing email notices with it.

**Amended 2026-11-12 (re-approved spec, US-7 AC-7.1–7.8, AC-5.2 30 s):** the auth change covers
**both** `/system` endpoints a service calls — `POST /system/service-token` (ADR-0044/0049) and
`POST /system/users/contact` (ADR-0056) — with one rule (§ API contracts, auth):
**the credential is verified first; a valid one is limited only by its own calling service's
allowance (300 tokens / 600 lookups per 10 min, keyed by the verified identity); only an
invalid one is counted per source address (20 per 10 min across both endpoints).** A flood of
bad credentials can therefore never get a valid credential refused, and every refusal is one
indistinguishable 429. The shared mechanism lives in a new `auth/src/system/systemRateLimits.ts`.
Recorded as `docs/adr/0086-system-endpoints-limited-per-verified-service.md` (amends ADR-0044
and ADR-0056); notify-api's 30 s liveness memo as `docs/adr/0087-push-liveness-answer-reused-30-seconds.md`
(§ ADR candidates). Component ids touched: `auth` (system routes), `notify-api` (push channel);
no `groma/` map exists in this repo.

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
| `notify-api/src/push/activityCheck.ts` (new) — **Amended 2026-11-12 after QE round 0 / security review (D-1)** | `createActivityCheck(contacts, { ttlMs: 30_000, now })` → `isActive(userId): Promise<"active" \| "inactive" \| "failed">`. Wraps the ADR-0056 `UserContactClient` for the push channel only: a `found` answer is remembered for 30 s per user (the user id and an expiry, never the address or name); `inactive` and `failed` are never remembered; concurrent checks for the same user share one lookup (single flight). Entries exist only for users auth answered `found` for, so the map is bounded by the number of active users; expired entries are dropped on access. **Amended 2026-11-12 (AC-5.2 re-approved):** the 30 s is counted from the moment the lookup request is **sent**, not from its answer, so a lookup in flight across a deactivation can never stretch the bound past 30 s. The email-notice path keeps calling the client directly, uncached (ADR-0056: every email notice is a fresh lookup). `userContact.ts`'s failure log lines drop the words "email notice not sent" (the client now serves push too) and keep the HTTP status / error class only. |
| `notify-api/src/push/sendPool.ts` (new) — **Amended 2026-11-12 after QE round 0 / security review (S-M2)** | `createSendPool({ concurrency: 16, maxQueued: 1_000, maxQueuedPerRecipient: 100 })` → `run(recipientId, send: () => Promise<void>): Promise<"done" \| "dropped">` (never rejects; `send` errors are the channel's to log, as today). One process-wide pool for Web Push sends: at most **16 sends in flight** across all dispatches; a FIFO wait queue of at most **1 000** sends in total and at most **100** per recipient. A send that would exceed either queue bound is not queued (dropped, best effort, AC-2.6) and the dispatch logs one line `[push] backlog full — <n> sends dropped` (count only). notify-api runs one instance (ADR-0008), so process-wide is suite-wide. |
| `notify-api/src/push/devices.repo.ts`, `devices.routes.ts` — **Amended 2026-11-12 after QE round 0 / security review (S-M2)** | The 20-device cap moves INTO `upsertByEndpoint`'s transaction, behind a per-user advisory lock (§ Data model); the route's separate count-then-upsert is removed and the repo's `{ outcome: "limit" }` maps to the unchanged 409. `countByUser` is no longer used by the route. |
| `auth/src/system/systemRateLimits.ts` (new) — **Amended 2026-11-12 (US-7)** | `createSystemRateLimits({ now? })` → `{ invalidCredentials, serviceToken, usersContact, tooManyRequests(c), logRefusal(kind, key) }`. One **invalid-credential** limiter (`SYSTEM_INVALID_CREDENTIAL_LIMIT`, keyed by `callerAddress()`, `maxKeys` 50 000) **shared by both routes**, and one **per-service** limiter per route (`SERVICE_TOKEN_SERVICE_LIMIT`, `USERS_CONTACT_SERVICE_LIMIT`, keyed by the verified `system:<clientId>`), all on one window `SYSTEM_RATE_WINDOW_MS`. `tooManyRequests` is the ONLY 429 builder of the two routes (§ API contracts, auth). Created once in `src/index.ts` and injected into both router factories (tests inject their own with a fake clock). |
| `auth/src/system/serviceToken.routes.ts`, `auth/src/system/userContact.routes.ts` — **Amended 2026-11-12 (US-7)** | The address-keyed `rateLimit` middleware ahead of everything is removed from both. Each route gets one **credential gate** that verifies first and then consults exactly one limiter (§ API contracts, auth). Both gain a 4 KiB body cap; users/contact a 4 096-char token cap and a cached key set (below). Factories take `deps.limits` (required) and `deps.now` (tests). `callerAddress()` is unchanged. Header comments rewritten (the old "not keyed by clientId" reasoning still holds for the *pre-verification* key, and is quoted in ADR-0086). |
| `auth/src/system/userContact.routes.ts` `jwksFromAuth` — **Amended 2026-11-12 (US-7)** | Today it reads better-auth's key set from the database on **every** call, so each invalid JWT costs a query. Becomes a cached resolver: key set held in memory, re-read when a token's `kid` is not in it, at most once per 30 s (cooldown); every other request does no I/O. better-auth's jwt plugin has no `rotationInterval` configured (`auth.config.ts`), so keys change only by deliberate action, and a new `kid` is picked up within 30 s. |
| `auth/src/lib/rateLimiter.ts` — **Amended 2026-11-12 (US-7)** | Gains an optional `maxKeys` (default: unbounded, so existing limiters are unchanged): when the map holds `maxKeys` keys after pruning, a NEW key is counted under one shared overflow key. Only the invalid-credential limiter sets it. The earlier planned `peek()` is **dropped** (not implemented; the valid-first order needs only `consume`). |
| `auth/src/lib/env.ts`, `auth/.env.example`, `infra/README.md` — **Amended 2026-11-12 (US-7)** | Four new optional variables (§ API contracts, auth → Environment); `SERVICE_TOKEN_RATE_LIMIT`/`SERVICE_TOKEN_RATE_WINDOW_MS` retired: ignored with one startup warning naming them; one startup line logs the four effective values. `.env.example` and the infra variable table / Step-0 runbook lines (`infra/README.md` ~1651, ~1713, ~885) updated. |
| `notify-api/src/lib/env.ts` | New push group (below), validated at startup, process exits on a partial group. |
| `notify-api/prisma/` | New `PushDevice` model + migration. |
| `shell/src/sw/push-sw.ts` (new) | The service worker: `push` → show or suppress; `notificationclick` → focus/open the target. Built as a classic (non-module) script emitted at the stable path `/push-sw.js`, because Firefox does not reliably run module service workers. |
| `shell/vite.config.ts` | A second build entry for the service worker with a fixed, unhashed output name, plus a dev-server middleware serving the same bundle at `/push-sw.js`. |
| `shell/src/lib/push.ts` (new) | Support detection, permission state, enable/disable, boot reconciliation, sign-out release. Talks to notify-api through `apiFetch` (ADR-0001). Stores `{deviceId, userId}` in IndexedDB (not a credential; ADR-0001 is about the JWT). |
| `shell/src/lib/session.ts` | `signOut()` gains an awaited, time-boxed **before-sign-out** step (≤ 2 s) so the device is deleted while the JWT is still valid; existing synchronous `onSignOut` hooks are unchanged. |
| `shell/public/push-icon.png` (new) | 192×192 PNG of the Operai mark: Chrome, Edge and Safari do not reliably render an SVG notification icon (design G5; verified in the R1 spike). |
| `shell/src/components/PushSettings.tsx` (new) + `AccountScreen.tsx` | A second section on My profile: the "this browser" control, its unavailable/blocked states, and the device list with Remove (`ConfirmDialog`). `@operai/ui` has no switch component, and the action is asynchronous and can be refused by the browser, so the control is a status line plus one `Button` ("Turn on" / "Turn off") — no new library component. The section is a SIBLING of `account-address-region`, never inside it: specs/012 AC-6.2's test asserts that region has no interactive element (design G6); the screen's "read-only" module comment is updated. `@operai/ui` components only; copy in `shell/src/strings.ts` (en + it). |
| `tools/env-doctor/manifest.ts` + templates | The new notify-api variables; `VAPID_PRIVATE_KEY` classed as a secret. **Amended 2026-11-12 (US-7):** `FORBIDDEN_VARS` gains `SERVICE_TOKEN_RATE_LIMIT` and `SERVICE_TOKEN_RATE_WINDOW_MS` on `auth` (retired: their meaning — every attempt per address — no longer exists). The four new auth variables are auth-local and optional with safe defaults, so no `REQUIRED_KEYS` entry (like the other auth limiter pairs); no template change. |

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
  If the browser subscription exists but the server's list (read successfully) has no row
  for the stored `deviceId`, the browser **releases** it: `subscription.unsubscribe()`, clear
  the store, show off. It is never re-`PUT` on load; turning push on again is an explicit
  user action (Turn on, no prompt while permission is still granted). A missing row means
  the user removed the device (AC-3.2, possibly from another browser) or notify-api pruned
  it on a 410/404 (AC-2.7) — in either case the device must stay gone. A list that cannot be read changes nothing (unverified). No `DELETE` is sent: there
  is no row. **Amended 2026-11-13 (D-9, T12):** the earlier rule re-`PUT` the subscription
  silently, so a device removed from another browser re-registered itself on this browser's
  next load and received pushes again, violating AC-3.2 on every browser. The re-`PUT` was
  never needed for pruning: a row pruned on a 410/404 belongs to a subscription the push
  service already invalidated, which the `!subscription` branch handles.
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
  1. **auth limits both `/system` endpoints per verified calling service, credential first**
     (re-scoped 2026-11-12 for US-7): 300 service tokens per client id whose secret verified,
     600 contact lookups per verified service JWT `sub`; only requests whose credential does
     not verify are counted per source address (20 per 10 min, both endpoints together), and
     a valid credential never consults that count (AC-7.5, user decision "a valid credential
     always passes"). Each bucket now bounds the one thing it can bound: what the holder of a
     credential does, and what an anonymous source costs. Detail: § API contracts, auth.
  2. **notify-api remembers a `found` answer for 30 s per user** (push only) and shares
     concurrent lookups. This bounds the cost per recipient regardless of who raises the
     notifications: an employee looping `POST /notifications` (self-raise, no rate limit,
     specs/005) to themselves costs at most 20 lookups per 10 minutes, so one person cannot
     drain notify-api's allowance and stop everyone's push and email notices. 30 s is the bound
     the suite already accepts for "deactivated → refused" at the authorization-enforcing
     servers (ADR-0014's resolve cache, ADR-0012 amendment M2), and it is far tighter than
     notify-api's own in-app channel, where a deactivated user's open tab keeps receiving
     notifications over SSE until the 7-day JWT expires (ADR-0012 § 4). Spec AC-5.2 was
     amended to this 30 s bound and re-approved on 2026-11-12 (R8 closed); the 30 s runs from
     when the lookup is sent (§ Components, `activityCheck.ts`).

  *Rejected:*
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

  *Rejected for the auth limiter (added 2026-11-12, US-7):*
  - **A per-address failed-credential guard BEFORE verification** (this plan's own first
    amendment): every private-network caller is `"direct"`, so 20 bad credentials from
    anywhere on the private network (one misconfigured service after a secret rotation is
    enough) refused every service's valid credential for 10 minutes. It contradicts the user
    decision behind AC-7.5.
  - **Keying the pre-verification count by the claimed `clientId`**: the id of a real client
    is guessable, so anyone could lock that service out by spamming its name with wrong
    secrets — the original reason the route keyed by address. Here the client id is a key
    only AFTER its secret verified.
  - **Raising the address-keyed limit** (e.g. to 600, or only that): one bucket for the whole suite is still
    not a per-service bound; any one consumer still starves the others (AC-7.3), and a flood
    of bad credentials still refuses valid ones.
  - **Trusting forwarded headers or socket addresses on the private network to tell services
    apart**: on the private network `X-Forwarded-For` is whatever the caller writes, and a
    Railway private IPv6 changes per deployment and proves nothing; the verified credential is
    the identity auth actually has. (Fixing caller addresses behind the proxy is a spec
    non-goal; `callerAddress()` is unchanged and now keys only the anonymous count.)
  - **A `Retry-After` computed from the refusing bucket's window remainder**: the sender knows
    the timing of its own invalid requests, so a value that does not match its failure count
    reveals that the credential was valid (AC-7.6). A fixed value is used (§ API contracts).
  - **No allowance for valid credentials at all** (only the invalid count): a runaway loop in
    one service would then hammer auth's signer and database without bound; AC-7.4 asks for
    the per-service refusal.
  - **Separate invalid-credential counts per endpoint**: AC-7.5 counts invalid requests "to
    either endpoint", and one shared count is the smaller bound on an anonymous source.
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

### Rollout (Amended 2026-11-12, US-7)

1. **auth first.** Deployable alone: for every legitimate caller it only widens what is
   admitted (20 per address → 300/600 per service), request and answer shapes are unchanged
   (AC-7.8), and no caller of these two endpoints reads `Retry-After` or the 429 `detail` (every
   service's `serviceToken.ts` and notify-api's `userContact.ts` act on the status only; the
   suite's `Retry-After` readers are browser clients of other routes). After it is live: list
   auth's variables for the retired `SERVICE_TOKEN_RATE_*` names (the Step-0 command in
   `infra/README.md`) and delete any found; `mise run env:doctor -- --env production --live`
   then reports no forbidden variable.
2. **notify-api second** (memo from send time, single flight, send pool, atomic device cap).
   It works against the old and the new auth alike; against the old one it is still bound
   by the shared 20 — which is why step 3 waits.
3. **`PUSH_ENABLED` stays off in production** until both are live and T12's capacity
   re-measure (AC-7.7 live row) has passed on the deployed pair. This, not merge order, is the
   real gate: Railway redeploys every service of one push in no fixed order (ADR-0049), and
   neither order is harmful while push is off.
4. env-doctor: no new required key and no template change; `FORBIDDEN_VARS` gains the two
   retired names on `auth` (§ Components). A changeset selects `@operai/auth` (minor: new
   variables, retired ones) and `@operai/notify-api`.

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

### auth `POST /system/service-token` and `POST /system/users/contact` — limits per calling service (Amended 2026-11-12, US-7; supersedes the D-1 draft of the same day)

Request bodies, success answers, the frozen 401 bodies, the credential and scope rules, and
the token's claims and 300 s lifetime are **unchanged** (ADR-0044/0049/0056, AC-7.8). What
changes is the order of checks and what each count is keyed by.

**Definitions.** A request has a **valid credential** when every check the endpoint makes on
the credential passes — for service-token: the body parses, matches the schema and
`authenticateServiceClient` accepts the secret; for users/contact: the Bearer JWT verifies
(RS256, issuer, `aud = SERVICE_AUDIENCE`, required claims) and carries `sub = system:<id>` and
the scope `users.contact`. Everything else is an **invalid credential** (no calling service),
including a malformed service-token body and a genuine service JWT that lacks `users.contact`.

#### `POST /system/service-token`

```
1. body cap 4 KiB (over → invalid credential, answered 400 "body: too large")
2. JSON + schema (unchanged: clientId ≤ 64, clientSecret ≤ 256, strict) — failure → invalid
3. authenticateServiceClient (unchanged: SHA-256 of both sides, timingSafeEqual; an unknown
   client compares against a fixed dummy digest) — accepted → valid, else invalid
   valid   → serviceToken.consume("system:<clientId>")
               admitted → mint (unchanged) → 200 {token, expiresInSeconds: 300}
               refused  → 429 (below); nothing minted, attempt not recorded
   invalid → invalidCredentials.consume(callerAddress(X-Forwarded-For))
               admitted → today's answer: 400 (malformed) or the frozen 401
               refused  → 429 (below); attempt not recorded
```

#### `POST /system/users/contact`

```
1. token = "Bearer …"; absent, or > 4 096 chars → invalid
2. jwtVerify against the CACHED key set + sub/scope checks (unchanged rules) — pass → valid
   valid   → usersContact.consume(sub)
               admitted → body cap 4 KiB, schema (400, unchanged) → lookup → 200 / 404 (unchanged)
               refused  → 429; body not read, no database lookup
   invalid → invalidCredentials.consume(callerAddress(X-Forwarded-For))
               admitted → the frozen 401 (unchanged)
               refused  → 429; no database lookup
```

The 4 KiB cap is far above any legitimate body (two strings capped at 64 and 256 chars, sent
compact by every client); a larger body is still a 400 Problem as today, only its `detail`
reads "body: too large" instead of the schema's field message — the one place an invalid
request's answer text changes, and only for bodies no client sends.

`invalidCredentials` is **one** limiter shared by both routes (AC-7.5 "to either endpoint"):
10 invalid service-token requests and 10 invalid lookups from one address make the 21st
invalid request to either a 429. `serviceToken` and `usersContact` are separate per-route
limiters. A valid credential **never** reads or writes `invalidCredentials`; an invalid one
never reads or writes a per-service limiter. A refused attempt is never recorded (existing
`consume` semantics), so retries during a refusal do not extend it (AC-7.4, AC-7.5).

#### The one 429 (both kinds, both routes)

```json
429 { "type": "https://httpstatuses.com/429", "title": "Too Many Requests", "status": 429,
      "detail": "Too many requests. Try again later.", "instance": "<request path>",
      "code": "rate_limited" }
headers: Retry-After: <ceil(SYSTEM_RATE_WINDOW_MS / 1000)>   (600 by default)
         Cache-Control: no-store
```

- Built only by `systemRateLimits.tooManyRequests(c)`. Body and headers are a function of
  the request path and the configuration, never of which limiter refused or of any bucket's
  state (AC-7.6). `instance` is the fixed route path, as in every other answer of these routes.
- **`Retry-After` is fixed at the window length.** It is truthful for a caller that stops sending:
  every attempt counted at the moment of refusal ages out of the sliding window within one
  window, so a retry after that many seconds is admitted unless the same key was admitted
  again in between. It is pessimistic (the real remainder is usually shorter), at
  no cost — no Operai caller reads it. Because all three limiters share `SYSTEM_RATE_WINDOW_MS`,
  the value cannot differ by limiter even when reconfigured.
- service-token's 429 `detail` changes from "Too many token requests…" to the shared text;
  only a caller already over a limit sees it, and no client parses it.
- Timing: on service-token both kinds of 429 run the same parse, the same hash + constant-time
  compare and one `Map` lookup, and neither mints; on users/contact a JWT that verifies costs
  more than one that does not, but a validly signed token can only be obtained from auth with
  a valid secret, so its holder learns nothing new.

#### What the work for an invalid credential is bounded by

The count cannot reduce the work of verification — a valid credential must be recognised
even from a flooded source, so every request is verified before any count is consulted (user
decision; spec Non-goals: guesses are not capped). The bound comes from making verification
cheap and I/O-free:

| Route | Work for one invalid request | Bounded by |
|---|---|---|
| service-token | read ≤ 4 KiB, one JSON parse, schema, 2 × SHA-256 over ≤ 256 chars, one `timingSafeEqual`, one `Map` update | body cap, schema lengths; no database, no signer |
| users/contact | ≤ 4 096-char token: base64url/JSON decode of header and payload, ≤ 1 RS256 verify (tens of µs), one `Map` update; body never read | token cap; cached key set (a re-read only for an unknown `kid`, ≤ 1 per 30 s whatever the flood); no database |

What the count adds: the 429 signal of AC-7.5, and bounded logging — below the limit each
invalid request logs as today (`[system/service-token] rejected credentials`, `[system-jwt]
verification failed: <code>`); from the limit on, those per-request lines stop and one line
`[system/<route>] invalid-credential limit reached` (no address) is logged per address key per
window. A refused valid caller logs `[system/<route>] allowance exhausted caller=<sub>` once
per window. Memory: per-service maps hold one key per configured service client;
`invalidCredentials` is capped at 50 000 keys (`maxKeys`), after which new addresses share one
overflow key (R13). Nothing is minted and no user is looked up for any 429 or 401.

#### Environment (auth) — Amended 2026-11-12, US-7

| Variable | Rule |
|---|---|
| `SERVICE_TOKEN_SERVICE_LIMIT` | optional positive integer, default **300** — service tokens per calling service per window (AC-7.1) |
| `USERS_CONTACT_SERVICE_LIMIT` | optional positive integer, default **600** — contact lookups per calling service per window (AC-7.2) |
| `SYSTEM_INVALID_CREDENTIAL_LIMIT` | optional positive integer, default **20** — invalid-credential requests per source address per window, both routes together (AC-7.5) |
| `SYSTEM_RATE_WINDOW_MS` | optional integer ≥ 1 000, default **600000** — the one window of all three limiters and the source of `Retry-After` |
| `SERVICE_TOKEN_RATE_LIMIT`, `SERVICE_TOKEN_RATE_WINDOW_MS` | **retired**: ignored, one startup warning names them; env-doctor flags them on `auth` (`FORBIDDEN_VARS`). Not reused under a new meaning, because a production override sized for the old per-address rule (20, or the runbook's 60) would silently cap a service below AC-7.1. Not a startup refusal either: an unknown or retired variable stopping auth is the deploy-order hazard ADR-0076 records. |

auth logs the four effective values once at startup. All auth-local and optional, so no
env-doctor `REQUIRED_KEYS` entry. Listed in `auth/.env.example` and `infra/README.md`.

**Sizing.** Service tokens: 8 service clients each mint about once per 4 minutes plus a
re-mint after a 401 or a restart — about 3 per service and 17–20 suite-wide per 10 minutes at
steady state; 300 per service is two orders of magnitude above that and 3× the spec's busiest
suite-wide figure. Contact lookups: only `system:notify-api` holds `users.contact`; it makes one
per email notice (uncached, ADR-0056) and at most one per push recipient per 30 s (memo), so
AC-7.7's > 100 notifications in 10 minutes cost ≤ ~200 lookups of 600. auth runs one instance
(rateLimiter.ts); a second instance would double every allowance (R17).

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
| AC-1.6 (amended 2026-11-12: by capability) | unit (shell) + component | `isPushSupported()` table: Chrome/Edge/Firefox/Safari desktop true; a capable desktop UA not in the supported set (Opera, Vivaldi, Brave, Dia) true — offered by capability, no delivery claim; Android Chrome, iPhone Safari, tablet UA, missing `serviceWorker`/`PushManager`/`Notification` false; component shows "not available", no Turn on, device list + Remove still rendered |
| AC-1.7 (amended 2026-11-12: consistent with AC-5.1) | unit (shell `push.ts`) + e2e (T10) | reload, and a session that ended without sign-out followed by the same user signing in: existing subscription + matching stored user + id in server list → on, no prompt; server row missing (list read successfully) → the browser subscription is released (`unsubscribe`, store cleared), off, no `PUT`, no prompt (amended 2026-11-13, D-9, T12; was a silent re-`PUT`); a device removed from another browser stays removed after this browser reloads (AC-3.2 regression row); after an explicit sign-out (AC-5.1 released the device) and signing in again → off, and Turn on with permission still `granted` subscribes without calling a prompt (`requestPermission` resolves `granted` at once; spy asserts no UI) |
| AC-1.8 | component | `GET /push/config` rejects → warning `Banner` with retry in the push section; address section still rendered; retry refetches |
| AC-2.1 | integration (notify-api) + manual | `POST /system/notifications` → fake sender called once per device with a payload that **decrypts** (test holds the subscriber private key) to the English title/body. Manual go-live check on real Chrome, Edge, Firefox, Safari with Operai closed |
| AC-2.1 under load — **Amended 2026-11-12 after QE round 0 / security review (D-1)** | integration (notify-api, REAL client) | `push.capacity.test`: the REAL `createUserContactClient` (no stub) against a fake auth on `Bun.serve` that enforces the **US-7** contract (600 lookups per `sub`, 300 tokens per client, 20 invalid per address, the shared 429 + fixed `Retry-After`) — it also serves `/system/service-token`, so the real token provider runs too — and counts calls; injected clock. Every request reaches it without `X-Forwarded-For`, as on Railway's private network. (a) 100 `POST /system/notifications` for 5 recipients with devices inside 30 s → every device sent to 20 times, and auth saw **exactly 5** contact lookups (a build without the memo makes 100 and fails); (b) 40 distinct recipients in one window → all pushed (the old 20-per-address rule would have refused #21); (c) the fake answers 429 → `failed`: no send, devices kept, `[user-contact] … HTTP 429` logged, the notification still 201 |
| AC-2.1 under load — auth side | contract (auth) | covered by the AC-7.x rows below (the D-1-draft rows — address guard before verification, `peek` — are withdrawn with that design) |
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
| AC-5.2 (amended, re-approved 2026-11-12: 30 s) memo | unit (`activityCheck.test`, injected clock) | the expiry is measured from when the lookup was **sent**: a lookup sent at t, answered at t + 2 s, is reused until t + 29 999 ms and looked up again at t + 30 000 ms; `found` reused for 29 999 ms, looked up again at 30 000 ms; `inactive` and `failed` never reused (next call looks up); 10 concurrent `isActive` for one user → 1 lookup, all 10 get its answer; a rejected/failed shared lookup is not reused by the next call; integration: user deactivated at d (fake auth flips to 404) → a notification at d + 30 s sends nothing and deletes every device, also when a `found` lookup was in flight across d; a notification at d + 10 s after a `found` at d − 5 s may still push (allowed by AC-5.2); the email-notice path still looks up once per email (memo not used, ADR-0056) |
| AC-5.3 | unit (`push.ts`) + integration | stored `userId` ≠ current → `unsubscribe()` at boot; notify-api `PUT` of an existing endpoint by another user moves the row |
| AC-6.1 | unit (env) + integration + component | env: off by default, partial group exits; `PUT` → 503; dispatch never calls sender; `GET /push/config` `enabled:false` → section absent |
| AC-6.2 | integration | decrypted payload keys are exactly `v,id,title,body,originApp[,href]` |
| AC-6.3 | integration | the bytes handed to the HTTP layer are an RFC 8291 `aes128gcm` record (header + ciphertext); the plaintext title does not occur in them; decryption with the subscriber key succeeds |
| AC-6.4 | integration | `PUSH_EXCLUDED_ORIGINS=meetings` → a meetings notification is not sent, a crm one is |
| AC-6.5 | review gate | ADR-0084 carries owner + date of the go-live decision; checked by QE before `PUSH_ENABLED=true` in production |
| AC-7.1 | contract (auth, `serviceToken.routes.test`, injected clock, default limits, no `X-Forwarded-For`) | one client mints 300 times inside one window → 300 × 200, each token verifies against the test key with `sub = system:<id>`, signer called 300 times, no 429 |
| AC-7.2 | contract (auth, `userContact.routes.test`, real DB fixtures) | 600 lookups of active users as `system:notify-api` inside one window, no `X-Forwarded-For` → 600 × 200 with `{id,email,name}` |
| AC-7.3 | contract (both route tests) | client A exhausts 300 tokens → client B's next mint is 200 and its token is byte-for-byte the shape of a fresh one; principal A exhausts 600 lookups → principal B (a second test client holding `users.contact`) gets 200 / 404 exactly as before; both from the same address |
| AC-7.4 | contract (both route tests) | 301st mint / 601st lookup → the shared 429, `Retry-After: 600`, signer spy and `db.user.findFirst` spy **not called**; 10 retries during the refusal are 429 and do not move recovery: at (first attempt + window) the next request is 200; for users/contact a malformed body over the allowance is 429, not 400 (body not read) |
| AC-7.5 | contract (both route tests + a shared-limiter test wiring both routers to one `createSystemRateLimits`) | from address X: 20 invalid (service-token: unknown client, wrong secret, malformed body; users/contact: bad signature, expired, wrong `aud`, user JWT, genuine service JWT without `users.contact`, no header) → each answered exactly as today (400 / frozen 401), 21st invalid → 429; **at the same instant** a valid credential from X → 200 (token minted / contact returned); the same with X = `"direct"` (no header); 50 valid requests interleaved do not count (19 invalid after them still 401); 10 invalid on each route → the next invalid on either is 429; refused invalid requests do not extend the period (window passes from the first → 401 again); signer and DB spies not called for any 401/429 |
| AC-7.6 | contract (both route tests) | (a) the 429 for an invalid flood and the 429 for an exhausted service on the same route are identical in status, body bytes and header set (excluding `Date`), even when the two buckets started 5 min apart; (b) with client A's allowance exhausted and X below 20, a wrong secret for A → the frozen 401 (allowance state never decides an invalid answer); (c) unknown client vs wrong secret vs near-miss secret (one char off) → identical 401 bodies, and identical 429s past 20; (d) `authenticateServiceClient` runs exactly once per request on the valid, invalid, 401 and both 429 paths (spy) — the compare is never skipped |
| AC-7.7 | contract (auth, new `src/system/systemCapacity.contract.test.ts`, production defaults, real routers, no `X-Forwarded-For` anywhere) | the D-1 traffic shape inside one window: the 8 configured service clients each mint 30 tokens (≈ 10× steady, interleaved), `system:notify-api` makes 220 lookups (110 email notices + 110 push activity checks), plus 15 invalid requests from `"direct"` → **zero 429**, every lookup 200/404, every mint 200. Run against the pre-US-7 routers this test fails at the 21st request — it is the test that would have caught D-1 |
| AC-7.7 | integration (notify-api, `push.capacity.test`, REAL token provider + REAL `createUserContactClient` + REAL activity check) | 120 `POST /system/notifications` for 120 distinct recipients in one window, 60 with `email: true`, 80 with devices, against the fake auth of the AC-2.1-under-load row → every email notice attempted (`emailStatus` ≠ `skipped` for a configured channel), every activity check returns `active`/`inactive` (never `failed`), auth saw ≤ 140 lookups and no 429 |
| AC-7.7 | live (dev stack, real auth + real notify-api + the other services running; part of T12's QE re-measure) | > 100 notifications for distinct seeded recipients in 10 min (email notices + users with devices) while every service keeps its token refresh: auth logs no `allowance exhausted` and no `invalid-credential limit reached` line, notify-api logs no `[user-contact] … HTTP 429` and no `[service-token] … 429`; then on the deployed pair before `PUSH_ENABLED=true` |
| AC-7.8 | contract + regression | the existing `serviceToken.routes.test`, `src/auth/service-token.contract.test.ts`, `userContact.routes.test` and `user-contact.contract.test.ts` success/401/400/404 assertions pass **unchanged** (request shapes, response bodies, `Cache-Control`, claims, `exp − iat = 300`); `mise run shared:check` shows no change to any shared-copy `serviceToken.ts`; only their per-address limiter tests are replaced by the AC-7.x rows |
| US-7 support | unit (auth, `rateLimiter.test`, `env.startup.test`, `userContact.routes.test`) | `maxKeys`: at the cap a new key shares the overflow key, existing keys keep their own counts, pruning frees capacity, unset = unbounded (existing limiters unchanged); env: the four defaults (300/600/20/600000), non-positive or window < 1000 → exit 1, retired `SERVICE_TOKEN_RATE_*` set → warning naming them, values ignored; cached key set: 100 verifications → 1 key-set read, an unknown `kid` → 1 re-read, a flood of unknown `kid`s → ≤ 1 re-read per 30 s; a token > 4 096 chars is 401 without a key-set read; env-doctor `FORBIDDEN_VARS` test flags the retired names on `auth` |

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
| R5 | A deactivated user's devices keep receiving if the auth lookup is down | Fail closed: no send on `failed` (AC-5.2 holds); the cost is no push during an auth outage. **Amended 2026-11-12 after QE round 0 / security review (D-1):** the plan considered only an auth outage, not a self-inflicted 429 from auth's own limiter; that is D-1, fixed by the per-service limits (US-7) and the memo. A 429 is still `failed` (fail closed). |
| R6 | Service-worker build path (classic script, stable name) fights the MF build or Vercel rewrites | Static files win over the SPA rewrite on Vercel; `/push-sw.js` already falls under the `no-store` header rule. Verify in `mise run dev:preview` |
| R7 | VAPID key rotation silently invalidates every subscription | Documented runbook; boot reconciliation never re-registers a subscription (amended 2026-11-13, D-9, T12: it used to re-`PUT` a subscription with no server row) |
| R8 — **Closed 2026-11-12** | The 30 s memo lets a push reach a deactivated user's devices for up to 30 s after deactivation | Spec AC-5.2 amended to exactly this bound and re-approved (2026-11-12). Residual edge closed in the design: the 30 s runs from when the lookup is sent, so a lookup in flight across the deactivation cannot extend it (test row AC-5.2 memo) |
| R9 — **Amended 2026-11-12 after QE round 0 / security review** | One user floods `POST /notifications` (self-raise, no rate limit) or a caller loops on one recipient, draining the shared `users.contact` budget or the send queue | Bounded per recipient: ≤ 20 lookups per 10 min (memo) and ≤ 100 queued sends (pool). Draining notify-api's 600 needs about 30 such recipients at once — and since US-7 it drains **only notify-api's own** allowance: other services' token mints are unaffected (AC-7.3). The flood is visible in notify-api's `[user-contact] … HTTP 429` and `backlog full` lines and in auth's `allowance exhausted caller=system:notify-api` |
| R10 — **Amended 2026-11-12 after QE round 0 / security review** | The device-cap lock is silently weakened by a later isolation change (REPEATABLE READ) or by a new code path that adds rows to a user outside `upsertByEndpoint` | Isolation pinned in code with a comment; the concurrency test fails under REPEATABLE READ; the repo header names `upsertByEndpoint` as the only insert path |
| R11 — **Amended 2026-11-12 (US-7)** | The auth change ships after notify-api, or an environment still runs the old per-address rule (or a leftover `SERVICE_TOKEN_RATE_*` override) | § Architecture → Rollout: auth first; notify-api works with either; `PUSH_ENABLED` stays off in production until the AC-7.7 live re-measure passes on the deployed pair (T12); env-doctor flags the retired names; auth logs its effective limits at startup |
| R12 — **US-7** | An invalid-credential flood still costs one verification per request: the 20-count cannot skip it, because a valid credential must pass even from a flooded source (user decision; guesses are not capped, spec Non-goals) | Verification made cheap and I/O-free (§ API contracts → work bound table): 4 KiB body cap, 4 096-char token cap, cached key set, no database, no signer; per-request log lines stop at the limit. Residual CPU flood is a platform concern, as for any public route; owasp-reviewer to confirm |
| R13 — **US-7** | `callerAddress()` trusts the rightmost `X-Forwarded-For`: from the internet that is the proxy's view (unforgeable), but a caller on the private network writes it itself and can spread invalid requests over many keys | Doing so gains nothing in work (R12: the cost per request is the same whether answered 401 or 429) and cannot affect a valid credential; memory is capped by `maxKeys` 50 000 (~ 10 MB). Past the cap new addresses share an overflow key and may see the 429 before their own 20th invalid request — a deviation from AC-7.5's per-source count that exists only during a > 50 000-address flood and never touches a valid credential (reported to the PO, not an amendment) |
| R14 — **US-7** | A legitimate burst exceeds a service's own allowance (e.g. notify-api above 600 lookups: a mass handover with email notices to hundreds of users) | 600 ≈ 3× AC-7.7's shape; best effort by spec (Non-goals): email notice `failed`, push `failed` (fail closed); both visible in logs. Raise `USERS_CONTACT_SERVICE_LIMIT` per environment without a code change |
| R15 — **US-7** | A stolen service secret now mints up to 300 tokens per 10 min instead of 20 | A stolen secret is already a full compromise of that service's scopes for as long as it is valid (5-min tokens, re-mintable); the address limit never stopped it either (one address, 20 per 10 min = a token every 30 s, far more than needed). Mitigation stays rotation of the secret (infra runbook) |
| R16 — **US-7** | The cached key set misses a new signing key | better-auth has no `rotationInterval` configured; a `kid` not in the cache triggers a re-read (≤ 1 per 30 s), so a deliberately added key is picked up at the first token that uses it; a valid token refused during that ≤ 30 s window is answered 401 and counted as invalid once; notify-api's client retries once with a fresh token (`userContact.ts`), and if that also falls in the window the one email notice or push is `failed` (best effort) |
| R17 — **US-7** | Limits are per process: a second auth instance would double every allowance and the invalid count | auth runs one instance today (rateLimiter.ts header, ADR-0035's named limitation); the `RateLimiter` interface is the seam for a shared store |

## Security

**YES.** New user-JWT routes that store per-user data, a server that POSTs to URLs supplied
by clients (SSRF — mitigated by the host allowlist and `https` only), a new secret
(`VAPID_PRIVATE_KEY`), cross-user isolation of devices (404 on another user's id), the
sign-out and user-switch paths, a service worker that opens URLs (only relative `href`,
same origin), and business content leaving the EU encrypted (ADR-0084). Schedule the
owasp-reviewer in parallel with QE.

**Amended 2026-11-12 after QE round 0 / security review, re-scoped for US-7:** add to the review surfaces
both auth `/system` endpoints — `POST /system/service-token` and `POST /system/users/contact` — and
`auth/src/system/systemRateLimits.ts`. These are the suite's credential-issuing and
personal-data-releasing service endpoints (a token for any scope; a user's email and name), so
the review should check, adversarially:
- every request is verified before any count is consulted, and a valid credential never
  reads or writes the invalid-credential count (AC-7.5) — including from `"direct"` and from
  an address already at 20;
- nothing is minted, no key set is re-read beyond the 30 s cooldown and no user is looked up
  for any 401 or 429 (signer/DB spies in the AC-7.4/7.5 rows);
- the two 429s are byte-identical including headers, `Retry-After` is the fixed window, and an
  invalid credential's answer depends only on its source's invalid count — not on client
  existence, secret closeness or any allowance (AC-7.6); the hash + constant-time compare runs
  on every path;
- the work per invalid request is bounded as tabled (body and token caps, cached key set, no
  database), the overflow key bounds memory, and no log line carries an address, client id
  claimed by an unverified request, secret or token;
- the 401/400 bodies and the token claims are unchanged (AC-7.8).
Also: the advisory-lock cap in `devices.repo.ts`, and the send pool's drop path (no device id,
user id or text in its log line). Tier: standard — no regulated data beyond what ADR-0056
already releases to one scope holder.

## ADR candidates

- **ADR-0084** — Web Push with payloads encrypted by notify-api, over FCM (rejected: FCM,
  content-free push with fetch-on-show).
- **ADR-0085** — push suppression decided by the browser's service worker (rejected: SSE
  presence on the server, tab visibility reported to the server).
- **ADR-0086** — `docs/adr/0086-system-endpoints-limited-per-verified-service.md` (re-scoped
  2026-11-12 for US-7; **amends ADR-0044** — the service-token limiter keyed by address — **and
  ADR-0056** — users/contact reusing that limiter). Decision: *a rate limit is keyed by the
  identity it is meant to bound, and a credential is verified before any count is consulted*.
  Both `/system/service-token` (300 per client id whose secret verified) and
  `/system/users/contact` (600 per verified service JWT `sub`) limit per calling service; only
  requests whose credential does not verify are counted per source address (20 per 10 min,
  shared by both); a valid credential always passes that count; every refusal is one 429 with
  a fixed `Retry-After`, so a refusal never tells a sender whether its credential was valid.
  Rejected: (1) a per-address guard before verification — on the private network every service
  is `"direct"`, so any 20 bad credentials refuse every valid one; (2) raising the address
  limit — still one bucket for the whole suite, one consumer still starves the others, a flood
  still refuses valid credentials; (3) trusting forwarded headers or socket addresses on the
  private network to tell services apart — caller-written, deployment-dependent, not an
  identity; (4) keying the pre-verification count by the claimed client id — lets anyone lock
  a service out by its guessable name (ADR-0044's original reason); (5) `Retry-After` from the
  refusing bucket's remainder — an oracle on validity; (6) no allowance for valid credentials —
  a runaway service hammers the signer and database. Consequence named in the ADR: the count
  cannot reduce verification work, so verification is kept cheap and I/O-free (caps, cached key
  set). Revisit: a second auth instance (shared store), a third `/system` endpoint on auth
  (inherits the rule by default), or a credential type whose verification needs I/O.
- **ADR-0087** — `docs/adr/0087-push-liveness-answer-reused-30-seconds.md` (split out of the
  first ADR-0086 draft so each entry is one decision; fold back if the caller prefers one
  record). **Amends ADR-0056** for the push consumer only: notify-api's push channel reuses a
  `found` contact answer for 30 s per user, counted from when the lookup was sent, with single
  flight; `inactive`/`failed` are never reused; email notices stay a fresh lookup. The 30 s is
  ADR-0014's bound, accepted in spec AC-5.2 (re-approved 2026-11-12). Rejected: a memo in
  notify-api alone with auth unchanged (each recipient still costs ≥ 1 lookup per window); a
  long TTL (hours of "still active" after deactivation); a dedicated `users.active` endpoint
  and scope (trigger to build it: a second liveness-only consumer); auth pushing deactivations
  to notify-api (lost message = indefinite pushes, or a delete that depends on notify-api,
  which ADR-0012 refused); device-age heuristics.
  Not ADRs (local, reversible): the advisory-lock device cap and the send-pool numbers.
