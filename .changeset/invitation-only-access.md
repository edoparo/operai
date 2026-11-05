---
"@operai/auth": minor
"@operai/admin-ui": minor
"@operai/notify-api": patch
---

Operai is now invitation-only. Signing in creates a user only for someone holding a valid invitation or an email in an allowed domain (`ALLOWED_SIGNUP_DOMAINS`); anyone else sees a page explaining this and can ask for access. Admins review these requests in a new waiting list in the Admin tool and approve one into an invitation or dismiss it, and are notified of new requests.
