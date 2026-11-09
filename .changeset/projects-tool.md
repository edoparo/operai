---
"@operai/projects-api": minor
"@operai/projects-ui": minor
"@operai/auth": minor
"@operai/crm-api": minor
"@operai/shell": minor
---

Add the Projects module (specs/025-projects, ADR-0079/0080): the delivery work wellD runs. A
project has a type (T&M, fixed price, maintenance, SaaS, internal), a state, a project manager and
a team, and may carry its delivery terms (deadline and max effort, SLA, hour package, T&M
positions, licence period). No money anywhere in the module. New services `projects-api` and
`projects-ui`; the shell mounts the tool at `/projects`.
- **auth:** registers the `projects` catalog (`projects:access`, entity-scoped `project:manage`)
  and the `project-manager` role; `sales` gains access and entity-scoped manage, `accounting`
  gains access; `project:manage` holders can read the user directory; new service scope
  `crm.companies.read`.
- **crm-api:** new `GET /system/companies`, readable only with a service credential carrying
  `crm.companies.read` (the first `/system/*` route on the CRM).
