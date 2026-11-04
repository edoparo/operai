---
"@operai/crm-api": minor
"@operai/crm-ui": minor
---

CRM offers are edited until they are sent, then revised (specs/020 US-7). While the newest offer has not been marked sent, "Edit" opens it with its own content and regenerates its PDF under the same reference. Marking it sent records when and by whom, and freezes it. After that, "New revision" starts from the sent offer and adds `r1`, `r2`… instead of starting again from the template. Offers of deals already at "Offer sent", won or lost count as sent.
