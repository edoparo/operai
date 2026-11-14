# crm-api

The CRM's resource server (specs/20261101-crm, ADR 20261101-crm-tool-shape-and-authorization): companies, contacts, deals, the pipeline,
activities and tasks. Bun + Hono + Prisma, port **8084**, logical database **`crm`**. Live API
reference at `http://localhost:8084/docs`.

## Environment

The environment is validated at startup by `src/lib/env.ts`. The resource-server set is
required. specs/20261101-crm-sales-flow adds two optional groups: without them, crm-api starts and only the
estimate routes, or the offer and attachment routes, answer 503 (`estimai_unconfigured`,
`storage_unconfigured`). specs/20261101-crm-notifications adds a third, the notify group: without it nothing is
sent and nothing fails.

| Variable | Local value | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://<user>:<password>@localhost:5435/crm` | the compose Postgres; same credentials as the other backends |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | the shell; crm-ui is a federated remote |
| `AUTH_JWKS_URL` | `http://localhost:3001/auth/jwks` | |
| `AUTH_ISSUER` | `http://localhost:3001` | must equal auth's `BETTER_AUTH_URL` |
| `AUTH_AUDIENCE` | auth's `AUTH_AUDIENCE` (`operai-suite` locally) | |
| `AUTH_BASE_URL` | `http://localhost:3001` | `/authz/resolve`, `/authz/users/identities` |
| `PORT` | `8084` (default) | |
| `ESTIMAI_API_URL` | `http://localhost:8080` | optional; estimate requests and offers (called with the caller's own JWT) |
| `CRM_S3_ENDPOINT` | `http://localhost:9000` | optional group, all five or none; the compose MinIO |
| `CRM_S3_REGION` | `us-east-1` | an opaque placeholder for a non-AWS endpoint |
| `CRM_S3_BUCKET` | `operai-crm-files-dev` | created by `minio-createbucket` in compose.yaml |
| `CRM_S3_ACCESS_KEY_ID` / `CRM_S3_SECRET_ACCESS_KEY` | the MinIO root user (`minioadmin` / `minioadmin` by default) | secrets in any shared environment |
| `CRM_S3_EU_ENDPOINT_HOSTS` | `localhost` | required for a non-AWS endpoint: the EU residency allowlist (ADR 20260716-eu-object-storage-refund-attachments) |
| `NOTIFY_INTERNAL_URL` | `http://localhost:8081` | optional group, all three or none (specs/20261101-crm-notifications): without it the CRM sends no notifications |
| `SERVICE_CLIENT_ID` | `crm-api` | its entry in auth's `SERVICE_CLIENTS` needs scope `notifications.push emails.send` |
| `SERVICE_CLIENT_SECRET` | the secret of that entry, at least 32 characters | secret |

`mise run dev` starts it with `direnv exec .` like every backend. The setup follows the other
backends:

- `.envrc` (committed) contains no secrets. It loads the root `.envrc` (`source_up`), builds
  `DATABASE_URL` from the root `POSTGRES_*` values, and then loads `.env`.
- `.env.example` (committed) holds the other variables, all of them not secret. Copy it to
  `.env`, which is gitignored.

Once, then `direnv allow crm-api`:

```bash
cp crm-api/.env.example crm-api/.env
```

The shell needs `VITE_CRM_API_URL=http://localhost:8084` in `shell/.env`. Without it,
`apiFetch` does not trust the crm-api origin and the CRM shows "Could not load".

## Commands

```bash
bun install
bun run db:migrate     # creates/updates the `crm` database (Prisma migrate dev)
bun run dev            # http://localhost:8084
bun run typecheck
bun test               # needs DATABASE_URL pointing at a disposable DB: tests TRUNCATE the tables
```

Tests run the assembled app against a real Postgres with the JWT and `/authz/resolve` mocked
(`src/test-support/`). Use a separate database, e.g. `crm_test`, migrated with
`bun run db:deploy`.
