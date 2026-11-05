---
"@operai/auth": patch
"@operai/admin-ui": patch
---

Access requests follow-ups: an invitation conflict (409) now names its cause in a `code` field (`active_user_exists` / `pending_invitation_exists`); in the Admin tool, deciding the last request on a page returns to the previous page instead of an empty list, and the list shows a focus ring when it takes keyboard focus after a decision.
