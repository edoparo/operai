# QE report: specs/029-push-notifications

## QE verdict: FAIL        (measured at 3b157e12, full mode, rigor production, re-verification after fix round 1 of 2)

Pass of 2026-11-12 (afternoon), fresh agent, full sweep of all 37 ACs and design.md. The tree was clean at 3b157e12
when every gate ran and stayed clean; this report is the only file changed. QE added no tests to the tree.
Scratch evidence (repro scripts, logs) is in
`/private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/39cd1c38-0ef8-4330-af42-72ff15685521/scratchpad/r1/`
(and `.../scratchpad/` for the round 0 scripts s1-s12 that were re-run).

Rows that could not run here, first: real OS push delivery on Chrome, Edge and Firefox, the click-through of a real OS
notification, Edge's WNS endpoint host, and the ADR-0084 go-live sign-off are all T12 (human), recorded below as
`pending T12`, never as passes. The e2e spec `notifications.spec.ts` cannot pass on the running dev shell (environment
fault E-1, still present after the user's restart) and is BLOCKED until the dev shell is healthy. One new design defect
(D-4) is a plain FAIL on its own.

## Round 0 defects to status

| Id | Round 0 finding | Status now | Evidence |
|---|---|---|---|
| D-1 | activity check exhausts auth's per-address limit (push stops after ~20/10 min, starves email notices) | FIXED (contract, integration and live) | auth `systemCapacity.contract.test` + `push.capacity.test` pass; live re-measure below: 0 refusals |
| D-2 | "Turn on" hangs forever when the service worker never becomes ready | FIXED | live `r1/s14.mjs`: a never-resolving `ready` ends the busy state after ~10 s with the retryable "couldn't set up push" alert, Turn on works again; unit tests in `push.test.ts` |
| D-3 | two secret-scan findings (placeholder userinfo URL in SSRF test vectors) | FIXED in the tree, still present in three commits of branch history | `betterleaks dir` over the 96 files this branch touched: neither file reports any more (details under Gates); history scan still reports the two original commits and the round 0 report commit |
| S-M1 | open redirect via hrefs that normalise to a protocol-relative path | FIXED in all three placements | live: service worker payload href, page-side `{navigate}` message handler, and `POST /notifications` guard each reject all 10 vectors (list below) |
| S-M2 | non-atomic per-user device cap | FIXED | live against the running service: 25 concurrent PUTs on 0 devices = 20 x 201 + 5 x 409; 19 devices + 10 concurrent distinct = 1 x 201 + 9 x 409, final 20; same endpoint twice concurrently = 200 + 201, one row; a user at the cap taking another user's endpoint = 409, row untouched |
| T10 note | T10 claimed the files in question are "files this branch does not touch" | Re-answered: that note was inaccurate in round 0 and the E-1 theory there ("stale share state") is superseded, see E-1 | e2e `push-notifications.spec.ts` 3/3 pass |
| T11 note | docs and changeset | OK | `mise run changeset:check` OK (`.changeset/web-push-notifications.md`), infra/README and AGENTS.md updated by T11/T22 |

## Gates

| Check | Threshold | Actual | Result |
|---|---|---|---|
| AC coverage (executed test per AC) | 37/37 | 37/37 have a passing automated test (map below); AC-2.1/2.3/4.1 real-browser delivery pending T12 | ✓ (automated) |
| auth `direnv exec . bun run typecheck` | 0 errors | 0 errors | ✓ |
| auth `direnv exec . bun test` | 0 fail | 842 pass / 0 fail, 59 files | ✓ |
| notify-api `direnv exec . bun run typecheck` | 0 errors | 0 errors | ✓ |
| notify-api `direnv exec . bun test` | 0 fail | 538 pass / 0 fail, 33 files | ✓ |
| shell `pnpm lint` | 0 findings | 0 | ✓ |
| shell `pnpm build` | builds | OK | ✓ |
| shell `pnpm test`, 12 full runs on the branch | 0 fail | 578 tests, 40 files: 11 runs green, 1 run red (1 test: `router.meetings.test.tsx`, remote-fails-to-load case) | see flake triage: pre-existing, not a 029 defect |
| tools/env-doctor `bun test` | 0 fail | 206 pass / 0 fail | ✓ |
| `mise run env:doctor` | green | all checks passed (9 services) | ✓ |
| `mise run changeset:check` | OK | OK | ✓ |
| `mise run shared:check` | in sync | 6 groups in sync (serviceToken, s3ResidencyAllowlist, s3ResidencyAddressing, systemAuth, problem, logger) | ✓ |
| Coverage (no configured threshold; measured) | report | notify-api 87.4% lines overall; push.channel 85.0, activityCheck 100, sendPool 100, devices.routes 93.8, devices.repo 73.9 (the 26% gap is the transaction-lock path covered by the real-Postgres concurrency test, not by line-counted unit tests), pushEndpoint 100; auth 94.7% overall, systemRateLimits 100, serviceToken.routes 100, userContact.routes 100, rateLimiter 100 | ✓ (info) |
| Dependency audit (`bun audit` notify-api and auth, `pnpm audit` shell) | 0 critical | 0 critical everywhere (notify-api 29 findings: 10 high, 16 moderate, 3 low; shell 25 high; all in packages this branch did not add); the only new dependency is web-push 3.6.7 with its types | ✓ |
| Secret scan, dir mode over the 96 files this branch touched | 0 unreviewed new | 3 hits, none new from code: (1) `auth/.env.example:21` private-key rule, pre-existing on main (line from June 2026, untouched by this branch); (2) `tools/env-doctor/check.test.ts:551` generic-api-key, pre-existing on main (specs/021, 2026-11-06, line untouched); (3) the round 0 version of this report (now overwritten). The two D-3 test files report nothing | ✓ |
| Secret scan, git mode `main..HEAD` | informational | 3 hits in history: the two original test commits (f76450af, a23812ef) and the round 0 report commit (eeef1394). All reviewed false positives (placeholder userinfo in a URL). They disappear when the branch is squashed; if CI ever scans branch history they will need fingerprint entries | ✓ (note) |
| Hardcoded credentials / VAPID private key in tracked files | none | none | ✓ |
| Capacity of the activity check and email notices (AC-2.1 under load, AC-7.7 live) | no refusal | 0 refusals in the live run (below) | ✓ |
| Design states (design.md) | all states present | all 10 states reachable and with the designed copy | ✓ |
| Accessibility (design.md) | keyboard + ARIA + focus table per design | holds everywhere except the "Remove" focus rule after a second removal (D-4) | ✗ (D-4) |
| Component reuse (design.md inventory) | 12 reuse : 0 new | unchanged since round 0: `PushSettings.tsx` composes library parts only; `operai-ui` untouched by this branch | ✓ |
| Exploratory UI pass at /account | every designed flow walked | done (below) | ✓ except D-4 |
| 360 px | no horizontal page overflow | page never overflows (360 and 320); the O-1 sidebar observation is unchanged and pre-existing | ✓ (O-1 note) |
| e2e `push-notifications.spec.ts` | 3/3 | 3 passed (7.6 s, two runs) | ✓ |
| e2e `notifications.spec.ts` | all pass | 5 failed / 8 passed on the live dev shell, all five failing tests open `/notify`, which crashes in that dev server (E-1) | BLOCKED (environment) |
| Real push delivery Chrome / Edge / Firefox (AC-2.1, 2.3, 4.1) | received with Operai closed | not run | pending T12 |
| Edge endpoint host `*.notify.windows.com` in allowlist (R3) | observed on real Edge | not observed | pending T12 |
| Safari real delivery | verified | verified by Matteo Codogno, 2026-11-11, T1 spike (as recorded in plan.md); not re-run by QE | verified by: Matteo Codogno, 2026-11-11, T1 spike |
| AC-6.5 go-live decision in ADR-0084 | owner + date | "Go-live sign-off: pending, owner Matteo Codogno" | pending T12 (gate before `PUSH_ENABLED=true` in production) |
| Open question: exclude Meetings (AC-6.4) | answered | unanswered; default none excluded | pending T12 |

## Defects

### D-4 (low-medium, design a11y; code; missed earlier, not new since the fix round): focus is lost after a second device removal when the neighbour row is the same one

- Design rule broken: design.md § Accessibility, focus table: "Remove (another device) succeeds -> next row's row header
  (`DataTable.focusRowKey`), else previous". After the second removal below, focus ends on `<body>` (the page's "Skip to
  content" region), so a keyboard or screen reader user loses their place.
- Repro (live, real Chromium, 3 devices): remove the FIRST row (focus lands on the new first row header, correct), then
  remove the LAST row of the remaining two. Focus goes to `body`. Both mouse and keyboard reproduce it.
  Script: `r1/s17.mjs` (prints one line per sequence). Results: first+last = BODY ✗ (mouse ✗, keyboard ✗);
  last+last, first+first = row header ✓ both modes. Round 0 only removed one row per page load, so it never saw it.
- Root cause: `focusAfterRemoval()` (shell/src/lib/pushSettingsModel.ts) yields the key of the surviving neighbour. In
  [A,B,C], removing A yields B (next); removing C from [B,C] yields B again (previous). `operai-ui`
  `DataTable` moves focus in `useEffect(..., [focusRowKey])`, so an unchanged key does not re-run the effect and nothing
  is focused. `PushSettings` keeps `focusKey` in state after use and never resets it.
- Placements of the pattern (every `focusRowKey` consumer): PushSettings devices table (shell) ✗;
  `inventory-ui/src/pages/RulesPage.tsx` via its own `DataTable` copy: focuses a just-added row, key is unique per
  action, cannot repeat ✓; `operai-ui` stories/pages (`DataTable.stories`, `QuickCreate.stories`, `catalogue.tsx`): demo
  code, not a user flow ✓. So the only affected user flow is My profile -> push devices.
- Route: code, T9 dev (frontend). Fix either in `PushSettings` (clear `focusKey` after the focus has been applied, or use a
  fresh token per removal) or in the library `DataTable` (re-run on a token), with a component test that removes the
  first row and then the last row of a three-device list and asserts focus on the surviving row header after the second.
  QE did not write that test into the tree because it would leave the suite red for the hand-over.

No other defects.

## Environment faults (not defects, no fix round)

### E-1 (still present after the user's restart): `/notify` crashes on the running dev shell (:5173)

- Observed: opening `/notify` (any route that mounts notify-ui) on http://localhost:5173 shows "Something went wrong!"
  with `Cannot read properties of null (reading 'isServer')`. `/account`, `/meetings` and every other route render. It
  is the same fault as round 0 and it survived the user's restart at 13:32, so round 0's "stale share state"
  theory is not sufficient. It breaks five tests of `notifications.spec.ts` (AC-2.4 empty state, AC-3.x, AC-2.5, AC-6.2,
  AC-6.3: all navigate to `/notify`); the remaining 8 pass.
- Does it predate this branch or come from it? Not from the branch's code: fresh dev servers of `main` (5909c757) and of
  this branch's HEAD (3b157e12), each in its own worktree with its own node_modules and the same running remotes,
  both mount `/notify` with its empty state and no error (checked with the same script as the failing one,
  `r1/e1c.mjs`). The branch changes no lockfile and no UI package.json. Candidate mechanism found: `projects-ui`
  has @tanstack/react-router 1.170.46 installed while shell, notify-ui, meetings-ui, crm-ui and admin-ui have 1.170.17;
  the Module Federation singleton prefers the highest version, and the stack trace shows the router copy served by
  http://localhost:5181 (projects-ui). That explains why a fresh host sometimes works and the long-lived one does not,
  but I did not prove it, and QE did not restart services. A clean fix to try: stop `mise run dev`, remove
  `shell/node_modules/.vite` and `projects-ui/node_modules/.vite`, reinstall projects-ui from its lockfile, restart,
  and rerun `notifications.spec.ts`. Route: environment owner, not a dev agent, no fix round.
- Side note for the caller: the e2e start-up prints the auth warning that `SERVICE_TOKEN_RATE_LIMIT` and
  `SERVICE_TOKEN_RATE_WINDOW_MS` are still set in the user's local auth environment and are ignored (the designed
  AC-7.8 behaviour). They should be deleted from that environment.

### Flake: `router.meetings.test.tsx` (and `router.inventory.test.tsx`), "shows RemoteMount's error state ... when the remote fails to load"

- Classification: PRE-EXISTING, not caused by the branch, not a 029 defect.
- Method: full shell suite, interleaved, 30 runs each, same machine, back to back: a worktree of `main` (5909c757, own
  node_modules, no push code, no `initPush()` in ShellLayout) and the branch HEAD. The `main` worktree also reports one
  environment failure per run (`remoteVersionExposes.integration` needs estimai-ui installed in that worktree); it is
  excluded below.
  - main: the flake appeared in 5 of 30 runs (all 5 in `router.inventory.test.tsx`, the same pattern: the healthy
    remote stub rendered instead of the throwing `vi.doMock`).
  - branch HEAD: 3 of 30 runs (2 in `router.meetings.test.tsx`, 1 in `router.inventory.test.tsx`); plus 1 of the 12
    runs earlier in this pass (meetings). So the branch's rate is not higher than main's.
- Placements of the same pattern (a test that re-`doMock`s a federated remote with a throwing factory after the
  `beforeEach` registered a healthy one): `shell/src/router.meetings.test.tsx` ✗ (flaky), `shell/src/router.inventory.test.tsx` ✗
  (flaky), `shell/src/lib/extensions.test.tsx` (same factory style, no failure seen in 60 runs). Both flaky files are
  unchanged by this branch (last touched on main by specs/021 and the inventory work). Route if the caller wants it
  fixed: frontend dev, as a separate chore (not a 029 task); it does not consume a 029 fix round.

## Live re-measurement (item 2 of the brief): D-1 and the AC-7.7 live row

The running processes serve the T14-T21 code: auth and notify-api were started 13:32:41 (after the last user restart);
behaviour confirms it (below), including auth's per-service limits, which round 0's code could not do.

- Valid mints, same address: 45 consecutive service-token requests with crm-api's real credential -> 45 x 200
  (round 0's rule would have refused #21).
- Contact lookups through notify-api's own client, 30 consecutive for one active user -> 30 x found, 0 failed (round 0:
  failed from #20).
- Real path, two phases, through `POST /system/notifications` with crm-api's service credential (scripts `r1/load.ts`,
  `r1/seed.ts`): phase 1: 30 email notices for 30 distinct recipients, 30 x 201, none `failed`; phase 2: 110
  notifications for 110 recipients that each own a push device (the push activity check), 110 x 201, and afterwards all 110
  devices were gone, i.e. 110 lookups were answered `inactive` (a refused lookup would have KEPT the device); then 110
  more email notices, 110 x 201, none `failed`. In total about 350 lookups by `system:notify-api` inside the 10-minute
  window, well above the old 20 and below the new 600. No notification surfaced a refusal. 130 seeded devices and 250
  notifications created by the run were removed afterwards.
- AC-7.5/7.6 live: 26 requests with an invalid body/credential to the token endpoint from this address: 20 answered as
  before (400), the 21st to 26th answered 429 with `Retry-After: 600` and a body that only says "Too many requests";
  directly afterwards 3 of 3 valid mints from the same address succeeded, and a valid contact lookup succeeded too.
- Not directly observable by QE: auth's own log lines (`allowance exhausted`, `invalid-credential limit reached`) and
  notify-api's (`HTTP 429`) because both services run in the user's terminal. The absence of any `failed` emailStatus,
  the deletion of every probed device and the successful valid calls are the observable proof; the user may still want to
  grep the two terminals for those strings to close T12's live row.
- Disclosure of side effects on the dev stack: my runs sent 3 email notices (status `sent`) to a throw-away test user
  whose address is on a non-deliverable test domain; created test users `qe-*` (the test endpoint recreates a user on
  every mint, so earlier `qe-*` ids become inactive); left a handful of notification rows addressed to those test users.
  The invalid-credential count for this machine's address reached 20 at about 14:36 and expired on its own.

## Exploratory pass (item 4): Playwright Chromium on http://localhost:5173/account, seeded sessions

Re-run in full after the fixes. Reached and checked, all as designed: config pending (nothing drawn), config disabled
(section absent, address intact), config failed (warning Banner with Retry, address intact, retry puts focus on the toggle),
devices loading (polite live "Loading push notification settings..." + skeleton), devices failed (warning, no toggle),
Off, turning on (busy label, `aria-busy`, a second Enter ignored, one prompt, one subscribe), On (success Banner
`role=status`, focus stays on the same button, device row with the "This browser" marker), reload still On with 0
prompts, Turn off (busy, success Banner, focus stays), blocked at load (static `role=note`, no button), refused prompt
(focus moves to the Banner), dismissed prompt (Turn on keeps focus, no PUT), unsupported (390 px iPhone UA: list and
Remove still work, "Not available" copy), every PUT failure (409/422/503/500/abort/200 with junk body: mapped copy,
`role=alert`, no browser subscription left, focus on the button), subscribe throwing, Remove dialog (alertdialog,
modal, labelled and described, focus on Cancel, Tab cycles Remove/Close/Cancel, Escape returns focus to the opening
Remove button, inline `role=alert` on failure with the dialog open, 404 treated as success), Italian and dark themes,
heading order h1 > h2 > h3 > h4 without gaps, table caption and row headers, Remove buttons named with label and date.
New since round 0 and checked: amended AC-1.7 (after an explicit sign-out and signing in again the section shows Off
with no device on the server, and Turn on with permission still granted turns On with no new device prompt UI; a session
that ends without sign-out and the same user signing in again still shows On); never-ready service worker (D-2, above);
`register()` rejecting shows the generic retryable alert and leaves 0 devices; ready resolving late is accepted; the
full open-redirect vector list (S-M1): `/.//evil.io`, `/..//evil.io`, `/a/..//evil.io`, `/%2e%2e//evil.io`,
`/%2E%2E//evil.io`, `/./\evil.io`, `//evil.io/x`, `https://evil.io`, `/<tab>/evil.io` and `javascript:` are all refused in
the service worker (becomes `/notify`), ignored by the page's message handler (stays on the page), and answered 400 by
`POST /notifications`; valid hrefs (`/crm/deals/9?x=1#y`) pass in all three places.
Not checked in a loop: Dark and Italian at 360 px beyond what `s4.mjs` covers (320, 360, 1280 all without page overflow).
360 px / O-1: the shell sidebar stays expanded at 223 px and the push section overflows `<main>` by about 84 px until the
user collapses it (placements: push heading ✗, description ✗, devices table ✗ while expanded; Home address section wraps ✓;
all ✓ with the sidebar collapsed). `ShellLayout.tsx` changed on this branch only by the message listener
(11 lines), the sidebar and `operai-ui` are untouched, so O-1 remains pre-existing shell chrome, not a 029 defect.

## Spec and plan findings (reported, not fixed; drift rule)

- AC-1.6 and AC-1.7 as amended on 2026-11-12 now match the build and the plan (verified live above); the round 0
  findings about them are closed. Residual noted in the spec's own Non-goals (capable Chromium forks and an iPadOS
  home-screen app may be offered Turn on).
- design.md frontmatter is still `status: draft` while spec and plan are approved (process note for the caller).
- Edge's WNS host is still the plan's assumption, not observed (R3, T12).
- ADR-0084 go-live sign-off is "pending" (AC-6.5, T12).

## AC to test map (all executed this pass)

| AC | Evidence (all passed) |
|---|---|
| 1.1 | `PushSettings.test`; live: 0 permission requests on load |
| 1.2 | `PushSettings.test`, `push.test`, `devices.routes.test`; e2e turn on lists this browser |
| 1.3 | `PushSettings.test` refused/dismissed; live s3 cases 7 and 8 |
| 1.4 | `PushSettings.test`; live s3 case 6 |
| 1.5 | `PushSettings.test`, e2e turn off; live: server list 0, focus stays on the button |
| 1.6 | `push.test` table, `PushSettings.test`; live iPhone UA: "Not available" + working Remove |
| 1.7 (amended) | `push.test` reconcile + the new explicit-sign-out case; e2e reload; live `r1/s15.mjs` both halves |
| 1.8 | `PushSettings.test`; live s3 cases 3, 4, 4b |
| 2.1, 2.2, 2.4, 2.5, 6.2, 6.3 | `push.channel.test` (decrypt with the subscriber key, plaintext absent from wire) and route tests |
| 2.1 under load | `push.capacity.test` with the real client against a fake auth enforcing the US-7 contract; live re-measure above |
| 2.3 | `pushHandlers.test`; live real Chromium worker (s7): visible tab -> nothing shown, closed -> shown with tag, lang `en`, icon, href |
| 2.6 | route tests; send pool `sendPool.test` (never > 16 in flight, bounded backlog) |
| 2.7 | `push.channel.test` (404/410 prune, 500 keeps) |
| 3.1-3.3 | route and component tests; live cross-user 404 identical to unknown id (round 0) |
| 4.1, 4.2 | `pushHandlers.test`; live evil/valid href vectors; real OS click pending T12 |
| 4.3 | e2e signed-out deep link |
| 5.1 | `session.test`, `push.test`; live: sign-out emptied the server list (round 0: 97 ms) |
| 5.2 (amended 30 s) | `activityCheck.test` (expiry from send time, single flight, `inactive`/`failed` never reused), `push.channel.test`; capacity test (100 notifications, 5 recipients, exactly 5 lookups) |
| 5.3 | `push.test`, route test; live user switch (round 0, re-run s8: B signing in unsubscribes A's subscription) |
| 6.1 | env tests, PUT 503, dispatch inert, section absent; live `enabled:false` |
| 6.4 | `push.channel.test` (excluded origin skipped) |
| 6.5 | review gate: pending T12 |
| 7.1 | `serviceToken.routes.test` (300 mints), live 45 mints |
| 7.2 | `userContact.routes.test` (600 lookups), live 30 + 350 |
| 7.3 | both route tests (A exhausts, B unaffected) |
| 7.4 | both route tests (301st/601st -> shared 429, `Retry-After`, spies not called, retries do not extend) |
| 7.5, 7.6 | both route tests and `systemRateLimits.test` (20 invalid then 429, valid passes from the same address and from `direct`, byte-identical 429s, verification runs once on every path); live s: 400 x 20 then 429, valid mints pass |
| 7.7 | `systemCapacity.contract.test` (8 clients x 30 mints + 220 lookups + 15 invalid, zero 429), `push.capacity.test` (120 recipients), live above |
| 7.8 | existing success/400/401/404 assertions unchanged and green; `shared:check` shows no change to any shared `serviceToken.ts` |

## Security

owasp-reviewer pass recommended and still required before close (plan § Security: YES). Residuals worth the reviewer's
eyes, none a defect against the ACs: the invalid-credential count does not cap guesses by design (spec Non-goals, user
decision); after a session ends WITHOUT an explicit sign-out the device row stays until the next sign-in by someone
else (AC-5.3) or a 404/410; the 86 400 s TTL means a notification can appear up to a day late; git-mode history still
contains three placeholder-credential hits (informational).

## Tests added by QE

None. D-4 is reproduced by `r1/s17.mjs` against the running stack; a failing test would have turned the suite red for
the hand-over. The dev for D-4 should add the component test described under the defect.

## Blocked / pending

- BLOCKED (environment, E-1): `notifications.spec.ts` needs a healthy dev shell. Needs: restart `mise run dev` after
  clearing the Vite caches and aligning projects-ui's router version, then
  `cd shell && E2E_ESTIMAI_REMOTE_PORT=5174 E2E_REFUND_REMOTE_PORT=5175 E2E_NOTIFY_REMOTE_PORT=5176 E2E_ADMIN_REMOTE_PORT=5177 E2E_INVENTORY_REMOTE_PORT=5178 E2E_CRM_REMOTE_PORT=5179 E2E_MEETINGS_REMOTE_PORT=5180 E2E_PROJECTS_REMOTE_PORT=5181 pnpm e2e notifications.spec.ts`
  (failure observed this pass: `Cannot read properties of null (reading 'isServer')` on `/notify`).
- pending T12 (human): Chrome, Edge, Firefox real delivery with Operai closed within 30 s, nothing shown with a visible
  tab, click opens the link or `/notify`, sign-out stops pushes, Edge WNS host, PNG icon on the three browsers, ADR-0084
  go-live sign-off (owner + date), the Meetings-exclusion decision, and the user's grep of the auth/notify-api terminals
  for the refusal strings to close the AC-7.7 live row on the deployed pair.
- Re-verification needs: D-4 fixed with its component test; E-1 cleared and `notifications.spec.ts` rerun. This is fix
  round 2 of 2; if D-4 is not fixed in it, the caller escalates per the rigor rules.
