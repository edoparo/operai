---
id: 20261101
slug: crm-notifications
status: in-progress
rigor: mvp
created: 2026-11-01
approved: 2026-11-01
depends-on: 018
---

# CRM notifications — in-app for everything that concerns you, email for what you must act on

> **Origin.** After specs/20261101-crm-sales-flow the product owner asked (2026-11-01) whether a technician
> learns about an estimate request. They do not: the CRM creates a task and nothing else,
> because crm-api has never called notify-api (specs/20261101-crm left notifications out of v1).
> The owner asked for the CRM's notifications to be reviewed: the important ones go by
> email as well as in the app, the others only in the app.

## Problem

The CRM hands work from one person to another, but nobody is told:
- a technician asked for an estimate finds out only by opening the CRM's task list;
- a salesperson learns that an estimate is ready only by reopening the deal;
- someone who becomes a deal's owner or gets a task finds out the same way.

The suite already has the channels: notify-api's in-app notifications with the header bell
(specs/20260713-notification-center), and its email channel (specs/20260713-user-invitations, ADR 20260714-notify-api-email-channel-service-trust). Every caller authenticates with
its own scoped service credential (ADR 20261013-all-notify-callers-scoped-credentials-shared-token-retired). The CRM is the only tool with handovers that
uses neither.

## Domain language

| Term | Meaning |
|---|---|
| **Notification** | One in-app message to one person, from the CRM, with a link to the deal or the task list. |
| **Email notice** | An email sent in addition to the notification, for an event the recipient must act on. |
| **Actor** | The person whose action caused the event. An actor is never notified of their own action. |

## Which events notify whom

The proposal. **Email** means the recipient gets the notification and an email notice.

| # | Event | Recipient | Channel | Why |
|---|---|---|---|---|
| E1 | An estimate is requested | the technical contact | **email** + in-app | They must do the work, with a due date. Holds up the deal. |
| E2 | The estimate is closed in EstimAI (specs/20261101-crm-sales-flow AC-3.3) | the requester and the deal owner | **email** + in-app | The deal can now move to proposal. |
| E3 | The estimate is reopened in EstimAI | the technical contact and the requester | **email** + in-app | Work is needed again and the deal is held up again. |
| E4 | A deal gets a new owner | the new owner | **email** + in-app | They are now responsible for the deal. |
| E5 | A task is assigned to someone else, or reassigned | the assignee | **email** + in-app | Work handed to them, with a due date (owner, 2026-11-01). |
| E6 | The estimate is unlinked | the technical contact | in-app | Their work on it stops. The task closes on its own. |
| E7 | A deal moves past the gate with "Proceed without estimate" | the deal owner and the requester | in-app | For information, with the reason. |
| E8 | A deal is won or lost | the deal owner | in-app | For information, when someone else moves it. |
| E9 | An offer is generated | the deal owner | in-app | For information, when someone else generates it. |

Events with no notification: creating, editing or deleting companies, contacts, notes, calls
and meetings; uploading attachments; moves between open stages.

## User stories and acceptance criteria

### US-1 The technician learns about an estimate request at once

- **AC-1.1** When an estimate is requested (E1), the technical contact receives an in-app
  notification and an email notice. Both name the deal, the client company and the requester,
  and both link to the deal in the CRM.
- **AC-1.2** The email notice contains no money: no amount, no total, no offer. The same
  applies to every CRM notification and email notice, so that a `crm-technical` recipient
  (ADR 20261101-crm-financial-visibility-permission) never learns a figure from one.
- **AC-1.3** The email notice also gives the task's due date.

### US-2 The salesperson learns when the estimate is ready

- **AC-2.1** When the estimate is closed in EstimAI (E2, amended 2026-11-05, ADR 20261105-estimai-closes-the-estimate-crm-follows), the requester and the deal owner
  receive an in-app notification and an email notice, each at most once even when one person
  is both.
- **AC-2.2** When it is reopened in EstimAI (E3), the technical contact and the requester receive
  both, except whoever reopened it.

### US-3 Handovers are announced in the app

- **AC-3.1** E4 and E5 send an email notice and a notification. E6–E9 send a notification
  only, to the recipients in the table above.
- **AC-3.2** Nobody is notified of their own action. For example, a salesperson who assigns
  a task to themselves receives nothing.
- **AC-3.3** Every notification shows the CRM as its origin in the bell and in the
  notification center, in English and Italian.

### US-4 Notifications never get in the way

- **AC-4.1** Sending is best effort and happens after the change is saved. If notify-api or
  the email provider is down, the action still succeeds, nothing is rolled back, and the
  failure is logged without personal data or deal content.
- **AC-4.2** crm-api authenticates to notify-api as itself (`system:crm-api`), with only
  the push and email scopes. notify-api accepts a push from it only for the `crm` origin
  (ADR 20261013-all-notify-callers-scoped-credentials-shared-token-retired).
- **AC-4.3** crm-api names the recipient by auth id only and never handles an email
  address. notify-api looks the address up in auth when it sends, keeps no copy, and sends
  nothing to a user who is no longer active. A caller cannot choose the address.
- **AC-4.4** If the address lookup fails, the in-app notification is still delivered. The
  email notice is skipped and the failure is logged.

## Non-goals

- Reminders before or after a due date. They would need a scheduler, and the suite derives
  state on read instead (ADR 20260714-invitation-lifecycle-derived-expiry-state).
- Per-user notification preferences or an email opt-out. They apply to the whole suite and
  belong in their own spec.
- Notifications to people without CRM access.
- Digests: every email notice is sent on its own.

## Open questions

- **O1 — Resolved by the owner, 2026-11-01: notify-api resolves the address.** crm-api
  sends one request per recipient ("notify this user; this one also by email"). notify-api
  asks auth for the active user's address, authenticating as `system:notify-api` with a new
  service scope, and keeps no copy. This needs a new auth endpoint for service principals
  and an ADR. Any later tool gets email notices the same way.
- **O2 — Resolved by the owner, 2026-11-01:** email notices are in English only, like the
  refund emails.
- **O3 — Resolved by the owner, 2026-11-01:** the classification stands, and E5 (a task
  assigned) also sends an email notice.
