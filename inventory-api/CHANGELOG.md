# @operai/inventory-api

## 0.2.0

### Minor Changes

- 26521e2: The supplier field now suggests the suppliers already in the register, on the
  register form and in the Edit dialog. It is still free text: a new supplier is
  typed as before. Suggestions come from a new `GET /suppliers` endpoint, limited
  to the entities the caller can read.

### Patch Changes

- 80400be: Remove the Cloudflare CLI (`cf`) from the service's dependencies. It was added by
  mistake and never recorded in `bun.lock`, so the image build, which installs with
  a frozen lockfile, failed.
- c30a110: Mark the S3 residency allowlist and path-style addressing in `src/lib/s3Residency.ts` with `shared-copy` begin/end comments, so a CI check can fail when the copies across the backends drift. Comment-only: no behaviour change.
- 81f0af0: The shared notification token is retired. `notify-api`'s two internal routes,
  `POST /system/emails` and `POST /system/notifications`, now accept only a scoped
  service credential from the caller; the `X-Internal-Token` header is refused with
  401 and the `NOTIFY_INTERNAL_TOKEN` setting is no longer read, so a deployment that
  still has it set starts normally. `inventory-api`'s comments and example file no
  longer mention the shared token.
- 041cf92: Mark the service-token client's shared region in `src/lib/serviceToken.ts` with
  `shared-copy` begin/end comments so a CI check can fail when the three copies drift.
  Comment-only: no behaviour change.

## 0.1.0

### Minor Changes

- 2b11a53: New Inventory tool (specs/20261006-hardware-inventory): a hardware register with assets, employee-confirmed
  assignment, a depreciation ledger with fiscal-year close, and invoice files.

  `inventory-api` and `inventory-ui` are new. The shell mounts the gated `/inventory` route
  and an ungated `/devices` route (a "My devices" screen for every signed-in user). `auth`
  gains the inventory permission catalog, a scoped service-token endpoint and a capability-gated
  user directory. `notify-api` accepts the scoped service JWT on `/system/notifications` and a new
  `inventory` origin app, which `notify-ui` renders. New environment variables must be set before
  deploying: see `infra/README.md` § `inventory-api` service.

  `auth GET /authz/resolve` now returns no permissions for a soft-deleted user, so a removed
  user loses access to `refund-api` and `inventory-api` within 30 seconds instead of keeping it
  until their token expires.
