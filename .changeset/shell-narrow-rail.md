---
"@operai/shell": patch
---

Below 640 px the tool navigation stays the icons-only rail whatever was chosen before, so a tool's content is no longer squeezed to a column a few words wide at 320 px (WCAG 1.4.10). There the toggle opens the expanded navigation as a panel over the content; Escape, a click outside it or a navigation closes it, and it is not remembered. Wider screens keep the stored collapse choice as before.
