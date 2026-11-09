---
"@operai/auth": minor
"@operai/estimai-api": minor
"@operai/estimai-ui": minor
"@operai/crm-api": minor
---

EstimAI list (specs/024): an admin can list and open every estimate read-only (new `estimate:read-all` permission, seeded to `admin`; ADR-0075); closed estimates move from the default Open list to a Closed filter; an estimate linked to a CRM deal shows a Deal badge, kept up to date by crm-api's new deal-link notices (scope `deal-link-notices.send`, ADR-0076). Deploy auth first, then add the scope to crm-api's `SERVICE_CLIENTS` entry, set `SERVICE_AUDIENCE` on estimai-api and `ESTIMAI_INTERNAL_URL` on crm-api, deploy both, and run `crm-api/scripts/backfill-estimate-links.ts --apply` once.
