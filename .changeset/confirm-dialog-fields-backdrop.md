---
"@operai/ui": patch
"@operai/refund-ui": patch
---

A `ConfirmDialog` with `fields` no longer closes on a backdrop click, so a typed reason is not thrown away (Escape, × and Cancel still close it), as the design system already required of every dialog holding input. In Refund, "Reject line" is now a `danger` button like the request-level Reject, and an empty reason moves focus to the field and is also flagged when leaving it after typing.
