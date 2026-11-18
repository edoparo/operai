---
"@operai/inventory-api": minor
"@operai/inventory-ui": minor
---

Inventory: an employee who has not confirmed or declined an assigned device is reminded by email and in Operai 24 hours after the offer, then every week until they answer. An inventory manager can send a reminder now from the asset (at most one an hour); the asset shows how many reminders went out and when the next one is due, and each one is in its history. Requires `emails.send` for inventory-api's service client in auth's `SERVICE_CLIENTS` before deploying.
