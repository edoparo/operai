# letterhead-api perf

Latency of the render routes for a 10-page offer, against the targets of the spec
(`specs/20261116-letterhead-service`): **AC-1.9** preview p95 < 1 s, **AC-1.10** PDF p95 < 3 s. Run with
[Bun](https://bun.sh); nothing to install.

| File | What |
| --- | --- |
| `render-perf.ts` | 50 sequential previews and 50 sequential PDFs of the same 10-page document; prints p50, p95 and the others; `--json` writes every sample. Exit 3 when a budget is missed. |
| `worst-case.ts` | Not a latency test. Sends the worst accepted request (a table of ~5 000 blocks) `--concurrency` times at once, to see that the container's memory limit holds the pool. |
| `seed-local.ts` | Local only. Seeds one `welld_it` letterhead version (the golden `brand` letterhead and its three assets) into a local database and bucket, because the person routes that save one do not exist yet. Refuses a non-local host. |
| `preview-edits.ts` | What a person waits for, end to end (T34): 40 scripted edits in the Letterheads configurator and in the CRM wizard, in headless Chromium through the real shell; time from the edit to the new pages painted; p50/p95. AC-8.4 and AC-10.4, 2 s p95. |
| `auth.ts` | The command line and the credential, shared by the two scripts. |

**The document.** The golden corpus's `offer-it` (`engine/tests/golden/fixtures/offer-it.json`: Italian, nine sections, a
cost table, lists, an image, a page break; 4 pages) with its blocks repeated and cut at the first block that makes the
layout reach exactly 10 pages. There is no 10-page fixture in the repository, so the script asks the service for the page
count while it searches (a preview of page 1 only) and prints the block count and the SHA-256 of the request: two runs
with the same digest measured the same document (today: 125 blocks, 23 469 bytes, `58d9c9e3265c1358`).

**What is timed.** The client's clock from sending the request to having read the whole answer. A preview is the whole
answer a caller gets: every page as a 64-colour PNG, and its text (about 870 KB for 10 pages). Sequential, one
connection, after 2 renders that are not counted (the first one reads the logos from the bucket; the service keeps them).
p50 and p95 are nearest-rank: the 25th and the 48th of 50 sorted samples. An answer that is not a 200 for a 10-page
document aborts the run.

## Locally, in a container with the Railway limits

The limits are the ones declared in `.railway/railway.ts` for `letterhead-api`
(`limitOverride`: 2 vCPU, 5 000 000 000 bytes = 5 GB: 2 workers x 2 GiB plus the supervisor). A container with the same cgroup limits is a **proxy** for the Railway
service: the CPU architecture, the clock and the noise of the neighbours are not Railway's. It is not a
measurement of the deployed service, which is T40.

```bash
# 1. Image, from the repository root
docker build -t letterhead-api:T13 letterhead-api

# 2. A database of your own on the compose Postgres (never the shared `letterhead`), migrated as Railway's preDeploy does
docker exec <postgres-container> psql -U postgres -d postgres -c 'CREATE DATABASE letterhead_lh_t13'
docker run --rm --add-host host.docker.internal:host-gateway \
  -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5435/letterhead_lh_t13 \
  letterhead-api:T13 letterhead-api migrate

# 3. A bucket of your own on MinIO, one letterhead version, its assets
bun letterhead-api/perf/seed-local.ts \
  --database-url postgresql://postgres:postgres@localhost:5435/letterhead_lh_t13 \
  --s3-endpoint http://localhost:9000 --bucket letterhead-lh-t13

# 4. The service, as Railway starts it (RAILWAY_PRIVATE_DOMAIN set: it binds [::]), with the declared limits.
#    The JWKS URL is this machine's port 18089, which render-perf.ts serves while it runs.
docker run -d --name letterhead-api-t13-perf --cpus=2 --memory=5000000000 --memory-swap=5000000000 \
  -p 18088:8088 --add-host host.docker.internal:host-gateway \
  -e PORT=8088 -e RAILWAY_PRIVATE_DOMAIN=letterhead-api.railway.internal \
  -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5435/letterhead_lh_t13 \
  -e AUTH_ISSUER=http://localhost:3001 -e AUTH_JWKS_URL=http://host.docker.internal:18089/auth/jwks \
  -e AUTH_BASE_URL=http://host.docker.internal:18089 -e AUTH_AUDIENCE=operai-suite -e SERVICE_AUDIENCE=operai-service \
  -e ALLOWED_ORIGINS=http://localhost:5173 \
  -e LETTERHEAD_S3_ENDPOINT=http://host.docker.internal:9000 -e LETTERHEAD_S3_REGION=us-east-1 \
  -e LETTERHEAD_S3_BUCKET=letterhead-lh-t13 -e LETTERHEAD_S3_ACCESS_KEY_ID=minioadmin \
  -e LETTERHEAD_S3_SECRET_ACCESS_KEY=minioadmin -e LETTERHEAD_S3_EU_ENDPOINT_HOSTS=host.docker.internal \
  letterhead-api:T13 letterhead-api

# 5. The measurement (a fake issuer is fine). Wait 30 s between runs: see below.
bun letterhead-api/perf/render-perf.ts --base-url http://localhost:18088 --local-auth \
  --issuer http://localhost:3001 --audience operai-service --jwks-port 18089 --json perf.json

# 6. Optional: does the memory limit hold two worst-case requests at once?
bun letterhead-api/perf/worst-case.ts --base-url http://localhost:18088 --local-auth \
  --issuer http://localhost:3001 --audience operai-service --jwks-port 18089 --detail-chars 130 --concurrency 2
docker exec letterhead-api-t13-perf sh -c 'cat /sys/fs/cgroup/memory.peak; grep oom /sys/fs/cgroup/memory.events'

# 7. Clean up
docker rm -f letterhead-api-t13-perf
```

`--local-auth` generates a new key on every run. The service fetches the key set again for an unknown `kid` at most once
every 30 s (`api/src/auth/service.rs`, `COOLDOWN`), so a second run within 30 s of the first is refused with 401: wait.
That is the service working as designed, not a flaw in the script.

The database and the bucket of a local run are left in place: the tables refuse `DELETE`, by design, and a database is
never dropped by a script.

## On the deployed service (T40)

The seed script is **not** used there: its rows could never be removed, and a version 1 made by a script would make the
first real save of the entity a `version_conflict` (`baseVersion` 0). A `welld_it` letterhead version must have been saved
through the service's own routes first; without one every render answers 409 `letterhead_not_configured` (AC-4.4: no
fallback). The runbook is in `infra/README.md` § `letterhead-api` service.

```bash
read -rs LETTERHEAD_PERF_CLIENT_SECRET && export LETTERHEAD_PERF_CLIENT_SECRET   # paste, Enter: never an argument
export LETTERHEAD_PERF_CLIENT_ID=letterhead-perf
bun letterhead-api/perf/render-perf.ts --base-url https://letterhead-api.operai.welld.io \
  --auth-url https://auth.operai.welld.io --json perf-deployed.json
```

A run from a laptop includes the round trip to `europe-west4`. The service's own log line has the server's time for each
render (`render route=preview … pages=10 ms=148`); `railway logs --service letterhead-api` gives the server side to put
beside the client side. Record both.

## The previews, as a person sees them (T34)

`preview-edits.ts` is not a test of the service's routes (that is `render-perf.ts`) but of the two screens that draw its pages:
the configurator (AC-8.4) and the CRM wizard (AC-10.4), 2 s at p95 each. It needs the e2e suite's stack (shell, letterheads-ui,
crm-ui, `auth` with ENABLE_TEST_AUTH, crm-api with `LETTERHEAD_SERVICE_ENABLED=true` calling the service directly,
`DATABASE_URL` of `auth` for the first admin, `PLAYWRIGHT_BROWSERS_PATH`) and the container above, started from the image of the
branch:

```bash
bun letterhead-api/perf/preview-edits.ts --json perf-previews.json --container letterhead-api-t13-perf
```

Each edit is a `fill` of a text field whose new text ends up on the pages; the clock runs from the field's `input` event until
the pages carrying it are in the DOM, ready, and painted (two animation frames). The wizard is measured on a 10-page offer and on
a 25-page worst case. `--container` adds the service's own time for the wizard's renders. The result of the local run
(a proxy, as above) is in `specs/20261116-letterhead-service/spike.md` § Not measured; the deployed run joins T40.
