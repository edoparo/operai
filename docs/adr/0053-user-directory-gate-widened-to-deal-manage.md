# 0053 — The user directory's second consumer: `deal:manage` opens `GET /authz/users/directory` for the CRM's owner and assignee pickers

**Date:** 2026-11-01
**Status:** Accepted (taken autonomously at the product owner's request — review before merge, see specs/017-crm/decisions.md D-6)
**Deciders:** wellD
**Project:** Operai

---

## Context

ADR-0047 made `auth GET /authz/users/directory` — the roster of active users, `{id, name,
email, entity}` — acceptable only behind an explicit allowlist of permissions whose holders
have a business need to pick a person, starting with inventory's `asset:manage`. It names "a
second consuming app" as its escalation trigger and requires each consumer to be added
deliberately.

The CRM (specs/017, ADR-0052) needs to pick a person in two places: the **owner** of a company
or a deal, and the **assignee** of a follow-up task. Without a roster those can only ever be the
person who created the record.

## Decision

We add the `crm` catalog's **`deal:manage`** to `DIRECTORY_GATE_PERMISSIONS`, under any entity
scope. Nothing else about the endpoint changes: same shape, same population (both entities),
same rate limit, no query parameters, `Cache-Control: no-store`. `crm-ui` calls it directly
through `shell/session`'s `apiFetch`; `crm-api` keeps no copy.

Deliberately **not** `crm:access`: reading the CRM is held by every consultant who needs it and
is no reason to be able to list every employee with their email. Not `contact:erase` either.

A caller without the gate still uses the CRM fully: their records default to themselves as
owner/assignee, and crm-ui shows the current owner read-only when the directory answers 403.

## Alternatives considered

- **Open the directory to `crm:access`.** Rejected: it would turn the narrow exception of
  ADR-0047 into "most of the company", the drift ADR-0047 exists to prevent.
- **An exact-email decision endpoint (ADR-0035 style).** Rejected for the same reason ADR-0047
  rejected it: people pick colleagues by name.
- **A CRM-local roster cached in `crm-api`.** Rejected: a second copy of personal data that
  goes stale (ADR-0039).

## Consequences

- The gate now has two entries; each further consumer is still a deliberate ADR change.
- A salesperson (role `sales`) can list every active user. That is the same audience size as an
  inventory manager and the same data.
- Tests in `auth/src/auth/directory.routes.test.ts` pin both that `deal:manage` opens the gate
  and that `crm:access` / `contact:erase` alone do not.
