---
"@operai/crm-api": minor
"@operai/crm-ui": minor
---

The event, referral and "other" detail of a company or deal suggests the details already written for that source (case, accents and spacing ignored), so the same event is not recorded three ways. New `GET /source-details?source=` in crm-api, readable by every `crm:access` holder.
