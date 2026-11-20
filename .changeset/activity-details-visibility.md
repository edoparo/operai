---
'@operai/activities-api': minor
'@operai/crm-api': minor
'@operai/crm-ui': minor
'@operai/projects-ui': patch
---

The author of a CRM activity or task now chooses who sees its details: everyone (the default, and every existing activity), the sales team (people who manage deals: today sales and admin), or only the author and, for a task, its assignee. Everyone else still sees the activity, its subject, people, dates and state, but not its text, description, pictures or attachments; it reads "Details are restricted". No role overrides the choice, administrators included. The subject is always visible, and the form says so. Projects' My tasks shows the same restricted line on a CRM task.
