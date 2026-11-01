---
"@operai/ui": minor
"@operai/shell": patch
"@operai/refund-ui": patch
"@operai/admin-ui": patch
"@operai/inventory-ui": patch
"@operai/estimai-ui": patch
---

The design system gains `Menu` (the header's logo and account menus, now with
full keyboard support) and `CheckboxGroupField` (pick several options from a
list), and `ConfirmDialog` can ask for an acknowledgement and hold fields.
Refund's "Mark as paid" and Inventory's dispose, close-year and new-rule
dialogs now share that confirmation; Admin's role and department checklists
and Inventory's invoice linking share the checkbox group. Success messages
dismiss themselves after the same time in every tool.
