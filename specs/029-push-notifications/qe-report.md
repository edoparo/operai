# QE report: specs/029-push-notifications

## QE verdict: FAIL        (measured at e28af74b, full mode, rigor production)

Pass of 2026-11-12. Tree clean at e28af74b when the gates ran; this report is the only file added after.
Scratch evidence (repro scripts, screenshots) lives in the QE scratchpad:
`/private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/39cd1c38-0ef8-4330-af42-72ff15685521/scratchpad/`.

Rows that could not run here (first lines, as required): real OS push delivery on Chrome, Edge and Firefox,
the click-through of a real OS notification, and the ADR-0084 go-live sign-off. All are T12 (human) and are
listed as `pending T12` below. They do not make this verdict BLOCKED because three defects already make it FAIL.

| Check | Threshold | Actual | Result |
|---|---|---|---|
| AC coverage (executed test per AC) | 29/29 | 29/29 have a passing automated test (map below); AC-2.1/2.3/4.1 real-browser delivery pending T12 | ✓ (automated) |
| notify-api typecheck (`direnv exec . bun run typecheck`) | 0 errors | 0 errors | ✓ |
| notify-api tests (`direnv exec . bun test`) | 0 fail | 441 pass / 0 fail, 29 files | ✓ |
| notify-api production bundle (`bun build`) | builds | 412 modules, 6.48 MB | ✓ |
| notify-api migration on a fresh DB, then `migrate diff` against schema.prisma | applies, no drift | applied; "No difference detected" (scratch DB dropped) | ✓ |
| shell `pnpm lint` | 0 findings | 0 | ✓ |
| shell `pnpm test` | 0 fail | 563 pass / 0 fail, 40 files | ✓ |
| shell `pnpm build` (tsc -b + vite) | builds | OK; `dist/push-sw.js` 1 731 B, classic IIFE, 0 `import`, unhashed | ✓ |
| `/push-sw.js` served by `vite preview` | 200, JS MIME, not cached long | 200 `text/javascript`, `Cache-Control: no-cache`; vercel.json `no-store` rule also matches it | ✓ |
| env-doctor `bun test` | 0 fail | 203 pass / 0 fail | ✓ |
| `mise run env:doctor` | green | 9 services checked, all checks passed (VAPID_PRIVATE_KEY secret-classed, production template `PUSH_ENABLED=false`) | ✓ |
| `mise run changeset:check` | OK | OK (`.changeset/web-push-notifications.md`) | ✓ |
| e2e `push-notifications.spec.ts` | 3/3 | 3 passed (7.8 s) | ✓ |
| Coverage (no configured threshold; measured for the new files) | report | notify-api push files: push.channel 83% lines, devices.routes 94%, pushEndpoint/deviceLabel/schemas 100%; shell push.ts 97.5%, PushSettings 97.5%, pushHandlers 94.6%, all 97.1% lines | ✓ (info) |
| Dependency audit (`bun audit`, notify-api) | 0 critical | 0 critical; 10 high, all pre-existing (hono, mysql2, zod via prisma/openapi); none in the new web-push tree (web-push 3.6.7, http_ece, asn1.js, jws, minimist, https-proxy-agent) | ✓ |
| Secret scan (`betterleaks git main..HEAD`, `betterleaks dir`) | 0 unreviewed | 2 findings on this branch, both reviewed as false positives (placeholder `user:pw@` in SSRF test vectors), NOT allowlisted in `.betterleaksignore` | ✗ (D-3) |
| Hardcoded credentials / VAPID key in tracked files | none | none (`git grep` of the dev public key and of private-key patterns: 0 hits) | ✓ |
| Capacity of the activity check (AC-2.1 under load) | every notification for a user with a device is pushed | lookups 20+ in 10 min get 429, push fails closed and email notices are starved too | ✗ (D-1) |
| Design states (design.md) | all states present | all 10 reachable states present and match the copy (list below); one hang found in the turn-on path | ✗ (D-2) |
| Accessibility (design.md) | keyboard + ARIA per design | focus, live regions, dialog trap and names hold in every reachable state (details below) | ✓ |
| Component reuse (design.md inventory) | 12 reuse : 0 new | `PushSettings.tsx` composes `Badge`, `StatusBadge`, `Banner`, `Button`, `Card`, `ConfirmDialog`, `DataTable`, `PageHeader`, `SkeletonRows`, `StatePanel`, `VisuallyHidden`, `useFocusOnMount`; `operai-ui` untouched; no new library component | ✓ |
| Exploratory UI pass at /account, 360 px | every reachable designed flow walked | done (see below); at 360 px the page does not overflow, the section does inside `<main>` while the shell sidebar is expanded (O-1) | ✓ (O-1 noted) |
| Real push delivery Chrome / Edge / Firefox (AC-2.1, 2.3, 4.1) | received with Operai closed | not run | pending T12 |
| Edge endpoint host `*.notify.windows.com` in allowlist (R3) | observed on real Edge | not observed | pending T12 |
| Safari real delivery (AC-2.1/2.3 amended, 4.1 click) | verified | verified by the user in the T1 spike (plan.md § Risks), not re-run by QE | verified by: Matteo Codogno, 2026-11-11, T1 spike (as recorded in plan.md) |
| AC-6.5 go-live decision in ADR-0084 | owner + date | "Go-live sign-off: pending, owner Matteo Codogno" | pending T12 (gate before `PUSH_ENABLED=true` in production) |
| Open question: exclude Meetings (AC-6.4) | answered | unanswered; default none excluded | pending T12 |

## Defects

Class and route are given for each. "Missed earlier" means it was in the tree since the task landed; nothing here is
new since a fix (there was no previous QE pass).

### D-1 (high, contract): the activity check exhausts auth's rate limit, so push stops after about 20 notifications per 10 minutes, suite-wide, and starves email notices

- Where: `notify-api/src/channels/push.channel.ts` step 3 calls `userContact.lookup(recipientId)` once per
  notification for every recipient that has at least one device (AC-5.2 activity check). That client posts to auth
  `POST /system/users/contact` (`auth/src/system/userContact.routes.ts`), whose limiter is
  `SERVICE_TOKEN_RATE_LIMIT` = 20 per `SERVICE_TOKEN_RATE_WINDOW_MS` = 600 000 ms by default (auth/src/lib/env.ts:139-140),
  keyed by caller network address. notify-api is one process and one address, so the whole suite shares ONE bucket.
- Observed (live, dev stack, notify-api's own credentials via `direnv exec`): 30 consecutive lookups returned
  `found` for #1-19 and `failed` (HTTP 429, logged by `[user-contact]`) for #20-30.
  Repro: `direnv exec . bun <scratchpad>/lookup.ts <userId>` from `notify-api/` (file:
  `.../scratchpad/lookup.ts`).
- Effect:
  1. AC-2.1 / AC-2.2 ("any notification ... is pushed") fail under ordinary load: a CRM handover burst or a few
     users with a device exceed 20 recipients-with-devices in 10 minutes and every further push is dropped
     silently (`failed` fails closed, by design AC-5.2/R5, but the plan only considered an auth outage, not
     self-inflicted 429).
  2. Regression to an existing feature: the same bucket serves the `email: true` notices of ADR-0056 / specs/019
     (handover emails). Push lookups now consume their budget, so emails fail with "email notice not sent" for the
     rest of the window.
  3. A notification with `email: true` for a user with devices spends two lookups.
- Why tests did not catch it: every push test stubs `UserContactClient`; no test exercises auth's limiter.
- Route: architect (plan § Send sequence step 3 and R5; ADR-0056 interaction), then the T6 dev. Fix options for the
  architect to choose between, not for QE: cache the active/inactive answer per user in notify-api for a short TTL;
  give `system:notify-api` its own limiter key or a higher limit in auth; have auth tell notify-api about
  deactivation (so the per-send check goes away); or look up only when the user's devices are older than N.
  Whatever is chosen needs a test that drives more than 20 notifications in a window against the real client with a
  fake auth that enforces the 20/10 min contract.
- Side effect of my repro on the dev stack: my 30 lookups used dev auth's budget for notify-api. Pushes and email
  notices on the dev stack answer `failed` until about 12:55 local (10 min after 12:44). Nothing was restarted.

### D-2 (low-medium, code): "Turn on" can hang forever in the busy state

- Where: `shell/src/lib/push.ts` `enablePush`, `await navigator.serviceWorker.ready` has no timeout. If the worker
  never reaches `active` (install fails, script error, blocked worker), `register()` resolves, `ready` never does.
- Observed (real Chromium, `ready` forced to a never-resolving promise): after 15 s the button still reads
  "Waiting for your browser…", `aria-busy=true`, no Banner, and the click guard (`busyRef`) ignores further clicks,
  so the only way out is a reload. Repro: `.../scratchpad/s12.mjs`.
- Contradicts design F6 ("none leaves a half-registered state ... Turn on remains and is the retry").
  `register()` rejecting (bad MIME, 404) is handled (`generic`); only the never-activates case is not.
- Route: code, T8 (frontend dev). Bound `ready` (and ideally the prompt-free steps after the grant) with a timeout
  that maps to `subscribe_failed`, with a unit test using a never-resolving `ready`.
- Placements of the same pattern (unbounded await after the gesture): `enablePush` ready ✗; `registration.pushManager.subscribe`
  (browser-owned, a push-service outage makes it reject rather than hang: not reproducible here) not tested;
  `disablePush` / `removePushDevice` await `apiFetch` (browser fetch timeouts apply, fine).

### D-3 (low, code/test fixtures): two secret-scan findings not allowlisted

- `notify-api/src/push/pushEndpoint.test.ts:30` (`https://user:pw@fcm.googleapis.com/x`, commit f76450af) and
  `notify-api/src/push/devices.routes.test.ts:267` (same literal, commit a23812ef), rule `generic-credential-uri`.
  Both are placeholder userinfo in SSRF test vectors, not credentials (reviewed by QE). The repo convention
  (AGENTS.md, Git) is to allowlist reviewed placeholders by fingerprint in `.betterleaksignore`; this branch did not.
  `betterleaks dir .` fingerprints: `notify-api/src/push/pushEndpoint.test.ts:generic-credential-uri:30` and
  `notify-api/src/push/devices.routes.test.ts:generic-credential-uri:267`.
- Route: dev of T4/T5 (or devops). Either allowlist the two fingerprints (git-mode fingerprints carry the commit
  sha and will change after a squash, so prefer the dir-mode form already used in the file) or build the literal
  from parts in the fixtures.
- Placements: both files listed; no other branch file produced a finding.

## Spec and plan findings (reported, not fixed; drift rule)

- **PO, AC-1.7 vs AC-5.1.** AC-1.7 says that after "signs in again" the setting "still shows on without asking
  again"; AC-5.1 says sign-out removes the device. Built and observed behaviour follows AC-5.1: after an explicit
  sign-out the server list is empty (0 devices, 97 ms) and the next sign-in shows Off with Turn on, no prompt
  (permission stays granted). AC-1.7 can only hold for a session that ended without sign-out. Needs a one-line
  clarification.
- **PO/architect, AC-1.6 vs the plan's support rule.** The AC lists four supported browsers and says any other
  browser is "not available"; the plan's `isPushSupported()` is feature detection plus a mobile test, never an
  allowlist. Desktop Opera, Vivaldi, Brave, Arc and Chromium forks therefore get "Turn on" (labelled "Unknown
  browser" when they register), and a fork that subscribes but never delivers (Dia in the spike) cannot be
  detected. Also an iPadOS home-screen app reports a desktop UA and has `PushManager`, so it is offered Turn on.
  Accept explicitly or tighten the AC to say "feature detection".
- **design.md frontmatter is still `status: draft`** while spec and plan are approved (process note for the caller).
- Edge's WNS host is still the plan's assumption, not observed (R3, T12).

## Environment faults (not defects, no fix round)

- **E-1: `/notify` (any route that mounts notify-ui) crashes on the running dev shell :5173** with
  `Cannot read properties of null (reading 'isServer')` from `useMatchRoute` at
  `http://localhost:5181/node_modules/.vite/deps/@tanstack_react-router`. `/meetings` on the same server renders.
  Checked whether it predates the branch: the branch DOES touch `shell/vite.config.ts` (T7 adds the
  push-service-worker plugin) and `ShellLayout.tsx`, so the T10 note "files this branch does not touch" is not
  accurate. But I ran fresh dev servers of both trees (git worktrees under the scratchpad, own `node_modules`
  via `pnpm install --offline --frozen-lockfile`, port 3000, the only other origin auth's CORS allows):
  fresh `main` (5909c757) mounts `/notify` fine, fresh branch HEAD (e28af74b) mounts `/notify` fine, the
  long-running :5173 instance crashes. So the source is not the cause; the live :5173 process holds a stale
  Module Federation share state (a React Router copy seeded by the projects remote on :5181, the first-writer-wins
  case documented in vite.config.ts). Fix for the caller: restart `mise run dev`. Worktrees removed afterwards.
- **Disclosure:** my first `main` control run symlinked the shell's `node_modules`, so it re-optimised the shared
  `node_modules/.vite/deps` once (12:37). The :5173 server kept answering identically afterwards (re-checked), but
  if the caller sees odd dev-server behaviour after that time, restarting it clears it.

## AC to test map (all executed)

| AC | Evidence (all passed) |
|---|---|
| 1.1 | `PushSettings.test`: shows Off, never asks on load; live: 0 `requestPermission` calls on load |
| 1.2 | `PushSettings.test`, `push.test`, devices.routes 201; e2e turn on lists this browser; live 201 + label "Safari · macOS" |
| 1.3 | `PushSettings.test` refused/dismissed; live: dismissed keeps Turn on and focus, no PUT; refused -> Blocked, focus on banner |
| 1.4 | `PushSettings.test`; live: permission denied on load -> Blocked, static `role=note`, no button |
| 1.5 | `PushSettings.test`, e2e turn off, live: server 0 devices, focus stays on the button |
| 1.6 | `push.test` table, `PushSettings.test`; live (iPhone UA): "Not available" + device list + working Remove |
| 1.7 | `push.test` reconcile cases; e2e reload; live: reload shows On, 0 prompts (see AC-1.7 vs AC-5.1 above) |
| 1.8 | `PushSettings.test`; live: config 500 -> warning Banner with Retry, address section intact, retry focuses the new toggle |
| 2.1, 2.2, 2.4, 2.5, 6.2, 6.3 | `push.channel.test` (decrypt with the subscriber key, no plaintext on the wire), system/raise route tests; live: real send to fcm.googleapis.com from a real dispatch (see AC-2.7) |
| 2.3 | `pushHandlers.test`; live in a real Chromium service worker (CDP `deliverPushMessage`): visible tab -> nothing shown; no window -> shown with `tag=id`, `lang=en`, `/push-icon.png`, `data.href` |
| 2.6 | route tests (10 s stall, throw, reject -> 201); live: `POST /notifications` 201 in 7 ms while the send ran |
| 2.7 | `push.channel.test`; live: a real FCM 404/410 for a fake token removed the device within 1 s, 500 path unit-tested |
| 3.1-3.3 | route + component tests; live: B cannot list, DELETE of A's id is 404 identical to an unknown id, row intact |
| 4.1, 4.2 | `pushHandlers.test` (focus + `postMessage`, `openWindow`, `/notify` fallback); real click: pending T12 (cannot be triggered from CDP) |
| 4.3 | e2e signed-out deep link |
| 5.1 | `session.test`, `push.test`; live: sign-out via the user menu emptied the server list in 97 ms |
| 5.2 | `push.channel.test` (inactive deletes all, failed keeps); capacity problem: D-1 |
| 5.3 | `push.test`, route test; live: user B opening the browser unsubscribed A's subscription and cleared the store, and a PUT of the same endpoint by B moved the row |
| 6.1 | env tests, PUT 503, dispatch inert, section absent; live: `enabled:false` -> section absent, config pending -> nothing drawn; production template `PUSH_ENABLED=false` |
| 6.4 | `push.channel.test` (excluded origin skipped) |
| 6.5 | review gate: ADR-0084 sign-off is "pending"; pending T12 |

## Exploratory pass detail (Playwright Chromium against http://localhost:5173/account, seeded sessions)

Reached and checked: config pending (nothing drawn), config disabled (absent), config failed (warning + Retry),
devices loading (polite live "Loading push notification settings…" + skeleton), devices failed (warning, no toggle),
Off, turning on (busy label, `aria-busy`, a second Enter ignored, one prompt, one subscribe), On (success Banner
`role=status`, focus stays on the same button, device row first), reload still On with 0 prompts, Turn off (busy,
success Banner, focus stays), blocked at load (static note), refused prompt (focus moves to the Banner,
`role=status`), dismissed prompt (Turn on keeps focus), unsupported (390 px iPhone UA: list and Remove still work),
every PUT failure code (409/422/503/500/abort/200-with-junk body: the mapped copy, `role=alert`, no browser
subscription left, focus on the button), subscribe throwing (`subscribeFailed` copy), Remove dialog (alertdialog,
`aria-modal`, labelled and described, focus on Cancel, Tab trapped Remove/Close/Cancel, Escape returns focus to
the Remove button that opened it, inline `role=alert` error on failure with the dialog open, 404 treated as
success, after removing the only row focus lands on the empty state heading), Italian (`it-IT`) and dark theme
render with the catalog copy, headings run h1, h2, h3, h4 without gaps, the table has a caption and row headers,
Remove buttons carry "Remove <label>, turned on <date>", no duplicate ids.

- O-1 (pre-existing shell chrome, surfaced by the new section): at 360 px the shell sidebar stays expanded at 223 px,
  leaving a 136 px content column. The page itself never overflows (scrollWidth 360, also 320), but inside `<main>`
  the push section overflows by 84 px (the h2 "Push notifications" is clipped, the table overflows its card).
  After the user collapses the sidebar nothing overflows, and the DataTable's own scroll region holds the Remove
  button. Placements: push heading ✗, description ✗, devices table ✗ (expanded sidebar); Home address section ✓
  (wraps); push section with sidebar collapsed ✓. The sidebar behaviour is not in this branch's diff
  (`ShellLayout.tsx` change is the message listener only); route to the shell owner or designer if narrow desktop
  windows matter. Not counted as a 029 defect.
- Minor: at 360 px the device label "Chrome · macOS" wraps with the middle dot on its own line.

## Security

Recommend an `owasp-reviewer` pass (plan § Security: YES). QE checked and found sound: endpoint allowlist against
look-alike, userinfo, port, IP, localhost, backslash, trailing-dot and over-length URLs (all 422/400 on the live
service; an upper-case `FCM.GOOGLEAPIS.COM` is accepted, it normalises to the allowed host); keys must be real P-256
points; the 8 KiB cap; user-JWT only (a service JWT is refused); no endpoint or key in any response; other users'
ids are a 404 identical to unknown; the service worker follows only same-origin relative hrefs (`https://…`, `//…`,
`/\t/…`, `/\…`, `javascript:` all became `/notify` in a real worker) and shows titles as text. Residual to weigh,
not a defect against the ACs: after a session ends WITHOUT an explicit sign-out (expiry, cleared cookies) the
device row stays and that browser keeps showing the user's notifications until the next sign-in by someone else
(AC-5.3) or a 404/410; AC-5.1 only covers explicit sign-out. The TTL of 86 400 s means a notification can appear
up to a day late when a computer wakes.

## Tests added by QE

None committed (every AC already had a passing automated test, and the three defects are reproduced by the scratch
scripts named above rather than by red tests left in the tree). `qe-report.md` is left uncommitted for the caller.

## Blocked / pending

- T12 (human): Chrome, Edge, Firefox real delivery with Operai closed within 30 s, nothing shown with a visible tab,
  click opens the link or `/notify`, sign-out stops pushes, Edge WNS host, PNG icon on Chrome/Edge/Firefox,
  ADR-0084 go-live sign-off (owner + date), the Meetings-exclusion decision. Needs the three browsers on a deployed
  preview and a person.
- Re-verification after fixes needs: D-1 resolved and re-measured with more than 20 notifications in 10 minutes
  through the real client; D-2 unit test; D-3 `betterleaks dir .` showing no finding in the two files; then the
  dev stack restarted (E-1) and the e2e spec re-run.
