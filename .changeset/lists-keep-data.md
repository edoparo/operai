---
"@operai/meetings-ui": patch
"@operai/crm-ui": patch
"@operai/projects-ui": patch
---

Lists no longer blank to a loading skeleton when you come back to them or when they reload after a change: they show what was last loaded at once and refresh it in the background (Meetings list, templates and folders; CRM companies, contacts, pipeline and tasks; Projects list and My tasks). Kept in memory only, for the open tab.
