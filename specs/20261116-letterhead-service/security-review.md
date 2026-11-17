# Security review: letterhead-service (OWASP Top 10, 2021)

Branch `feat/letterhead-service`, diff `932de77a...HEAD`. Reviewed by reading the code against the plan (incl. § Security and both Amendments) and the five ADRs of 2026-11-16.

Method and limits: static review only. No `cargo`, `bun`, `osv-scanner` or `cargo-audit` is installed on this machine, so no test or script was run and no dependency advisory was looked up. The finding F2 rests on reading the code, not on running it.

**Verdict: REVIEW REQUIRED** (2 medium, 9 low, 4 info; no critical or high). Nothing found blocks the merge by itself. F1 and F2 should be fixed or consciously accepted before the CRM switch is turned on.

| Severity | Count | Findings |
| --- | --- | --- |
| critical | 0 | |
| high | 0 | |
| medium | 2 | F1, F2 |
| low | 9 | F3 to F11 |
| info | 4 | F12 to F15 |

## Findings

### F1 (medium) A04 Insecure Design: one shared caller identity and no per-user throttle let one CRM user starve offer generation

- Where: `letterhead-api/api/src/routes/render.rs:170` (`app.pool.admit(&caller.0)`), `letterhead-api/api/src/pool/mod.rs:68` (`DEFAULT_PER_CALLER_QUEUE = 2`), `letterhead-api/api/src/routes/preview.rs:173-176` (person previews use the same small pool), `crm-api/src/offer-drafts/offerDrafts.routes.ts` (preview route), `crm-api/src/offer-templates/offerTemplates.routes.ts` (try-preview route), `crm-api/src/lib/letterheadClient.ts` (one retry on 429, then 503).
- Evidence: the pool is 2 workers, 4 queued, 2 per caller (`tools/env-doctor/templates/production/letterhead-api.env`: `LH_WORKERS=2`, `LH_QUEUE=4`). Every CRM user reaches the service as the single identity `system:crm-api`, so the per-caller share (2 waiting) is shared by all CRM users and by offer generation. crm-api has no rate limit or in-flight cap on `POST /deals/{id}/offer-draft/preview` or `/offer-templates/{id}/try-preview`; each call can render up to 300 pages. A few parallel previews from one account (a script, or a buggy client) fill the queue, and other people's previews and `generate` (business-critical, writes an offer number) get 429, then 503 `layout_service_unavailable`. Person previews (`person:<sub>`) are bounded per person but two persons can still fill the whole queue (4). `generate` also holds a DB transaction and the deal lock for up to 50 s while it waits (`crm-api/src/offers/generation.ts:504`), so a slow queue also ties up Prisma connections.
- Impact: availability of the offer flow for all CRM users, caused by any one authenticated user. No data exposure.
- Fix:
  1. In crm-api, bound preview work per user: one in-flight preview per `sub` (cancel or reject the superseded one) and a small token bucket, for example in a Hono middleware on the two preview routes.
  2. In letterhead-api, reserve capacity for the PDF route: admit `/v1/render/pdf` from a separate class (one reserved worker or queue slot) so a preview flood cannot take it. A cheap way is a second `admit` key such as `"{caller}:pdf"` with its own per-caller share, plus a floor of free slots kept for it.
  3. Keep `OFFER_TRANSACTION` generous, but consider rendering before opening the transaction (the render is idempotent) so a slow service does not hold the deal lock.

### F2 (medium) A04/A05: the save-time and preview "fit" check compiles Typst inside the API process, outside the killable worker pool

- Where: `letterhead-api/api/src/routes/write.rs:80,340-362` (`fit`, `FIT_SLOTS`, `spawn_blocking(... check_fit ...)`) and `letterhead-api/api/src/routes/preview.rs:95,361-387`.
- Evidence: ADR 20261116-renders-run-in-killable-worker-processes... and plan F3 say untrusted layout work runs in a worker with a deadline and an RSS cap. `check_fit` runs `AssetFiles::of(config, assets)` and up to 12 Typst compiles (2 languages x 3 variants x 2 frames), measuring the logo and drawing the background. That decodes the person's uploaded PNG, JPEG or SVG (up to 25 MP per raster) in the supervisor process. `spawn_blocking` work cannot be cancelled: no deadline, no RSS cap. The two files each have their own `Semaphore(2)`, so up to 4 such jobs can run at once. `POST /v1/letterheads/{entity}/preview` needs only `letterheads:access`, and any asset id of the entity can be read from a version's config, so the in-process path is reachable without `manage`.
- Impact: a pathological stored asset or config can pin CPU or memory in the one process that also serves every render and holds the worker pool, with nothing able to kill it. An OOM kill of that process takes the pool down for all callers (container limit 5 GB).
- Fix: run `check_fit` as another job type in the worker pool (same `Permit`, deadline and RSS cap, same wire format), and drop the two static semaphores. If that is too large for this release, at least add a wall-clock budget by running the check on a dedicated thread plus a watchdog that aborts the process on overrun, and record the exception in ADR "renders-run-in-killable-worker-processes" as a known gap.

### F3 (low) A03/A04: SVG sanitiser panics on an element inside `<style>` (500 instead of 422)

- Where: `letterhead-api/engine/src/assets/svg.rs:509-513` and `:526-527`.
- Evidence (by reading, not run): for `<svg><style><rect/></style></svg>`, `element_open` handles `<style>` by setting `in_style = true` and pushing the sentinel `usize::MAX` on `self.stack` (line 512). The next element, `<rect/>`, takes the `Some(name)` path, pushes a node, then does `self.nodes[*parent]` with `*parent == usize::MAX` (line 527), which is an index-out-of-bounds panic. `element_close` would have refused `<style>` later (line 539), but never gets there. The test `nothing_a_caller_sends_makes_ingestion_panic` (`assets/tests.rs`) uses a random mutator with six seeds and none of them has a `<style>` containing an element, so it does not cover this.
- Impact: the panic is caught by `spawn_blocking`, so the process does not die. The upload route (`write.rs:135-139`) and the render route (`render.rs:176-179`) answer 500 `internal_error` / `render_failed` instead of the contract's 422 `invalid_asset` / `invalid_content` (`svg_not_allowed`). The default panic hook prints a location and index only, no request text. No bypass of the sanitiser: the input is refused either way. It also contradicts the "no input panics" claim in the tests, and a build with `panic = "abort"` would turn it into a process kill.
- Fix: refuse `<style>` as soon as its start tag is seen, before anything is pushed:

```rust
// element_start, with the other early refusals
if local.eq_ignore_ascii_case("style") {
    return Err(Reason::SvgNotAllowed);
}
```

  and delete the `in_style` / `usize::MAX` machinery, or at least make `element_open` return `Err(Reason::SvgNotAllowed)` when `self.in_style` is set. Add `<svg><style><rect/></style></svg>` and `<svg><style><g><style/></g></style></svg>` to the refused list and to the fuzz seeds.

### F4 (low) A05: the person's bearer token is forwarded to `AUTH_BASE_URL`, which may be plain `http` to any host

- Where: `letterhead-api/api/src/env.rs:360-372` (`url()` accepts `http` or `https`), `letterhead-api/api/src/authz/resolve.rs:165-172` (sends `Authorization: Bearer <person token>`), `authz/mod.rs:95`.
- Evidence: the production template uses the Railway private network (`http://${{auth.RAILWAY_PRIVATE_DOMAIN}}:${{auth.PORT}}`), which is acceptable. The guard that would catch a mistake does not exist: a typo or a copy of a public host with `http://` starts the service, and then every person token crosses the network in clear.
- Fix: at startup, accept `http` only for loopback, `*.railway.internal`, or `host.docker.internal` / `localhost` (dev); otherwise require `https`. The same rule for `AUTH_JWKS_URL` (a tampered key set means forged tokens).

### F5 (low) A05: worker isolation is a cleared environment only; same uid, no syscall or file-system confinement

- Where: `letterhead-api/api/src/pool/mod.rs:184-201` (`env_clear`, stderr null, `kill_on_drop`), `letterhead-api/api/src/worker.rs`.
- Evidence: the worker is the same binary under the same uid. `env_clear()` keeps the secrets out of the worker's own environment, but a worker that is compromised (a bug in the Typst, PNG, JPEG or font code) can read `/proc/<parent pid>/environ` (`DATABASE_URL`, the S3 key pair) and can open sockets. The plan's "no network syscall" claim is checked by a test of what the worker code does, not by a restriction on what the process may do.
- Impact: only matters after a memory-safety or logic bug in a dependency; the code is `unsafe`-free. Defence in depth.
- Fix: confine the worker before it reads a job: Landlock plus a seccomp allowlist via a safe crate (no `unsafe` in this workspace), or start the worker under a distinct uid with `Command::uid` if the container starts as root and drops privileges. Also keep secrets out of the supervisor's environment where possible (read them once, then re-exec without them is not possible, so the uid or Landlock route is the real fix).

### F6 (low) A05: the service routes are exposed on the public domain

- Where: `.railway/railway.ts:132` (`domains: [{ domain: "letterhead-api.operai.welld.io", port: 8088 }]`), `letterhead-api/api/src/main.rs:152-168` (one listener for both route sets), `axum::serve` with no header-read timeout or connection cap.
- Evidence: the person routes need a public origin (the browser calls them). `/v1/render/*` and `/v1/letterheads/status` are only called by crm-api, over the private network, yet they are reachable from the internet on the same port. They are protected (RS256, issuer, audience, scope, `system:` sub; identical 401), so this is attack surface, not an auth bypass. The pre-auth work is small: 16 KiB token cap, JWKS refetch limited to once per 30 s per process.
- Fix: serve the service routes on a second listener bound to the private interface only (`RAILWAY_PRIVATE_DOMAIN` is already detected for the bind address), leave the public port with the person routes, and add header-read and idle timeouts (hyper `header_read_timeout`) to the public one.

### F7 (low) A04/A08: uploaded asset can be left orphaned in the bucket

- Where: `letterhead-api/api/src/routes/write.rs:152-169`.
- Evidence: the object is `put` to the bucket first and the row inserted second. If `insert_asset` fails (database down, unique violation), the object stays and nothing refers to it. The sweep (`db/repo.rs:229`, "24 h sweep") finds objects through rows, so it never sees this one. Also, uploads have no concurrency cap and `read_body` pre-allocates the declared length (up to 2 MiB + 64 KiB, `write.rs:527`) before any byte arrives; the caller needs `letterhead:manage`.
- Impact: slow bucket growth with images of at most 2 MiB each; minor memory spike per concurrent upload. Content in these objects is logos and backgrounds, already sanitised.
- Fix: on an insert error, `delete_object(Storage::object_name(id))` best-effort before returning; limit concurrent uploads with a small `Semaphore` as the fit check does; cap the pre-allocation at 64 KiB and let the `Vec` grow.

### F8 (low) A06: no advisory scan covers the Rust dependency tree

- Where: `.github/workflows/letterhead-api.yml` (no `cargo audit` / `osv-scanner` step), `letterhead-api/Cargo.lock`.
- Evidence: the workflow runs fmt, clippy, tests, the golden corpus and conformance only. The service parses untrusted images, SVG, JSON, fonts and PDFs with `typst` 0.15.1, `png` 0.18.1, `image` 0.25.10, `xmlparser` 0.13.6, `axum` 0.8.9, `sqlx` 0.9.0, `aws-sdk-s3` 1.159.0, `rustls` 0.23.46. I could not check any of these against an advisory database offline, so I make no claim about their state.
- Fix: add `osv-scanner --lockfile letterhead-api/Cargo.lock` (the repo's gate tool) or `cargo audit --deny warnings` as a step, and run it on a schedule too, so a new advisory on a pinned version is seen without a code change.

### F9 (low) A08: CI and image supply chain pinned by tag, not by digest

- Where: `.github/workflows/letterhead-api.yml:140` (`actions/checkout@v4`), `:173` (`actions/cache@v4`), `:88` (`postgres:17`), `:103` (`docker.io/bitnamilegacy/minio:2025.7.23-debian-12-r5`); `letterhead-api/Dockerfile:7,34` (`rust:1.100.0-bookworm`, `debian:bookworm-slim`).
- Evidence: the workflow pins `setup-bun` by commit SHA, pdfium by SHA-256 of archive and library, and the PGDG key by fingerprint, which is good. The rest uses movable tags. `permissions: contents: read`, no secrets and no `pull_request_target` keep the blast radius small. The production image is built from `debian:bookworm-slim`, so a moved tag changes what ships. `bitnamilegacy` is the namespace Bitnami moved unmaintained images to; test-only here.
- Fix: pin the two actions to commit SHAs (with a `# v4.x.y` comment, as `setup-bun` is), and the Dockerfile `FROM` lines to `@sha256:` digests, refreshed by the repo's usual dependency bot.

### F10 (low) A04: the retirement script trusts its own environment and deletes without a recoverable copy

- Where: `crm-api/scripts/retire-uploaded-letterheads.ts:56-60,138` (`switchOn: env.LETTERHEAD_SERVICE_ENABLED` of the script's own process), `:92-100` (delete, then clear the reference), `crm-api/scripts/check-letterhead-service.ts` (checks only that `GET /v1/letterheads/status` lists an active version for each entity).
- Evidence: the guards are right in shape (dry run by default, key regex of the entity's own `letterheads/<entity>/<uuid>.pdf`, object deleted before the reference is cleared, `updateMany` conditioned on the key, nothing else touched). Two gaps: (1) `--apply` is allowed whenever the shell running the script has `LETTERHEAD_SERVICE_ENABLED=true`; that says nothing about the deployed crm-api, which may still be off and still read the uploaded PDF. (2) The check proves an active version exists, not that a render works (an asset missing from the bucket still passes). The delete is permanent ("no rollback", owner O5).
- Fix: before deleting, make the script call `preview` for each entity through the real client with a one-line sample and require a 200, and require an explicit `--i-confirm-crm-api-is-switched` (or read the switch from the deployed environment through the infra tooling). Keep a recoverable copy: enable bucket versioning on the CRM bucket for the retirement window, or copy the object to an `archive/` prefix before the delete.

### F11 (low) A07: stale signing keys are trusted for up to an hour after the key set stops answering

- Where: `letterhead-api/api/src/auth/service.rs:28-33,~290-310` and the twin in `auth/person.rs` (`MAX_AGE` 10 min, `STALE_MAX` 60 min, `COOLDOWN` 30 s).
- Evidence: when auth's JWKS is unreachable, the last good key set keeps verifying for up to 60 minutes. A key that auth rotated out because of a compromise stays accepted for as long as the refetch fails. This matches the posture of the other resource servers (ADR 20260703-jwt-resource-server-remote-jwks), so it is a known trade-off, not a regression. Service tokens also have no cap on `exp - iat` in this verifier (crm-api's are 5 min).
- Fix: none needed for merge. If wanted, lower `STALE_MAX` for the service verifier to 10 minutes, and reject service tokens whose `exp - iat` exceeds 15 minutes.

### F12 (info) A01: read routes are not entity-scoped

- Where: `letterhead-api/api/src/routes/read.rs:116,148,188,229`.
- Evidence: `letterheads:access` alone returns both entities' history, every version's config and every asset by id; only `manage` routes check entity scope (`write.rs:89-100`, correct: capability, then entity parse, then scope). The catalog says access is "the whole read capability", and the plan's table matches. A person whose `letterhead:manage` is scoped to `welld_ch` can still read `welld_it`'s configuration and logos. Asset ids are random v4 UUIDs and are not listed anywhere except in version configs.
- Action: confirm with the owner that cross-entity read is intended; if not, filter `versions`, `version` and `asset` by `authz.manage_scope()` or by a read scope.

### F13 (info) A02/A09: immutable change record keeps a display name or email, readable by every access holder

- Where: `letterhead-api/api/src/routes/write.rs:104-110` (`actor_name` falls back to the person's e-mail address), `routes/read.rs:165` (`createdBy: { sub, name }` to every access holder), migration `20261116000001_init.sql` (`letterhead_change.actor_name`, immutable by trigger).
- Evidence: ADR 20261116-letterhead-versions-assets-and-change-record-are-immutable... records this (erasure needs an owner decision and a reviewed migration). The e-mail fallback is the part that goes further than the ADR text ("name or email"): an e-mail address, not needed for the feature, becomes permanent and visible to all holders.
- Action: store `sub` plus the token's `name`; when `name` is absent store a fixed label (for example "unknown") instead of the e-mail address.

### F14 (info) A05: S3 residency guard for a non-AWS endpoint is an operator-declared allowlist

- Where: `letterhead-api/api/src/env.rs:255-300`, `tools/env-doctor/templates/production/letterhead-api.env` (`LETTERHEAD_S3_ENDPOINT=https://t3.storageapi.dev`, `LETTERHEAD_S3_EU_ENDPOINT_HOSTS=t3.storageapi.dev`, region `ams`).
- Evidence: for an AWS endpoint the guard checks the region against an EU list and the region named in the host; correct. For any other endpoint it only checks that the host matches the allowlist that the same environment declares, so it catches an inconsistency, not a wrong location. The template itself says the bucket is assumed and not provisioned yet. Same design as `crm-api`'s `s3Residency.ts`, so consistent, and `.railway/railway.ts` creates the bucket with `region: "ams"`.
- Action: before go-live, confirm in the Railway console that the `letterhead` bucket is in `ams`; no code change.

### F15 (info) What was checked and found sound

Included so the next reviewer does not redo it.

- Service JWT (`auth/service.rs`): RS256 only, `kid` required, JWKS fetched without redirects, 5 s timeout, 256 KiB cap; issuer, audience, `exp`, `nbf` with zero leeway; scope split on spaces; sub must start with `system:`; a token that also carries the person audience is refused. Person verifier is the mirror image. All denials return one body (`UNAUTHORIZED_BODY`) and the cause goes only to the log facts.
- Config (`env.rs`): `SERVICE_AUDIENCE` must differ from `AUTH_AUDIENCE`; `ALLOWED_ORIGINS` refuses `*` and non-canonical origins; secrets are `Secret` (redacted `Debug`).
- Routes: `person::require` runs before `authz::require_access` (layer order checked); authz failures are 503 fail-closed; scope parsing ignores a grant it cannot read (`scope.rs`). CORS is skipped for the three service paths and is an exact-origin allowlist elsewhere; `no-store` on every answer.
- Bodies: render admission (`pool.admit`) happens before the body is read; declared and streamed sizes are both capped (20 MiB render, 1 MiB JSON, 2 MiB + 64 KiB upload); 15 s read timeout; oversize bodies are drained with a bound.
- Multipart: a hand-written parser with a boundary charset check, four parts at most, 8 KiB part heads, duplicate or unknown fields refused.
- Assets: the sanitiser is an allowlist that rebuilds the file (refuses rather than strips), refuses DOCTYPE, entities, PIs, scripts, `foreignObject`, event handlers, non-fragment `href` and `url()`, caps elements (10 000) and depth (64), and bounds `<use>` expansion. PNG and JPEG are checked from the header for dimensions (25 MP) with CRC and structure checks before storage; the served asset carries `nosniff` and `default-src 'none'; sandbox`. The only gap found is F3.
- Storage: object key built from a server UUID; read verifies length and SHA-256 against the row; the cache is bounded.
- Template injection: `main.typ` has no `eval`, `plugin` or caller-path `read`; text arrives as JSON strings in `/data.json`; the `World` serves only the main source and the files of the job, and refuses packages and everything else (`world.rs`); regexes are built from constants only.
- Database: all SQL is bound parameters (sqlx); immutability triggers on version, version-asset and change tables, an asset guard, and TRUNCATE refusal on all four tables. `DROP`, or an owner disabling triggers, is outside the guard, as the plan states (the service runs the migration and the server under the same owner role; a separate least-privilege runtime role would close it).
- Logs (`log.rs`): fixed fields only (route, sanitised caller, entity, outcome, status, pages, ms, cause); the worker's stderr is null and its panic hook is silent.
- Errors: render and person routes answer fixed codes. The save route echoes a typed placeholder name, bounded in length, back to the person who typed it (documented in `config/problem.rs`); the UI renders it as text.
- crm-api: client sends the scoped service token, `redirect: "error"`, 35 s total budget, at most one retry (401 or 429 with `Retry-After` capped at 5 s), bodies and tokens never logged, error codes passed through only from a closed list. Preview and try-preview sit behind `authorized` + `deal:financials` + `deal:manage`, load the deal or template through scope (403 `out_of_scope`), check the template's entity against the deal's, are 404 when the switch is off, and sit under the 512 KiB (draft) and 1 MiB (templates) body caps. Generation renders inside the transaction before any write, and a failure rolls back. The 410 middleware comes after the auth guards. The retirement script is dry-run by default and key-shape guarded (see F10).
- auth: `letterhead:render` is only added to the list of known scopes; a client gets it only through the `SERVICE_CLIENTS` configuration. The catalog registers `letterheads:access` (no conditions) and `letterhead:manage` (entity condition); the seed gives `manage` to `admin` only.
- Front ends: no `dangerouslySetInnerHTML`, `innerHTML` or `eval` anywhere in the new code. `PagePreview` puts the service's base64 PNG in a fixed `data:image/png` URI and the page text in a `figcaption` as React text. `AssetField` fetches the asset with the token and refuses any blob that is not PNG, JPEG or SVG before making an object URL, shows it in an `<img>` (scripts do not run there), and revokes it on change or unmount. The `/letterheads?entity=` link is built from a closed union with `encodeURIComponent` and is shown only when the shell's permission list has `letterheads`; the server enforces anyway. The shell adds the letterhead-api origin to its trusted-origin list for the bearer only when configured.
- CI: `permissions: contents: read`, no secrets, no `pull_request_target`; pdfium is pinned by archive and library SHA-256 and checked before use; the PGDG key is pinned by fingerprint with a single-key check.

## Recommended order of work

1. F3 (one-line refusal plus tests), F4 (startup check): small and local.
2. F1 and F2: decide before the switch is turned on in production; both are about the service's capacity and its isolation claim.
3. F8 and F9: CI changes, independent of the code.
4. F10 before the retirement script is run with `--apply`.
5. F5, F6, F7, F11 as hardening; F12 to F14 need an owner decision, not code.

## Delta review (2026-11-17)

Scope: the fixes after the first review: T48 (`5f28da1e`, `8d6b4579`), T49 (`3baf53ee`), T50 (`678500f6`). Same method and limits as above: static reading only, nothing was built or run (no `cargo`, `bun`), so the unit tests the commits add were read, not executed.

**Verdict: PASS WITH NOTES.** Both mediums are closed on the service side. F1 is closed for the PDF route's worker slot and bounded per person in crm-api, with one low residual (N1). No new medium or higher finding.

| Finding | Status | Note |
| --- | --- | --- |
| F1 (medium) shared identity, no per-user throttle | partially fixed | Worker slot reserved for PDFs and a per-person cap in crm-api: both correct. Not done: queue places and the per-caller share are still shared between PDFs and previews (N1); no render-before-transaction (item 3 of the fix). Residual is low. |
| F2 (medium) fit check outside the worker pool | fixed | `Job::fit` runs in the pool (deadline, RSS cap, kill); both semaphores and `spawn_blocking` removed; image decoding and Typst compile now happen only in the worker. See N4 for what still runs in the supervisor. |
| F3 (low) SVG `<style>` panic | fixed | `element_open` refuses any element while `in_style` is set, before anything is pushed. `<style/>`, `<style>text</style>`, nested `<style>` and `<g><style><rect/>` are all refused (close or open). Refusal cases are in `assets/tests.rs`. |
| F4 (low) http auth URLs | fixed | `AUTH_JWKS_URL` and `AUTH_BASE_URL` need https unless loopback, private, link-local, `*.internal`, `*.localhost` or a dotless name. `::ffff:` mapped addresses, CGNAT and `0.0.0.0` are refused (fail closed). Redirects are not followed in the three clients. |
| F5 worker confinement | open | Not touched. |
| F6 public exposure of service routes | open | Not touched. |
| F7 orphaned upload | open | Not touched. |
| F8 no Rust advisory scan | open | Not touched. |
| F9 CI/image pins by tag | open | Not touched. |
| F10 (low) retirement script | partially fixed | Render pre-check is correct (below). The script still trusts its own `LETTERHEAD_SERVICE_ENABLED`, and the recoverable copy is a runbook step, not enforced. |
| F11 stale JWKS | accepted-risk-candidate | Not touched; owner decision as before. |
| F12 to F14 | open (owner decisions) | Not touched. |
| CORS credentials (T48) | fixed, no new risk | See N2. |

### Checks behind the statuses

- F1, service side (`pool/sched.rs`, `pool/mod.rs`, `routes/render.rs:170-175`): PDF admits as `Class::Pdf`, preview and fit as `Class::Interactive`; interactive may hold `n-1` slots when `n >= 2`. `interactive_running` is incremented when a slot is handed out (idle path and queue path) and decremented in `release_as`. I traced the cancel paths: a waiter whose receiver closed does not count; `Permit::drop` on a waiting permit releases a slot that was already sent with its class; `Lease::drop` releases with its class (also when the future is dropped mid-job). I found no leak or double count. A returning slot goes to the oldest waiter that may have it, so a PDF is served ahead of interactive waiters that are over the limit. With `LH_WORKERS=2` (production template) a PDF finds an idle slot unless another PDF is running.
- F1, crm-api (`offers/contentSchema.ts`): the cap is taken in `requireLetterheadService`, which both preview routes use and which runs after the auth guards (`[...writing, requireLetterheadService]`, `[...generating, ...]`); the generate routes do not use it, so generation is not throttled. Acquire is synchronous (no race); release is in `finally`, so it runs on an answer, a thrown `ProblemError` and an exception. A client disconnect does not cancel the handler, so the slot stays counted until the service call ends (the code says so, and that is the safe side). A missing `userId` shares one key (stricter). 429 `preview_busy` carries no input. The cap is per process (documented).
- F2: the worker decodes the fit job with the same framing and `deny_unknown_fields`; `decode_job` refuses a fit with a request and a document without one; a pool refusal on a fit is a 500, a full pool is 429 `busy`, a deadline is 504.
- F10, render pre-check: runs for both entities before any delete, also in the dry run, only when something is to retire; uses the offers' own client (`letterhead.pdf`), so credential, scope and URL are the deployed path; a failure prints only the client's closed error code or the class name; any failure exits 1 with nothing changed. The sample content carries no real data.
- T50 (`sectionTooLong`): answers 422 before any service call; it echoes the engine's `name` and the template heading only, both written by an authorised author, not a request value. No new surface.

### New findings

#### N1 (low) A04: the reserved slot protects the worker, not the queue or the per-caller share

- Where: `letterhead-api/api/src/pool/sched.rs` (`admit_as`: `queue.len() >= max_queue || held >= per_caller` applies to both classes), `routes/render.rs:170-175` (all CRM previews and PDFs use the caller `system:crm-api`).
- Evidence: a PDF is only sure of a place when an idle slot exists. If one PDF is already running (with `LH_WORKERS=2`, the other worker running a preview), a second PDF must queue. The per-caller share is 2 and is the same key for every CRM user's previews and for generation, and the queue is 4. Two users each holding two previews (the crm-api cap) can leave `system:crm-api` with 2 waiting previews, so the next concurrent generate gets 429, then one retry, then 503 `layout_service_unavailable`. It needs two active users and a concurrent generate, so it is a narrow window, not the original one-user starvation.
- Fix: count waiting places per `(caller, class)` (or give PDFs their own waiting share and one reserved queue place), so previews can never use the places a PDF would. In crm-api, a global (not only per-person) cap on in-flight previews, a few below the service's worker count.

#### N2 (info) A05: CORS with credentials: conditions to keep

- Where: `letterhead-api/api/src/routes/mod.rs:166-175`.
- Evidence: `Access-Control-Allow-Credentials: true` is sent only when the `Origin` is in the exact allowlist (`env.rs` refuses `*` and non-canonical origins), together with `Vary: Origin`; a non-listed origin gets neither header. Authentication is the bearer header and the service sets no cookie, so credentials mode adds no ambient authority. The preflight lists only `GET, POST, OPTIONS`. Correct and not exploitable as written.
- Action: none now. Keep it only while auth stays header-based: if a cookie or session is ever added to this service, the allowlist must be re-reviewed and CSRF handled. Do not add `http://` or localhost origins to the production `ALLOWED_ORIGINS`.

#### N3 (low) A04: retirement guards still depend on the operator (remainder of F10)

- Where: `crm-api/scripts/retire-uploaded-letterheads.ts` (`switchOn: env.LETTERHEAD_SERVICE_ENABLED`, no confirmation flag), `infra/README.md` step 4b.
- Evidence: the render pre-check proves the service draws a page; it does not prove the deployed crm-api has the switch on (the script reads its own shell's value), and the archive copy before `--apply` is a prose step. The runbook uses `railway run --service crm-api`, which injects the deployed environment, so in the documented path the first gap is closed in practice.
- Fix: optional: require `--i-have-a-copy` (and `--i-confirm-crm-api-is-switched`) with `--apply`, or have the script copy each object to an `archive/` key before deleting it.

#### N4 (info) A05: what still runs in the supervisor

- Where: `routes/write.rs:134` (`spawn_blocking(assets::ingest)`), `routes/render.rs:181` (`prepare`: `ingest_images`).
- Evidence: upload and image-block ingestion check the PNG and JPEG container and header size and rebuild SVG, with no pixel decode, and are bounded (2 MiB, 10 000 elements, depth 64). It is the code F3 was in. With the F3 fix, no input I could find panics; there is still no deadline on that work. Low impact, listed so the ADR's "untrusted layout work runs in the worker" is read as "layout and decoding"; the ingestion stays outside by design.
- Action: none; keep the fuzz test on the SVG reader.

#### N5 (info) capacity: interactive work is now serialised on one worker

- Evidence: with `LH_WORKERS=2` interactive jobs may use one worker, and each person preview is two pool jobs (the fit check, then the render) where the fit check used to run on a spare thread. Previews are slower under load and a save can now answer 429 `busy` where it used to wait up to 10 s. This is the intended trade for the reserved slot, not a vulnerability.
- Action: size `LH_WORKERS` (3 gives two interactive) once T34's measurements are in; the form already retries a 429 once.

### Summary

0 critical · 0 high · 0 medium · 1 low new (N1) + 1 low remainder (N3) · 3 info (N2, N4, N5). Originals: F2 and F3 and F4 fixed, F1 and F10 partially, F5 to F9 and F11 to F14 untouched.

## Delta review 2 (2026-11-17) — T53

Scope: `9f129a4e` (+ `9d02c912`, docs only): the id-less `POST /offer-templates/try-preview`, both try-preview routes moved from `deal:manage` to the template read guard (`authorized` + `crm:access` + `deal:financials`, `reading` in `offerTemplates.routes.ts:84`), the shared `tryPreviewOf`, `previewThroughService` / `requireLetterheadService` in `offers/contentSchema.ts`, and crm-ui `TryWizardView.tsx` / `crmApi.ts`. Static reading only; nothing was built or run, so the tests in `offerTemplates.tryPreview.test.ts` were read, not executed.

**Verdict: PASS WITH NOTES.** No medium or higher finding. The relaxation reveals nothing a reader of templates could not already read; it widens N1 (who can reach the shared capacity), which stays low.

### Checks behind the verdict

- Authorization, order of guards: `authorized` (401) then `deal:financials` (403) then `requireLetterheadService` (404 when the switch is off, then the per-person cap) on both routes, before the body is read. A person without `crm:access` or `deal:financials` learns nothing, not even the switch state. The tests cover 401 and 403 for `outsider`, `consultant`, `managerNoMoney`.
- Nothing newly readable: the entity profile values that reach the page (`legalName`, address, VAT, IBAN, place of issue) come from `loadProfile(entity)`. `GET /entity-profiles` (`entityProfiles.routes.ts:108-112`, handler at `:241`) returns every entity's full profile, including IBAN and VAT, under the same guard and with no entity scope, and `GET .../letterhead` (`:349`) is the same. Only the writes call `assertInScope`. So a `deal:financials` holder scoped to `welld_ch` who tries a `welld_it` template, or names `welld_it` on the id-less route, sees nothing beyond what the list already gives them. The text rendered is the caller's own body plus the profile; no template row, deal, client, contact or offer data is read (`tryPreviewOf` reads only the profile, and `{id}` only `found.entity` and `found.format`). Both routes use the template's or the body's entity for the letterhead, never the caller's scope, which is consistent with how reads work today.
- Entity forgery on the `{id}` route: the body's `entity` must equal the stored template's (422 `entity`), so the body cannot pick another entity's letterhead through a saved id. The id-less route chooses the entity freely, which is the same reach as the profile list.
- Input validation: `TryPreviewBody` is `.strict()`; `content` is `WizardTemplateBody` (name 80, description 160 and one line, `uses` at most 6 of 40, `source` 1 to 150 000 characters, no NUL, strict); `answers` is the draft's `AnswersSchema` (bounded strings, lists, tables, costs); `language` and `entity` are enums. The `/offer-templates` prefix sits under the 1 MiB body cap (`index.ts:73-77`). `parseBody` refuses NUL and nesting beyond 32 before Zod. The id-less route is not looser than the template create, because the same body schema is used. The text is parsed (`parseTemplate`) once per request for a 150 000-character cap; that is linear and bounded by the cap, and it runs after the per-person slot, so it is covered by the cap of 2.
- No echo: 422 errors carry the field path and the Zod message (no value). `template_invalid` returns the parser's `problems` for the caller's own text, to the caller only. `answers_invalid` carries `path` and `reason` code (the test asserts the value is not in the body). `section_too_long` echoes the engine's section names and the template headings, as in T50. The service's refusals are mapped to closed codes by the client. 429 `preview_busy` carries no input. `Cache-Control: no-store` is set on the success answer.
- Persistence: none. `tryPreviewOf` calls no write; `loadTemplate` is a read. The saved-id route does not use the stored `source`, only the body's.
- UI: `TryWizardView` builds the body from the editor state; for a new template the name is a fixed constant, `description` empty and `uses` empty, so a half-typed name cannot make the request invalid. The abort signal is passed through. Pages are rendered by the existing `ServicePreview` (fixed `data:image/png` URI, text as React text); nothing in the diff uses `dangerouslySetInnerHTML`. The client's `letterheadService` flag only chooses the path; the server enforces the switch and the guards. The profile list is still read in this view for the sample issuer (a read the person may already make).

### New findings

#### N6 (low) A04: the read guard widens who can occupy the shared interactive capacity (extends N1)

- Where: `offerTemplates.routes.ts:84,529,553` (`reading` on both routes), `offers/contentSchema.ts:52-72` (cap of 2 per person, in-process), `letterhead-api/api/src/pool/sched.rs` (`admit_as`, per-caller share and queue shared by `system:crm-api`).
- Evidence: before T53 only `deal:manage` holders (plus `deal:financials`) could reach the shared interactive slot and the shared queue through try-preview; now every `deal:financials` holder can, and the id-less route needs no stored template. The cap is concurrency per person, not a rate: a person can keep two previews in flight continuously (the UI debounces at 250 ms, a script need not). With `LH_WORKERS=2` interactive work may use one worker, the per-caller share is 2 and the queue 4, all under one caller identity. Two read-only users can therefore hold the interactive worker and the shared places, and the next preview or a generate (N1) answers 429 then 503 `layout_service_unavailable`. A request that is aborted by the client still counts until the service call ends (the code says so), so a fast typist also meets their own `preview_busy`. A text of up to 150 000 characters with 15 full sections makes each job heavier than a draft's typical one; the service bounds it (deadline, RSS cap, kill).
- Impact: availability of previews and, through the shared places, of generation, for the people with the money rights; no data exposure, no integrity impact. Not new in kind, wider in who.
- Fix: the one already listed under N1, now more pressing: count waiting places per `(caller, class)` and give PDFs a reserved queue place; in crm-api add a global in-flight cap for previews a few below the service's worker count (shared across both try-preview routes and the draft previews), and optionally a short per-person rate limit (for instance 1 request per 500 ms) in front of the concurrency cap. Decide before the switch is on for the whole sales team.

#### N7 (info) Documentation drift after the relaxation

- Where: the "Errors" and crm-api bullets of "What was checked and found correct" (above) say preview and try-preview sit behind `deal:financials` + `deal:manage` and load the template through scope (403 `out_of_scope`); `crm-ui/src/lib/crmApi.ts:495-496` still lists 403 `out_of_scope` for `tryPreviewOfferTemplate`.
- Evidence: after T53 try-preview needs only `deal:financials`, takes no entity scope, and answers 403 only for the missing capability; the route's `responses` (`:538-545`) do not list `out_of_scope` either. This is a comment, not behavior.
- Action: update the comment and read the earlier bullet as superseded for try-preview (the draft preview keeps `deal:manage` and scope). Keep the test "no entity scope" (it pins the reading), so a later change of the guard is noticed.

#### N8 (info) A01: the `{id}` route answers 404 before it validates the body

- Where: `offerTemplates.routes.ts:786-789` (`loadTemplate` before `parseBody`).
- Evidence: a holder of the read guard can tell whether an id exists, which `GET /offer-templates/{id}` already tells them. No new information.
- Action: none.

### Summary

0 critical · 0 high · 0 medium · 1 low (N6, widens N1) · 2 info (N7, N8). Nothing in this delta is medium or higher. N1 and N6 should be closed together before the switch is turned on for all financials holders.
