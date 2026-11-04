---
"@operai/auth": minor
"@operai/estimai-api": minor
"@operai/crm-api": minor
"@operai/crm-ui": minor
"@operai/projects-api": minor
"@operai/projects-ui": minor
---

Projects hand-off (specs/022-projects-handoff, ADR-0060/0061): a won deal reaches OPS "in series".
A to-start queue lists the CRM's won deals that no project has taken, read live (a reopened deal
leaves it, a re-won one returns); a project manager takes a deal as a new project with its first
contract or attaches it to an existing project, and the contract starts from what the deal knows.
A fixed-price contract made from a deal with an estimate copies the estimate's man-days once, and
they cannot be edited. Contracts and projects show their deal, a "no longer won" notice and the
estimate link; the CRM deal page shows its project and the contract's Bexio order id, read-only.
- **auth:** new service scopes `crm.deals.read`, `estimai.estimates.read` and `projects.contracts.read`.
- **estimai-api:** its first `/system/*` route, `GET /system/estimates/{id}/summary`, returns only
  `{ id, name, manDays }` to a service credential with `estimai.estimates.read`; new optional
  `SERVICE_AUDIENCE`.
- **crm-api:** new `GET /system/deals` for projects-api (`crm.deals.read`, no amounts); the deal read
  gains `delivery` and `deliveryKnown`; `SERVICE_CLIENT_ID` / `SERVICE_CLIENT_SECRET` are now required
  with either `NOTIFY_INTERNAL_URL` or the new optional `PROJECTS_INTERNAL_URL`.
- **crm-ui:** a read-only "Delivery" card on the deal page.
- **projects-api:** `GET /queue`, `POST /queue/{dealId}/project` and `/attach`, `GET /system/contracts`
  (`projects.contracts.read`), contracts keep their deal and estimate ids; new `ESTIMAI_INTERNAL_URL`
  and `SERVICE_AUDIENCE`.
- **projects-ui:** the queue page, the "New project" and "Attach to project" dialogs, and the deal on
  the contract card and project page.
