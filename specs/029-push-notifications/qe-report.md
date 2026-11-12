# QE report: specs/029-push-notifications

## QE verdict: FAIL        (D-5 re-verification, measured at 64722e10, full mode, rigor production)

D-5 (blank page on bare tool URLs) is FIXED and the L5 leak fix still holds, but two defects that no earlier pass could see
because earlier passes did not run these checks remain open: **D-6** browser Back/Forward inside any tool changes the address
and leaves the old page on screen, and **D-7** the whole-suite e2e run is red on two `meetings-capture` tests because 029's
boot code now creates an IndexedDB database on every browser. Neither is caused by the D-5 commit (D-6 is reproduced with the old
router shape too; D-7 comes from T8). T12 rows stay pending (human). Working tree at 64722e10 plus two UNCOMMITTED QE spec
files under `shell/e2e/` (listed under "Tests added by QE"); no product code touched. Scripts and outputs in `/private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/39cd1c38-0ef8-4330-af42-72ff15685521/scratchpad/` and `/private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/39cd1c38-0ef8-4330-af42-72ff15685521/scratchpad/r4/`
(`ext.mjs`, `ext-nav.txt`, `ext2.txt`, `back.mjs`, `exp.mjs`, `exp2.mjs`, `exp3.mjs`, `idb.mjs`, `r5-uicheck.txt`, `r5-e2e-full.txt`, `r5-rl.txt`, `r5-rh.txt`, `r5-<app>.txt`).

## D-5 re-verification

| Check | Threshold | Actual | Result |
|---|---|---|---|
| `mise run ui:check` | exit 0 | exit 0: operai-ui 184, shell 585, refund-ui 751, meetings-ui 1002 tests pass; lint, typecheck, Storybook build ok | ✓ |
| The other six frontends (not in `ui:check`): `pnpm lint && pnpm build && pnpm test` | all exit 0 | estimai 360, inventory 1056, crm 240, admin 567, notify 50, projects 418 tests pass; lint and build exit 0 each | ✓ |
| `node scripts/check-react-skew.mjs` | OK | OK (10 frontends, react 19.2.7, router 1.170.46) | ✓ |
| `mise run changeset:check` | OK | OK (matched `release-router-history-on-unmount.md`, `router-per-mount-and-tanstack-alignment.md`, `router-survives-hide-and-reveal.md`, `web-push-notifications.md`) | ✓ |
| Bare tool URL, full load, 10 mount points (`matrix.mjs`) | content | estimai, refund, inventory, crm, admin land on the redirect target and render; meetings, projects, notify, devices, my-meetings render | ✓ |
| SPA from `/crm/pipeline` to each of the 10 (`matrix.mjs`) | content | all 10 render | ✓ |
| 28-step walk + sidebar clicks + 22 Back steps (`walk.mjs`) | right page, 0 blank | 0 blank, 0 page errors, only the expected 403s (refund remote for an admin without refund access) | ✓ (heading-level staleness is not seen by this script; see D-6) |
| Leak, 10 cycles per mount point (`leak.mjs`): net `popstate` and `beforeunload` listeners, `pushState`/`replaceState` identity vs the shell-only baseline | 0 and identity | 9 mount points (projects, meetings, notify, crm, inventory, estimai, refund, admin, my-meetings): 0 / 0 and `===` after cycles 1, 5 and 10 | ✓ |
| Leak, 12 cycles on three more mount points (`ext.mjs leak`) | same | `/devices`, `/crm/contacts`, `/projects/tasks`: 0 / 0 / identity at cycles 1, 6, 12; 0 blank | ✓ |
| LIFO interleaving: 60 random hops over 12 routes with random leave-mid-load delays, then every gated tool opened, back to /account (`ext.mjs random`) | no blank, baseline restored | 0 blank mid-run, all 6 tools open afterwards, at /account listeners 0 and identity true, 0 page/console errors | ✓ |
| Leave while the Suspense fallback shows: network throttled (350 ms latency, 300 kB/s, cache off), leave after 150-750 ms, 16 rounds over 8 remotes (`ext.mjs slow`) | no blank, no leak | fallback seen in 16 of 16 rounds; afterwards all 6 tools render, listeners 0, identity true, 0 errors | ✓ |
| CRM deal page + `HostMeetings` panel, 10 visits (new `router-lifecycle.spec.ts`) | card renders each time, nothing accumulates | passes: Meetings region and deal title every visit, popstate count identical on all 10 visits, 0 and identity restored at /account | ✓ |
| Floating `RecorderDock` mounted next to CRM/Projects 10 times via the widget's Open meeting (new `router-lifecycle.spec.ts`) | nothing accumulates | passes: popstate count constant per phase over 10 cycles, 0 and identity restored after Stop and leaving | ✓ |
| In-remote links, forward direction, every remote (`ext.mjs nav`) | URL and page update | clicking each tab/link updates the address and the page in estimai (only one screen), refund, inventory, crm, meetings, projects, admin; notify, devices, my-meetings single screen | ✓ |
| **Browser Back/Forward inside a remote** (`ext.mjs nav`, `back.mjs`, new `remote-history.spec.ts`) | the page named by the address | **address changes, page does not**: after Back from `/crm/tasks` the URL is `/crm/contacts` and the page, its heading and the `aria-current` tab still say Tasks; same for Forward; stays until a reload. admin, inventory, projects, crm fail in the new spec at the first Back; refund and meetings show the same in `ext-nav.txt` | ✗ (D-6) |
| e2e whole suite (`pnpm e2e`, 117 tests, run 1) | all pass | 115 passed, 2 failed (both `meetings-capture.spec.ts`, see D-7) | ✗ (D-7) |
| e2e `tool-entry.spec.ts` (the dev's 11 tests, inside the whole run) | pass | all 11 pass | ✓ |
| e2e the 029 specs (`notifications.spec.ts`, `push-notifications.spec.ts`, inside the whole run) | pass | all pass, including `notifications.spec.ts` AC-2.5 (the L5 failure) | ✓ |
| Dev servers served 64722e10 | yes | the live served `crm-ui/src/App.tsx` contains `DisposableRouterHost` | ✓ |
| Console / page errors across the live scripts | 0 | 0 page errors; console errors only the 4 expected 403s | ✓ |
| `.changeset/release-router-history-on-unmount.md` accurate | text matches the code | wrong: describes the removed `useDisposableRouter` hook ("now creates the router on mount and destroys its history on unmount ... safe under StrictMode"); `router-survives-hide-and-reveal.md` says it was replaced, so the two changelog entries contradict each other | ✗ (docs defect D-8) |

### Defects

**D-6 (medium, functional; MISSED EARLIER, not new since the D-5 fix). Browser Back/Forward inside a tool shows the previous address with the current page.**

- Class: every tool with more than one screen. Placements (live, `ext-nav.txt`, and the new spec): CRM Companies -> Contacts -> Tasks, Back x2, Forward x2 ✗ (heading and `aria-current` stay on Tasks); Admin Roles/Departments/Users ✗; Inventory Assets/Rules/Years ✗; Projects list/My tasks ✗; Refund (requests/review) ✗ and Meetings (list/templates/erase) ✗ in `ext-nav.txt` (same signature drift; the new spec does not drive these two). Single-screen mounts (estimai list, notify, devices, my-meetings) cannot show it. Cross-tool Back (tool to tool) is correct: the 22-step Back chain in `walk.mjs` renders the right tool every time.
- Repro: seeded admin, open `/crm/companies`, click Contacts, click Tasks, press the browser's Back. URL `/crm/contacts`, page still Tasks. A reload shows Contacts. Clicking a link afterwards works, the next Back is stale again (`exp3.mjs`).
- Evidence about cause (not a fix): the remote's own `popstate` handler DOES run (instrumented: both the shell's and the CRM's `onPushPopEvent` fire, `exp2.mjs`), so the history is subscribed. Replacing the `DisposableRouterHost` with a module-level singleton router (what `main` has) through a Playwright route on `crm-ui/src/App.tsx` gives exactly the same stale result (`exp.mjs singleton` vs `exp.mjs host`), so the D-5 host is not the cause and this was equally present at 85fcb037/5ee89091. What is NOT known: whether it is also stale on `main` itself. `main` uses `@tanstack/react-router` 1.170.17 everywhere; this branch moved shell and all remotes to 1.170.46 (86496298, the E-1 alignment). A main stack could not be run beside the dev one (the auth CORS list names only `http://localhost:5173`). The dev should compare on the old router version before choosing a fix. Hypothesis only: the shell hides the remote subtree on each URL change (the D-5 comment), and the router update triggered by a `popstate` renders into a tree that stays on the old match.
- Missing test: `shell/e2e/remote-history.spec.ts` (uncommitted, red on purpose, 4 tests; each fails at its first `goBack`, forward clicks pass). Add a component-level test that mounts a real tool router through the shell's Suspense and presses Back.

**D-7 (medium, regression of an existing journey; MISSED EARLIER, caused by 029 T8 d0419315, not by D-5). `operai-push` IndexedDB database exists on every browser that loads Operai, which breaks two `meetings-capture` e2e tests.**

- Failures: `meetings-capture.spec.ts:146` "closing the page mid-recording ... Discard leaves the device clean (AC-2.8, AC-4.11)" (2.6 m) and `:237` "after Stop the browser storage is empty (AC-4.11)": `expect(baseline).toEqual({ local: [], session: [], indexedDb: [], caches: [] })` receives `indexedDb: ["operai-push"]`. The recording journeys themselves passed up to that assertion (the offline-40-s test and the recorder-widget journey of the same file pass, and so does the keyboard test).
- Cause (verified): a brand-new user who only loads `/account`, never touching push, already has `["operai-push"]` in `indexedDB.databases()` (`idb.mjs`). `initPush` at shell boot runs `reconcilePush`, which opens the store (`openStore`, `indexedDB.open('operai-push', 1)`) to read the this-browser marker and so creates the database empty. Contents are a device id, not audio, so meetings AC-4.11 ("audio never written to the device") is not violated; the e2e's blanket "nothing in IndexedDB" assertion is.
- Two possible fixes for the owner (spec / plan call, not QE): read the marker without creating the database (e.g. look for it in `indexedDB.databases()` first), or amend the meetings e2e to allow `operai-push` as the one known database and say why. Either way a person decides because the second edits another feature's acceptance journey. Not a flake: both runs of both tests are deterministic on this assertion.
- Why earlier passes did not see it: they ran only the 029 specs plus a few non-029 ones; this is the first whole-suite run on the branch.

**D-8 (low, docs). `.changeset/release-router-history-on-unmount.md` still describes `useDisposableRouter`.** It names the removed hook and claims "safe under React StrictMode"; with `router-survives-hide-and-reveal.md` in the same release the generated changelog would carry both. Reword it to `DisposableRouterHost` or fold it into the second changeset (the first one's bump list is the same nine packages). Also left over: spec/QE history mentions of the old hook are history, no action.

### Passing and unchanged

D-5: fixed and verified on all ten mount points, full load and SPA, with a throttled-network leave-mid-load storm and 60 random LIFO hops. L5 leak fix: holds, now also for `/devices`, `/crm/contacts`, `/projects/tasks`, the CRM deal's `HostMeetings` panel and the floating `RecorderDock` (10 cycles each). Gates green on all nine frontends. No console or page errors beyond the expected 403s. Not touched: 029 ACs, the push/auth/notify-api results of earlier sections.

### Environment notes (not defects)

- For the refund checks the local QE user `qe-e1r3admin@operai.test` was granted the `accounting` role (global) with the same fixture the e2e uses (`auth/scripts/e2e-invite-fixtures.ts grant-refund-accounting`); a dev database row, not product state. e2e persons are created and cleaned by the suite's own helpers.
- `test-results/` under `shell/` holds Playwright artefacts from this pass (ignored by git).

### Tests added by QE (UNCOMMITTED, per the brief)

- `/Users/matteocodogno/LAB/aiscream/operai/shell/e2e/router-lifecycle.spec.ts`: 2 tests, both PASS (CRM deal + HostMeetings 10 visits; RecorderDock 10 mounts). Their sensitivity was seen: a first version with a wrong baseline failed on the wrapper-identity assertion, and a first version with the wrong selector failed on the card.
- `/Users/matteocodogno/LAB/aiscream/operai/shell/e2e/remote-history.spec.ts`: 4 tests, all FAIL today (D-6). It should be committed with the fix (red until then), or kept out of the tree until a dev picks D-6 up; the caller decides.

### Blocked / pending

- pending T12 (human): unchanged (real push delivery on Chrome/Edge/Firefox, Edge WNS host, AC-7.7 deployed pair, stored-href, ADR-0084 sign-off, Meetings-exclusion decision).
- Re-verification needs D-6 and D-7 fixed (D-8 with them): `cd shell && E2E_ESTIMAI_REMOTE_PORT=5174 E2E_REFUND_REMOTE_PORT=5175 E2E_NOTIFY_REMOTE_PORT=5176 E2E_ADMIN_REMOTE_PORT=5177 E2E_INVENTORY_REMOTE_PORT=5178 E2E_CRM_REMOTE_PORT=5179 E2E_MEETINGS_REMOTE_PORT=5180 E2E_PROJECTS_REMOTE_PORT=5181 pnpm e2e` (all 121 tests green, including `remote-history.spec.ts`), then `node /private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/39cd1c38-0ef8-4330-af42-72ff15685521/scratchpad/r4/ext.mjs nav` (no STALE lines) and `leak.mjs`.
- This is fix round 4 on the router work; the caller decides on escalation under the rigor rules (D-6 is a decision about the TanStack version or the shell/remote suspense seam, which may be a plan change).
- owasp-reviewer: still recommended, as before (L5 is closed by evidence here; the reviewer should confirm).

---

## Superseded: L5 re-verification (measured at 9b394e13)

## QE verdict: FAIL        (L5 re-verification, measured at 9b394e13, full mode, rigor production) -- superseded

Commit 9b394e13 (`useDisposableRouter`) fixes the leak it targets, but it BREAKS every remote whose index route redirects
(estimai, refund, inventory, crm, admin): they render an empty page. Previous verdict at 85fcb037 was PASS; this pass supersedes it
(sections below are kept as history). Evidence in `/private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/39cd1c38-0ef8-4330-af42-72ff15685521/scratchpad/r4/` (`walk.mjs`/`walk.txt`, `poll.mjs`, `matrix.mjs`, `trace.mjs`, `leak.mjs`, `blank.png`, `e2e1.txt`, `e2e2.txt`, `e2e3.txt`, `uicheck.txt`). QE changed only this file; tree clean at 9b394e13.

## L5 re-verification

| Check | Threshold | Actual | Result |
|---|---|---|---|
| `mise run ui:check` | exit 0 | exit 0: operai-ui 181, shell 585, and the two consumer groups 749 and 1002 tests, all pass | ✓ |
| `node scripts/check-react-skew.mjs` | OK | OK (10 frontends, react 19.2.7, router 1.170.46) | ✓ |
| `mise run changeset:check` | OK | OK (`release-router-history-on-unmount.md` matched) | ✓ |
| shell `pnpm vitest run` | 0 fail | 585 pass / 0 fail, 40 files (also inside ui:check) | ✓ |
| Dev servers picked up the change | Vite serves 9b394e13 | yes: all ports 5173-5181 answer, and swapping one remote back to the old `App.tsx` changes behaviour (see D-5) | ✓ |
| Leak check, 10 leave-and-return cycles per remote (`leak.mjs`: net `popstate`/`beforeunload` listeners via instrumented add/removeEventListener, `pushState`/`replaceState` identity vs. the shell-only baseline at /account) | no growth | all 9 mount points (projects, meetings, notify, crm, inventory, estimai, refund, admin, my-meetings): net listeners 0 and 0 after cycle 1, 5 and 10; both history functions `===` the baseline every time | ✓ |
| Every gated remote + /notify + /devices + /my-meetings renders, full load (`matrix.mjs`) | content | meetings, projects, notify, devices, my-meetings render; **estimai, refund, inventory, crm, admin: empty `<main>` for 15 s** (URL becomes `/estimai/estimates`, `/refund/requests`, `/inventory/assets`, `/crm/companies`, `/admin/roles`) | ✗ |
| Deep links on full load | right page | `/crm/pipeline`, `/inventory/assets` render; any path that hits the index redirect (`/crm`, `/inventory`, `/estimai`, `/refund`, `/admin`) is blank | ✗ |
| SPA navigation between remotes, same 17-step walk as round 2 plus real sidebar clicks, then Back (`walk.mjs`) | right page every step | 8 of 28 forward steps blank (every step that targets one of the five redirect remotes: spa /inventory, /estimai, /refund; click /crm x2, /estimai, /admin); the others and the whole Back chain (22 entries) show the right page, including the redirect remotes once they are history entries | ✗ |
| Shell's own navigation after many mounts | works | bell -> /notify, /account, /devices, /my-meetings, sidebar to meetings and projects all work | ✓ |
| In-remote navigation (links inside a remote) | URL and page update | crm tabs (Contacts, Tasks, Pipeline, Companies) not exercisable after a redirect remote goes blank; on a non-redirect entry (`/crm/pipeline`) the SPA steps to /crm/contacts and /crm/tasks render | ✗ (blocked by D-5 for the redirect entries) |
| Console / page errors | 0 | 0 page errors; console errors are only 403s from the refund remote for an admin without refund access (expected, same as round 2) | ✓ |
| e2e `notifications.spec.ts` + `push-notifications.spec.ts`, run 1 and run 2 | 13/13 | 12 passed, 1 failed both runs: `notifications.spec.ts:200` "AC-2.5 ... clicking a notification linking to /estimai actually mounts EstimAI" (Import JSON button never appears) | ✗ |
| e2e `activities-crm.spec.ts` | pass | 5/5 passed (its routes are non-redirect deep links) | ✓ |
| e2e `estimai-persistence.spec.ts` | pass | 2 failed (both journeys; the EstimAI list never renders) | ✗ |
| e2e `inventory-assignment.spec.ts` | pass | Journey 1 failed, Journeys 2 and 3 skipped after it | ✗ |
| e2e `refund-headline.spec.ts` | pass | Journey 1 failed, Journey 2 skipped after it | ✗ |
| No flash of an empty page that breaks a test or focus | none | the intended one-commit `null` is not the problem; the blank here is permanent (D-5) | ✗ (same defect) |

### Defects

**D-5 (new since 9b394e13; not missed earlier: the same walk rendered `/inventory(/assets)`, `/admin/roles`, `/crm/...` at 85fcb037). A remote whose index route throws `redirect` in `beforeLoad` renders nothing under `useDisposableRouter`.**

- Class: any remote whose router has an index route that redirects. Placements (every one checked live, full load AND SPA, all blank): estimai-ui (`/estimai` -> `/estimai/estimates`) ✗, refund-ui (`/refund` -> `/refund/requests`) ✗, inventory-ui (`/inventory` -> `/inventory/assets`) ✗, crm-ui (`/crm` -> `/crm/companies`) ✗, admin-ui (`/admin` -> `/admin/roles`) ✗. Not affected, no redirect: projects-ui ✓, meetings-ui `App` and `MyMeetings` ✓, notify-ui ✓. Not affected, ungated shell mounts: /devices ✓, /account ✓. Deep links that skip the redirect (`/inventory/assets`, `/crm/pipeline`) ✓. User impact: clicking EstimAI, Refund, Inventory, CRM or Admin in the sidebar, a notification link to `/estimai`, or a reload of the bare tool URL gives a blank page; Back after leaving and a deep link are the only ways in.
- Repro: seeded admin session, open `http://localhost:5173/inventory`. URL becomes `/inventory/assets`, `<main id="shell-main-content">` has no children (`blank.png`; `poll.mjs`: no content in 15 s). Same for the other four.
- Causality: temporarily restoring the pre-9b394e13 `inventory-ui/src/App.tsx` (`git show 9b394e13^:...`, reverted with `git checkout`, tree clean after) makes `/inventory` render "Inventory Assets Depreciation rules ..." immediately; with the committed file it is blank. Nothing else differs.
- Observation for the dev (hypothesis, not proven): the instrumented trace (`trace.mjs`) on `/inventory` shows the history being created, then `replaceState('/inventory/assets')` at the redirect, then a further unsubscribe/subscribe pair about 500 ms later (a third router is created and the previous one destroyed), after which nothing renders. The non-redirect load shows only the early unsubscribe/subscribe pair and renders. Something re-runs the subscription after the redirect (a Suspense hide/reveal of the remote subtree re-running the store's effect is the obvious candidate), and the newly created router never makes it into the tree. A passing unit suite does not see it because the 8 new `App.test.tsx` cases use injected/memory histories and no redirecting index route in a real federation mount.
- Missing test (dev to add; QE wrote none): per redirecting remote, mount `App` through the real `createAppRouter` with a browser history at the bare basepath (`/inventory`) and assert the redirect target's page renders (not just that `history.destroy` runs); plus one shell e2e that opens each bare tool URL. The existing e2e specs above already fail on it (`notifications.spec.ts:200`, `estimai-persistence`, `inventory-assignment` J1, `refund-headline` J1).
- Constraint on the fix: keep the leak result above (listeners net 0, wrapper identity restored after 10 cycles on all 9 mount points); re-run `leak.mjs`.

### Passing and unchanged

Leak fix works as designed on all nine mount points. Skew, changesets, shell tests, `ui:check`: green. The 9 mount points other than the five redirecting remotes render and navigate correctly, Back chain correct, 0 console/page errors.

### Blocked / pending

- Re-verification needs D-5 fixed; then re-run: `cd /private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/39cd1c38-0ef8-4330-af42-72ff15685521/scratchpad/r4/.. && node r4/matrix.mjs && node r4/walk.mjs && node r4/leak.mjs` (scripts use the running dev stack and the local `qe-e1r3admin@operai.test` user), the two 029 e2e specs (expect 13/13), and `activities-crm`, `estimai-persistence`, `inventory-assignment`, `refund-headline` e2e (expect all green; the 4 non-029 specs were not run before this pass, so their pre-9b394e13 baseline is inferred from the D-5 causality check, not measured).
- This is fix round 3; the caller decides on escalation under the rigor rules.
- pending T12 (human): unchanged from below (real push delivery, Edge host, AC-7.7 deployed pair, stored-href, L2-L4, ADR-0084 sign-off).
- owasp-reviewer: L5 itself was a security finding; recommend the reviewer confirm L5 closed after D-5 is fixed.

---

## Earlier passes (history)

## QE verdict: PASS        (measured at 85fcb037, full mode, rigor production, E-1 re-run)

Every executable row is green; E-1 is cleared (environment fault, no fix round consumed). The rows that need a human stay
`pending T12 (human)` and are not failures: real OS push delivery on Chrome / Edge / Firefox and the OS click, the Edge endpoint host
(R3), the AC-7.7 deployed-pair re-measure, the stored-href check, the L2-L4 acceptance and the ADR-0084 go-live sign-off (AC-6.5).
They are gates before `PUSH_ENABLED=true` in production. Security review round 1 is PASS (0 findings at or above medium), as reported by the caller.

QE changed only this file. Tree clean at 85fcb037 for every run below. Evidence of the re-run:
`/private/tmp/claude-501/-Users-matteocodogno-LAB-aiscream-operai/39cd1c38-0ef8-4330-af42-72ff15685521/scratchpad/r3/` (`nav.mjs`, `deep.mjs`, `ac43.mjs`, `e2e1.txt`, `e2e2.txt`).

## Round 2 - E-1 re-run (commits 86496298 and 85fcb037; dev servers restarted with fresh `node_modules/.vite`)

| Check | Threshold | Actual | Result |
|---|---|---|---|
| Environment precondition | one router version, fresh caches | `shell`, `projects-ui`, `notify-ui` all resolve `@tanstack/react-router` 1.170.46; each `node_modules/.vite` dated 12 Nov 16:36 (recreated); all ports 5173-5181 answer | ✓ |
| `/notify` on :5173, seeded session (`r3/nav.mjs`) | renders, no `isServer` crash | fresh user and admin user: "Notifications / Inbox / Mark all as read / Nothing here yet"; 0 page errors | ✓ |
| Navigate between remotes with different deep links, admin user, all 7 gated remotes + /notify + /account (`r3/nav.mjs`, `r3/deep.mjs`), full loads, SPA pushState, and browser Back | each shows the right page | /crm/pipeline -> /projects/tasks -> /crm/contacts -> /admin/users -> /crm/pipeline -> /projects -> /notify -> /crm/tasks -> /inventory(/assets) -> /admin/roles -> /projects/tasks: every step rendered its own page (Pipeline, My tasks, Contacts, Users, Pipeline, Project list, Notifications, Tasks, Assets, Roles, My tasks); Back landed on the previous route each time; 0 page errors. Note: the refund page for that admin shows the remote's own "You no longer have refund access" state (the admin role has no refund grant), expected | ✓ |
| e2e `notifications.spec.ts` + `push-notifications.spec.ts`, run 1 | 13/13 | 13 passed (34.5 s) | ✓ |
| e2e same, run 2 | 13/13 | 13 passed (34.0 s) | ✓ |
| AC-4.3 full form (`r3/ac43.mjs`) | signed-out `/notify` -> sign-in with `redirect=http://localhost:5173/notify` -> after sign-in back on `/notify` AND the Notifications heading renders | redirect param exact; after sign-in URL `/notify`; heading "Notifications" visible; 0 page errors | ✓ |
| `node scripts/check-react-skew.mjs` | one react / react-dom / router version | OK: 10 frontends, react 19.2.7, router 1.170.46 (operai-ui does not declare the router, by design) | ✓ |
| `node --test scripts/check-react-skew.test.mjs` | 0 fail | 10 pass / 0 fail | ✓ |
| `mise run changeset:check` | OK | OK (`router-per-mount-and-tanstack-alignment.md`, `web-push-notifications.md`) | ✓ |
| shell `pnpm vitest run` (once) | 0 fail | 585 pass / 0 fail, 40 files | ✓ |
| shell `pnpm lint` | 0 findings | 0 | ✓ |
| Real push delivery, Edge host, AC-7.7 deployed-pair, stored-href, L2-L4, ADR-0084 sign-off (AC-6.5) | recorded | not run | pending T12 (human) |

### E-1 status: CLEARED (environment fault, not a product defect)

Confirmed root cause as given by the caller: projects-ui resolved router 1.170.46 against 1.170.17 elsewhere, so the Module Federation
singleton gave the shell a second router. With all nine frontends on 1.170.46 and fresh Vite caches, `/notify` renders and the seven
previously failing `notifications.spec.ts` tests pass (13/13, twice). The remount tests of 85fcb037 are backed by the live
deep-link walk above (remounting a remote on a different deep link shows the right page). The earlier "two open tabs" flake did not recur in two full runs.
No new defects. Still true: the e2e start-up prints that `SERVICE_TOKEN_RATE_LIMIT` and `SERVICE_TOKEN_RATE_WINDOW_MS` are ignored; delete them from the local auth environment.
Test users created for the walk (`qe-e1r3@`, `qe-e1r3admin@`, `qe-ac43@operai.test`) remain in the local dev database; `qe-e1r3admin` holds the admin role locally.

## Round 2, first pass (after commits 8e1fd0a7 and 313cafaf; superseded by the E-1 re-run above where they differ)

| Check | Threshold | Actual | Result |
|---|---|---|---|
| D-4 component tests (`PushSettings.test.tsx`) | 7 removal sequences green | 38/38 pass in the file; the 7 sequences (first+last, last+last, first+first, middle+first, middle+last, last+first, all three down to the empty panel) pass | ✓ |
| D-4 tests detect the bug | red when the fix is removed | with the `key={loaded.focusSeq}` line blanked (temporary, reverted with `git checkout`, tree clean after), 3 tests fail: first+last, middle+first, last+first | ✓ |
| D-4 live, `/account`, real Chromium, 3 devices, keyboard and mouse (`r1/s17.mjs`) | focus on a row header after the 2nd removal | first+last, last+last, first+first: row header in all 6 runs (the case that gave BODY in round 1 is fixed in both modes) | ✓ |
| D-4 live, down to the empty state (`r2/s20.mjs`, 8 runs: first x3, last x3, first+last+last, last+first+first, keyboard and mouse) | focus on neighbour row header, then on the "No devices yet" heading | 8/8: row header after the 1st and 2nd removal, heading `H4 "No devices yet"` after the 3rd | ✓ |
| Remount does not move focus on Turn on / Turn off | focus stays on the toggle | Turn on: focus stays on the toggle (now "Turn off"); Turn off: stays on the toggle (now "Turn on"); a removal followed by Turn on: stays on the toggle. The device table DOM node is the same node across Turn on and Turn off (not remounted: `focusSeq` changes only in the removal path) | ✓ |
| Remount does not re-announce banners | banner node untouched, nothing re-added | across a second removal the status banner (`role=status`) is the same DOM node, 0 banner nodes added (MutationObserver on the section); the banner lives outside the keyed table | ✓ |
| shell `pnpm lint` | 0 findings | 0 | ✓ |
| shell `pnpm build` | builds | OK | ✓ |
| shell `pnpm vitest run`, 6 full runs | 0 fail | 6/6 green: 585 tests, 40 files each (578 in round 1 + the 7 new). The router.inventory / router.meetings flake did not appear in 6 runs | ✓ |
| auth `direnv exec . bun test` | 0 fail | 842 pass / 0 fail, 59 files | ✓ |
| notify-api `direnv exec . bun test` | 0 fail | 538 pass / 0 fail, 33 files | ✓ |
| `mise run changeset:check` | OK | OK (`.changeset/web-push-notifications.md`) | ✓ |
| e2e `push-notifications.spec.ts` | 3/3 | 3 passed | ✓ |
| e2e `notifications.spec.ts` | all pass | 3 passed, 7 failed on the live dev shell (see E-1 below) | BLOCKED (environment) |
| AC-4.3 full form: Notifications heading after the sign-in return | heading visible on `/notify` | URL part passes in `push-notifications.spec.ts`; the heading cannot render because `/notify` crashes | BLOCKED (E-1) |
| Real push delivery Chrome / Edge / Firefox (AC-2.1, 2.3, 4.1); OS click | received with Operai closed | not run | pending T12 (human) |
| Edge endpoint host (R3); AC-7.7 deployed-pair re-measure; stored-href check (T12); ADR-0084 go-live sign-off (AC-6.5); L2-L4 acceptance (T12) | recorded | not run | pending T12 (human) |
| Spec open question: exclude Meetings (AC-6.4) | answered | closed by commit 313cafaf: no origin excluded (spec.md and tasks.md updated). Recorded, nothing to execute | ✓ (recorded) |

### D-4 status: FIXED (missed earlier in round 1; round 2 adds no new defect)

Root cause as filed in round 1 (an unchanged `focusRowKey` re-runs no effect in `DataTable`) is addressed by `focusSeq`
(bumped by every removal, the device table keyed on it), so each removal is a fresh focus request. No other `focusRowKey` consumer
needed a change (placements checked in round 1: inventory RulesPage unique key per action, library stories demo-only).
Side effect to know about, not a defect: the table remounts per removal, so any state internal to `DataTable` is reset by a
removal; the table has no sort or selection state today, so nothing is visible.

### E-1: still present, BLOCKED (environment, no fix round)

- Observed now: `/notify` on :5173 shows "Something went wrong!" with `Cannot read properties of null (reading 'isServer')`
  (checked three ways: `r1/e1d.mjs` twice, and the error-context of `notifications.spec.ts:124`). `/account` and the other routes render.
- Why the restart did not clear it: the dev servers were restarted at 15:18, but the remedy was not applied. At the time of
  this pass `shell/node_modules/.vite` is still dated 13:32 and `projects-ui/node_modules/.vite` is still dated 11 Nov
  (neither was removed), and `projects-ui/node_modules/@tanstack/react-router` is still 1.170.46 while shell, notify-ui,
  meetings-ui, crm-ui and admin-ui have 1.170.17. QE did not restart or modify anything.
- Result of the e2e run: `notifications.spec.ts` 3 passed, 7 failed. Six of the failures open `/notify` and show that crash
  (AC-1.1/2.1 heading, AC-2.4, AC-3.x, AC-2.5, AC-6.2, AC-6.3). The seventh, AC-1.4/1.5 "two open tabs" (tab B badge stayed empty), does not
  open `/notify`; it passed 3 of 3 when re-run alone, so in the full run it was a flake of the same degraded shell or of load, not a defect (not
  attributable to 029, but it can only be closed with a healthy shell). Round 1 counted 5 failures; the AC-1.1 heading test now also fails, which fits
  an intermittent crash rather than a change in the branch (the branch changed only PushSettings, its model and tests since round 1).
- Exact remedy, for the environment owner: stop `mise run dev`; `rm -rf shell/node_modules/.vite projects-ui/node_modules/.vite`;
  `cd projects-ui && pnpm install --frozen-lockfile` and confirm `node -p "require('./node_modules/@tanstack/react-router/package.json').version"`
  prints 1.170.17 (if the lockfile really pins 1.170.46, that is a projects-ui dependency drift to fix by aligning its lockfile, a chore outside 029); restart `mise run dev`; check
  `/notify` shows "Nothing here yet" or the list; then re-run
  `cd shell && E2E_ESTIMAI_REMOTE_PORT=5174 E2E_REFUND_REMOTE_PORT=5175 E2E_NOTIFY_REMOTE_PORT=5176 E2E_ADMIN_REMOTE_PORT=5177 E2E_INVENTORY_REMOTE_PORT=5178 E2E_CRM_REMOTE_PORT=5179 E2E_MEETINGS_REMOTE_PORT=5180 E2E_PROJECTS_REMOTE_PORT=5181 pnpm e2e notifications.spec.ts push-notifications.spec.ts`
  (expected 13/13). Evidence the branch is not the cause stays as in round 1 (fresh dev servers of `main` and of the branch both mount `/notify`).
  The user may instead run that command once themselves on a healthy shell and report; that counts as `verified by: <who>, <date>`.
- Still true: the e2e start-up prints that `SERVICE_TOKEN_RATE_LIMIT` and `SERVICE_TOKEN_RATE_WINDOW_MS` are ignored; delete them from the local auth environment.

### Verdict logic

No ✗ remains: D-4 is fixed, every executable gate is green at 313cafaf. The one row that did not run is the E-1 e2e (and AC-4.3's heading
half), so the verdict is BLOCKED, not PASS. Once E-1 is cleared and the 13 e2e tests pass, the verdict becomes PASS (with the T12 rows
still listed as human gates before `PUSH_ENABLED=true` in production). The owasp-reviewer pass is already done (round 1 PASS).

# Round 1 (kept for the record; superseded where Round 2 says so)

Verdict at that time: FAIL at 3b157e12 (D-4; E-1 BLOCKED). Everything below is the round 1 text, unchanged, except that D-4 is now FIXED and the
Meetings open question is closed (see Round 2).

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
