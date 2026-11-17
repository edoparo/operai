---
'@operai/auth': minor
---

Add the `letterheads` permission catalog (specs/20261116-letterhead-service): `letterheads:access` and the entity-conditioned `letterhead:manage`, registered in the declared catalogs and the app list. The seed gives both to `admin` only, `letterhead:manage` unconditioned; every other role gets them by an administrator's grant. Add `letterhead:render` to the known service scopes, so a service client (crm-api first) can mint a token the letterhead service verifies.
