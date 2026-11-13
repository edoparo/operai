---
"@operai/refund-ui": minor
"@operai/admin-ui": minor
"@operai/shell": patch
---

The refund tool's settings (mileage rates per entity and the accounting distribution email) move from Admin to a new Settings tab in Refund (`/refund/settings`), shown to whoever holds `rate:read` or `settings:read`. Admin no longer has a Refund section.
