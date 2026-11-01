---
"@operai/ui": minor
"@operai/refund-ui": minor
"@operai/shell": patch
---

New shared design system `@operai/ui` (operai-ui/, ADR-0050): the suite's tokens,
themes and component classes move into it from the shell, together with React
components (buttons, dialogs, banners, badges, fields, tables, page and tool
layout, empty and loading states) and a Storybook. refund-ui is the first app
built on it: its dialogs now share one focus and keyboard behaviour, its buttons
follow the suite's variants, and its secondary text and status colours meet
WCAG AA in both themes. Suite-wide, `font-mono` now renders DM Mono as intended,
and the shell's Tailwind scan includes notify-ui.
