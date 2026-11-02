---
spec: 019
status: approved
approved: 2026-11-01
---

# Plan — CRM notifications (specs/019)

The owner approved the spec and, in advance, this plan (2026-11-01: "Approvo tutto").

## Architecture

```
crm-api ──(service JWT: notifications.push emails.send)──► notify-api POST /system/notifications
                                                               │ 1. in-app row + SSE (unchanged)
                                                               │ 2. if email: true
                                                               ▼
                       notify-api ──(service JWT: users.contact)──► auth POST /system/users/contact
                                                               │    { email, name } of an ACTIVE user, or 404
                                                               ▼
                                                    email channel (Resend), template `notification_notice`
```

- crm-api names a recipient by auth id only and never sees an address (AC-4.3).
- notify-api resolves the address at send time and keeps no copy. The address is still
  written to `email_delivery`, the delivery log, as for every email today.
- notify-api becomes a service client of auth (`system:notify-api`), the suite's fifth.

## Contracts

### auth — `POST /system/users/contact` (new)

- **Auth:** a service JWT verified like notify-api verifies them: RS256 against better-auth's
  JWKS (the key that signs service tokens), issuer pinned, `aud = SERVICE_AUDIENCE`,
  `sub = system:<client>`, `users.contact` in `scope`. A user JWT (`aud = AUTH_AUDIENCE`) is
  refused. Every failure returns the same 401 body.
- **Request:** `{ "userId": string }`, 1–200 characters.
- **Response:**
  - **200** `{ "id", "email", "name" }` for a user who is not deleted;
  - **404** for an unknown or soft-deleted user, with the same body in both cases.
- **Rate limit:** like `/system/service-token`.
- **Logging:** `[system] users.contact caller=<sub> found=<bool>`, with no id and no email.
- **New scope:** `users.contact` joins `KNOWN_SERVICE_SCOPES`. `SERVICE_CLIENTS` gets the
  entry `notify-api` with scope `users.contact` (the env value is the developer's, T10).

### notify-api — `POST /system/notifications` (extended)

- **`originApp`** accepts `crm`. Binding: `system:crm-api` → `["crm"]`.
- **New optional body field `email: boolean`** (default `false`). When `true`:
  - the token must also carry `emails.send`, otherwise **403** before anything is written,
    because an email is a separate capability (ADR-0049);
  - after the in-app row is written, notify-api resolves the recipient through auth and
    sends the template `notification_notice` to that address.
- **The response** stays the notification, plus
  `emailStatus: "sent" | "failed" | "skipped"`, present only when `email: true`:
  - `skipped`: the email group is not configured, or auth answered 404 (the user is
    inactive);
  - `failed`: auth or Resend could not be reached or answered with an error.
  - Neither turns the 201 into an error (AC-4.4).
- **New optional env group** (all four or none, validated at startup):
  - `APP_BASE_URL`: the shell's origin, for the absolute link in the email;
  - `AUTH_BASE_URL`;
  - `SERVICE_CLIENT_ID` (`notify-api`) and `SERVICE_CLIENT_SECRET` (at least 32 characters).
  Without the group, `email: true` gives `emailStatus: "skipped"` and a startup warning.
- **Template `notification_notice`, English:**
  - subject: the notification title;
  - body: the title, the body text, a button "Open in Operai" pointing to
    `APP_BASE_URL + link.href` (or to `APP_BASE_URL` when there is no link), and a footer
    naming the origin tool;
  - every field is escaped, like every other template.

  The template is built by notify-api from the notification it just stored. It is **not**
  reachable through `/system/emails`, so a caller can never pick the address.

### notify-ui and shell

- `crm` joins `NotificationOriginApp` in both and gets an origin label in both catalogs:
  "CRM" in en and it.

### crm-api — the notifier

- **New optional env group** (all or none): `NOTIFY_INTERNAL_URL`, `SERVICE_CLIENT_ID`
  (`crm-api`) and `SERVICE_CLIENT_SECRET`. Without it the notifier is a no-op and logs once
  at startup. The auth client entry needs scope `notifications.push emails.send`.
- **Code:**
  - `src/lib/serviceToken.ts`, the shared copy (scripts/check-shared-copies.ts);
  - `src/lib/notify.ts`: `notify(event)` builds one request per recipient. It drops the actor
    and duplicate recipients, sets `email` from the event's class, retries once on a 401 with
    a fresh token, never throws, and runs after the commit without being awaited by the
    route. It is disabled under `NODE_ENV=test` unless a test injects a notifier.
- **Copy:** English, with no money in any field (AC-1.2). The deal title and the company
  name are clipped to 100 characters. Links:
  - `/crm/deals/<id>` for every event except E5;
  - `/crm/tasks` for E5.

| # | Hook (after commit) | Recipients | email | severity |
|---|---|---|---|---|
| E1 | estimate request | technical contact | yes | info |
| E2 | estimate ready | requester, deal owner | yes | success |
| E3 | estimate reopen | technical contact | yes | warning |
| E4 | deal create, or update with a different owner | new owner | yes | info |
| E5 | task create, or update with a different assignee (type `task` only) | assignee | yes | info |
| E6 | estimate unlink | technical contact | no | info |
| E7 | gate override | deal owner, requester (if any) | no | warning |
| E8 | stage → won / lost | deal owner | no | success / warning |
| E9 | offer generate | deal owner | no | info |

## Environment and tooling

- **env-doctor manifest:**
  - crm-api `NOTIFY_INTERNAL_URL` → notify-api;
  - notify-api `AUTH_BASE_URL` → auth;
  - `SERVICE_CLIENT_SECRET` is secret in both services;
  - the variables are optional, in line with `ESTIMAI_API_URL` (018 D-15).
- **shared copies:** `crm-api` and `notify-api` join the `serviceToken` group.
- **ADR-0056:** notify-api resolves an email notice's address from auth.

## Tests

- **auth:** the endpoint answers only a service token carrying `users.contact`. It refuses a
  user JWT, a wrong audience and a missing scope with the same 401. It returns 404 for unknown
  and deleted users with an identical body, and 200 with id, email and name.
- **notify-api:**
  - `crm` origin binding;
  - `email: true` without `emails.send` → 403 and no row;
  - with it, the auth lookup and the email send are stubbed:
    - `sent`;
    - 404 → `skipped`;
    - auth down → `failed`, with the in-app row kept;
    - group unconfigured → `skipped`;
  - the template escapes its fields and builds the absolute link;
  - `/system/emails` rejects `notification_notice`.
- **crm-api:**
  - an injected notifier records one test per event row of the table: recipients, email flag
    and link;
  - the actor is never notified;
  - recipients are deduplicated;
  - no money appears in any title or body;
  - the notifier's own unit tests: 401 retry, never throws, no-op when unconfigured.
- **notify-ui and shell:** the origin label.

## Risks

- **A burst of CRM actions spends auth's rate limit for `users.contact`.** One lookup per
  email notice, at the human pace of the CRM: acceptable. If not, notify-api can cache for a
  few seconds; that is not planned.
- **The fifth service client adds an env value to auth.** env-doctor and T10 cover it.
