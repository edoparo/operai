---
"@operai/crm-api": patch
"@operai/crm-ui": patch
---

Unlinking a deal's technical estimate deletes the task the request created, as long as it is still open; a completed one stays on the timeline. On the deal page, the activity list reloads after an estimate is requested, marked ready, reopened or unlinked, so the task shows up without a page refresh.
