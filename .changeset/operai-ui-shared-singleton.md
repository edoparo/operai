---
"@operai/shell": patch
"@operai/estimai-ui": patch
"@operai/refund-ui": patch
"@operai/admin-ui": patch
"@operai/notify-ui": patch
"@operai/inventory-ui": patch
"@operai/crm-ui": patch
"@operai/meetings-ui": patch
"@operai/projects-ui": patch
---

The design system `@operai/ui` is compiled once, by the shell, and shared with every remote as a Module Federation singleton: remotes declare it with `import: false` and no longer bundle it (ADR 20261114-operai-ui-shared-singleton-provided-by-the-shell). The rich-text entry is still compiled by crm-ui, meetings-ui and projects-ui.
