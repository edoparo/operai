---
"@operai/ui": minor
"@operai/shell": patch
"@operai/estimai-ui": patch
"@operai/refund-ui": patch
"@operai/admin-ui": patch
"@operai/notify-ui": patch
"@operai/inventory-ui": patch
---

One styling dialect across the suite (ADR-0051): colours and fonts are Tailwind
utilities generated from the shared design tokens, never inline styles, and a
lint rule keeps it that way. Hover and focus colours now apply where inline
colours used to override them, date pickers follow the light theme, EstimAI's
AI purple and tinted highlights follow the theme too, and each tool's
standalone build uses the suite's real tokens instead of a stale copy.
