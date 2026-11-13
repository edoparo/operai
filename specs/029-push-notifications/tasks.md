---
spec: 029
generated: 2026-11-11
synced: 2026-11-12
---

# Tasks: Push notifications

Contracts: `plan.md` (approved) is binding; screens, states, copy and a11y: `design.md`.

Re-sync 2026-11-12 (QE round 0 FAIL + security review FAIL; spec re-approved with US-7 and amended AC-5.2/1.6/1.7; plan re-approved): T1–T11 kept as done; T14–T22 added (fix round 1 + US-7); T12 now also depends on them and carries the AC-7.7 live re-measure. Fix round 1 of 2.

- [x] T1: Spike — prove Web Push from Bun on real browsers and settle R1/R2/R3/G5 — refs: AC-2.1, AC-2.3, AC-6.3 — deps: none
  - touch: `notify-api/package.json`, `notify-api/bun.lock`, `specs/029-push-notifications/plan.md`, `shell/public/push-icon.png`
  - work: add `web-push`; from a throwaway Bun script (not committed) send an encrypted payload to a real subscription on Chrome, Edge, Firefox and Safari (macOS); on Safari, receive pushes with a visible tab and NOT show them, three times, and observe whether permission is revoked; record Edge's endpoint host; check a PNG icon renders; add the 192×192 `push-icon.png`.
  - done when: plan.md § Risks carries a dated "Spike result" line per R1/R2/R3/G5 (works / fallback taken); if R2 forces "always show on Safari" or R1 forces the WebCrypto fallback, the spec/plan amendment is written before T6/T7 start (drift rule). Needs a person with the four browsers.

- [x] T2: notify-api push env group + env-doctor contract — refs: AC-6.1, AC-6.4 — deps: none
  - touch: `notify-api/src/lib/env.ts`, `notify-api/src/lib/env.test.ts`, `notify-api/.env.example`, `tools/env-doctor/manifest.ts`, `tools/env-doctor/templates/**`, `tools/env-doctor/*.test.ts`
  - done when: env tests pass for: off by default; `"false"`/unset off; enabled without VAPID keys, subject, or the email-notice group → exit 1 naming the missing vars; private key not deriving the public key → exit 1; `PUSH_EXCLUDED_ORIGINS` with an unknown origin → exit 1; `mise run env:doctor` green with `VAPID_PRIVATE_KEY` classed secret.

- [x] T3: `PushDevice` model, migration and repository — refs: AC-1.2, AC-1.5, AC-2.7, AC-3.1, AC-3.2, AC-3.3, AC-5.2, AC-5.3 — deps: none
  - touch: `notify-api/prisma/schema.prisma`, `notify-api/prisma/migrations/*`, `notify-api/src/lib/generated/**`, `notify-api/src/push/devices.repo.ts`, `notify-api/src/push/devices.repo.test.ts`
  - done when: `bun run db:migrate` applies cleanly on a fresh DB; repo tests pass for upsert-by-endpoint (new → created, existing other owner → moved, keys replaced), list by user newest-first, delete by id+user (other user → not found), delete all for user, delete by id, count per user.

- [x] T4: Endpoint allowlist and device label — refs: AC-3.1, AC-6.3 — deps: T1
  - touch: `notify-api/src/push/pushEndpoint.ts`, `notify-api/src/push/pushEndpoint.test.ts`, `notify-api/src/push/deviceLabel.ts`, `notify-api/src/push/deviceLabel.test.ts`
  - done when: allowlist table passes — allowed: `fcm.googleapis.com`, `*.push.services.mozilla.com`, `web.push.apple.com`, the Edge host(s) recorded in T1; refused: `http:`, IP literals, `fcm.googleapis.com.evil.io`, userinfo (`https://fcm.googleapis.com@evil.io`), ports, > 2000 chars; label table maps Chrome/Edge/Firefox/Safari × macOS/Windows/Linux UA strings to "Browser · OS", unknown → "Unknown browser".

- [x] T5: Device routes — `GET /push/config`, `PUT|GET /push/devices`, `DELETE /push/devices/{id}` — refs: AC-1.2, AC-1.5, AC-3.1, AC-3.2, AC-3.3, AC-5.3, AC-6.1 — deps: T2, T3, T4
  - touch: `notify-api/src/push/devices.routes.ts`, `notify-api/src/push/devices.schemas.ts`, `notify-api/src/push/devices.routes.test.ts`, `notify-api/src/index.ts`, `notify-api/src/openapi/registry.ts`
  - done when: route tests pass for every status in plan § API contracts (200/201/400/401/404/409/422/503), exact-path middleware only (a service JWT is refused, a user JWT on `/system/*` still refused), responses never contain `endpoint`/`p256dh`/`auth`, user B cannot see or delete A's device (404, row intact); OpenAPI lists the four routes.

- [x] T6: Push channel — dispatch from `inAppChannel.send`, encrypt, send, prune — refs: AC-2.1, AC-2.2, AC-2.4, AC-2.5, AC-2.6, AC-2.7, AC-5.2, AC-6.2, AC-6.3, AC-6.4 — deps: T1, T2, T3
  - touch: `notify-api/src/channels/push.channel.ts`, `notify-api/src/channels/push.channel.test.ts`, `notify-api/src/push/webPushSender.ts`, `notify-api/src/push/webPushSender.test.ts`, `notify-api/src/channels/inApp.channel.ts`, `notify-api/src/system/notifications.routes.test.ts`, `notify-api/src/notifications/raise.routes.test.ts`
  - done when: integration tests with an injected fake HTTP layer pass for every push row of plan § Test strategy (AC-2.1/2.2/2.4/2.5/2.6/2.7/5.2/6.1/6.2/6.3/6.4), including decrypting the captured `aes128gcm` body with the test subscriber's private key and asserting the plaintext title is absent from the wire bytes; `POST /system/notifications` latency unchanged by a 10 s sender stall (dispatch not awaited); logs contain no endpoint, key or notification text (asserted).

- [x] T7: Shell service worker, its build entry and dev serving — refs: AC-2.3, AC-2.4, AC-4.1, AC-4.2 — deps: T1
  - touch: `shell/src/sw/*`, `shell/vite.config.ts`, `shell/tsconfig*.json`
  - done when: unit tests with a fake `ServiceWorkerGlobalScope` pass (visible window → no `showNotification`, except when the subscription endpoint is on `web.push.apple.com` → shown (Safari, AC-2.3 amended); hidden only → shown with `tag = id`, `lang: 'en'`, icon `/push-icon.png`, `data: {href}`; click with/without `href` and with/without an existing window → focus + `postMessage({navigate})` / `openWindow`; malformed payload → nothing shown, no throw); `pnpm build` emits `dist/push-sw.js` as a classic script with no hash and no `import`; `pnpm dev` serves `/push-sw.js`.

- [x] T8: Shell push library, sign-out release and boot reconciliation — refs: AC-1.6, AC-1.7, AC-5.1, AC-5.3 — deps: T7
  - touch: `shell/src/lib/push.ts`, `shell/src/lib/push.test.ts`, `shell/src/lib/session.ts`, `shell/src/lib/session.test.ts`, `shell/src/components/ShellLayout.tsx`, `shell/src/components/ShellLayout.test.tsx`
  - done when: unit tests pass for `isPushSupported()` table; enable/disable against a fake `PushManager` and `apiFetch`; reconcile cases (on; server row missing → release the browser subscription (`unsubscribe`, clear store), off, no `PUT`, no prompt — amended 2026-11-13, D-9, T12, was a silent re-`PUT`; stored user ≠ current → `unsubscribe`; permission revoked → `DELETE` + `unsubscribe`, 404 = success; any failure after subscribe → `unsubscribe`); `signOut()` sends the `DELETE` with the JWT before caches clear and never waits more than 2 s; the existing synchronous `onSignOut` tests still pass; `ShellLayout` handles the service worker's `{navigate}` message via `navigateSuite`.

- [x] T9: My profile push section (`PushSettings`) + copy — refs: AC-1.1, AC-1.2, AC-1.3, AC-1.4, AC-1.5, AC-1.6, AC-1.8, AC-3.1, AC-3.2, AC-3.3, AC-6.1 — deps: T8
  - touch: `shell/src/components/PushSettings.tsx`, `shell/src/components/PushSettings.test.tsx`, `shell/src/components/AccountScreen.tsx`, `shell/src/components/AccountScreen.test.tsx`, `shell/src/strings.ts`, `operai-ui/src/components/Banner*` (only if `Banner` does not forward `tabIndex`; then with a story and a test)
  - done when: component tests cover every state in design.md § Screens & states and every component row of plan § Test strategy for AC-1.x/3.x/6.1; focus and live-region rules of design.md § Accessibility asserted (focus after Remove, after blocked, busy label); the section sits outside `account-address-region` and specs/012 AC-6.2's test still passes; strings parity (`catalogGaps`) and the no-hardcoded-strings scan pass; `pnpm lint` and `pnpm build` green; `mise run ui:check` green if `operai-ui` was touched.

- [x] T10: E2E — My profile push flow and signed-out deep link — refs: AC-1.1, AC-1.2, AC-1.5, AC-3.2, AC-4.3 — deps: T5, T9
  - touch: `shell/e2e/push-notifications.spec.ts`, `shell/e2e/helpers/pushFixtures.ts`
  - done when: `cd shell && pnpm e2e push-notifications.spec.ts` passes against `mise run dev` with `PUSH_ENABLED=true` and test VAPID keys: fake `PushManager` via init script; turn on → device row visible; reload → still on; remove → gone; signed-out visit to `/notify` lands on sign-in and returns to `/notify`.

- [x] T11: Runbook, AGENTS.md and changesets — refs: AC-6.1, AC-6.5 — deps: T6, T9
  - touch: `infra/README.md`, `AGENTS.md`, `.changeset/*`
  - done when: `infra/README.md` documents VAPID key generation, 1Password storage, `PUSH_ENABLED`/`PUSH_EXCLUDED_ORIGINS`, and that rotation invalidates every subscription; AGENTS.md's notify-api and shell descriptions mention the push channel, the `/push/*` routes and `/push-sw.js`; one changeset selects `@operai/notify-api` and `@operai/shell` (minor); `mise run changeset:check` green.

- [x] T14: auth — shared system rate limits, `maxKeys`, env and retired vars — refs: AC-7.4, AC-7.5, AC-7.6 — deps: none
  - touch: `auth/src/system/systemRateLimits.ts`, `auth/src/system/systemRateLimits.test.ts`, `auth/src/lib/rateLimiter.ts`, `auth/src/lib/rateLimiter.test.ts`, `auth/src/lib/env.ts`, `auth/src/system/env.startup.test.ts`, `auth/.env.example`, `tools/env-doctor/manifest.ts`, `tools/env-doctor/*.test.ts`
  - done when: plan § API contracts "auth" + the "US-7 support" test row pass — `createSystemRateLimits` (per-service allowances 300/600, one per-address invalid count shared by both endpoints, one `tooManyRequests` builder with fixed `Retry-After`), `maxKeys` overflow semantics, the four env defaults and bounds (exit 1 on bad values), retired `SERVICE_TOKEN_RATE_*` → startup warning naming them, values ignored; env-doctor flags the retired names on `auth` (`FORBIDDEN_VARS`); `cd auth && direnv exec . bun test` and typecheck green.

- [x] T15: auth — `POST /system/service-token` verifies first, then one count — refs: AC-7.1, AC-7.3, AC-7.4, AC-7.5, AC-7.6, AC-7.8 — deps: T14
  - touch: `auth/src/system/serviceToken.routes.ts`, `auth/src/system/serviceToken.routes.test.ts`, `auth/src/auth/service-token.contract.test.ts`, `auth/src/index.ts`
  - done when: plan § Test strategy rows AC-7.1/7.3/7.4/7.5/7.6/7.8 for service-token pass (no `X-Forwarded-For`, injected clock): 300 mints → 300 × 200; 301st → shared 429, signer not called; invalid flood → 401 then 429 at 21, a valid credential from the same address still 200; byte-identical 429s; existing success/400/401 assertions unchanged (only the old per-address limiter tests replaced).

- [x] T16: auth — `POST /system/users/contact` verifies first, cached key set, token cap — refs: AC-7.2, AC-7.3, AC-7.4, AC-7.5, AC-7.6, AC-7.8 — deps: T15
  - touch: `auth/src/system/userContact.routes.ts`, `auth/src/system/userContact.routes.test.ts`, `auth/src/auth/user-contact.contract.test.ts`, `auth/src/index.ts`
  - done when: the same rows for users/contact pass (600 lookups → 600 × 200; 601st → 429 with no DB read; invalid kinds incl. a genuine service JWT without the scope count as invalid; 10 + 10 across both routes → 429); key-set cache rows (100 verifications → 1 read, unknown `kid` → ≤ 1 re-read per 30 s, token > 4 096 chars → 401 with no read); existing 200/400/401/404 assertions unchanged.

- [x] T17: auth — suite-capacity contract test (the test that would have caught D-1) — refs: AC-7.7 — deps: T16
  - touch: `auth/src/system/systemCapacity.contract.test.ts`
  - done when: plan row AC-7.7 (contract) passes with production defaults and real routers: 8 clients × 30 mints + 220 lookups + 15 invalid from `"direct"` in one window → zero 429; shown to fail at the 21st request when run against the pre-US-7 routers (stash/checkout evidence in the report, not committed).

- [x] T18: notify-api — push activity memo (30 s from send), single flight, send pool, capacity test — refs: AC-5.2, AC-2.1, AC-2.4, AC-2.6, AC-7.7 — deps: none
  - touch: `notify-api/src/push/activityCheck.ts`, `notify-api/src/push/activityCheck.test.ts`, `notify-api/src/push/sendPool.ts`, `notify-api/src/push/sendPool.test.ts`, `notify-api/src/channels/push.channel.ts`, `notify-api/src/channels/push.channel.test.ts`, `notify-api/src/lib/userContact.ts`, `notify-api/src/push/push.capacity.test.ts`
  - done when: plan rows "AC-2.1 under load", "AC-2.4/2.6 send pool", "AC-5.2 (amended) memo" and AC-7.7 (integration) pass — real token provider + real `createUserContactClient` against a fake auth enforcing the US-7 contract with no `X-Forwarded-For`: 100 notifications / 5 recipients / 30 s → exactly 5 lookups; 40 recipients → all pushed; 120 recipients → no 429; email notices still look up every time; never > 16 sends in flight; drops logged without ids; `direnv exec . bun test` green.

- [x] T19: notify-api — atomic device cap (S-M2) + secret-scan false positive in the route tests (D-3) — refs: AC-1.2, AC-3.1 — deps: T18
  - touch: `notify-api/src/push/devices.repo.ts`, `notify-api/src/push/devices.repo.test.ts`, `notify-api/src/push/devices.routes.ts`, `notify-api/src/push/devices.routes.test.ts`
  - done when: plan row "Device cap" passes against real Postgres (19 + 10 concurrent → 1 created / 9 limit; 0 + 25 concurrent PUT → 20 × 201 / 5 × 409; own endpoint at 20 → 200; move at 20 → 409, row untouched; same endpoint twice concurrently → 201 + 200, one row); READ COMMITTED pinned; the route's separate count removed; `betterleaks dir notify-api/src/push/devices.routes.test.ts` clean (literal built from parts or fingerprint allowlisted in `.betterleaksignore` — then add that file to this task's commit).

- [x] T20: shell — open-redirect class fix (S-M1, all placements) + service-worker ready timeout (D-2) — refs: AC-4.1, AC-4.2, AC-1.2, AC-1.3, AC-1.7 — deps: none
  - touch: `shell/src/sw/pushHandlers.ts`, `shell/src/sw/pushHandlers.test.ts`, `shell/src/lib/push.ts`, `shell/src/lib/push.test.ts`, `shell/src/components/PushSettings.tsx`, `shell/src/components/PushSettings.test.tsx`
  - done when: `safeHref` and `handleServiceWorkerMessage` reject any value whose normalised pathname starts with `//` (vectors `/.//evil.io`, `/..//evil.io`, `/a/..//evil.io`, `/%2e%2e//evil.io`, plus the existing ones) → `/notify` / ignored; `enablePush` bounds `navigator.serviceWorker.ready` with a timeout and surfaces a retryable error (design F6), the button leaves the busy state and Turn on retries; amended AC-1.7 row: after an explicit sign-out and signing in again the section is off, and Turn on with permission still `granted` subscribes without a prompt UI (add the test if T8 lacks it); `pnpm lint`, `pnpm test`, `pnpm build` green.

- [x] T21: notify-api — server-side href guard (S-M1) + secret-scan false positive in the allowlist tests (D-3) — refs: AC-4.1, AC-4.2, AC-6.2 — deps: T19
  - touch: `notify-api/src/notifications/notifications.schemas.ts`, `notify-api/src/notifications/notifications.schemas.test.ts`, `notify-api/src/push/pushEndpoint.test.ts`, `.betterleaksignore`
  - done when: `isRelativeSuitePath` rejects every value whose `new URL(h, 'http://x').pathname` starts with `//` (same vectors as T20) on both the system and user routes (400), existing valid hrefs still accepted; `betterleaks dir .` reports no finding on this branch's files; `direnv exec . bun test` green.

- [x] T22: Docs — auth limits runbook, rollout order, AGENTS.md, changeset — refs: AC-7.8, AC-6.1 — deps: T14, T15, T16, T18
  - touch: `infra/README.md`, `AGENTS.md`, `.changeset/*`
  - done when: `infra/README.md` documents the four new auth variables, the retired `SERVICE_TOKEN_RATE_*` (delete after auth is live), the rollout order (auth → notify-api → `PUSH_ENABLED` only after the AC-7.7 live re-measure) and the Step-0/R-1 runbook lines the plan names; AGENTS.md's auth description mentions per-service limits on its `/system` endpoints (ADR list untouched — ADR-0086/0087 are added by the ADR writer); the changeset also selects `@operai/auth` (minor); `mise run changeset:check` green.

- [ ] T12: Cross-browser go-live check, AC-7.7 live re-measure and ADR-0084 sign-off — refs: AC-2.1, AC-2.3, AC-4.1, AC-6.5, AC-7.7 — deps: T10, T11, T14–T22
  - touch: `docs/adr/0084-web-push-encrypted-payloads-not-fcm.md`, `specs/029-push-notifications/qe-manual.md`
  - done when: `qe-manual.md` records the T1 checks deferred from the spike (Chrome/Edge/Firefox: suppression with a visible tab keeps the subscription alive, Edge endpoint host is in T4's allowlist, PNG icon renders) and, per Chrome/Edge/Firefox/Safari on a deployed preview: push received with Operai closed within 30 s; nothing shown with a visible tab; click opens the link / `/notify`; sign-out stops pushes; and ADR-0084's "Go-live sign-off" carries owner and date. The open question on excluding Meetings (spec) is answered and reflected in `PUSH_EXCLUDED_ORIGINS`. Plus, before enabling in production: a one-off check that no stored `notification.link.href` in the production notify DB fails the new `isRelativeSuitePath` (security round 1, low L1; user decision 2026-11-12) — fix or delete any that do; and record in ADR-0084 that security lows L2–L4 are accepted (send-queue fill by colluding insiders, a theoretical sync-throw in auth's key-set reload, length-only secret validation). Plus the AC-7.7 live row: > 100 notifications in 10 min on the dev stack (then the deployed pair) with no `allowance exhausted` / `invalid-credential limit reached` line in auth and no `HTTP 429` in notify-api. Human task.

- [ ] T13: Close — all gates green, spec status → done — refs: all — deps: T12
  - touch: `specs/029-push-notifications/*`
  - done when: QE PASS, owasp-reviewer PASS (plan § Security: YES), fresh passing `eval-report.md`, no drift; `/wellforge:done 029-push-notifications` succeeds.
