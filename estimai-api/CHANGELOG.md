# @operai/estimai-api

## 0.2.0

### Minor Changes

- 3172659: EstimAI list (specs/20261108-estimate-list-oversight): an admin can list and open every estimate read-only (new `estimate:read-all` permission, seeded to `admin`; ADR 20261108-estimai-oversight-permission-amends-0036); closed estimates move from the default Open list to a Closed filter; an estimate linked to a CRM deal shows a Deal badge, kept up to date by crm-api's new deal-link notices (scope `deal-link-notices.send`, ADR 20261108-crm-pushes-deal-links-to-estimai). Deploy auth first, then add the scope to crm-api's `SERVICE_CLIENTS` entry, set `SERVICE_AUDIENCE` on estimai-api and `ESTIMAI_INTERNAL_URL` on crm-api, deploy both, and run `crm-api/scripts/backfill-estimate-links.ts --apply` once.
- d549baf: A technical estimate is finished when it is closed in EstimAI. The owner or an editor closes it from the estimate page, after which it is read-only until someone reopens it. The CRM follows on its own: the deal's estimate turns ready, its task is completed, and the requester and the deal owner are told; reopening it in EstimAI reverses that. The CRM no longer has its own "Mark ready" and "Reopen" buttons. Needs `estimate-notices.send` on estimai-api's service client in auth, `CRM_INTERNAL_URL` on estimai-api and `SERVICE_AUDIENCE` on crm-api.
- 0b3b843: Second of three pushes that retire the shared notification token (specs/20261013-notify-service-credentials,
  ADR 20261013-auth-mints-own-service-credential-in-process/0049). Every notify-api caller now authenticates as itself with a scoped,
  short-lived service credential and no longer reads `NOTIFY_INTERNAL_TOKEN`: `auth`
  mints its own `emails.send` credential in process for invitation emails,
  `refund-api` uses `notifications.push` for decisions and `emails.send` for the batch
  email, and `estimai-api` uses `notifications.push` for collaborator changes. A caller
  whose credential is missing or refused fails soft exactly as before. `notify-api` still
  accepts the shared token until it is deleted from the deployed services.

### Patch Changes

- f888a45: Security-review hardening for the estimate oversight: a revoked `estimate:read-all` stops working on the next request, a deal-link notice dated more than 5 minutes ahead is refused, and an oversight list over 500 estimates is logged.
- 041cf92: Mark the service-token client's shared region in `src/lib/serviceToken.ts` with
  `shared-copy` begin/end comments so a CI check can fail when the three copies drift.
  Comment-only: no behaviour change.

## 0.1.1

### Patch Changes

- bdf998c: Bind backends to IPv6 (::) on Railway (when RAILWAY_PRIVATE_DOMAIN is set) so private networking (\*.railway.internal) can reach them. Enables moving cross-service call URLs (AUTH_JWKS_URL / AUTH_BASE_URL / NOTIFY_INTERNAL_URL) to internal DNS and shared/reference variables (Layer 2), reducing the env-var sprawl. Local dev unchanged (keeps Bun default IPv4).
