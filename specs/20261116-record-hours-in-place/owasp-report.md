# OWASP Top 10 review — Record hours in place, and the Week view of My hours

Spec: `specs/20261116-record-hours-in-place/` · Task: T14 · Branch: `feat/record-hours-in-place`
Reviewed: `git diff 72a2760e..HEAD -- hours-ui shell projects-ui crm-ui` at `fe516c2e` (93 files, frontend only; no
backend, `package.json`, lockfile, `vercel.json` or CSP file changed in the range — verified by `git diff --stat`).
Read against: `plan.md` § Security, § API contracts, Decisions 2 and 3; `spec.md`; `decisions.md`; ADR
`docs/adr/20261116-record-hours-widget-through-the-host-extension-seam.md`; hours-api's create path (read only).

## Verdict: PASS

PASS WITH NOTES on the reviewer's own scale (low-severity and informational items only). For the run trace:
`verdicts.security: "PASS"`, the notes below in `security.notes[]`. No finding is medium or higher, so there is no
defect to fix and nothing to re-check.

0 critical · 0 high · 0 medium · 2 low · 3 informational

## What was checked, and the evidence

### S1. `./RecordHours` widget: the only write is `POST /time-entries`, as the caller (A01, A04)

- The widget's whole API surface is two calls: `getTimeLists` (`hours-ui/src/RecordHours.tsx:66`) and `createEntry`
  (`:106`); the import line (`:8`) names nothing else, so no `updateEntry`, `deleteEntry` or `listEntries` is reachable from
  it. `RecordHours.test.tsx:441` ("writes only with POST /time-entries, once…") and `:674` ("no PATCH or DELETE") hold it.
- Every call goes through `apiFetch` (`hours-ui/src/lib/hoursApi.ts:67`, `readActivities` in
  `lib/activitiesRead.ts`), the shell's singleton: Bearer JWT in memory, attached only to `getTrustedOrigins()`
  (`shell/src/lib/session.ts:343`; hours-api and activities-api origins already trusted, unchanged). No cookie auth, so no
  CSRF surface.
- Author is never client input: hours-api's `POST` schema is `.strict()` and rejects `userId`
  (`hours-api/src/entries/schemas.ts` `CreateEntrySchema`; `entries/write.test.ts:294`), and the row is written with
  `userId = c.get("userId")` from the verified JWT (`entries.routes.ts:314,319`).
- **A forged `targetId` (or `activityId`) meets the owner's check.** Read-only verification of the unchanged backend:
  `POST` runs `validateWrite` then `askOwners` (`entries.routes.ts:315-316`) before `db.timeEntry.create`
  (`:317`). `askOwners` calls `assertBookable` (`:222`, `hours-api/src/targets/bookability.ts:44-117`), which asks
  projects-api / crm-api / activities-api / meetings-api **as the caller** (the caller's `Authorization` is forwarded unchanged,
  `clients/owner.ts:83`; 2 s timeout `:92`; `redirect: "error"`), and fails closed: owner silent, 5xx, malformed or
  incomplete answer → 503 `host_unavailable` (`bookability.ts:62,68,84,102`); unreadable or missing → one 404
  (`:64,69,86,108`); readable but not on the team / not involved → 403 `not_on_project` / `not_involved_in_deal`
  (`:70,116`). The activity pointer is likewise asked as the caller and must be about the same project or deal
  (`targets/activity.ts` `assertActivityOf`). Tests: `entries/bookability.test.ts:105-113` (403, nothing written),
  `:141-169` (every owner failure is 503, "never accepted unchecked").
- `checkProps` (`hours-ui/src/RecordHoursModel.ts:44-68`) refuses a malformed set by throwing (non-string members, unknown
  `on` / `placement`, a project or deal without `targetId`, other work carrying a target or a task, `activityName` with no
  `activityId`). Every message names the rule and never a value (`:46`, `RecordHoursModel.test.ts:52-54`: the secret name
  does not appear). The throw reaches the shell's boundary (`shell/src/lib/extensions.tsx:179-181`) and the hosts' `Contain`
  (`projects-ui/.../RecordHoursAction.tsx:37-42`, `crm-ui/.../RecordHoursAction.tsx:83-88`), which log `error` and
  `componentStack` only — rule text and component names, no props. No `console.*` exists in the widget or the Week code.
- Names render as React text: `targetName` / `activityName` appear in the dialog description as `{name}` in a `<span>`
  (`EntryDialog.tsx:114-124`), in the success message as a text node (`RecordHours.tsx:127`), in the fixed Activity field as a
  `FactList` value, and in `aria-label={t.buttonOn(activityName)}` (`:150`, an attribute, escaped by React). A repo-wide
  scan of the diff's non-test source and `operai-ui/src` finds no `dangerouslySetInnerHTML`, `innerHTML`, `eval`,
  `new Function`, `document.write` or `insertAdjacentHTML` (the hits are in test files only).
- "See in My hours" is a constant: `MY_HOURS_PATH = '/hours'` (`RecordHoursModel.ts:28`), used for `href` and
  `navigateSuite(MY_HOURS_PATH)` (`RecordHours.tsx:130,134`); no prop feeds it. A modified click is left to the browser
  (`:17-18`). `navigateSuite` is the shell's existing in-suite navigation (`session.ts:872`).
- Injection on the wire: ids reach URLs only as `URLSearchParams` values or `encodeURIComponent` path segments
  (`activitiesRead.ts`, `hoursApi.ts:entryPath`), and the body is `JSON.stringify` of `toInput`; hours-api's id rule
  (1..64, no NUL, no comma, no edge space, `lists/idRule.ts`) answers 400 to the rest.
- In a fixed dialog no picker exists, so no projects-api / crm-api / meetings-api search runs (`EntryDialog.tsx:393-445`);
  `ActivityField` in `fixed` makes no read (`ActivityField.tsx:77,93`). The widget talks to hours-api and, for the
  optional Activity select on a page, activities-api, as the person.

### S2. `hours.recordHours` across the seam: only what the host shows, nothing back (A01, data minimisation)

- Contract is six strings (`shell/src/lib/extensions.tsx:44-57`), mirrored by hand in crm-ui and projects-ui
  `remotes.d.ts`; the shell test pins the exact key set (`shell/src/lib/extensions.test.tsx:307-324`).
- The props are built per host from one object: project and task `projects-ui/src/lib/recordHours.ts:48-73`; deal
  `crm-ui/src/lib/recordHours.ts:30-39`, task `:63-83`. What crosses is an id plus the name the page or row already
  displays (the CRM row shows `activity.deal?.title`, `crm-ui/src/components/ActivityItem.tsx:97`) and a task subject used
  only for the button's accessible name (and, for other work, never sent: `presetOf`, `RecordHoursModel.ts:78`). No amounts,
  notes, financials, people or hours data cross.
- Nothing flows back: the type has no function member, the widget has no `onSaved`, and the diff contains no
  `dispatchEvent`, `CustomEvent`, `postMessage`, `BroadcastChannel`, storage write or global assignment. After a save the
  host is not told (`RecordHours.test.tsx:664`).
- The hosts' rule is UX only, and says so: `mayRecordOnProject` / `mayRecordOnTask` (`projects-ui/.../recordHours.ts:30,85`)
  and `mayRecordOnDeal` / `mayRecordOnTask` (`crm-ui/.../recordHours.ts:21,47`) only decide whether a button renders; the
  doc comments and ADR "Failure shape: show versus accept" state that hours-api decides every save. Nothing in the diff
  reads these predicates for an authorization decision, and a wrong rule costs a missing shortcut or a refused save
  (403 `not_on_project` / `not_involved_in_deal`, shown with My hours' words, `EntryDialogModel.ts:475-479`).
- A deployed-skew failure degrades to a fixed link (`<a href="/hours">`), not to an open path.

### S3. The Week view: own hours only, an address with a day and filter ids, unreadable names never drawn (A01, A02/privacy)

- Read scope: `weekFilters = { ...applied, from: monday, to: sunday }` where `applied.whose` is the literal `'mine'` and no
  `userId` or `meetingId` is ever set (`MyHoursPage.tsx:194-208`); the read is `readAllEntries(filters)` →
  `listEntries` over the allow-listed filter names (`lib/exportPages.ts:33-52`, `hoursApi.ts:37-63`). The oversight path
  (`whose=all`, `userId`) is not reachable from this page; `MyHoursPage.week.test.tsx:196-203,249,416-455,647` assert `whose: 'mine'`
  on every Week read. hours-api scopes `whose=mine` to the verified `sub`, and a `userId` or `whose=all` needs `time-entry:read-all`, else 403 (`hours-api/src/entries/list.routes.ts:5,107-108,124,151`); someone else's entry on a write is a 404 (`entries.routes.ts:342`).
- Edit and Delete in the cell dialog reuse the List's `updateEntry` / `deleteEntry` (`MyHoursPage.tsx:481-516`);
  hours-api addresses the row by id and owner in the statement itself (`entries.routes.ts:351-355,377`).
- Address: `view=week` and `week=YYYY-MM-DD` (`HoursFiltersState.ts` `readView` / `withView` / `withWeek`, `lib/week.ts`
  `readWeekParam`), plus the pre-existing `period/from/to/target/category/workType/group` ids. The picked project and deal
  stay in memory (`MyHoursPage.tsx:159-160`). No note, name or label enters a URL; a pasted `week` that is not a real day,
  or `view` other than `week`, is ignored (`week.ts:readWeekParam`, `readView`), and neither value is rendered.
- Unreadable names: `weekGrid` takes a label only from an entry with `visibility: 'visible'`, makes the row `hidden` if any entry
  says so (`weekGrid.ts:77-95`), and gives no `preset` (no Add hours) to a nameless or retired row. The row label, the
  button names and the cell dialog title go through the List's own `rowName` / `onPhrase` fed an `EntryOn` made from the
  row (`WeekViewModel.ts:34-56`), with `href: null`. The cell dialog's entries are the List's `EntryRow`, whose link passes
  `suitePath` (`names.ts:21`: a rooted path only, no scheme, host or backslash). A server label sent with a hidden row is
  asserted absent from the DOM (`WeekView.test.tsx:307,361`; `WeekCellDialog.test.tsx:109-110`). Meeting hours stay on
  the meeting's row and the Week never joins on a deal (`weekGrid.ts:61-65`), so the Week cannot reveal a meeting's deal
  link the viewer may not read.
- A deal filter that meetings-api cannot answer is a refusal state, never a short grid
  (`MyHoursPage.tsx:244-250,520-521`), and a failed page of the walk is an error, never a partial grid (`exportPages.ts`).
- AC-5.24 (no Add hours on an unreadable or retired row) is a UX rule; the server independently refuses a save on a
  target the person cannot read (404) or is not on (403).
- No storage: no `localStorage`, `sessionStorage`, `indexedDB`, `caches` or service-worker use in the diff; the week's
  entries live in component memory only.

### S4. Origins, CSP, dependencies, secrets, logs

- No new origin and no CSP change: `shell/vercel.json` is not in the diff. Its `connect-src` / `script-src` already name
  `hours-api.operai.welld.io`, `hours.operai.welld.io` and `activities-api.operai.welld.io`, with no wildcard and
  `frame-ancestors 'none'`, `object-src 'none'`. The widget is a new `exposes['./RecordHours']` entry of the already-trusted
  hours remote (`hours-ui/vite.config.ts:44`; `exposes.test.ts` pins exactly three). `RecordHours.graph.test.ts` pins that
  its import graph carries no `exceljs`, export, page, app or router.
- No dependency change (`package.json` and lockfiles untouched in all four apps): nothing for A06/A08.
- No secret, token, key, e-mail address, phone or IBAN in the 12 180 added lines of the four apps, nor in the added
  spec / ADR / AGENTS lines. Fixtures use fictional names (Ada Lovelace, Grace Hopper, Bea Meier, Project Alpha) and
  non-routable `*.test` origins.
- No new log line besides the two `console.warn` of the hosts' boundaries (error + component stack, see S1).

### OWASP categories with nothing to report

A02 (no crypto, no sensitive data stored client-side), A05 (no config change; CSP and CORS untouched; hours-api's
default-deny session guard `src/index.ts:66`, body cap, and log-path-only logger are unchanged), A06, A07, A08 (federated
entry on an already-trusted, CSP-allowed origin), A09 (no log of values), A10 (no request is built from a prop; the one
link is a constant).

## Findings

None at medium or above. Nothing to fix before close.

## Notes (low-severity and informational; for `security.notes[]`)

**[N1 — LOW, A04 defence in depth]** `projects-ui/src/components/RecordHoursAction.tsx:98`
`projects-ui` forwards its whole React props object to `HostExtension` (`props={props}`), whereas crm-ui rebuilds exactly
six members (`crm-ui/src/components/RecordHoursAction.tsx:123`) and pins it with a test "whatever else the caller spreads in"
(`crm-ui/.../RecordHoursAction.test.tsx:72-78`). decisions.md T6 records "only six plain strings cross the seam" as the
guarantee. Exploit scenario: none today, because all three call sites spread `recordHoursPropsOf(...)` typed as
`RecordHoursProps`, the widget ignores extra keys, and the seam is in-memory, same-origin. A future call site that spreads a
wider object (for instance a project with its note) would carry that data across the seam and into the boundary key
`JSON.stringify(props)` (`shell/src/lib/extensions.tsx:155`).
Fix (optional): destructure the six and rebuild them as crm-ui does, and add crm-ui's exact-keys test to projects-ui:
```tsx
export default function RecordHoursAction({ on, targetId, targetName, activityId, activityName, placement }: RecordHoursProps) {
  // …
  const props: RecordHoursProps = { on, targetId, targetName, activityId, activityName, placement }
```

**[N2 — LOW, A04 / integrity of the confirmation]** `hours-ui/src/RecordHours.tsx:101-102,106`
The success message names the host-supplied `targetName`, and the `201` body (`on.label`, resolved by hours-api from the owner)
is discarded. This is the ADR's own recognised shape ("a success message that names a target the server never
confirmed"; § Negative: "The widget cannot verify that `targetName` matches `targetId`"). It is accepted and mitigated by
R10: both props come from one object per host (`recordHoursPropsOf`, tested). Exploit scenario: only a host bug or a
compromised host could show one name over another id, and a compromised host already runs same-origin with the person's
`shell/session` and could call hours-api directly, so no privilege is gained. Fix (optional hardening): keep the response of
`createEntry` and prefer its label when `on.visibility === 'visible' && on.label !== null`, falling back to the prop.

**[N3 — INFORMATIONAL]** `hours-ui/src/components/WeekView.tsx:109,120,135,193-195`
Rows whose name is withheld still carry the target's id in DOM attributes (`data-cell="project:<id>:<day>"`,
`data-testid="hours-week-row-project:<id>"` through `DataTable.tsx:139`) and as the React key. No name is rendered
(`WeekView.test.tsx:307,361`). The id is that of the person's own entry (time-tracking D44, the same value as in their
`GET /time-entries` answer), so nothing new is disclosed. The no-id guard (`WeekView.test.tsx:350-351`) scans text and
`aria-label` only; design G6's "no id" is met on screen, not in attributes. If a strict "no id in the DOM" posture is wanted,
key the row and its cells by index in `WeekView`. No action required.

**[N4 — INFORMATIONAL, availability]** `hours-ui/src/lib/exportPages.ts:33-52`
`readAllEntries` has no page ceiling, so a person who recorded thousands of entries in one week makes the Week walk many
500-row pages. The data is their own (`whose=mine`), a repeated cursor stops a loop, and plan R7 states the walk is the
rule. Self-inflicted only; no action.

**[N5 — INFORMATIONAL, for QE]** `hours-ui/src/pages/MyHoursPage.weekCells.test.tsx:641`
`cellButton('project:unknown', …)` is vacuous for a hidden project that carries an id (its key is `project:p-secret`); the
decisions.md T12 finding. AC-5.24 is still held by the name query on line 642 (`/^Record hours on .*(Seminars|not visible
to you)/` finds no button) and by `WeekView.test.tsx` / `WeekCellDialog.test.tsx`. The rule is UX; hours-api refuses the
save regardless.

## How this was verified

- Read the whole non-test diff of the four apps, plus hours-api `entries.routes.ts`, `schemas.ts`, `targets/bookability.ts`,
  `targets/activity.ts`, `clients/owner.ts`, `lists/idRule.ts` and `index.ts` (read only; hours-api tests were not run, since
  backend tests truncate the local dev databases).
- Scans over the added lines (12 180) and over the non-test source for: XSS and DOM sinks, `href` / `location` built from
  data, selectors built from data, client storage, cross-window messaging, event channels back to a host, `console.*`,
  tokens, keys, e-mail addresses, personal names, non-test origins.
- Ran the frontend tests that carry these claims, all green: hours-ui `RecordHoursModel`, `RecordHours.graph`, `weekGrid`,
  `week` (4 files, 99 tests); `RecordHours`, `RecordHours.it`, `WeekView`, `WeekCellDialog`, `MyHoursPage.week`,
  `MyHoursPage.weekCells` (6 files, 248 tests); projects-ui record-hours files (8 files, 76 tests); crm-ui (6 files, 63
  tests); shell `extensions.test` (20 tests).

## Not covered

- `shell/e2e/hours-in-place.spec.ts` (T13) is not in this diff, so the journey-level proof that a forged id is refused
  end to end is carried by hours-api's own suite (`bookability.test.ts`) and by the widget's component tests
  (`RecordHours.test.tsx:464-496`, 403 / 404 / 503 shown with My hours' words), not by an e2e run.
- The CSP was read from `shell/vercel.json`, not probed on a deployed shell.

---

## Follow-up 2026-11-17 (fix round 1)

Scope: `git diff 8903ad1b..HEAD -- operai-ui/src hours-ui/src crm-ui/src projects-ui/src shell/src ':!*.test.ts' ':!*.test.tsx'` at
`15078f57` (12 production files, +160 / -26; the round's reasoning is `decisions.md` "QE round 1 …"). Read against the first
pass above and its notes N1-N5. Frontend only: `git diff --name-only 8903ad1b..HEAD` lists no backend file, `package.json`,
lockfile, `vercel.json` or `shell/src` file, so no new origin, CSP change or dependency (A05, A06, A08: nothing).

### Verdict: PASS

For the run trace: `verdicts.security: "PASS"`; the two informational notes below go in `security.notes[]`. N1 of the first
pass is fixed. No finding is medium or higher, so there is no defect to route.

0 critical · 0 high · 0 medium · 0 low · 2 informational

### What was checked, and the evidence

**F1. N1 is fixed: projects-ui passes exactly six strings (A04, data minimisation).**
- `projects-ui/src/components/RecordHoursAction.tsx:64-71` now destructures `{ on, targetId, targetName, activityId,
  activityName, placement }` instead of taking the caller's `props`; `:106` rebuilds `const props: RecordHoursProps = { on,
  targetId, targetName, activityId, activityName, placement }` and `:109` is the only thing handed to `HostExtension`
  (`<HostExtension name="hours.recordHours" props={props} …>`). Nothing else of the caller's object is reachable on that side
  of the seam, so it can no longer reach the shell's boundary key `JSON.stringify(props)` (`shell/src/lib/extensions.tsx:155`)
  or the widget. The six match the contract (`extensions.tsx:45-57`) and crm-ui's rebuild (`crm-ui/.../RecordHoursAction.tsx`,
  unchanged).
- The test that pins it: `projects-ui/src/components/RecordHoursAction.test.tsx:80-91` ("passes nothing but the six plain
  strings across the seam, whatever else the caller spreads in (OWASP N1)") asserts the sorted key set of what the widget received.
  Ran it: `RecordHoursAction.test.tsx`, `TasksCard.reload.test.tsx`, `MyTasksPage.keepsRows.test.tsx` = 3 files, 15 tests, green.
- The type is still erased at runtime, which is why the rebuild (not the `RecordHoursProps` annotation) is what closes it.

**F2. No change alters how a save or delete is sent, or as whom (A01, A04).**
- Not in the diff: `hours-ui/src/RecordHours.tsx`, `lib/hoursApi.ts`, `lib/activitiesRead.ts`, `RecordHoursModel.ts`, `shell/src/lib/session.ts`
  (the `apiFetch` that attaches the Bearer JWT to trusted origins). Author is still never client input (hours-api `.strict()`
  schema, first pass S1), and a forged `targetId` / `activityId` still meets the owner's check as the caller before any row is
  written (first pass S1; backend untouched).
- `EntryDialog.tsx`: the request is built only at `:279` (`toPatch`) and `:288` (`toInput`), both unchanged, behind the same
  `if (busy) return` (`:268`) and `validate` gate. The round touches the `catch` only: `failureOf(…, fixed, taskFixed)` (`:290-295`)
  and `askFocus(Object.keys(failure.fields).length > 0)` (`:301`). `taskFixed = fixed && presetTask !== null` (`:217`) comes from the
  host's props, not from a server answer.
- `failureOf` (`EntryDialogModel.ts:446-499`) is a pure mapping from an error code to one of the dialog's own fixed strings. The new
  `taskFixed` branch for `activity_not_allowed` (`:478-482`) picks the form-level alert instead of the field, with the same
  string `t.activityNotAllowed[kind]`. No server `message` / `detail` / label is rendered; the default stays `generic`.
- Focus handling is the only new behaviour, and it moves focus without activating anything: `EntryDialog.tsx:259-262` calls
  `focusFirstInvalid` (returns a boolean, `operai-ui/src/components/Field.tsx:251`) and, when no field is invalid, `.focus()`
  on `body.current?.closest('form')?.querySelector('button[type="submit"]')`; `DeleteEntryDialog.tsx:48-53` does the same for Confirm. Both
  selectors are constants (nothing data-derived). They hit the intended button: the library's `Button` defaults to
  `type='button'` (`Button.tsx:61`), and the only `type="submit"` in `ConfirmDialog` / `FormDialog` is Confirm / Save, which sits last in the form.
  A second Confirm or Save is a fresh, explicit activation through the same `confirm` / `submit` and the same `busy` guard
  (`DeleteEntryDialog.tsx:56`); a repeated DELETE of an entry that already went is the page's "already gone" success (`DeleteEntryDialog.tsx:9-13`,
  the prop's doc comment), and Cancel still takes focus when the dialog opens (`ConfirmDialog.tsx`, `initialFocusRef={cancelRef}`),
  so the destructive button is focused only after the person has pressed it and seen the refusal.
- `MyHoursPage.tsx:603` `onRetry={retryAll}` (was `week.reload`): `retryAll` (`:262-271`) in the Week calls `week.reload()` only. The
  read is still `weekFilters` with the literal `whose: 'mine'` and no `userId` (first pass S3); no oversight path became reachable. `WeekView.tsx:315-320`
  `focusRetry` queries the constant selector `[role="alert"] button`.
- The other hours-ui edits are inert for security: the Week row-label floor (`min-w-28`), an `aria-hidden` scroll hint with a fixed string,
  and the Italian success message `Hai registrato ${duration} su ${name}.` (`strings/recordHours.ts`), still drawn as a React text node
  (`RecordHours.tsx:127`, unchanged), never as HTML.
- `hours-ui/src/test-support/focusFixup.ts` (new, uses `MutationObserver` and `document.body`) has no non-test importer (grep), so it
  is not in any bundle.

**F3. `@operai/ui` `ListRows` keying: a row key cannot be steered to matter, and the new keying closes a state-carrying hole (A01, A04).**
- Change: `ListRows.tsx:24-28` keys each `<li>` by the key `Children.toArray` gives the child (`.$<id>` for a keyed element, `.<n>`
  for an unkeyed one, so it is position-based exactly as before) and by `index` only for text.
  A React key is never written to the DOM and never parsed; `toArray` escapes `/` in it. There is no injection or selector surface.
- All 17 `<ListRows>` call sites (estimai-ui 2, refund-ui 5, inventory-ui 2, crm-ui 2, projects-ui 2, hours-ui 2, meetings-ui 1,
  notify-ui 1; the `LinesCard` wrapper's one caller, `ReviewDetailPage.tsx:405-479`, maps `key={line.id}`) key by a server-assigned
  primary key of one result set: `row.id`, `task.id`, `item.id`, `entry.id`, `assignmentId`, `assetId`, `line.id`, collaborator `row.id`. The
  browser cannot choose one: crm-ui's `ActivityInput` has no `id` (`activitiesApi.ts:28-40`), hours-api's create schema is `.strict()`
  (first pass S1), and a primary key cannot repeat inside one answer. hours-ui's paged List cannot repeat a row across pages
  either (hours-api's keyset cursor orders by `day desc, createdAt desc, id desc`, `list.routes.ts:7`; `useHoursPages` appends pages).
  So the only rows ever sharing a list are records the same viewer was already sent.
- "State or a dialog carried to another record's row": this is what the OLD index key allowed (state of slot *i* stayed when the record in
  slot *i* changed). The new key makes a row's state follow its own record, and a row that leaves unmounts with its state. The
  record-specific dialogs also hold the record by value above the row (`TasksCard.tsx` `editing`, `ActivityTimeline.tsx` `composing`),
  and the Record hours widget is behind `ExtensionErrorBoundary key={JSON.stringify(props)}` (`extensions.tsx:155`), so a change of
  target or task remounts it whatever the row does.
- Because `@operai/ui` is the shell's Module Federation singleton, the change reaches all nine apps when the shell deploys; the call-site
  review above is why that is safe. Ran `operai-ui` `ListRows.test.tsx` (9 tests), green.

**F4. `cacheKey` in crm-ui `ActivityTimeline` and projects-ui `TasksCard`: no data across targets or pages; across a user switch it holds only as before (A01).**
- Keys name the whole of the fetcher's inputs, which are the `useCallback` dependencies: `TasksCard.tsx:83`
  `project-tasks:${JSON.stringify([project.id, view, page])}` for `[project.id, view, page]` (`:78`); `ActivityTimeline.tsx:46`
  `crm-activities:${JSON.stringify([key, page])}` for `[key, page]` (`:41`), where `key = JSON.stringify(target)` and
  `ActivityTarget` is exactly one of `{companyId}` / `{contactId}` / `{dealId}` (`activitiesApi.ts:26`), so a company, a contact and a deal
  with the same id never share an entry. JSON-encoding makes the key unambiguous (no separator injection); the prefixes are distinct
  from every other key in the same app's cache (crm-ui `contacts:` `companies:` `crm-tasks:` `pipeline:` `company-owners`; projects-ui
  `projects:` `my-tasks:` `project-managers`), and the cache is per app bundle (`hooks/useResource.ts:35`, a copy in each app).
- `useResource` only shows a remembered answer for the same fetcher or the same key (`useResource.ts:93-104`), so switching
  project, tab, page or target goes to that key's own entry or to `loading`. Writes `cache.set` only on success (`:62`); a failed
  re-read is `status: 'error'` with `data: null` (`:82-90`), so a project the person has lost (403 / 404) never keeps showing
  rows past one request. Row buttons that follow cached `may` flags are a UX convenience for that one request; activities-api asks the
  host as the caller on every write (AGENTS.md, ADR 20261110-activities-service-access-delegated-to-host).
- Sign-out and session loss end the document, which empties the cache: `signOut` ends with `window.location.href = <auth>/sign-in?…`
  in a `finally` (`shell/src/lib/session.ts:793-818`), and a failed refresh after a 401 calls `redirectToSignIn` →
  `window.location.assign` (`:378-381`). Module-scope caches (`useResource.ts:35`) and the in-memory JWT do not outlive it, and the sign-in
  and the return are new documents.
- Ran `TasksCard.reload`, `MyTasksPage.keepsRows` (projects-ui) and `ActivityTimeline.keepsRows`, `TasksPage.keepsRows` (crm-ui) = 4 files, 20 tests,
  green; `DeleteEntryDialog.focus`, `EntryDialog.fixedActivityRefusal`, `EntryDialog.refusalFocus`, `EntryDialogModel.preset`, `RecordHours`,
  `RecordHours.it` (hours-ui) = 6 files, 184 tests, green.

### Findings

None at medium or above. Nothing to fix before close. First-pass notes: **N1 fixed** (F1). N2, N3, N4, N5 are unchanged by this
round (`RecordHours.tsx`, `weekGrid.ts`, `exportPages.ts` and the cell tests are not in the diff) and keep the status given above.

### Notes (informational; for `security.notes[]`)

**[I1 — INFORMATIONAL, A01 / A04: the per-app answer cache is not keyed by the principal]** `projects-ui/src/components/TasksCard.tsx:83`,
`crm-ui/src/components/ActivityTimeline.tsx:46`, `*/src/hooks/useResource.ts:35`
The two new cached surfaces (task lists of a project, activity timelines of a company, contact or deal) join eight that already
exist (`my-tasks:`, `crm-tasks:`, `pipeline:` with money, `companies:`, `contacts:`, `projects:`, …). The cache is in memory for
the life of the document and its key carries no `sub`. Isolation is the document boundary (F4): every sign-out, 401 or return from sign-in is a new document.
Residual scenario, not new and not introduced here: the cookie session is changed in another tab while this tab stays open; once this
tab's in-memory JWT is refreshed from the cookie (`session.ts:350-371`) as the other person, a revisit shows the previous person's
last answer for a target until the revalidation lands, then the new answer or an error replaces it. That needs the same browser
profile, the previous page was already on that screen, and the shell's session and permission caches behave the same way, so nothing new
is disclosed. Fix (optional, one place): a `sub` in the shell's identity that each remote clears its cache on (`onSignOut(clearResourceCache)`
already exists as a pattern in `session.ts:667-683`), or `sub` in the key. No action required for this feature.

**[I2 — INFORMATIONAL, A04 integrity: `ListRows` trusts its callers' keys to be unique]** `operai-ui/src/components/ListRows.tsx:27`
Before, the `<li>` key was the index, which never repeats; now it is the caller's key. React answers a duplicate with a warning in
development, and in production a row can be drawn twice or left out after the list changes. Today this cannot happen: all 17 call sites
key by the primary key of a single answer (F3) and `decisions.md` records "no guard for duplicate child keys". Exploit scenario: none
without a future caller that keys a merged list by a non-unique value (a name, or ids from two services), which on an approval
list (refund-ui `ReviewQueuePage`) would hide an item. Fix (optional): keep the sentence added to `operai-ui/docs/design-system.md` ("give each row a key
that names its record") and, when a list is ever merged from two sources, prefix the key with its source.

### How this was verified

- Read the whole non-test diff of the range (12 files), plus `ConfirmDialog.tsx`, `FormDialog.tsx`, `Button.tsx`, `Field.tsx`
  (`focusFirstInvalid`), `useResource.ts` of both apps (byte-identical to each other and not in the diff), `session.ts` sign-out and 401 paths,
  `extensions.tsx`, all 17 `ListRows` call sites and the cursor/paging code of hours-ui and hours-api (read only).
- Scans of the diff for `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `localStorage` / `sessionStorage`, `postMessage`, `console.*`, selectors built
  from data, new origins and credentials: none in production code. The new e2e files (`shell/e2e/hours-in-place.spec.ts`,
  `helpers/hoursFixtures.ts`, not in scope of this diff) were grepped only: they use the existing gated session helpers, `@operai.test`
  addresses and localhost defaults, and no credential is written in them.

### Not covered

- The focus behaviour was proven against `test-support/focusFixup.ts` (jsdom emulation of the browser's focus fixup) and the QE's measurement,
  not re-measured in a browser; it has no security effect either way (focus only, no activation).
- The e2e journeys and hours-api's own suite were not run (they need the stack, and backend tests truncate the local dev databases).
