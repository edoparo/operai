---
"@operai/crm-api": minor
"@operai/crm-ui": minor
---

CRM tasks can be blocked by other tasks (specs/017 US-6). When a task is created or edited, it can wait on up to 10 open tasks of the same company, for example the deal's estimate task. While one of them is open, the task shows as Blocked, lists what it waits on and cannot be marked done. When the last one is done, including when the estimate is marked ready, the assignee is told in-app and by email.
