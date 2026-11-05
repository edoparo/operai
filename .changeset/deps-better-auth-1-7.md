---
"@operai/auth": patch
"@operai/admin-ui": patch
"@operai/crm-ui": patch
"@operai/estimai-ui": patch
"@operai/inventory-ui": patch
"@operai/notify-ui": patch
"@operai/refund-ui": patch
"@operai/shell": patch
"@operai/ui": patch
---

Dependency security update. better-auth moves to 1.7.18 everywhere, closing the advisory that let an OAuth state be used as a magic link to sign in as another user. The frontends move to vitest 4 and refreshed lockfiles, which clears the critical seroval and tinypool advisories. auth gains a migration adding three optional key columns that better-auth 1.7 expects on its signing-key table.
