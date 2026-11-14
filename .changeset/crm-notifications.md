---
"@operai/crm-api": minor
"@operai/notify-api": minor
"@operai/notify-ui": minor
"@operai/shell": minor
"@operai/auth": minor
---

CRM notifications (specs/20261101-crm-notifications, ADR 20261101-notify-api-resolves-email-notice-address-from-auth):
- **Notifications:** the CRM notifies people in the app when work is handed to them or concerns them: estimate requests and hand-backs, a new deal owner, an assigned task, a gate override, won and lost deals, a generated offer.
- **Email notices:** estimate requested, ready or reopened, a new deal owner and an assigned task also send an email, in English. None of them contains any money.
- **notify-api:** `POST /system/notifications` accepts `email: true`. The caller then needs the `emails.send` scope as well. notify-api looks up the recipient's address in auth and sends the new `notification_notice` email.
- **auth:** new service endpoint `POST /system/users/contact` and new scope `users.contact`.
- **Notification center:** `crm` is a new origin, shown in the bell and the notification center.
