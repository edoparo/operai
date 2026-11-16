---
"@operai/shell": patch
"@operai/estimai-ui": patch
"@operai/refund-ui": patch
"@operai/admin-ui": patch
"@operai/notify-ui": patch
"@operai/inventory-ui": patch
"@operai/crm-ui": patch
"@operai/projects-ui": patch
---

Patch the `zod` and `undici` advisories in the frontends' lockfiles: `zod` (reached through better-auth and eslint-plugin-react-hooks) moves to 4.6.7 and `undici` (reached through jsdom, tests only) to 7.30.1. Lockfile-only, both within the parents' existing ranges; no package.json change.
