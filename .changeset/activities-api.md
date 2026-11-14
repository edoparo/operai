---
"@operai/activities-api": minor
"@operai/auth": minor
"@operai/crm-api": minor
"@operai/projects-api": minor
"@operai/notify-api": minor
"@operai/notify-ui": patch
"@operai/shell": minor
"@operai/crm-ui": minor
"@operai/projects-ui": minor
---

Add activities-api (specs/20261110-activities, ADR 20261110-activities-service-access-delegated-to-host/0082/0083): one backend-only service for the activities, tasks and
task blockers of the CRM and of Projects, with no permission catalog of its own, so every access decision is
asked of the host (`crm-api`, `projects-api`) as the caller and fails closed. `crm-api` moves its activities,
participants, blockers and meeting host state out (they are copied in once by
`activities-api/scripts/import-crm-activities.ts`, a later push drops the old tables) and calls
`activities-api` with the new service scope `activities.write`; `projects-api` becomes a host. `auth`
registers the scope and the `activities-api` service client; `notify-api` accepts the `projects` origin and
binds `system:activities-api` to `crm` and `projects`; `notify-ui` tags it. The shell trusts the
activities-api origin; `crm-ui` reads activities from it; `projects-ui` gains a Tasks card on a project and a
My tasks page.
