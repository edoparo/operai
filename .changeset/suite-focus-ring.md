---
"@operai/ui": minor
"@operai/inventory-ui": patch
---

Keyboard focus is now visible the same way in every tool: a 2px accent ring
(`--focus-ring`, at least 5.2:1 in both themes) on every focusable element,
from the shared tokens. It used to exist only in Inventory's standalone build,
so inside the suite no tool had it.
