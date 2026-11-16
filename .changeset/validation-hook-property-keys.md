---
'@operai/crm-api': patch
'@operai/meetings-api': patch
'@operai/activities-api': patch
'@operai/inventory-api': patch
'@operai/projects-api': patch
---

The validation hook's issue path type accepts any property key (zod 4 may report symbols), so it type-checks under both zod 3 and zod 4. Responses are unchanged.
