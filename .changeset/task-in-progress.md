---
'@operai/activities-api': minor
'@operai/ui': minor
'@operai/crm-ui': minor
'@operai/projects-ui': minor
---

A task can now be marked "In progress", in the CRM and in Projects. Whoever can mark a task done can start it and stop it again; a task waiting on other tasks cannot be started until they are done. Done is still one click away from Open, and reopening a done task makes it open. The task lists' "Open" view includes tasks in progress (with an "In progress" badge), and a new "In progress" view shows only those. The task shows who started it and when.
