# 0085 — Push suppression is decided by the browser, never by the server

**Date:** 2026-11-11  
**Status:** Accepted  
**Deciders:** Matteo Codogno (owner of specs/029 push notifications)  
**Project:** Operai

---

## Context

specs/029 sends each raised notification as a Web Push message to every browser the recipient has turned push on in (AC-2.1, AC-2.2). A browser that already has a visible Operai tab must show nothing extra, because that tab already got the notification over SSE: bell count and, if toast-worthy, a toast (AC-2.3, ADR-0008, ADR-0009). Only the browser knows whether a tab is visible. notify-api is a single-instance service with no presence state (ADR-0008), and it must not start keeping any.

## Decision

We will decide suppression in the shell's service worker (`/push-sw.js`), not on the server. On a `push` event the worker checks `clients.matchAll({type: 'window', includeUncontrolled: true})` for a window of the shell origin with `visibilityState === 'visible'`. If one exists it shows nothing. Otherwise it calls `showNotification` with `tag` set to the notification id, so one browser never shows the same notification twice (AC-2.4). notify-api always sends to every device of the recipient and keeps no notion of presence. Clicks follow the same rule: the worker focuses an existing shell window and asks it to navigate, or opens a new one.

## Failure shape

**A decision about whether a person sees something is taken by a party that cannot observe the state the decision depends on, and that party substitutes a proxy for the state: a connection that is open, a flag reported earlier, a count that was true a moment ago.** The proxy answers a different question from the one asked. Here, "an open stream exists" is read as "the person is looking", and the cost of the mismatch falls on the person: a message that was swallowed, or the same message shown twice.

The same shape appears in its mirror-image positions:

- **Server decides, client reports.** A server that skips work because a client is connected, or a client that pushes its visibility or focus to the server so the server can decide. Both trust a copy of the client's state that goes stale at the moment it matters, most of all at a tab switch.
- **Read and write.** A state that is only ever written by the client (visibility, focus, "I have read it") and read by a server to decide delivery is the same gap in the other direction.
- **Two channels, one event.** When the same event reaches a person over two channels (SSE in the tab, a system notification outside it), the decision to drop one must be taken by the party that can see the other. Deduplication keyed on the event id (`tag`, a per-recipient `seq`) belongs to the party that displays, not to the party that sends.
- **Sender versus receiver.** A sender that trusts a receiver's "I have it" (an acknowledgement that means "I have stored it" rather than "I have shown it") is the same error on the other side of the wire.

Recognise it anywhere by: a server-side `if (connected)` or `if (online)` guard in front of a delivery to a person; a client endpoint that exists only to tell the server about visibility, focus or presence; a "skip because the other channel is live" branch with no check that the other channel is visible to the person; a duplicate-suppression rule that lives on the sending side.

## Options considered

### Option A — The service worker decides on the browser's own visibility state (chosen)

Described above. The worker is the only party that sees the window's `visibilityState` at the moment the push arrives.

**Pros:**
- Answers the question actually asked, at the moment it is asked
- No presence state on notify-api, no extra endpoint, no per-tab traffic
- `tag = id` gives a per-browser dedup that needs no coordination between browsers or tabs
- Same rule covers several tabs, several windows and several browsers without any of them knowing about the others

**Cons:**
- Suppression depends on code in the browser: a worker that fails to run shows the notification (acceptable, it is the safe failure), or a visible-tab check that is wrong suppresses it (covered by the unit test of AC-2.3)
- Safari may treat a push that shows no notification as a misuse and revoke permission (Risk below)

### Option B — notify-api skips push when the user has an open SSE stream (rejected)

**Pros:**
- No change in the browser; the server already knows who is connected

**Cons:**
- An open stream proves that a tab exists, not that it is visible. A background tab keeps its stream open, so the push that should have reached the person is swallowed
- Needs per-user presence state on a single-instance service that is deliberately stateless apart from the ticket store (ADR-0008)

### Option C — Tabs report their visibility to notify-api (rejected)

**Pros:**
- The server could decide with a fact it holds

**Cons:**
- Chatty: a report on every visibility change in every tab
- Racy: switching tabs sends "hidden" for one and "visible" for another in no guaranteed order, so the stored state is wrong for a window of time that is exactly when a push tends to arrive
- Still wrong at the moment of the switch, and blind to a browser that has crashed or been closed without a final report
- Adds per-user, per-tab state to a single-instance service for a decision the browser can take alone

### Option D — Always show the system notification, even with a visible tab (rejected)

**Pros:**
- No suppression logic at all; nothing can be swallowed

**Cons:**
- Every notification shows twice to a user who is looking at Operai: the toast and the system notification. The owner rejected this at the spec gate (specs/029, AC-2.3)

## Consequences

**Positive:**
- Delivery logic on notify-api stays stateless: one fan-out to every device of the recipient, no presence
- A person sees each notification once per browser, and never twice in the browser they are looking at
- The decision sits next to the display it controls, so a change to what "visible" means is made in one file

**Negative / trade-offs:**
- The push service carries every notification, including those the browser will suppress; the cost is one message per device, which is the same cost as Option B's sends
- Correct behaviour depends on the shell's service worker being deployed and registered; a stale worker is handled by the normal worker update cycle, not by the server

**Risks:**
- **Safari cancels the subscription after pushes that show nothing (specs/029 R2) — confirmed by the T1 spike, 2026-11-11.** Three pushes suppressed with a visible tab and Safari dropped the subscription (permission still granted, Apple still answering 201). Showing and closing at once does not help: the notification stays in Notification Center. **Amendment:** on Safari — recognised by the subscription endpoint host `web.push.apple.com` — the service worker always shows, with the same `tag = id`; the suppression rule holds on Chrome, Edge and Firefox. Safari users therefore get the system notification and the in-tab toast when Operai is visible; the user accepted this over the alternatives (server skipping Safari while an SSE stream is open, which this ADR rejects; excluding Safari). Spec AC-2.3 amended accordingly.
- **Worker and window disagree about visibility.** A window that is visible but not focused, or a window of another origin, must not count. The check is for a window of the shell origin with `visibilityState === 'visible'`.
- **Click target mismatch.** A worker that opens a new window instead of focusing an existing one doubles the tabs a user has. The rule is focus first, `openWindow` only when no shell window exists.

## Compliance notes

- GDPR / data-protection impact: low — no presence or visibility data is stored or sent to the server; the decision is local to the browser and the push payload is unchanged by it (ADR-0084)
- Data residency: not applicable to the decision itself; the payload rules of ADR-0084 apply
- Audit trail: not required; suppression is a display decision, not a business event

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
