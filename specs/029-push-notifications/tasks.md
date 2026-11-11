---
spec: 029
generated: 2026-11-11
synced: 2026-11-11
---

# Tasks: Push notifications

Contracts: `plan.md` (approved) is binding; screens, states, copy and a11y: `design.md`.

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

- [ ] T4: Endpoint allowlist and device label — refs: AC-3.1, AC-6.3 — deps: T1
  - touch: `notify-api/src/push/pushEndpoint.ts`, `notify-api/src/push/pushEndpoint.test.ts`, `notify-api/src/push/deviceLabel.ts`, `notify-api/src/push/deviceLabel.test.ts`
  - done when: allowlist table passes — allowed: `fcm.googleapis.com`, `*.push.services.mozilla.com`, `web.push.apple.com`, the Edge host(s) recorded in T1; refused: `http:`, IP literals, `fcm.googleapis.com.evil.io`, userinfo (`https://fcm.googleapis.com@evil.io`), ports, > 2000 chars; label table maps Chrome/Edge/Firefox/Safari × macOS/Windows/Linux UA strings to "Browser · OS", unknown → "Unknown browser".

- [ ] T5: Device routes — `GET /push/config`, `PUT|GET /push/devices`, `DELETE /push/devices/{id}` — refs: AC-1.2, AC-1.5, AC-3.1, AC-3.2, AC-3.3, AC-5.3, AC-6.1 — deps: T2, T3, T4
  - touch: `notify-api/src/push/devices.routes.ts`, `notify-api/src/push/devices.schemas.ts`, `notify-api/src/push/devices.routes.test.ts`, `notify-api/src/index.ts`, `notify-api/src/openapi/registry.ts`
  - done when: route tests pass for every status in plan § API contracts (200/201/400/401/404/409/422/503), exact-path middleware only (a service JWT is refused, a user JWT on `/system/*` still refused), responses never contain `endpoint`/`p256dh`/`auth`, user B cannot see or delete A's device (404, row intact); OpenAPI lists the four routes.

- [ ] T6: Push channel — dispatch from `inAppChannel.send`, encrypt, send, prune — refs: AC-2.1, AC-2.2, AC-2.4, AC-2.5, AC-2.6, AC-2.7, AC-5.2, AC-6.2, AC-6.3, AC-6.4 — deps: T1, T2, T3
  - touch: `notify-api/src/channels/push.channel.ts`, `notify-api/src/channels/push.channel.test.ts`, `notify-api/src/push/webPushSender.ts`, `notify-api/src/push/webPushSender.test.ts`, `notify-api/src/channels/inApp.channel.ts`, `notify-api/src/system/notifications.routes.test.ts`, `notify-api/src/notifications/raise.routes.test.ts`
  - done when: integration tests with an injected fake HTTP layer pass for every push row of plan § Test strategy (AC-2.1/2.2/2.4/2.5/2.6/2.7/5.2/6.1/6.2/6.3/6.4), including decrypting the captured `aes128gcm` body with the test subscriber's private key and asserting the plaintext title is absent from the wire bytes; `POST /system/notifications` latency unchanged by a 10 s sender stall (dispatch not awaited); logs contain no endpoint, key or notification text (asserted).

- [ ] T7: Shell service worker, its build entry and dev serving — refs: AC-2.3, AC-2.4, AC-4.1, AC-4.2 — deps: T1
  - touch: `shell/src/sw/*`, `shell/vite.config.ts`, `shell/tsconfig*.json`
  - done when: unit tests with a fake `ServiceWorkerGlobalScope` pass (visible window → no `showNotification`, except when the subscription endpoint is on `web.push.apple.com` → shown (Safari, AC-2.3 amended); hidden only → shown with `tag = id`, `lang: 'en'`, icon `/push-icon.png`, `data: {href}`; click with/without `href` and with/without an existing window → focus + `postMessage({navigate})` / `openWindow`; malformed payload → nothing shown, no throw); `pnpm build` emits `dist/push-sw.js` as a classic script with no hash and no `import`; `pnpm dev` serves `/push-sw.js`.

- [ ] T8: Shell push library, sign-out release and boot reconciliation — refs: AC-1.6, AC-1.7, AC-5.1, AC-5.3 — deps: T7
  - touch: `shell/src/lib/push.ts`, `shell/src/lib/push.test.ts`, `shell/src/lib/session.ts`, `shell/src/lib/session.test.ts`, `shell/src/components/ShellLayout.tsx`, `shell/src/components/ShellLayout.test.tsx`
  - done when: unit tests pass for `isPushSupported()` table; enable/disable against a fake `PushManager` and `apiFetch`; reconcile cases (on; server row missing → silent re-`PUT`, no prompt; stored user ≠ current → `unsubscribe`; permission revoked → `DELETE` + `unsubscribe`, 404 = success; any failure after subscribe → `unsubscribe`); `signOut()` sends the `DELETE` with the JWT before caches clear and never waits more than 2 s; the existing synchronous `onSignOut` tests still pass; `ShellLayout` handles the service worker's `{navigate}` message via `navigateSuite`.

- [ ] T9: My profile push section (`PushSettings`) + copy — refs: AC-1.1, AC-1.2, AC-1.3, AC-1.4, AC-1.5, AC-1.6, AC-1.8, AC-3.1, AC-3.2, AC-3.3, AC-6.1 — deps: T8
  - touch: `shell/src/components/PushSettings.tsx`, `shell/src/components/PushSettings.test.tsx`, `shell/src/components/AccountScreen.tsx`, `shell/src/components/AccountScreen.test.tsx`, `shell/src/strings.ts`, `operai-ui/src/components/Banner*` (only if `Banner` does not forward `tabIndex`; then with a story and a test)
  - done when: component tests cover every state in design.md § Screens & states and every component row of plan § Test strategy for AC-1.x/3.x/6.1; focus and live-region rules of design.md § Accessibility asserted (focus after Remove, after blocked, busy label); the section sits outside `account-address-region` and specs/012 AC-6.2's test still passes; strings parity (`catalogGaps`) and the no-hardcoded-strings scan pass; `pnpm lint` and `pnpm build` green; `mise run ui:check` green if `operai-ui` was touched.

- [ ] T10: E2E — My profile push flow and signed-out deep link — refs: AC-1.1, AC-1.2, AC-1.5, AC-3.2, AC-4.3 — deps: T5, T9
  - touch: `shell/e2e/push-notifications.spec.ts`, `shell/e2e/helpers/pushFixtures.ts`
  - done when: `cd shell && pnpm e2e push-notifications.spec.ts` passes against `mise run dev` with `PUSH_ENABLED=true` and test VAPID keys: fake `PushManager` via init script; turn on → device row visible; reload → still on; remove → gone; signed-out visit to `/notify` lands on sign-in and returns to `/notify`.

- [ ] T11: Runbook, AGENTS.md and changesets — refs: AC-6.1, AC-6.5 — deps: T6, T9
  - touch: `infra/README.md`, `AGENTS.md`, `.changeset/*`
  - done when: `infra/README.md` documents VAPID key generation, 1Password storage, `PUSH_ENABLED`/`PUSH_EXCLUDED_ORIGINS`, and that rotation invalidates every subscription; AGENTS.md's notify-api and shell descriptions mention the push channel, the `/push/*` routes and `/push-sw.js`; one changeset selects `@operai/notify-api` and `@operai/shell` (minor); `mise run changeset:check` green.

- [ ] T12: Cross-browser go-live check and ADR-0084 sign-off — refs: AC-2.1, AC-2.3, AC-4.1, AC-6.5 — deps: T10, T11
  - touch: `docs/adr/0084-web-push-encrypted-payloads-not-fcm.md`, `specs/029-push-notifications/qe-manual.md`
  - done when: `qe-manual.md` records the T1 checks deferred from the spike (Chrome/Edge/Firefox: suppression with a visible tab keeps the subscription alive, Edge endpoint host is in T4's allowlist, PNG icon renders) and, per Chrome/Edge/Firefox/Safari on a deployed preview: push received with Operai closed within 30 s; nothing shown with a visible tab; click opens the link / `/notify`; sign-out stops pushes; and ADR-0084's "Go-live sign-off" carries owner and date. The open question on excluding Meetings (spec) is answered and reflected in `PUSH_EXCLUDED_ORIGINS`. Human task.

- [ ] T13: Close — all gates green, spec status → done — refs: all — deps: T12
  - touch: `specs/029-push-notifications/*`
  - done when: QE PASS, owasp-reviewer PASS (plan § Security: YES), fresh passing `eval-report.md`, no drift; `/wellforge:done 029-push-notifications` succeeds.
