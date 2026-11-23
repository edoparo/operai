# @operai/hours-api

## 0.2.0

### Minor Changes

- 2b3d2fe: Add hours-api (specs/20261112-time-tracking, ADR 20261112-hours-api-time-entries-own-service-hours-catalog, 20261112-time-bookability-asked-of-owners-meeting-hosts-system-route), the service behind time tracking: the hours people spend on company work. A time entry is one person's own declaration of a duration, on one day, on a project, a deal, a meeting or other work. It is a whole number of 30-minute steps, never a time of day, and only its author can change or delete it. Whether a person may book on a project, a deal or a meeting is asked of the service that owns it (`projects-api`, `crm-api`, `activities-api`, `meetings-api`) as that person on every write, and a write fails closed when the owner cannot answer. Holders of the new `time-entry:read-all` permission can list and total everyone's hours; holders of `time-list:manage` keep the categories and the work types people pick from (retire and restore, never delete). Totals group by person, project, deal, category, month or day, and merge what the viewer may not read into one group.
  - **Operators:** a new database `hours`, a Railway service and the env contract in `tools/env-doctor`. hours-api reads a meeting's current deal from `meetings-api` with its own service credential, so it needs `SERVICE_CLIENT_ID`, `SERVICE_CLIENT_SECRET` and `SERVICE_AUDIENCE` to start; `auth` needs the `hours-api` client (scope `meetings.hosts.read`, added to `SERVICE_CLIENTS` only after the new `auth` is live, because an unknown scope stops it) and `meetings-api` needs `SERVICE_AUDIENCE`. Until those last two exist a meeting's deal reads as unavailable; nothing else is affected.

### Patch Changes

- 2b3d2fe: hours-api takes the dependency versions every backend moved to: zod 4.6.7 and `@hono/zod-openapi` 1.6.3 (GHSA-mrhx-c7xc-m3w5), `@scalar/hono-api-reference` 0.12.17 and hono 4.13.16 with `@hono/node-server` pinned to 2.1.6. A request body sent with a Content-Type other than JSON now answers a 415 Problem (`Unsupported Media Type`) instead of 400 `invalid_request`; malformed JSON and a missing body are still 400 `invalid_request`, and zod's own wording of some messages changes.
