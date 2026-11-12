---
id: 029
slug: push-notifications
status: approved
rigor: production
created: 2026-11-11
approved: 2026-11-12
---

# Push notifications

Approved 2026-11-11; re-opened 2026-11-12 to add US-7 and amend AC-5.2 (user decisions after QE round 0), then amended the same day to fix the US-7 figures and the invalid-credential rule (user decisions). Re-approved 2026-11-12 by Matteo Codogno with the open questions below accepted as risk.

## Problem

Operai tells a user that something happened in three ways today: a toast and the bell
while an Operai tab is open (specs/005), the notification center the next time they look,
and an email for the few notifications that ask for one (ADR-0056). A user who has closed
Operai therefore learns about a time-sensitive event — a refund to approve, a deal handed
over, a meeting summary ready — only when they come back or read their inbox. The toast
exists precisely because these events are time-sensitive, yet it reaches nobody who is not
looking at Operai at that moment. wellD wants the notifications Operai raises for a user
to appear as a system notification on the user's computer even when Operai is closed.

> Amended 2026-11-11 during planning: the approved draft pushed only toast-worthy
> notifications, but every notification another service raises (`/system/notifications`)
> is stored as not toast-worthy, so it would have pushed nothing. The user chose: every
> notification is pushed (AC-2.1, AC-2.2).

> Amended 2026-11-12 after QE round 0 (defect D-1): push needs one lookup of the
> recipient's account per notification, and that lookup, together with every service's
> request for its own service credential, goes through two `auth` endpoints whose refusal
> limit is counted per caller address — 20 requests per 10 minutes by default
> (`auth/src/lib/env.ts:139-140`, `auth/src/system/serviceToken.routes.ts:125-128,196-197`,
> `auth/src/system/userContact.routes.ts:124-130`). In production every service reaches
> `auth` over the private network without a forwarded address, so all of them count as one
> caller (plan.md § Design decisions, activity check): the whole suite shares one allowance
> of 20 — about the 17–20 credential requests it already makes at steady state — and the
> live QE run saw lookup 20 of 30 refused. Without a fix, push and the existing email
> notices (ADR-0056) stop after about 20 notifications in 10 minutes, so the fix (US-7) is
> in scope here; the user decided to include it in this feature.

## Domain language

- **push notification** — a system notification shown by the operating system or browser
  on one of the user's devices, outside any Operai page. Every push notification is a copy
  of a persisted notification (specs/005); there is no push that exists only as a push.
- **push device** — one browser on one computer on which a user has turned push
  notifications on. A user may have several; each is turned on and removed independently.
- **toast-worthy** — the existing flag that marks a notification as time-sensitive and
  shows it as a toast (specs/005 US-5). It plays NO part in push: every notification is
  eligible (amended 2026-11-11, see Problem).
- **calling service** — a suite service that has proven its identity to `auth` with its own
  service credential (`service client`, ADR-0044/0049). A request whose credential does not
  verify has no calling service.
- **allowance** — how many requests of one kind `auth` accepts in a 10-minute period before
  it refuses the next ones. In US-7 there is one per calling service and endpoint (300
  service-token requests, 600 contact lookups), and a separate, smaller limit on requests
  whose credential does not verify (AC-7.5) that never applies to a verified calling service.

## User stories

### US-1: I turn push notifications on for this browser

As a signed-in user, I want to turn push notifications on for the browser I am using, so
that Operai can reach me there when it is closed.

**Acceptance criteria:**
- AC-1.1: Given a signed-in user on a browser that offers push (see AC-1.6) who has not
  turned push on for it, when they open My profile (`/account`), then they see a push
  setting for "this browser" in the off state, and the browser has NOT asked them for
  notification permission.
- AC-1.2: Given that setting in the off state, when the user turns it on and grants the
  browser's permission, then the setting shows on, and this browser appears in their list
  of push devices (US-3).
- AC-1.3: Given the user turns the setting on and the browser's permission prompt ends
  without a grant, then the setting stays off and no push device is recorded; and
  - if the user refused (permission now denied), a message explains that notifications are
    blocked in the browser and how to allow them (the AC-1.4 state);
  - if the user dismissed the prompt (permission still not decided), a message says
    notifications were not allowed, and turning on stays offered.
  (Amended 2026-11-11 from design finding G2: a dismissed prompt is not "blocked".)
- AC-1.4: Given the browser's notification permission was already denied for Operai, when
  the user opens My profile, then the setting is shown as unavailable with the same
  explanation, and turning it on is not offered.
- AC-1.5: Given push is on for this browser, when the user turns the setting off, then the
  browser is removed from their push devices and receives no further push notifications
  (AC-2.x), while in-app notifications and toasts are unchanged.
- AC-1.6: The supported, tested browsers are current desktop Chrome, Edge, Firefox and
  Safari on macOS. Push is offered by capability, not by browser name: given a phone or
  tablet browser, or a browser that lacks service workers, push messaging or
  notifications, when the user opens My profile, then the push setting says push is not
  available on this browser and does not offer turning on. Given any other desktop browser
  that has those capabilities (for example Opera, Vivaldi, Brave or Dia), the setting may
  offer turning on, with no guarantee that notifications are delivered there (see
  Non-goals). In every case the list of the user's other push devices and their Remove
  action (US-3) are still shown. (Amended 2026-11-11 from design finding G1. Amended
  2026-11-12 after QE round 0: offered by capability, supported set named, delivery on
  other browsers not guaranteed.)
- AC-1.7: Given push is on for this browser, when the user reloads Operai, or the session
  ends without an explicit sign-out (for example it expired) and the same user signs in
  again on it, then the setting still shows on without asking again. Given the user signed
  out explicitly (AC-5.1), when they sign in again on it, then the setting shows off, and
  turning it on again does not show a new permission prompt if the browser's permission is
  still granted. (Amended 2026-11-12 after QE round 0: made consistent with AC-5.1.)
- AC-1.8: Given the push settings cannot be loaded (the notification service does not
  answer), when the user opens My profile, then the push section shows a warning with a
  retry, and the rest of My profile is unaffected. (Added 2026-11-11, design finding G3.)

### US-2: A notification reaches me when Operai is closed

As a user with push on, I want each notification raised for me to appear as a system
notification, so that I see it without having Operai open.

**Acceptance criteria:**
- AC-2.1: Given a user with push on for a browser, and no Operai tab open in that browser,
  when any suite app raises a notification for them, then a system
  notification appears on that computer within 30 seconds (provider permitting) showing
  the notification's English title and body.
- AC-2.2: Given the same user, when a notification is raised whether or not it is
  toast-worthy, then it is pushed (AC-2.1); toast-worthiness decides only the in-tab toast,
  as today.
- AC-2.3: Given a user with push on for a browser that currently has an Operai tab open
  and visible, when a notification is raised, then that tab shows it as today (bell count,
  and a toast if it is toast-worthy, specs/005) and no system notification appears on that
  browser — **except on Safari**, where the system notification appears as well (once,
  AC-2.4). (Amended 2026-11-11 from the T1 spike: Safari cancels the push subscription
  after a few pushes that show no notification, and a notification closed at once stays in
  Notification Center; the user chose "always show on Safari".)
- AC-2.4: Given a user with push on for two browsers, when a notification is
  raised, then each browser that has no visible Operai tab shows it once (no duplicates
  on the same browser).
- AC-2.5: Given a notification that also carries an Italian variant (ADR-0065), when it is
  pushed, then the system notification shows the English title and body.
- AC-2.6: Given the push service is unavailable or rejects a send, when a notification
  is raised, then the notification is still persisted, still appears in the
  bell, the center and any open tab's toast exactly as today, and the raising app's call
  succeeds as it does today (push is best effort, never a reason to fail or roll back).
- AC-2.7: Given a push device the push service reports as no longer valid (expired,
  unsubscribed in the browser, browser data cleared), when a send to it is rejected for that
  reason, then that device is removed from the user's push devices and no further sends
  are attempted to it.

### US-3: I can see and remove the browsers that receive my push notifications

As a user, I want to see where my push notifications go and remove a browser I no longer
use, so that a lost or shared computer stops showing my notifications.

**Acceptance criteria:**
- AC-3.1: Given a user with one or more push devices, when they open My profile, then
  they see each device with a recognisable description (browser and operating system), the
  date it was turned on, and which one is "this browser".
- AC-3.2: Given that list, when the user removes a device, then it disappears from the
  list and receives no further push notifications, and the user's other devices are
  unaffected.
- AC-3.3: Given a user, then the list shows only their own devices; no user can list,
  add or remove another user's push devices.

### US-4: Clicking a push notification takes me to it

As a user, I want clicking a push notification to open Operai where the notification
points, so that I can act on it straight away.

**Acceptance criteria:**
- AC-4.1: Given a push notification for a notification with a link, when the user clicks
  it, then Operai opens on that link (in an existing Operai tab brought to the front if
  there is one, otherwise a new tab).
- AC-4.2: Given a push notification for a notification without a link, when the user
  clicks it, then Operai opens on the notification center (`/notify`).
- AC-4.3: Given the user is signed out when they click a push notification, then they go
  through the normal sign-in and land on the target from AC-4.1/4.2 afterwards.

### US-5: Push stops when I should no longer receive it

As wellD, I want push notifications to stop reaching a browser promptly (at once on
sign-out, within 30 seconds on deactivation) when the person behind it should no longer
see Operai content there.

**Acceptance criteria:**
- AC-5.1: Given a user with push on for a browser, when they sign out of Operai in that
  browser, then that browser is removed from their push devices and receives no further
  push notifications.
- AC-5.2: Given a user who is deactivated (specs/006 soft delete), when a notification is
  raised for them 30 seconds or more after the deactivation, then no push notification is
  sent to any of their devices, and their devices are removed. A notification raised
  within those 30 seconds may still be pushed. (Amended 2026-11-12 after QE round 0, user
  decision: 30 s bound as ADR-0014. Before: "when a notification would be raised for
  them", i.e. instantly.)
- AC-5.3: Given a browser where user A turned push on, when user B signs in to Operai in
  the same browser, then that browser never shows user A's notifications while B is signed
  in (A's device is removed or replaced; it is never shared between two users).

### US-6: The push services never read notification content

As wellD, I want notification text to cross the browsers' push services (Google, Mozilla,
Apple — none EU-bound) only in a form they cannot read, and push to be an explicit,
switchable decision, so that no business content leaves the EU readable.

**Acceptance criteria:**
- AC-6.1: Given a production deployment, then push is disabled unless it is explicitly
  enabled by configuration; with push disabled, the My profile setting is not shown and no
  push is ever attempted.
- AC-6.2: Given the push payload, then it contains only the notification's title, body,
  origin app, a link target and the notification id — never the recipient's email, name or
  any field the notification does not already show the recipient in the center.
- AC-6.3: Given any push sent, then the payload reaching the push service is encrypted so
  that only the recipient's browser can read it; a push service observes only metadata
  (that a message was sent, to which browser subscription, when, and its size).
- AC-6.4: Given an origin app whose notifications must not be pushed (configurable per
  origin app), when one of its notifications is raised, then no push is sent for it.
  Default for every origin app: allowed.
- AC-6.5: Given the go-live, then the decision that push services see the metadata of
  AC-6.3 is recorded in an ADR with its owner and date before push is enabled in
  production.

### US-7: One service's volume never gets another service's internal calls refused

As wellD operating the suite, I want each service's requests to `auth` for its own service
credential (`POST /system/service-token`, ADR-0044/0049) and for a user's contact details
(`POST /system/users/contact`, ADR-0056 and the push activity check of AC-5.2) to be limited
per calling service, so that no service's volume, and not the suite's combined volume,
causes a legitimate call of another service to be refused, and no flood of calls with
invalid credentials, from whatever source, causes a request with a valid credential to be
refused, while such a flood is still refused.

Added 2026-11-12 (user decision after QE round 0, D-1). Figures decided by the user the
same day ("Token 300 · lookup 600"): per calling service per 10 minutes, `auth` accepts up
to 300 service-token requests and up to 600 contact lookups, and refuses beyond that. Also
decided: "a valid credential always passes" (AC-7.5).

**Acceptance criteria:**
- AC-7.1: Given a calling service with a valid credential, when it requests service tokens
  300 times within 10 minutes (its whole allowance, and three times the 100 the suite is
  expected to make at its busiest), then none of those requests is refused and each returns
  a token.
- AC-7.2: Given a calling service holding the scope for contact lookups, when it makes 600
  contact lookups for active users within 10 minutes (its whole allowance), then none is
  refused and each returns the contact details.
- AC-7.3: Given a calling service that has used its whole allowance of either endpoint,
  when another calling service with a valid credential calls the same endpoint, then that
  call is not refused and is answered as it would be had the first service made no calls.
- AC-7.4: Given a calling service that goes beyond its own allowance on an endpoint (a
  runaway loop: its 301st service-token request, or its 601st contact lookup, within 10
  minutes), when it sends the next request, then that request is refused with a "too many
  requests" answer that says after how many seconds to retry, nothing is minted or looked
  up for it, and the refusal ends on its own once the 10-minute period has moved on
  (retries during the refusal do not extend it).
- AC-7.5: Given a source address that has sent 20 or more requests with invalid credentials
  to either endpoint within 10 minutes, when it sends a further request with an invalid
  credential, then that request is refused with the "too many requests" answer before any
  token is minted or any user looked up; and given that same source, at the same moment,
  sends a request with a valid credential, then that request is answered normally (a token
  minted, or the contact details returned), subject only to its own calling service's
  allowance (AC-7.4) and never refused because of the invalid requests, whichever source
  they came from. Given fewer than 20 such invalid requests, an invalid credential is
  answered exactly as today (the same refusal for an unknown client and a wrong secret).
  Requests with a valid credential are not counted towards the 20, and refused invalid
  requests do not extend the period (it ends on its own once 10 minutes have moved on).
- AC-7.6: Given any request whose credential does not verify, then the answer is only ever
  one of two: the refusal it gets today (below 20 invalid requests from its source) or the
  "too many requests" answer of AC-7.5 (from 20 on), chosen solely by how many invalid
  requests that source has sent, and never by whether the named service exists, whether its
  secret was nearly right, or how much of any service's allowance has been used; and the
  "too many requests" answer given for an invalid credential is indistinguishable from the
  one given to a verified calling service beyond its allowance (AC-7.4), so a refusal of
  either kind never tells the sender whether the credential was valid. The only answer that
  tells a sender its credential was valid is the successful one it already gets today.
- AC-7.7: Given more than 100 notifications raised within 10 minutes for different
  recipients, some asking for an email notice (ADR-0056) and some for users with push
  devices (US-2), while the other suite services keep requesting their service
  credentials, then every email notice is attempted, every push activity check completes,
  and none of them fails because `auth` refused a call.
- AC-7.8: Given a legitimate service using these two endpoints within its allowance, then
  the request shapes, the answers, the credential and scope rules and the token contents
  and lifetime are unchanged, so no service has to change how it calls `auth`.

## Non-goals

- Phones and tablets, including iPhone/iPad home-screen apps — desktop browsers only
  (AC-1.6); making Operai installable is a separate piece of work.
- Per-user, per-app or per-event choice of which notifications are pushed — every
  notification is pushed (except an origin app excluded by configuration, AC-6.4); callers
  do not mark notifications for push.
- Italian push text — push is always English (AC-2.5), even when the notification has an
  Italian variant.
- Changing the read model: a push click marks nothing read by itself; opening the center
  marks read exactly as specs/005 US-3 says.
- Push for email-only messages (invitations, batch emails) that are not notifications.
- Push to anyone other than the notification's recipient; broadcast or department push.
- Quiet hours, do-not-disturb schedules or grouping several notifications into one push.
- A delivery history or read receipts for pushes.
- Delivery on browsers outside the supported set (AC-1.6). Known limitation: some desktop
  browsers built on Chromium (Dia was tested) expose the push capability yet never deliver
  because they have no working push service; the product cannot detect this, so it may
  offer turning on there with no delivery guarantee. Likewise a tablet browser that
  identifies itself as a desktop one (for example an iPadOS home-screen app) may be offered
  turning on. (Added 2026-11-12 after QE round 0; records existing behaviour, adds none.)
- Instant removal on deactivation: AC-5.2 allows up to 30 seconds, the same bound the suite
  already accepts at its authorization-enforcing services (ADR-0014). (Added 2026-11-12.)
- Changing any other limit in `auth`: US-7 touches only the two endpoints it names. The
  per-user limits on user-facing routes (for example the user directory, identity lookups
  and the app-access check) stay as they are.
- Limiting how often a user can raise notifications for themselves (specs/005 self-raise
  has no limit today); US-7 only guarantees that such volume does not take `auth` calls
  away from other services.
- Guaranteed delivery of an email notice or push when `auth` is unavailable or a service
  exceeds its own allowance: both stay best effort (AC-2.6, ADR-0056).
- Fixing how `auth` identifies callers of its user-facing routes behind the platform proxy.
- Capping how many credential guesses a source can make: AC-7.5 limits the work done for
  invalid credentials, not the number of guesses evaluated, because a valid credential must
  always pass (user decision 2026-11-12). Protection against guessing rests on the secrets'
  strength, which this feature does not change.

## Constraints

Captured verbatim from the user (2026-11-11); the plan decides how:

- ~~Push is delivered through **Firebase Cloud Messaging (FCM)**.~~ Superseded during
  planning (2026-11-11): the user chose **standard Web Push with an encrypted payload**
  ("Web Push standard"), because with FCM Google reads the text in clear.
- A push notification shows the **full title and body** of the notification ("Titolo e
  testo completi"); it crosses the push services encrypted (AC-6.3).
- Push copy is **always English** ("Sempre inglese").
- The setting lives in **My profile** (`/account`).

## Open questions

Approved on 2026-11-11 by Matteo Codogno with the questions below still open, accepted as
risk; each must be closed before push is enabled in production (AC-6.1).

- [x] ~~Do Safari's and Firefox's push services count as acceptable processors?~~ Resolved
  2026-11-11: with an encrypted payload (AC-6.3) every push service sees metadata only;
  one decision covers all three (AC-6.5).
- [x] Is there any origin app whose notifications must be excluded at launch (AC-6.4),
  e.g. Meetings, given ADR-0061? With content encrypted the default is "none excluded". —
  owner: Matteo Codogno Decided 2026-11-12 by Matteo Codogno: none excluded at launch (`PUSH_EXCLUDED_ORIGINS` empty) — Meetings notifications carry only the meeting title and a status, the payload is end-to-end encrypted (ADR-0084), and lock-screen previews are an OS setting; to be recorded in ADR-0084's go-live sign-off (T12).
- [ ] Who signs the go-live ADR entry (AC-6.5)? — owner: Matteo Codogno
- [x] ~~Are 100 token requests and 600 contact lookups per calling service per 10 minutes
  the right figures?~~ Decided 2026-11-12 by Matteo Codogno, "Token 300 · lookup 600": the
  allowance per calling service per 10 minutes is 300 service-token requests and 600
  contact lookups; beyond that a verified service is refused (AC-7.1, 7.2, 7.4).
- [x] ~~AC-7.5 counts invalid credentials per source address and all services share one
  address on the private network: is it accepted that a flood of wrong credentials gets
  every service refused?~~ Decided 2026-11-12 by Matteo Codogno, "a valid credential always
  passes": throttling of invalid credentials never causes a request with a valid credential
  to be refused (AC-7.5, AC-7.6). The plan must say how the credential is verified before
  the source's invalid count is consulted.
