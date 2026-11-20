# 20261120 — An activity's details visibility is the author's choice, stored on the record by activities-api; who is in the sales team is a fact the host answers live

**Date:** 2026-11-20  
**Status:** Accepted (decided by the owner, Matteo Codogno, 2026-11-20; amends ADR 20261110-activities-service-access-delegated-to-host)  
**Deciders:** Matteo Codogno (owner), wellD  
**Project:** Operai

---

## Context

A CRM task or note can hold sensitive details (a client's margin, a discount ceiling, a private
phone number). Until now every CRM reader saw every activity's text, description and files, because
activities-api asks crm-api only "may this caller read this company?" (ADR 20261110-activities-service-access-delegated-to-host). The owner wants
the author to choose who sees the details: everyone, the sales team, or only the author
(specs/20261110-activities US-9). That choice is about ONE record, made by its author; it is not a
role rule, and crm-api does not know activities.

## Decision

- **The choice lives on the record, in activities-api.** `activity.detailsVisibility`
  (`everyone` | `sales_team` | `author`, default `everyone`, every existing row `everyone`). A
  database CHECK (`activity_details_visibility_crm_only`) allows a restriction only on a CRM
  activity; the host registry carries it as data (`restrictsDetails`), so Projects refuses the field
  (422 `field_not_allowed`) without a branch on the app. Only the author sets or changes it.
- **The group is a fact the host answers, live, as the caller.** crm-api's
  `POST /activity-host/v1/resolve` gains a top-level `salesTeam: boolean`: the caller manages deals
  of at least one entity (`dealScope(c).length > 0`, conditions applied, never `hasCapability`).
  activities-api reads it from the same call it already makes, per request, never cached; absent
  or not `true` is "not in the team" (fail closed), so an old crm-api withholds sales-team
  details rather than showing them.
- **Only the details are withheld, and they are not sent at all.** A caller who may not see them
  gets the activity with `body: null`, `task.description: null`, `task.files: []` and
  `detailsHidden: true`; a file's download URL answers the same 404 as a missing file. The subject,
  people, dates, blockers and state stay visible (lists, notices and blockers already show the
  subject; the form says so).
- **No role overrides it.** The author always, a task's assignee always (they must know what to
  do), the sales team when chosen; an administrator sees what the sales team sees, never an
  "only me" activity (the meetings posture of ADR 20261104-meetings-tool-shape-visibility-by-participation).

## Consequences

- activities-api now holds ONE per-record rule of its own. It still holds no permission catalog:
  the group membership is the host's answer, and the rule is a pure function
  (`mayReadDetails`) next to `mayChange`/`mayComplete`.
- A deploy in either order is safe for reads (fail closed). crm-ui must not be live before
  activities-api: the old create schema is strict and would refuse the new field (422).
- A second group (another team, per-entity sales teams) is a new value of the enum and a new
  fact in the resolve answer, decided by a new ADR, not a widening of `salesTeam`.

## Rejected

- **A permission in `auth` for reading restricted details:** a role would override the author's
  choice, which the owner excluded.
- **Hiding the whole activity:** the timeline and My tasks would silently lose entries; the owner
  chose details only.
- **Asking crm-api for `deal:manage` through a separate call:** one more round trip per request
  for a fact the existing resolve call can carry.
- **Copying the sales team into activities-api:** a copy goes stale the moment a grant changes.
