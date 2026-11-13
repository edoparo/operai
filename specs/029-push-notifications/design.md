---
spec: 029
status: approved
approved: 2026-11-12
---

# Design: Push notifications

Scope: one new section on My profile (`shell/src/components/AccountScreen.tsx`, shell route
`/account`, ADR-0034) and the content rules of the OS system notification shown by the service
worker. Nothing else has UI: sign-out release, user switch, dead-device pruning and exclusion by
origin app (AC-2.6/2.7, 5.x, 6.2-6.5) are silent by design.

Method: `operai-ui/docs/building-pages.md` and `design-system.md` read first, then
`operai-ui/src/index.ts` and `AccountScreen.tsx`. Every part below is an existing `@operai/ui`
piece; the plan's "Turn on / Turn off" `Button` decision (no switch in the library) is kept.

## Flows

Surfaces: **S** = the My profile "Push notifications" section, **OS** = the system notification.

### F1 - Open My profile (US-1 AC-1.1/1.4/1.6/1.7, US-3 AC-3.1, US-6 AC-6.1)
Entry: UserMenu "My profile" -> `/account`. The section loads in two steps, in this order:
1. `GET /push/config`. While pending, the section renders **nothing** (no heading, no skeleton), so a
   deployment with push off never flashes a section that then disappears. `enabled:false` -> the
   section is absent from the DOM (AC-6.1); the address section is unaffected. A failed config
   request is NOT "disabled": the section renders with the load-failed Banner (state L-fail).
2. `GET /push/devices` (plus the local support/permission/subscription read in `push.ts`). Pending ->
   loading state; failure -> load-failed state; success -> "this browser" card + devices card.

"This browser" mode is derived once loaded (checks in this order):
| Mode | Condition | Shows |
|---|---|---|
| `unsupported` | AC-1.6 test fails | status "Not available" + explanation, no button |
| `blocked` | `Notification.permission === 'denied'` | status "Blocked" + explanation, no button (AC-1.4) |
| `on` | subscription exists, stored userId = me, deviceId in server list (AC-1.7) | status "On" + "Turn off" |
| `off` | everything else | status "Off" + "Turn on" (AC-1.1: no permission prompt on load) |

The browser's permission is never requested on load. A browser subscription whose row is missing from
the server list (removed from another browser, AC-3.2, or pruned, AC-2.7) is released on load and the
section shows `off`, with no UI announcement; it is never re-registered silently, and turning it on again
is the user's Turn on. (Amended 2026-11-13, D-9, T12: replaces a silent re-`PUT` of the missing row,
which brought a device removed from another browser back.)

### F2 - Turn on this browser (US-1 AC-1.2)
Entry: "Turn on" (a user gesture; required by Safari).
1. Button becomes busy, label "Waiting for your browser..." (the browser prompt is outside the page).
   The devices card's Remove buttons stay usable; the Turn on button ignores clicks while busy.
2. Granted -> subscribe -> `PUT /push/devices` (201/200).
3. Success exit: status flips to "On", button to "Turn off" (same button element, focus stays on it),
   the new device appears at the top of the list (newest first), a compact success Banner with
   `autoDismiss` says "Push notifications are on for this browser." (its `role=status` is the
   announcement; no second live region).
Error exits: see F3 (permission) and the error table (server/network). Every failure after a
browser subscription was created calls `subscription.unsubscribe()` first, so "no row on the server"
always means "no subscription in the browser" and the section returns to `off`.

### F3 - Permission refused, dismissed or already blocked (AC-1.3, AC-1.4)
- Prompt answered "Block" (permission now `denied`): section switches to `blocked`. Because the Turn on
  button disappears, focus moves to the blocked Banner (it carries `ref` + `tabIndex={-1}`, focused with
  `useFocusOnMount`), so focus is never lost to `<body>`. The Banner is `warning`, `live="polite"`.
- Prompt dismissed (permission still `default`, e.g. Esc or closing it): section stays `off`, "Turn on"
  stays and keeps focus, and a polite warning Banner says the browser did not allow notifications and to
  choose Allow when it asks. No device is recorded and nothing is sent to the server.
- Permission already `denied` on load: `blocked` immediately (AC-1.4), explanation as a static
  `warning` Banner (`live="off"`, `aria-label`), no Turn on.
- The permission may change in the browser while the page is open: `push.ts` re-reads it on
  `navigator.permissions` `change` (where supported) and on window focus; `blocked` -> `off` after the user
  allows it. No announcement for this passive change.

### F4 - Turn off this browser (AC-1.5)
Entry: "Turn off" (no confirmation: it is easy to undo - permission stays granted, so turning on again
does not prompt). Button busy "Turning off...". `DELETE /push/devices/{id}` then `unsubscribe()`. Success:
status "Off", button "Turn on" (same element, focus stays), the row leaves the list, compact success
Banner "Push notifications are off for this browser." Failure (network/5xx): stays `on`, danger Banner
"Couldn't turn off push notifications. Try again." and the "Turn off" button is the retry. A 404 counts as
success (already gone).

### F5 - Remove a device (US-3 AC-3.2)
Entry: "Remove" on a row (a plain button with `aria-haspopup="dialog"`) -> `ConfirmDialog tone="danger"`
(focus on Cancel). Two bodies: another device ("It will stop receiving push notifications. You can turn
them on again from that browser.") and this browser's row (same effect as F4: "This browser will stop
receiving push notifications. You can turn them on again at any time."), the latter also runs
`unsubscribe()` and flips the control to `off`.
- Confirm: `busy`, dialog not dismissible; success -> dialog unmounts, row gone, compact success Banner
  "Removed Chrome . macOS." (uses the device label).
- Failure: `ConfirmDialog.error` inline, dialog stays open, Confirm retries. A 404 is treated as success.
- Focus after success (the trigger no longer exists): next row's row header via `DataTable.focusRowKey`
  (previous row if it was last); list empty -> the empty `StatePanel` with `focusOnMount`; if the removed
  row was this browser and it was the only row, the empty panel wins and the Turn on button is the next
  tab stop.

### F6 - Errors while turning on (AC-1.2 failure exits)
All shown as a `danger` Banner directly above the button (an action failed and needs the person), and
none leaves a half-registered state (see F2). The Turn on button remains and is the retry.
| Cause | Banner text key |
|---|---|
| network / 5xx / unknown | `push.errors.generic` |
| 409 `device_limit` (20 devices) | `push.errors.deviceLimit` - tells them to remove a device below; focus does not move |
| 422 `endpoint_not_allowed` | `push.errors.endpointNotAllowed` |
| 503 `push_disabled` | `push.errors.unavailable` |
| browser `subscribe()` throws (push service unreachable, Chromium forks without push) | `push.errors.subscribeFailed` |
| 401 | no copy: `apiFetch` does its refresh/redirect (ADR-0001) |

### F7 - Browser without push (US-1 AC-1.6)
`unsupported` mode (any mobile/tablet browser or missing `serviceWorker`/`PushManager`/`Notification`):
status "Not available" and one sentence naming the supported browsers; no button, nothing else changes.
The devices card still renders (see gap G1) so a user can remove a lost computer from a phone.

### F8 - A notification arrives (OS surface; US-2 AC-2.1-2.5, AC-6.2)
Service worker `push` event, content rules (the server builds them; the worker only displays):
| Field | Rule |
|---|---|
| `title` | the notification's English title, verbatim, no prefix or suffix (the browser already shows the site origin) |
| `options.body` | the English body, verbatim; the server truncates with "..." to fit the byte budget; the worker never rewrites it |
| `options.icon` | the Operai mark (plan: `/operai.svg`; see gap G5 - Chrome/Edge/Safari need a raster icon) |
| `options.tag` | the notification id, so the same notification on the same browser never shows twice (AC-2.4) |
| `options.lang` | `"en"` always, whatever `<html lang>` is (AC-2.5) |
| `options.data` | `{ href }` only |
| not used | action buttons, `requireInteraction`, `renotify`, `image`, `badge`, vibration, sound |
| suppression | any visible window client of the shell origin -> show nothing (AC-2.3, ADR-0085) |
Payload carries nothing else (AC-6.2); the worker shows no recipient name or email.

### F9 - Click an OS notification (US-4)
Target = `href` (relative, same origin) or `/notify` when absent (AC-4.1/4.2). A shell window exists ->
focus it and `postMessage({navigate})` (the page calls `navigateSuite`); none -> `clients.openWindow`.
Signed out -> the shell's existing sign-in redirect returns to the target (AC-4.3, no new UI).
Clicking marks nothing read (non-goal).

### F10 - Silent flows (no UI, listed for traceability)
Sign-out release and user switch (AC-5.1/5.3), deactivated user (AC-5.2), dead-endpoint pruning
(AC-2.7), push failures (AC-2.6), origin exclusion (AC-6.4). After a prune or user switch, the next
visit to My profile shows `off`; the device simply is not in the list.

## Screens & states

One section appended after the "Home address" section inside `ToolLayout width="narrow"`. It is a new
shell component `PushSettings.tsx` (a composition of library parts, not a library component). Heading
levels: h1 "My profile" (ToolLayout), h2 per section (`PageHeader`), h3 per card.

```
<section aria-labelledby="account-push-heading" data-testid="account-push-section">
  PageHeader  title=push.heading  titleId=account-push-heading  description=push.description
  [one state, below]
```

State order of checks (building-pages step 2): config pending (render nothing) -> config disabled (render
nothing) -> devices loading -> load failed -> loaded.

| State | Render |
|---|---|
| config pending / `enabled:false` | nothing (AC-6.1) |
| loading devices | `VisuallyHidden live` `push.loading` + `SkeletonRows rows={2} actions={0}`, under the heading |
| load failed (config or devices) | `Banner tone="warning"` `push.loadError` with Retry (`onRetry`); the "this browser" control is NOT rendered (its `on/off` depends on the server list) except `unsupported` and `blocked`, which need no server state and render their card above the Banner |
| loaded | two Cards, below |

**Card 1 - "This browser"** (`Card title=push.thisBrowser`): a row with the status and the one button, a
one-line hint under it, and the Banner slot for feedback/errors. Layout utilities only.
| Mode | Status element | Button | Hint / Banner |
|---|---|---|---|
| `off` | `Badge` neutral "Off" | `Button variant="primary"` "Turn on" | hint `push.offHint` (says the browser will ask permission) |
| turning on | "Off" | same button `busy`, label "Waiting for your browser..." | - |
| `on` | `StatusBadge meaning="active"` "On" | `Button variant="secondary"` "Turn off" | hint `push.onHint` |
| turning off | "On" | busy, "Turning off..." | - |
| `blocked` | `Badge` neutral "Blocked" | none | static `Banner tone="warning" live="off"` `push.blocked` (same text after a refusal, `live="polite"`) |
| refused (dismissed) | "Off" | "Turn on" | `Banner tone="warning" live="polite"` `push.notAllowed` |
| `unsupported` | `Badge` neutral "Not available" | none | static text `push.unsupported` in `text-soft` (a fact, not a warning: no Banner) |
| error | unchanged | unchanged | `Banner tone="danger"` per F6 (cleared on the next attempt) |
| success | new mode | new mode | compact `Banner tone="success" autoDismiss` (F2/F4) |

A "Turn on"/"Turn off" label is a verb first, sentence case, no glyph. Status is never colour-only: the
word is always present; `StatusBadge active` carries its check glyph.

**Card 2 - "Your devices"** (`Card title=push.devices.title`; always rendered once loaded, in every mode):
- Loaded with rows: `DataTable` (`caption`, `rowTestIdPrefix="account-push-device"`, no sorting - the API
  returns newest first), columns:
  | Column | Content |
  |---|---|
  | Browser (`rowHeader`) | server label ("Chrome . macOS", proper nouns, not in the strings module) + `Badge` neutral "This browser" on the stored `deviceId` row |
  | Turned on | `formatDate(createdAt)` (dd.mm.yyyy, mono) |
  | Actions (header text via `VisuallyHidden`) | `Button size="sm" variant="secondary"` "Remove", `aria-label` = `removeLabel(label, date)`, `aria-haspopup="dialog"` |
  Max 20 rows, so no paging.
- Empty: `StatePanel title=push.devices.emptyTitle` + body (no action; Turn on is in the card above).
- Remove confirmation: `ConfirmDialog tone="danger"` (F5) with `testIdPrefix="account-push-remove"`.

Responsive: narrow column, three short columns; the DataTable's own keyboard-scrollable region covers
phone width. A phone shows the `unsupported` card plus this list.

## Component inventory

Library in use: **`@operai/ui`** (ADR-0050; from AGENTS.md and `AccountScreen.tsx` imports) with Tailwind
token utilities (ADR-0051). Nothing from Mantine/MUI.

| Element | Reuse | Note |
|---|---|---|
| Page frame | `ToolLayout width="narrow"` (already in `AccountScreen.tsx`) | unchanged |
| Section heading + description | `PageHeader` | h2, `titleId` for the section label |
| Two groups | `Card` x2 (h3 titles) | not nested |
| Status "Off / Blocked / Not available" and "This browser" marker | `Badge` neutral | metadata, not a domain status |
| Status "On" | `StatusBadge meaning="active"` | the dictionary's "accepted and in effect" |
| Turn on / Turn off / Remove | `Button` (`primary`, `secondary`, `secondary sm`, `busy`) | one primary in the section (Turn on) |
| Feedback and errors | `Banner` (`danger`, `warning`, `compact` + `autoDismiss` `success`) | Retry via `onRetry` |
| Loading | `SkeletonRows` + `VisuallyHidden live` | |
| Empty device list | `StatePanel` | |
| Device list | `DataTable` (`rowHeader`, `focusRowKey`) | 3 comparable columns |
| Remove confirmation | `ConfirmDialog` | `error`, `busy`, focus on Cancel |
| Dates | `formatDate` | never by hand |
| Focus on a blocked state | `useFocusOnMount` + `Banner ref` | no hand-written effect |

Ratio: **12 reuse : 0 NEW** (the shell-local `PushSettings.tsx` is a composition of the above, not a new
design-system component). No switch/toggle, no new Icon, no new token, no library change.
Note for implementation: confirm that `Banner` forwards `tabIndex` to its root; if not, that is a one-line
library addition (with test), not a hand-rolled focus wrapper.

## Copy (shell/src/strings.ts)

New `push` group in `en`; `it: typeof en` must be complete (parity test). Sentence case, product names
unchanged. `.` in a label below stands for the middle dot the server sends; the strings module never
contains it (labels come from the API).

```ts
// en
push: {
  heading: 'Push notifications',
  description: 'Get a system notification on this computer when Operai is not open. Push notifications are always in English.',
  loading: 'Loading push notification settings…',
  loadError: "Couldn't load your push notification settings.",
  retry: 'Retry',
  thisBrowser: 'This browser',
  status: { on: 'On', off: 'Off', blocked: 'Blocked', unavailable: 'Not available' },
  turnOn: 'Turn on',
  turningOn: 'Waiting for your browser…',
  turnOff: 'Turn off',
  turningOff: 'Turning off…',
  offHint: 'Your browser will ask for permission to show notifications.',
  onHint: 'This browser shows a notification when Operai is not open and visible.',
  unsupported: 'Push notifications are not available on this browser. They work on current desktop Chrome, Edge, Firefox and Safari on macOS.',
  blocked: "Notifications are blocked for Operai in this browser. Allow them in the browser's site settings, then reload this page.",
  notAllowed: "Push notifications weren't turned on because the browser didn't allow notifications. Choose Allow when it asks.",
  enabled: 'Push notifications are on for this browser.',
  disabled: 'Push notifications are off for this browser.',
  errors: {
    generic: "Couldn't change push notifications. Check your connection and try again.",
    deviceLimit: 'You already have 20 devices. Remove one below, then turn this browser on.',
    endpointNotAllowed: "This browser's notification service isn't supported, so push notifications can't be turned on here.",
    unavailable: 'Push notifications are switched off right now. Try again later.',
    subscribeFailed: "Your browser couldn't set up push notifications. Check that it allows push messaging, then try again.",
    turnOffFailed: "Couldn't turn off push notifications. Try again.",
  },
  devices: {
    title: 'Your devices',
    caption: 'Browsers that receive your push notifications',
    columnBrowser: 'Browser',
    columnSince: 'Turned on',
    columnActions: 'Actions',
    thisBrowser: 'This browser',
    remove: 'Remove',
    removeLabel: (label: string, date: string) => `Remove ${label}, turned on ${date}`,
    emptyTitle: 'No devices yet',
    emptyBody: 'Turn on push notifications in a browser and it will appear here.',
  },
  removeDialog: {
    title: (label: string) => `Remove ${label}?`,
    body: 'It will stop receiving push notifications. You can turn them on again from that browser.',
    bodyThisBrowser: 'This browser will stop receiving push notifications. You can turn them on again at any time.',
    confirm: 'Remove',
    busy: 'Removing…',
    cancel: 'Cancel',
    close: 'Close',
    error: "Couldn't remove this device. Try again.",
  },
  removed: (label: string) => `Removed ${label}.`,
}

// it
push: {
  heading: 'Notifiche push',
  description: "Ricevi una notifica di sistema su questo computer quando Operai non è aperto. Le notifiche push sono sempre in inglese.",
  loading: 'Caricamento delle impostazioni delle notifiche push…',
  loadError: 'Impossibile caricare le impostazioni delle notifiche push.',
  retry: 'Riprova',
  thisBrowser: 'Questo browser',
  status: { on: 'Attive', off: 'Disattivate', blocked: 'Bloccate', unavailable: 'Non disponibili' },
  turnOn: 'Attiva',
  turningOn: 'In attesa del browser…',
  turnOff: 'Disattiva',
  turningOff: 'Disattivazione…',
  offHint: 'Il browser chiederà il permesso di mostrare le notifiche.',
  onHint: 'Questo browser mostra una notifica quando Operai non è aperto e visibile.',
  unsupported: 'Le notifiche push non sono disponibili su questo browser. Funzionano su Chrome, Edge, Firefox e Safari per computer (macOS) aggiornati.',
  blocked: "Le notifiche sono bloccate per Operai in questo browser. Consentile dalle impostazioni del sito nel browser, poi ricarica questa pagina.",
  notAllowed: 'Le notifiche push non sono state attivate perché il browser non ha consentito le notifiche. Scegli Consenti quando lo chiede.',
  enabled: 'Le notifiche push sono attive su questo browser.',
  disabled: 'Le notifiche push sono disattivate su questo browser.',
  errors: {
    generic: 'Impossibile modificare le notifiche push. Controlla la connessione e riprova.',
    deviceLimit: 'Hai già 20 dispositivi. Rimuovine uno qui sotto, poi attiva questo browser.',
    endpointNotAllowed: 'Il servizio di notifiche di questo browser non è supportato, quindi qui non si possono attivare le notifiche push.',
    unavailable: 'Le notifiche push sono disattivate al momento. Riprova più tardi.',
    subscribeFailed: 'Il browser non è riuscito a configurare le notifiche push. Controlla che consenta i messaggi push e riprova.',
    turnOffFailed: 'Impossibile disattivare le notifiche push. Riprova.',
  },
  devices: {
    title: 'I tuoi dispositivi',
    caption: 'Browser che ricevono le tue notifiche push',
    columnBrowser: 'Browser',
    columnSince: 'Attivo dal',
    columnActions: 'Azioni',
    thisBrowser: 'Questo browser',
    remove: 'Rimuovi',
    removeLabel: (label, date) => `Rimuovi ${label}, attivo dal ${date}`,
    emptyTitle: 'Nessun dispositivo',
    emptyBody: 'Attiva le notifiche push in un browser e comparirà qui.',
  },
  removeDialog: {
    title: (label) => `Rimuovere ${label}?`,
    body: 'Smetterà di ricevere notifiche push. Potrai riattivarle da quel browser.',
    bodyThisBrowser: 'Questo browser smetterà di ricevere notifiche push. Potrai riattivarle in qualsiasi momento.',
    confirm: 'Rimuovi',
    busy: 'Rimozione…',
    cancel: 'Annulla',
    close: 'Chiudi',
    error: 'Impossibile rimuovere questo dispositivo. Riprova.',
  },
  removed: (label) => `${label} rimosso.`,
}
```

OS notification text is NOT in this module: title and body come from the server and are always English
(AC-2.5). The section's `description` says so, in the user's language, because the setting is the one
place that tells them the pushes will not match the language of the rest of Operai.

Test ids (prefix `account-push-`): `-section`, `-status`, `-toggle`, `-banner`, `-devices`,
`-device-<id>`, `-device-remove-<id>`, `-remove-confirm/-cancel/-error` (via `testIdPrefix`).

## Accessibility

Keyboard paths (all native `button` / library controls; no custom widgets):
- Tab order inside the section: Turn on/off button -> device rows' Remove buttons (top to bottom). The
  Retry button of a load-failed Banner precedes them when present. Enter/Space activates.
- `ConfirmDialog`: modal, Tab trapped, Escape and the backdrop close it except while busy, focus starts on
  Cancel and returns to the Remove button that opened it when the dialog is cancelled.

Focus management after async actions (the section changes under the user's hands):
| Action | Focus goes to |
|---|---|
| Turn on succeeds / Turn off succeeds | stays on the same button (label changes in place) |
| Turn on error or dismissed prompt | stays on the button |
| Turn on -> permission becomes `denied` (button removed) | the blocked Banner (`tabIndex={-1}`, `useFocusOnMount`) |
| Remove (another device) succeeds | next row's row header (`DataTable.focusRowKey`), else previous; empty list -> `StatePanel focusOnMount` |
| Remove (this browser) succeeds | as above; the control behind it flips to `off` |
| Remove fails | stays in the open dialog, error inline (`role="alert"`) |
| Retry in load-failed state | the loading state is announced; focus returns to the first control after load (Turn on/off, or Remove) only if focus was on the vanished Retry button |

Announcements: success feedback is the compact `Banner` (`role="status"`, polite) and is the only
announcement for that action; danger Banners are `role="alert"`; a refusal or blocked notice is polite
(`live="polite"`) because the person just acted and reads it in place, a static blocked/unsupported notice
is `role="note"` with `aria-label`; loading is a polite `VisuallyHidden live`. The button's busy state is
`aria-busy` with the "Waiting for your browser..." label (the browser prompt itself is announced by the
browser).

Names: Remove buttons carry `aria-label` "Remove Chrome . macOS, turned on 31.10.2026" - the date makes two
identical labels distinguishable; the visible text "Remove" is the start of the name (label in name). The
"This browser" Badge is plain text in the row header cell, not colour-only. Status "On/Off/Blocked/Not
available" is a word. The dialog title repeats the device label.

Contrast / tokens: only library components and `text-soft`/`text-text`; never `text-muted` for the hint
lines (fails AA). Both themes come from the library.

OS notification a11y: text only, no icons-as-meaning, no actions, no sound or vibration; the browser/OS
owns its presentation. Clicking is the only interaction, so keyboard and screen-reader access is the OS's.

Hotspots: (1) focus after Remove when the trigger disappears; (2) focus after Turn on turns into
`blocked`; (3) busy label while an out-of-page browser prompt is open; (4) duplicate device labels.

## Spec / plan findings (drift - reported, not designed around)

- **G1 - AC-1.6 vs AC-3.x.** AC-1.6 says an unsupported browser "offers no action"; AC-3.1/3.2 say the user
  sees and removes their devices. This design shows the list and Remove on unsupported browsers (the case
  of a lost computer, managed from a phone) and offers no *turn on* action. Needs a one-line spec
  clarification either way.
- **G2 - AC-1.3 wording.** "Refuses (or dismisses)... a message explains that notifications are blocked."
  A dismissed prompt leaves permission at `default` and is not blocked (the user can be asked again);
  telling them it is blocked is false and sends them to settings needlessly. Designed: `denied` -> blocked
  copy; `default` after the prompt -> "didn't allow", Turn on stays. Spec amendment recommended.
- **G3 - Config request failure is unspecified** (plan: `enabled:false` hides the section; a failed
  `GET /push/config` is neither). Designed as a load-failed Banner with Retry; the cost is a warning on My
  profile when notify-api is down. Also: "section absent" requires the config before the heading renders,
  hence nothing is drawn while config is pending.
- **G4 - Permission revoked in the browser while a server row exists.** The browser drops the subscription,
  the server row survives until the next send returns 410, so the list can show a device that is "this
  browser" in reality but has no marker (the stored id matches, the subscription is gone). Designed: the
  row keeps its "This browser" marker while the stored id matches and remains removable; the control shows
  `blocked`/`off`. Plan's reconcile text says nothing for this combination.
- **G5 - `icon: /operai.svg`.** Chrome and Edge do not render SVG notification icons reliably and Safari
  ignores them; a raster (e.g. a 192 px PNG of the mark, under `/`) is needed. Flagged for the R1/R2 spike;
  the design only fixes "the Operai mark".
- **G6 - Existing read-only guarantee on this page.** `AccountScreen.tsx`'s spec 012 AC-6.2 test asserts no
  interactive element exists inside `account-address-region`. The push section has buttons, so it must sit
  OUTSIDE that region (a sibling `<section>`), and the file's module comment about the screen being
  read-only needs updating. No contradiction as long as the region boundary is respected.
- **G7 - Failure modes the plan does not map to copy:** `subscribe()` throwing (Brave and other forks pass
  support detection but have push off), 422 `endpoint_not_allowed` for an unlisted push service, and a
  silent boot re-`PUT` failing (409/422): designed above; the third surfaces only as `off`. (Amended
  2026-11-13, D-9, T12: the boot re-`PUT` no longer exists, so the third case is gone; a missing row is
  simply `off`.)
- **G8 - Multi-tab.** Turning push on in one tab does not update an open My profile in another tab of the
  same browser until it reloads; acceptable, not designed. Mention only if QE reports it.
- **ACs with no UI surface:** AC-2.6, 2.7, 5.1-5.3, 6.2-6.5 (behaviour only).
- **UI added that no AC asks for (kept small):** the success Banners (required by design-system INC-19,
  "silence is not feedback") and the "always in English" sentence in the description (supports AC-2.5,
  expectation setting). Remove either if you want strict AC-only scope.

## Self-critique

One pass over the checklist: loading/empty/error states present for config, devices, turn-on, turn-off and
remove; zero NEW components; every flow maps to an AC (F1 AC-1.1/1.4/1.6/1.7/3.1/6.1, F2 AC-1.2, F3 AC-1.3/1.4,
F4 AC-1.5, F5 AC-3.2, F7 AC-1.6, F8 AC-2.x/6.2, F9 AC-4.x); a11y expressed as concrete focus and live-region
rules, not prose. Fixed in the pass: focus loss when the button vanishes, duplicate device labels, and the
failed-list state hiding a control that does not depend on the server.
