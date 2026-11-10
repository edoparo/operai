---
"@operai/refund-api": minor
"@operai/refund-ui": minor
---

Accounting can reject a single expense line instead of the whole refund request, and must give a reason. The rejected line pays nothing, shows its reason to the employee once the request is approved (and in the archive PDF), and can be restored until the request is decided. A request whose every line is rejected can no longer be approved — it has to be rejected as a whole. New endpoints `POST`/`DELETE /review/requests/{id}/lines/{lineId}/reject` (gated on `request:reject`), audit actions `line_rejected`/`line_restored`, and a migration adding the rejection columns to `refund_line`.
