---
"@operai/crm-api": minor
"@operai/crm-ui": minor
"@operai/auth": minor
"@operai/shell": minor
---

Add the CRM (specs/017-crm, ADR-0052/0053): companies, contacts, deals through a stage
pipeline with per-currency weighted totals, activities and follow-up tasks. New services
`crm-api` and `crm-ui`; `auth` registers the `crm` catalog and the `sales` role and lets
`deal:manage` holders read the user directory; the shell mounts the tool at `/crm`.
