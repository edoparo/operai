---
"@operai/auth": patch
"@operai/estimai-api": patch
"@operai/notify-api": patch
"@operai/refund-api": patch
"@operai/inventory-api": patch
"@operai/crm-api": patch
"@operai/meetings-api": patch
"@operai/projects-api": patch
"@operai/activities-api": patch
---

Migration logs on Railway no longer show as errors: `bun run` no longer echoes the command on stderr (`[run] silent = true`) and `db:deploy` sends Prisma's informational stderr to stdout. A failing migration still exits non-zero and fails the deploy.
