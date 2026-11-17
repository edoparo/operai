---
spec: 20261116
status: approved
approved: 2026-11-16
---

# Plan: Letterhead service — one engine that lays out a whole document, for every tool

Inputs: `spec.md` (approved 2026-11-16, amended A1–A5 the same day), `spike.md` (Typst 0.15.1
embedded in Rust, measured), the codebase as it is (facts cited with paths). Decisions that need
an ADR are marked **[ADR-n]** and listed under "ADR candidates".

## Architecture

### Shape

```
                        person JWT (aud AUTH_AUDIENCE)                    service JWT (aud SERVICE_AUDIENCE,
 letterheads-ui ──────────────────────────────┐                           scope letterhead:render)
 (new federated tool /letterheads)            ▼                                  ┌──────── crm-api (first caller)
                                    ┌───────────────────────────────┐            │         test caller (AC-9.1)
 crm-ui wizard ──► crm-api ─────────►  letterhead-api  (Rust, new)   ◄───────────┘
   (preview of        │  service JWT │  axum HTTP supervisor          │
    the draft)        │              │   ├─ /v1/render/*   service   │──► Postgres  db `letterhead`
                      │              │   ├─ /v1/letterheads/* person │       versions, assets, change record
                      │              │   └─ worker pool  ◄─ stdin/out │──► Railway bucket `letterhead` (EU)
                      │              │        letterhead-api worker   │       logos, backgrounds
                      ▼              └───────────────────────────────┘
          appends deal PDFs (pdf-lib), stores the offer PDF in its own bucket (unchanged)
```

- **letterhead-api** — a new Rust service (Cargo workspace inside `letterhead-api/`):
  - `engine` crate: pure; the content model v1 and its validation (AC-1.5, 1.7, 1.8, 2.3, 3.3, 3.6),
    placeholder resolution (spike `resolve.rs`, US-6), the virtual Typst World, the layouts
    (template + Typst + fonts, compiled in), the outputs: PDF, paletted PNG pages, page text,
    unprintable-character count (spike `main.rs`). No I/O, no clock, no network: everything it
    needs is in its arguments. This is what makes AC-1.4 and AC-2.2 provable.
  - `worker` binary mode (`letterhead-api worker`): reads one render job from stdin, writes one
    result to stdout, evicts the comemo cache, waits for the next. Holds no socket, no DB, no
    bucket, no secret (its environment is cleared at spawn).
  - `api`: the HTTP supervisor (axum + tokio): authentication, authorisation, limits, the worker
    pool, Postgres (`sqlx`, SQL migrations), the bucket (`aws-sdk-s3`, EU residency guard as
    `crm-api/src/lib/s3Residency.ts`), logging.
- **Rendering runs only in workers [ADR-2].** Typst cannot be cancelled (spike F3), so each render
  goes to a pre-started worker process; the supervisor kills it at the 30 s deadline (AC-3.4) or
  when its RSS passes the cap, and starts a fresh one. A worker renders one job at a time. Pool
  size `LH_WORKERS` (default 2) and queue `LH_QUEUE` (default 4, at most 2 per caller identity)
  bound the work: beyond, 429 `busy` with `Retry-After` (AC-3.5). The per-caller share is the
  pattern of `crm-api/src/offers/isolatedPdfCheck.ts:51-65`. The bound is set by memory (spike F4:
  worst accepted request ~855 MiB): workers × 1 GiB cap + supervisor must fit the container.
- **One compile, two outputs.** A preview and a PDF of the same request run the same function on
  the same layout; the preview rasterises the `PagedDocument` that the PDF exports, so preview
  and PDF cannot diverge (AC-1.3). Pages are 64-colour paletted PNG at 1.5 px/pt (893 × 1263):
  ~65 KiB a page, tolerant difference 0.435 % (spike) **[ADR-4]**.
- **Layout versions [ADR-3].** A layout = (template file, Typst version, font files). Every
  letterhead version records the layout it was saved with; a render uses the version's layout,
  so a Typst upgrade or a template change never moves the lines of an existing version (AC-4.5).
  A new layout is added beside the old ones: the template under `engine/layouts/<n>/`, and a newer
  Typst as a renamed dependency (`typst_0_16 = { package = "typst", version = "=0.16.x" }`) — Cargo
  links semver-incompatible 0.x versions side by side. A golden corpus per layout (page count,
  text and baseline position of every line) fails CI on any change. Layout 1 = Typst 0.15.1 +
  `layouts/1/main.typ` + the 13 font files of AC-7.5 pinned by SHA-256.
- **Content versions.** `contentVersion: 1` is the only one in this spec. A future content
  version is translated into the newest one before rendering; a request of an older version
  renders after an upgrade with the same pages because the layout is the letterhead version's,
  not the service's (AC-1.8).
- **letterheads-ui** — a new federated remote (React + TypeScript + Vite, `@operai/ui`), the
  configurator of US-8, built from the projects-ui skeleton (smallest gated tool). It talks only to
  letterhead-api's person routes. Details come from `/wellforge:design` (UI feature).
- **crm-api** (first caller, US-10): a letterhead client (service token with scope
  `letterhead:render`, cached as `crm-api/src/lib/serviceToken.ts`), a draft-to-blocks converter,
  a preview route for the wizard, generation switched to the service behind
  `LETTERHEAD_SERVICE_ENABLED`, the retirement of the uploaded letterhead at the switch.
- **crm-ui**: the wizard preview shows the service's pages; Settings no longer offers the upload —
  both only once the switch is on. Until then the CRM behaves as today (AC-10.12).
- **auth**: a new catalog `letterheads` and a new service scope `letterhead:render`.

### Why this shape (and what was rejected)

- **A separate Rust service, Typst as a library** — owner constraint. It adds a second backend
  stack to a Bun-only monorepo (`ADR 20260703-estimai-api-bun-hono-typescript`: "one backend
  stack"), so it needs an ADR **[ADR-1]**; its scope is limited to this service.
- **Workers, not threads.** Threads cannot be stopped (F3); a thread pool would let a 30 s+
  render run on after the 504, breaking AC-3.4. A fresh process per render (132 ms) was measured
  and rejected as the default — the pool avoids the spawn on the 2 s path — but it stays the
  fallback if a worker misbehaves.
- **One service holds both the render routes and the configurator routes.** The configurator's
  preview must use the same engine (AC-8.4); splitting the stored letterheads into another service
  would make every render a cross-service read. The render route still refuses person tokens
  (AC-3.1): the two families have separate routers and separate auth middleware.
- **The CRM preview goes through crm-api, not from crm-ui to letterhead-api.** Rendering is
  service-only (AC-3.1); crm-api already holds the entity profile values (AC-10.10) and the offer
  engine that turns a draft into text. Rejected: crm-ui calling the service with a person token
  (breaks AC-3.1) or with a delegated service token in the browser (a secret in the browser).
- **The preview takes the draft body, unsaved.** `POST /deals/{id}/offer-draft/preview` accepts
  the same body as the draft PUT and renders it without storing it, so the preview does not wait
  for autosave; generation keeps reading the stored state
  (`ADR 20261115-offer-draft-server-held-generated-from-stored-state`). Both pass through one
  `draftToBlocks()`, so the draft previewed and the draft generated give the same pages (AC-10.3).
- **Images, not HTML/SVG, for the preview** — owner constraint (AC-1.2). SVG pages were
  considered (smaller, selectable) and rejected: the browser would lay out text with its own
  fonts and the guarantee of AC-1.3 would be lost.
- **Active version = the highest version of the entity.** Every save and every restore creates
  the next version active at once (AC-4.1, 4.2), so no "active" pointer is stored; nothing can
  make an older version active without creating a new one.

### Sequences

**Render (caller → service).** Verify the service JWT (JWKS of `auth`, `aud = SERVICE_AUDIENCE`,
`scope ∋ letterhead:render`) → body ≤ 20 MiB (else 413) → parse and validate the content (422
`invalid_content` / `content_too_large` / `unsupported_content_version` / `unsupported_language` /
`unknown_entity`) → load the letterhead version (404 / 409) and its assets from the bucket (cached
in the supervisor by immutable asset id — logos are not document content) → admit to the pool
(429) → worker: compile, check page count ≤ 300 (422 `too_many_pages`), outputs → answer with
`Cache-Control: no-store` → one log line (AC-3.2) → the job's buffers are dropped; the worker
evicts its cache.

**Configurator preview (person → service).** Verify the person JWT (`aud = AUTH_AUDIENCE`) →
`GET {AUTH}/authz/resolve` with the forwarded token (cached 30 s per `(sub, perm_epoch)`, as
`crm-api/src/auth/authz.middleware.ts`) → `letterheads:access` → validate the unsaved
configuration with the save rules → render the built-in sample document in the person's language
(or the language switch's) → pages. Uses the same pool and limits.

**Save.** Person with `letterhead:manage` in scope for the entity (else 403 / 403 `out_of_scope`)
→ validate (AC-5.1 … 7.7) → one transaction: advisory lock on the entity, check
`baseVersion = max(version)` (else 409 `version_conflict`, AC-4.8), insert version n+1 with the
current layout, insert the change record with the names of the changed settings (a JSON diff of
the configuration, keys only) → 201.

**Offer generation after the switch (crm-api).** Unchanged transaction of `createOfferVersion`
(`crm-api/src/offers/generation.ts:485-525`): lock the deal, take the next number, build the
blocks from the stored draft and the snapshot, **call the service for the PDF** (timeout 35 s),
append the chosen deal PDFs with pdf-lib as today, `putObject`, insert the offer row with
`letterheadVersion` (from the answer). Any service failure throws inside the transaction: it rolls
back, no number is consumed, no PDF is stored, the draft is untouched (AC-10.6) — the existing
guarantee of that function, not a new one.

## Data model

### letterhead-api — Postgres, logical database `letterhead` (compose and Railway, as every service)

```sql
create table letterhead_asset (
  id          uuid primary key,                -- server-chosen; the bucket key is assets/<id>
  entity      text not null check (entity in ('welld_it','welld_ch')),
  kind        text not null check (kind in ('logo','background')),
  format      text not null check (format in ('png','jpeg','svg')),  -- sniffed from bytes (AC-7.1)
  sha256      bytea not null,
  bytes       int  not null check (bytes <= 2097152),               -- AC-7.3
  width_px    int, height_px int,                                    -- raster only
  created_by  text not null, created_at timestamptz not null default now()
);

create table letterhead_version (
  entity         text not null check (entity in ('welld_it','welld_ch')),
  version        int  not null check (version >= 1),
  layout_version int  not null,                    -- ADR-3
  config         jsonb not null,                   -- LetterheadConfig v1 below, asset ids inside
  created_by     text not null, created_at timestamptz not null default now(),
  restored_from  int,                              -- AC-4.2
  primary key (entity, version)
);

create table letterhead_version_asset (            -- which assets a version uses (AC-4.6)
  entity text not null, version int not null, asset_id uuid not null references letterhead_asset(id) on delete restrict,
  primary key (entity, version, asset_id),
  foreign key (entity, version) references letterhead_version(entity, version) on delete restrict
);

create table letterhead_change (                   -- AC-4.7
  id bigserial primary key,
  entity text not null, version int not null, action text not null check (action in ('save','restore')),
  actor_sub text not null, actor_name text not null, at timestamptz not null default now(),
  changed_settings text[] not null, restored_from int,
  foreign key (entity, version) references letterhead_version(entity, version) on delete restrict
);
```

- **Immutability at the database level** for `letterhead_version`, `letterhead_version_asset`,
  `letterhead_asset` (once referenced) and `letterhead_change`: a `BEFORE UPDATE OR DELETE`
  trigger that raises, the pattern of
  `refund-api/prisma/migrations/20260716133804_init/migration.sql:129-142`
  (`ADR 20260716-immutable-financial-audit-trail-refund`; Tier 1 of
  `ADR 20260804-two-tier-audit-assurance`) [ADR-5]. Unreferenced assets (uploaded, never saved)
  may be deleted by a sweep after 24 h; the trigger allows `DELETE` on an asset only when no
  `letterhead_version_asset` row references it.
- Migrations: plain SQL files run by `sqlx migrate` in Railway `preDeploy`; never edited once
  applied (AGENTS.md).
- **LetterheadConfig v1** (stored `config`, validated on save):

```jsonc
{
  "margins": { "top": 32, "bottom": 34, "left": 25.4, "right": 25.4 },  // mm, 5–100; body ≥ 100 × 150 (AC-5.1)
  "fonts":   { "body": "Noto Serif", "heading": "Ubuntu", "frame": "Ubuntu" },  // closed list (AC-7.5)
  "look": {                                                              // AC-5.9
    "headings": [ {"size":15,"bold":true,"color":"e50339"}, {…}, {…} ],  // 8–24 pt
    "body":     { "size": 10.5, "lineSpacing": 1.2 },                     // 8–14 pt, 1.0–2.0
    "table":    { "headerFill": "f1f1f4", "borders": true, "borderColor": "c9cad1" },
    "bulletMarker": "bullet" | "dash"
  },
  "variants": {                                                           // AC-5.4, 5.5
    "default": Variant, "first": Variant | null, "last": Variant | null
  }
}
// Variant
{
  "header": Frame, "footer": Frame,
  "logo": { "asset": "<uuid>", "position": "left"|"center"|"right", "heightMm": 12.7 } | null,  // 5–40 mm (AC-7.4)
  "background": "<uuid>" | null                                          // AC-7.7
}
// Frame
{
  "valign": "top" | "bottom",                                             // A3
  "rule": { "show": true, "thicknessPt": 0.5, "color": "e50339" },       // AC-5.6
  "left":   [Line ×0..4], "center": [Line ×0..4], "right": [Line ×0..4]  // A1
}
// Line
{ "text": { "it": "Pagina {page} di {pages}", "en": "Page {page} of {pages}" },  // AC-5.8
  "size": 7.5, "bold": false, "color": "595c69" }                                  // A2: 6–14 pt
```

  Literal characters: `{{` `}}` `[[` `]]` (AC-6.2, AC-6.6), shown in the configurator's help.

### crm-api — Prisma migration

- `DealOffer.letterheadVersion Int?` — null for offers made before the switch (AC-10.2, AC-10.9).
- No column is dropped in this release. At the switch the retirement script sets
  `EntityProfile.letterheadKey/By/At` to null and deletes the objects (AC-10.12); dropping the
  columns is a follow-up migration once the switch has run in production (recorded in the
  CHANGELOG as the next step).

### auth

- `auth/src/authz/catalogs/letterheads.ts`: app `letterheads`; permissions `letterheads:access`
  and `letterhead:manage` (`supportedConditions: ["entity"]`), modelled on
  `auth/src/authz/catalogs/crm.ts:29-53`; registered in `DECLARED_CATALOGS` / `ALL_APP_IDS`
  (`auth/src/authz/seed.ts:269-292`). Seed: `admin` gets both, unconditioned (AC-8.9;
  `seedAdminRoleGrants` already grants `access`; `manage` added explicitly). No other role.
- `KNOWN_SERVICE_SCOPES` (`auth/src/system/serviceClients.ts:63-76`) gains `letterhead:render`.
  crm-api's client in `SERVICE_CLIENTS` gets it (environment, not code — AC-9.3).

## API contracts

All errors are RFC 7807 `application/problem+json` with a `code` (AGENTS.md); no error body ever
repeats request text (AC-3.6). All render answers carry `Cache-Control: no-store` (AC-3.8).

### Service routes (service JWT, scope `letterhead:render`; anything else → the one 401)

`POST /v1/render/preview?pages=1,2,3` and `POST /v1/render/pdf`

```jsonc
// request (both)
{
  "contentVersion": 1,
  "entity": "welld_it",
  "letterheadVersion": 7,            // optional; default: the entity's active version
  "language": "it",                  // it | en
  "entityData": {                    // optional, every member optional (AC-6.3)
    "legalName": "…", "addressLines": ["…"], "vat": "…", "iban": "…", "contacts": "…"
  },
  "blocks": [
    { "type": "heading", "level": 1, "text": "…", "style": "…"? },
    { "type": "paragraph", "runs": [ { "text": "…", "bold": true?, "italic": true?, "underline": true?, "style": "…"? } ], "style": "…"? },
    { "type": "list", "ordered": false, "items": [ { "runs": [ … ] } ] },
    { "type": "table", "columns": [3, 5, 1, 2], "align": ["left","left","right","right"]?,
      "header": [ [Cell…] ], "rows": [ [ [Cell…] ] ] },          // Cell = paragraph | list
    { "type": "image", "data": "<base64 png|jpeg|svg>", "widthRatio": 0.25 },   // never a URL (AC-2.3)
    { "type": "pageBreak" }
  ]
}
```

Named styles (closed set, AC-1.7): `plain`, `muted`, `small`, `right`, `center`, `title`,
`missing` (highlighted, for an unanswered field — AC-10.4).

```jsonc
// 200 preview — application/json
{ "letterheadVersion": 7, "pageCount": 4, "missingPlaceholders": ["iban"], "unprintableCharacters": 0,
  "pages": [ { "n": 1, "image": "<base64 PNG, 893×1263>", "text": "…reading order…" } ] }
// 200 pdf — application/pdf; headers: Letterhead-Version, Page-Count,
//           Missing-Placeholders (comma list), Unprintable-Characters
```

| Status | `code` | When |
| --- | --- | --- |
| 401 | — | no/invalid/expired credential, wrong audience, no scope, person token (one body, as `crm-api/src/auth/systemAuth.middleware.ts:43-53`) |
| 404 | `letterhead_version_not_found` | named version does not exist (AC-4.4) |
| 409 | `letterhead_not_configured` | entity has no version (AC-4.4) |
| 413 | `request_too_large` | body > 20 MiB |
| 422 | `invalid_content` | `problems: [{ path: "/blocks/12/runs/0", reason: "unknown_style" }]`, max 20 |
| 422 | `content_too_large` | > 5 000 blocks or a text > 200 000 chars; `limit` named |
| 422 | `too_many_pages` | > 300 pages |
| 422 | `unsupported_content_version` / `unsupported_language` / `unknown_entity` | |
| 422 | `header_overflow` / `footer_overflow` | a value makes a frame taller than its margin (AC-5.3) |
| 429 | `busy` | pool and caller queue full; `Retry-After: 2` |
| 504 | `render_timeout` | worker killed at 30 s |

`GET /v1/letterheads/status` (service): `{ "welld_it": { "activeVersion": 3 }, "welld_ch": null }`
— used by the CRM's switch check (AC-10.12).

### Person routes (person JWT + `/authz/resolve`)

| Route | Permission | Body / answer |
| --- | --- | --- |
| `GET /v1/catalog` | access | fonts, placeholders, named styles, bounds, literal-brace help (AC-6.1, 6.2) |
| `GET /v1/letterheads` | access | both entities: active version summary or `null` |
| `GET /v1/letterheads/{entity}/versions` | access | history: `[{version, createdBy, createdAt, changedSettings, restoredFrom}]` (AC-8.7) |
| `GET /v1/letterheads/{entity}/versions/{n}` | access | `{version, layoutVersion, config}` |
| `GET /v1/assets/{id}` | access | the stored (sanitised) bytes, for the form's thumbnails |
| `POST /v1/letterheads/{entity}/assets` (multipart, ≤ 2 MiB) | manage, in scope | `{id, kind, format, width, height}`; 422 `unsupported_image` / `svg_unsafe:<reason>` / `image_too_large` (AC-7.1–7.3) |
| `POST /v1/letterheads/{entity}/preview` | access | `{config, language, pages?}` → as render preview, on the sample document (AC-8.4, 8.5) |
| `POST /v1/letterheads/{entity}/versions` | manage, in scope | `{baseVersion, config}` → 201 `{version}`; 409 `version_conflict`; 422 `invalid_letterhead` with `problems: [{path, reason}]` (AC-5.x, 6.1, 6.6) |
| `POST /v1/letterheads/{entity}/versions/{n}/restore` | manage, in scope | `{baseVersion}` → 201 `{version}` (AC-4.2) |

403 `forbidden` without the permission, 403 `out_of_scope` outside the person's entity (AC-8.2).
There is no `PUT`, `PATCH` or `DELETE` route anywhere (AC-4.3, 4.6).

### crm-api

- `POST /deals/{id}/offer-draft/preview?pages=…` — person, same guard as `GET /deals/{id}/offer-draft`;
  body = the draft PUT body (not stored). Answer: the service's preview answer, unchanged, plus
  `missingFields`. Service failures map to 503 `layout_service_unavailable` (unreachable, 5xx,
  `busy`, timeout) and 409 `letterhead_not_configured` (AC-10.7, 10.8).
- `POST /deals/{id}/offer-draft/generate` — unchanged contract; new failures 503
  `layout_service_unavailable` and 409 `letterhead_not_configured` (AC-10.6, 10.8).
- `GET /config` (or the existing scope answer) gains `letterheadService: boolean` so crm-ui knows
  which preview and Settings to show.
- With the switch on: `POST /entity-profiles/{entity}/letterhead`, `…/confirm` and
  `GET …/letterhead` answer 410 `letterhead_upload_retired` (AC-10.11).

## Test strategy

Test levels used:

- **R-unit**: Rust unit tests in `engine` (no I/O).
- **R-golden**: the per-layout golden corpus. Each fixture records page count, the text of each
  page, and every line's baseline and x position. CI fails on any difference.
- **R-conf**: the conformance runner. It renders a fixture as preview and as PDF, rasterises the
  PDF with pdfium (`pdfium-render`, pinned binary, tests only), and checks A5's text and pixel rules.
- **R-int**: letterhead-api integration tests over HTTP against compose Postgres and MinIO, with a
  fake `auth` (local JWKS).
- **B-int**: crm-api `bun test` with a fake letterhead service, plus one contract test against the
  real service in compose.
- **auth**: auth's own tests.
- **V-ui**: Vitest in letterheads-ui and crm-ui.
- **E2E**: Playwright in `shell/e2e/`.
- **PERF**: a script run against the deployed service.
- **RES**: the residue test of AC-3.7.

Running these needs a new CI workflow. `.github/workflows/letterhead-api.yml` runs `cargo test`,
the golden corpus and conformance on every change under `letterhead-api/`. Today no workflow runs
any service's tests. For a layout guarantee "for as long as the service exists" that is not
enough, so this workflow is a deliberate exception and is recorded in ADR-3.

| AC | Level | Test |
| --- | --- | --- |
| AC-1.1 | R-int, R-conf | `/v1/render/pdf` on the offer fixture: A4 media box, frame from the version, blocks in order |
| AC-1.2 | R-int | preview: `pageCount`, images 893×1263 (210:297 ±1 px), text in reading order; `?pages=2` returns only page 2 |
| AC-1.3 | R-conf | every corpus fixture: same page count; text equal with whitespace normalised; tolerant pixel diff ≤ 0.5 %; positive control (1 pt shift) must fail |
| AC-1.4 | R-unit | render twice: PDF byte-identical apart from creation metadata (none written); line positions equal |
| AC-1.5 | R-golden | `every-block.json` (each block type once): each present once, in order (text order in page texts) |
| AC-1.6 | R-golden + R-unit | `breaks.json` corpus: frame-level checks (no line outside the body; heading never last; no 1-line widow/orphan of a multi-line paragraph/item; row split only when taller than the body; header row repeated; no empty page); A4 long word broken inside the margin |
| AC-1.7 | R-unit, R-int | unknown style → 422 `invalid_content` `unknown_style`, nothing rendered |
| AC-1.8 | R-unit, R-golden | `contentVersion: 2` → `unsupported_content_version`; v1 fixtures keep their golden pages after an engine change (layout-pinning test, ADR-3) |
| AC-1.9 | PERF | 10-page offer preview, 50 sequential requests on the deployed service, p95 < 1 s |
| AC-1.10 | PERF | same for PDF, p95 < 3 s |
| AC-2.1 | R-unit (property), R-golden | injection set (spike `inject.json`) in every text position and entity value: printed verbatim (page text equals input), page setup unchanged; plus a fuzz over random Typst syntax |
| AC-2.2 | R-unit | World access log: only `/data.json`, `/img/n`, `/asset/<id>`; network denied in the worker (no socket syscall: run with an empty network namespace in CI / seccomp-less assertion via `strace -f -e trace=network` in a dedicated test); a secret file's content never appears |
| AC-2.3 | R-unit, R-int | image block with `url`/`path` member → `invalid_content`; image rules shared with logos |
| AC-2.4 | R-golden | `{page}` and `{legal_name}` in body text printed as typed |
| AC-3.1 | R-int | six 401 cases (none, invalid, expired, other audience, no scope, person token) → byte-identical bodies |
| AC-3.2 | R-int | captured stdout: one line per render/refusal with caller, entity, outcome, pages, ms; marker strings absent |
| AC-3.3 | R-int | 20 MiB + 1 → 413; 5 001 blocks / 200 001 chars → 422 naming the limit; 301-page document → `too_many_pages`, no partial body |
| AC-3.4 | R-int | a test-only layout that loops (feature `test-slow`) → 504 at 30 s (deadline overridable in tests); worker PID gone; a new worker serves the next request |
| AC-3.5 | R-int | saturate with caller A → 429 `busy` + `Retry-After`; caller B's request still served |
| AC-3.6 | R-int | 25 problems → 20 listed with path and reason; body contains none of the request's strings |
| AC-3.7 | RES | render with unique markers (success and failure); then search: Postgres dump, bucket listing and objects, the container's filesystem (incl. `/tmp`), captured logs; no metrics/traces exist (asserted: no exporter configured) |
| AC-3.8 | R-int, infra review | header on every render answer; Railway service and bucket regions checked in `.railway/railway.ts` review + startup residency guard test |
| AC-4.1 | R-int | save → version n+1, active at once; history keeps n |
| AC-4.2 | R-int | restore 2 when 4 is active → version 5 equals 2's config and assets; 2 and history unchanged |
| AC-4.3 | R-int | no PUT/PATCH/DELETE route (router table test); DB trigger refuses UPDATE |
| AC-4.4 | R-int | default → active; named → exact; missing → 404; empty entity → 409; never another entity's |
| AC-4.5 | R-golden | corpus rendered with layout 1 is stable across Typst/template changes (CI); dedicated test adds a dummy layout 2 and proves version-1 fixtures unchanged |
| AC-4.6 | R-int | no delete route; DB trigger refuses DELETE of version, version_asset, referenced asset |
| AC-4.7 | R-int (real Postgres) | change row written on save/restore with actor, time, entity, version, changed setting names; raw `UPDATE` and `DELETE` both rejected by the trigger |
| AC-4.8 | R-int | two saves on base n: second → 409 `version_conflict`; first kept |
| AC-4.9 | R-int | `welld_de` → 422 `unknown_entity` on render and person routes |
| AC-5.1 | R-unit, R-golden | bounds 5/100 mm; body < 100 × 150 refused naming the margin; body ink inside margins (frame check) |
| AC-5.2 | R-unit | 4 lines max (A1); fit check with 40-char values; line look bounds (A2); valign (A3) |
| AC-5.3 | R-unit, R-int | long legal name → 422 `footer_overflow`; never drawn over the body |
| AC-5.4 | R-golden | first-page variant on p.1 only; absent → default on p.1 |
| AC-5.5 | R-golden | last-page variant on the last page of a 4-page doc; 1-page doc uses first; page breaks identical with/without last variant |
| AC-5.6 | R-unit, R-golden | rule drawn between text and body across the body width; bad colour refused |
| AC-5.7 | R-golden | "Pagina {page} di {pages}" equals PDF page count on every page |
| AC-5.8 | R-golden, R-unit | same request `it`/`en`: "Pagina 2 di 5" / "Page 2 of 5", same breaks; missing language → 422; save with one language empty refused naming text and language |
| AC-5.9 | R-unit, R-golden | each look option applied; out-of-bounds refused naming the option |
| AC-6.1 | R-unit | unknown placeholder refused naming it and its text; catalog lists the set |
| AC-6.2 | R-unit | `{{x}}` / `[[x]]` print literally |
| AC-6.3 | R-int | request without entityData renders; nothing persisted (RES) |
| AC-6.4 | R-unit | missing/blank/whitespace value prints nothing, empty line takes no height, `missingPlaceholders` listed, no refusal |
| AC-6.5 | R-unit | address lines joined with ", "; blank lines skipped; none → nothing |
| AC-6.6 | R-unit | `[VAT: {vat}]` with/without value; segment without placeholder and nested segment refused at save |
| AC-7.1 | R-unit | PNG/JPEG/SVG sniffed from bytes; a PNG named `.svg` and a PDF named `.png` handled by bytes; others refused |
| AC-7.2 | R-unit, R-int | SVG corpus: script, `on*`, `foreignObject`, DOCTYPE/ENTITY, http/file/relative `href`, `@import`, external `use` → refused with reason; clean SVG stored re-serialised; render of it reads no file (F5) |
| AC-7.3 | R-unit | 2 MiB + 1 refused; PNG with a lying header decoded-size > 25 MP refused before decoding; SVG with 10 001 elements refused |
| AC-7.4 | R-golden, R-int | logo left/centre/right, height 5–40 mm, aspect kept; stored in letterhead bucket (EU) |
| AC-7.5 | R-unit | font list = 13 pinned files (SHA-256); coverage string printed with 0 unprintable for every font; unknown font refused; no font fetch (World has no font path) |
| AC-7.6 | R-unit | 漢字 😀 → visible .notdef, `unprintableCharacters: 3`-style count, not refused, characters not listed |
| AC-7.7 | R-golden | background under everything on its variant's pages; breaks identical with/without it |
| AC-8.1 | auth, E2E | tool hidden without `letterheads:access`; route refused |
| AC-8.2 | R-int, E2E | access-only: save/restore → 403; scoped manager: other entity → 403 `out_of_scope`, nothing changed; admin both |
| AC-8.3 | V-ui, E2E | every control labelled, keyboard-only flow (axe + keyboard e2e), refused value shown next to control and announced (`aria-describedby` + live region), focus to first error |
| AC-8.4 | E2E + PERF | edit → new preview without save; 95 % of 40 scripted edits within 2 s on the deployed stack; sample ≥ 3 pages, every block type |
| AC-8.5 | R-unit, V-ui | sample entity data carries "(SAMPLE)" marker; preview route makes no outbound call (fake transport asserts none) |
| AC-8.6 | V-ui | stale answer discarded (sequence id); previous pages kept with "updating" state; failure notice, form usable; alt "Page N of M"; page text in a visually hidden region |
| AC-8.7 | V-ui, E2E | history lists number, who, when, changed names; open in preview; restore after confirm |
| AC-8.8 | V-ui | unsaved-change guard; en/it key parity test; date format; sample language follows person |
| AC-8.9 | auth | seed grants both permissions to `admin` only, unconditioned; entity-conditioned grant yields scope |
| AC-9.1 | R-int | test caller `system:letterhead-test-caller` renders an expense table for `welld_ch`: PDF and preview |
| AC-9.2 | R-unit | schema test: no member name in request/answer contains deal/offer/request/estimate |
| AC-9.3 | R-int | the test caller is configured only through auth's client config (no allowlist of subs in the service) |
| AC-10.1 | B-int | switch on: generate/edit/revise call the service; crm-api draws no frame; deal PDFs appended after, unnumbered |
| AC-10.2 | B-int | offer row stores `letterheadVersion` from the answer |
| AC-10.3 | B-int, E2E | preview page count and page texts equal the generated PDF's rendered pages (draft → preview vs draft → generate) |
| AC-10.4 | E2E + PERF, V-ui | 2 s p95 on the deployed stack; previous pages kept; missing field drawn with `missing` style and label; generation refused while missing (existing test kept) |
| AC-10.5 | V-ui | page text is the image's text alternative; no text selection offered |
| AC-10.6 | B-int | service down / 500 / busy / timeout during generate → no offer row, sequence unchanged, no object, draft unchanged, localized message |
| AC-10.7 | V-ui, B-int | same failures during preview → last pages stay, notice, no dialog, typing/saving unaffected |
| AC-10.8 | B-int, V-ui | `letterhead_not_configured` surfaced; link to /letterheads only for holders of access; no PDF produced |
| AC-10.9 | B-int | offers created before the switch: object bytes and snapshot unchanged, still downloadable; edited unsent draft and new revision use the service |
| AC-10.10 | B-int | entityData sent equals the profile at that moment; empty legal name still refuses generation; place of issue unchanged in content |
| AC-10.11 | B-int, V-ui | switch on: upload start/confirm/read → 410; Settings hides the card; `letterhead_unusable` unreachable |
| AC-10.12 | B-int (script) | switch check refuses unless both entities active (`/v1/letterheads/status`); retirement script deletes objects and nulls profile columns; old offers still open |
| AC-10.13 | V-ui, B-int | new strings exist in en and it with the same keys (parity tests already in each app) |
| AC-10.14 | B-int, V-ui | try-preview without a deal: pages equal the draft path's for the same template + answers; previous pages kept, failure notice, `letterhead_not_configured` (amendment G1) |

Coverage: all 79 ACs of the spec appear above, each with at least one test.

## Risks

| # | Risk | Mitigation / early check |
| --- | --- | --- |
| R1 | Railway vCPU and memory are far below the spike machine; 2 workers at 1 GiB may not fit, or latency may miss AC-1.9 or AC-10.4. | The first task after the skeleton deploys letterhead-api and runs PERF on Railway before any CRM work. If it fails, the owner hears it before the CRM tasks start, as O10 requires. Container memory is set in `.railway/railway.ts` `resources`. |
| R2 | The offer looks different. Brand fonts and the configured frame replace pdf-lib's Helvetica and the uploaded PDF, so clients will notice. | This is in scope (US-10). Golden snapshots of 3 real offers go to the owner for sign-off before the switch, and the switch is a separate release step. |
| R3 | The Rust port of the entity-scope check (`crm-api/src/authz/conditions.ts`) drifts from the TypeScript one. | A shared fixture table (JSON) of resolve answers with expected `inScope` results, run by both the crm-api and letterhead-api tests. |
| R4 | Two Typst versions side by side make builds slower and the binary larger. Or a Typst release cannot be linked alongside another. | Measured when layout 2 is first needed. Fallback in ADR-3: keep the old layout in a separate worker binary built from a frozen tag; the supervisor routes by layout. |
| R5 | Generation calls the service inside the deal's transaction and advisory lock, for up to 35 s. | Same as today's in-transaction render. Offers are rare and the lock is per deal. A shorter timeout of 10 s for generation can be decided after PERF. |
| R6 | Preview payload (~650 KiB per 10 pages, about 870 KiB as base64) on slow links. | `pages=` lets the wizard ask for visible pages first. Per-page images are content-hashed, so the UI reuses unchanged ones. PERF measures this over a throttled link. |
| R7 | Widow and orphan prevention relies on Typst defaults (not verified by the spike). | AC-1.6 frame-level test in the golden corpus. Typst exposes `text.costs` as the fallback setting. |
| R8 | crm-ui carries two preview paths (old HTML and pdfjs, new service) until the switch. | Flag-driven, from `letterheadService` in the config answer. The old path and its two ADRs are removed in the follow-up that drops the profile columns. |
| R9 | The pdfium test dependency (prebuilt binary) is not available on a CI runner. | Pinned download with checksum in the workflow. The fallback is the spike's Python checker (`pypdfium2`). |
| R10 | Rust is a new stack for the team. | ADR-1 limits it to this service. The engine is small (spike ~500 lines). mise pins the toolchain, and AGENTS.md gets a Rust section. |

## Security

**Security-sensitive: YES.** The feature handles service-to-service authentication and a new
credential scope, person authorisation with entity scope, file uploads (SVG, PNG, JPEG), and
untrusted text fed to a typesetting engine (code injection). Document content and entity data in
transit include PII and financial terms. It also deletes the CRM's stored letterheads. An
owasp-reviewer pass is scheduled in parallel with QE.

Controls in this plan:
- **Injection (US-2).** Text reaches the engine only as data: JSON strings, never markup. The template uses no `eval`, `plugin` or caller-path `read`. The World is virtual (spike: the injection set printed verbatim, only expected files read). A property and fuzz test checks this.
- **Process isolation (F3).** Workers run with a cleared environment and no secrets. They are killed at the deadline or when they exceed the RSS cap. Network: the worker has no client code, and a test asserts it makes no network syscall.
- **SVG (F5).** An allowlist sanitizer (elements and attributes) is applied at upload. The SVG is re-serialised, references are rejected, and the element cap is 10 000. The World serves only the asset ids of the version being rendered.
- **Raster images.** The decoded size is checked from the header and bounded before decoding (25 MP), following ADR 20261115-uploaded-pdf-decoded-size-bound-before-parse.
- **Auth.** Identical 401 bodies. The render route has no person-token path. Person routes use auth's resolve, so a deny takes effect within 30 s, the existing suite tolerance.
- **No residue (AC-3.7).** Nothing is written to disk. Logs carry identifiers and numbers only, and the RES test proves it.
- **Data residency.** Railway `europe-west4`, and the bucket is in the EU. The startup guard follows `s3Residency.ts`.
- **CRM deletion at the switch.** A scripted, logged step that runs only after the switch check passes.

## ADR candidates

1. **ADR-1:** A Rust service with Typst embedded, in the Bun monorepo, for document layout only. Amends ADR 20260703's "one backend stack". It covers the toolchain (mise `rust` pin), Docker (builder → `debian:bookworm-slim`, non-root), Changesets (a `package.json` shim with a version and CHANGELOG in `letterhead-api/`), env-doctor manifest entries, compose and Railway wiring.
2. **ADR-2:** Renders run in killable worker processes, with concurrency bounded by memory.
3. **ADR-3:** Layout versions pin the template, Typst and the fonts. Old layouts stay compiled in and are guarded by a golden corpus in CI. This also records the exception to "no CI runs service tests".
4. **ADR-4:** The preview is palette PNG pages plus page text from the same compile as the PDF. The CRM wizard preview goes through crm-api. This supersedes ADR 20261115-paginated-preview-one-flow-float-rail and ADR 20261115-letterhead-preview-pdfjs-main-thread-in-the-remote at the switch; they are marked superseded then, per O15, only in this ADR.
5. **ADR-5:** The letterhead change record and versions are immutable at the database level (Tier 1 of the two-tier audit ADR).

## Amendment (2026-11-16, owner) — design gaps G1–G10

From `design.md` § Gaps for spec/plan; approved by the owner. These amend the sections above;
where they disagree, this section wins.

- **G1 — Try the wizard (spec AC-10.14).** New crm-api route
  `POST /offer-templates/{id}/try-preview?pages=…`, behind the same guard as the template editor's
  routes. Body: `{ content, answers, entity, language }`, where `content` is the unsaved template
  with the same schema as the template PUT and `answers` are the editor's sample answers. It builds
  the blocks with the same `draftToBlocks()` as the draft preview, with a context that has no
  deal, plus the entity profile's values. The answer and errors are those of
  `/deals/{id}/offer-draft/preview`. crm-ui's `TryWizardView` uses `ServicePreview` on the service
  path.
- **G2 — Starting values.** `GET /v1/catalog` gains `defaultConfig`, a valid `LetterheadConfig` v1:
  margins 25/25/25/25 mm, Noto Serif body, Ubuntu headings and frame, and a default variant whose
  footer is `{legal_name}` / `{address}` on the left and `{page} / {pages}` on the right, with no
  logo. The first save of an entity sends `baseVersion: 0`.
- **G3 — Errors of a save and an upload.**
  `invalid_letterhead.problems[] = { path, reason, name?, language? }`.
  - `path` is a JSON Pointer into `LetterheadConfig`, for example
    `/variants/first/footer/left/1/text/en` or `/margins/left`. For an overflow it points at the
    frame: `/variants/default/footer`.
  - `name` is the placeholder or option concerned. `language` is `it` or `en`.
  - `reason` is one of: `out_of_range`, `not_a_number`, `bad_colour`, `unknown_font`,
    `unknown_placeholder`, `unbalanced_brace`, `segment_no_placeholder`, `segment_nested`,
    `too_many_lines`, `language_missing`, `body_too_small`, `header_overflow`, `footer_overflow`,
    `asset_unknown`.
  - Upload is `multipart/form-data` with the fields `kind` (`logo` | `background`) and `file`.
    A refusal is 422 `invalid_asset` with `reason` ∈ `unsupported_format`, `too_many_bytes`,
    `too_many_pixels`, `too_many_elements`, `svg_script`, `svg_event_handler`, `svg_foreign_object`,
    `svg_doctype`, `svg_external_reference`. This replaces `unsupported_image`,
    `svg_unsafe:<reason>` and `image_too_large` above.
- **G4 + G10 — What the person may change, and the active version.** `GET /v1/letterheads` answers
  `{ "welld_it": { "activeVersion": 3, "canManage": true }, "welld_ch": { "activeVersion": null, "canManage": false } }`.
  `canManage` is computed by the service from `/authz/resolve`. The browser never evaluates
  conditions itself (plan R3).
- **G5 — Deal PDFs.** The appended deal PDFs are neither drawn nor listed in the preview. They are
  appended after the rendered pages at generation (AC-10.1), so preview text equals the rendered
  pages' text (AC-10.3).
- **G6 — Layout of an old version.** `POST /v1/letterheads/{entity}/preview` gains an optional
  `layoutVersion`, which defaults to the current layout. Opening version n sends n's
  `layoutVersion`.
- **G7 — The switch in crm-ui.** `letterheadService: boolean` is added to crm-api's `GET /scope`
  answer, the one behind `useCrmCapabilities`. There is no `/config` route.
- **G8 — Page text for assistive technology.** `img alt="Page N of M"`, with the page's text in a
  visually hidden `figcaption` of the same `figure`. This satisfies AC-8.6 and AC-10.5 (owner
  confirmed).
- **G9 — History.**
  - The versions list returns `createdBy: { sub, name }`. `name` is the person's display name,
    taken from the token's `name` claim at save and stored in `letterhead_change.actor_name`.
  - `changedSettings` holds names from this closed set: `margins`, `fonts`, `look.headings`,
    `look.body`, `look.table`, `look.bulletMarker`, `variants.first`, `variants.last`, and for each
    variant v of default, first and last: `variants.v.header`, `variants.v.footer`,
    `variants.v.logo`, `variants.v.background`.
  - The UI translates each name with a copy key.

## Amendment (2026-11-17) — implementation findings, batch 2 (made during an unattended run; owner to confirm)

Found while implementing T2, T3, T8 and T10 (code under `letterhead-api/`). This amends the sections
above and G3. Where they disagree, this section wins.

1. **Save problems (G3; AC-3.6, AC-6.1, AC-6.2, AC-6.6).** The closed list of
   `invalid_letterhead.problems[].reason` has 18 entries:
   - the 14 reasons of G3;
   - `wrong_type`, `missing_member` and `unknown_member`, for a configuration that is not the shape the
     configurator sends. `unknown_member` points at the object that holds the member and has no `name`, so
     a key outside the schema is never echoed;
   - a new `unbalanced_bracket`, with `name` set to `[` or `]`.

   An unclosed `[` or a stray `]` is `unbalanced_bracket`. `unbalanced_brace` now covers only `{` and `}`.
   A separate reason is needed because the fixes differ: a brace is a placeholder or a literal (AC-6.1,
   6.2), while a bracket is a conditional segment (AC-6.6). The UI picks its sentence from `reason` and must
   not branch on `name`. The 15 reasons that the form can cause each get their own sentence. The three shape
   reasons deliberately use the generic sentence.
2. **Upload reasons (G3; AC-7.1, AC-7.2, AC-7.3).**
   - `invalid_asset.reason` gains `svg_not_allowed`, for an element, attribute, namespace or style property
     that is outside the allowlist and is not one of the specific faults (script, `on*`, `foreignObject`,
     doctype or entity, external reference). When both apply, the specific fault is reported.
   - Such an SVG is refused, never silently stripped. A dropped `<style>`, `class` or `<image>` would store
     a logo that does not look like the file the person chose.
   - Confirmed: `unsupported_format` covers bytes that are not PNG, JPEG or SVG; a damaged raster (bad
     chunk, CRC or segment, or a truncated file); malformed XML; and well-formed XML whose single root is
     not `svg`.
   - The sentence for `svg_not_allowed` tells the person how to fix it: export a plain SVG with
     presentation attributes, or upload a PNG. Editor-saved files (Inkscape metadata, Illustrator internal
     CSS) end up here.
3. **Content model details (AC-1.5, 1.6, 1.7, 2.1, 2.3, 3.3, 4.2, 5.6, 6.4, 6.5; ADR-3).**
   - a. *5 000 blocks* — accepted. Blocks count at any depth: a table counts as one, plus each block in its
     cells, and an empty cell counts as one. The spike measured its worst case this way (a 1 660 × 3 table,
     855 MiB, F4), so this is the count that bounds memory.
   - b. *200 000 characters* — accepted, with one correction.
     - What is counted: Unicode scalar values (not bytes, not UTF-16 units), per block, summed over a
       heading's text, a paragraph's runs or a list's items.
     - Each entity value has its own budget. All the address lines share one budget.
     - Correction: a run, list item or address line that adds no characters counts as one. Without this,
       a 20 MiB body of empty runs would escape the limit. Text of exactly 200 000 characters is still
       accepted.
   - c. *`null`* — corrected to match the code. `null` means absent only for:
     - `letterheadVersion`, `entityData` and each `entityData` member, because a caller's profile field
       may be empty (AC-6.3, 6.4);
     - in `LetterheadConfig`, `variants.first`, `variants.last`, `logo` and `background`, which are typed
       `| null` above.

     Every other optional member (`style`, `header`, `align`, `widthRatio`, `ordered`, `bold`, `italic`,
     `underline`) is omitted when absent, and `null` there is `wrong_type`.
   - d. *Table header optional* — accepted. AC-1.5 lists the header row as a capability. AC-1.6's repeat
     rule applies when a header is present.
   - e. *`style` on every block except `pageBreak`* — accepted (closed set, AC-1.7). The layout defines
     what each style does on each block type. A style that has no visible effect on a block is accepted
     and does nothing. It is never an error.
   - f. *`widthRatio` defaults to the full width* — accepted. Full width is used rather than natural size,
     because natural size depends on DPI metadata. Added: an image is also scaled down to fit the body
     height, keeping its aspect, so no image draws outside the margins (AC-1.6, 5.1).
   - g. *Image `data`* — accepted. Content validation checks only the base64 syntax. Then:
     - the pure engine function `content::ingest_images` decodes each image and calls `assets::ingest`.
       The render route calls it after `validate_request` and before the pool;
     - a refusal is 422 `invalid_content` with
       `{ path: "/blocks/<i>/data", reason: <asset reason> }`. The upload reasons of item 2 join the
       content reason list;
     - the worker receives the ingested bytes (for an SVG, the rebuilt file), never the caller's bytes
       (AC-2.3, AC-7.1–7.3, spike F5).
   - h. *Values printed as sent* — accepted (AC-2.1, 6.4, 6.5). Nothing is trimmed or normalised. A value
     or address line made only of Unicode whitespace counts as missing. Whatever height a value takes,
     including a line break inside it, is measured by the render-time overflow check. A frame that grows
     too tall is refused with `header_overflow` or `footer_overflow` (AC-5.3) and never drawn over the
     body.
   - i. *Rule thickness 0.1–5 pt* — accepted as the bound for AC-5.6, which names no bound. The frame's
     fit and overflow checks include the rule's thickness.
   - j. *Restore copies the old `layout_version`* — accepted (AC-4.2, AC-4.5, ADR-3).
     - The new version copies version n's `layout_version`, `config` and asset links, so it renders
       exactly as n did.
     - It is not re-validated against today's save rules: n was valid for its own layout, and its assets
       are immutable.
     - `changedSettings` is the diff between the config of `baseVersion` and the config of n. The
       `baseVersion` check inside the transaction guards against a race.
     - A save always uses the current layout.
4. **Migrations at deploy (ADR-1, ADR-5).**
   - `letterhead-api migrate` reads only `DATABASE_URL` and applies the migrations embedded by
     `sqlx::migrate!("./migrations")`, through the existing `Repo::migrate`. It exits 0 when nothing is
     left to apply. On failure it exits non-zero with a message that never contains the URL. `serve` never
     migrates.
   - `api/build.rs` emits `cargo:rerun-if-changed=migrations`, so a new migration file forces a rebuild.
   - In the Dockerfile, `ENTRYPOINT ["letterhead-api"]` becomes `CMD ["letterhead-api"]`. Railway's
     `start` and `preDeploy` are then whole commands whether Railway appends them to the entrypoint or
     replaces it. With the entrypoint kept, `preDeploy` could run `letterhead-api letterhead-api migrate`.
   - Locally, compose gets a one-shot `letterhead-api-migrate` service (same image,
     `command: ["letterhead-api", "migrate"]`). `letterhead-api` waits for it to finish
     (`condition: service_completed_successfully`). `mise run db:migrate` runs the subcommand through
     `cargo run -p letterhead-api -- migrate`.
   - **T12** carries the crate, Dockerfile, compose and mise changes. It is the first task whose routes
     read the database in a running service, and T17, T26 and T31 run against compose without depending
     on T13.
   - **T13** carries `.railway/railway.ts`: `start: "letterhead-api"`,
     `preDeploy: "letterhead-api migrate"`.
5. **TRUNCATE: yes (AC-4.6, AC-4.7; ADR-5).**
   - A new migration, `api/migrations/20261117000001_refuse_truncate.sql`, adds a
     `BEFORE TRUNCATE … FOR EACH STATEMENT` trigger that raises `letterhead_immutable`. It goes on all four
     tables, so a `TRUNCATE … CASCADE` that starts from any of them is refused too. The init migration is
     not edited.
   - Why: TRUNCATE deletes every row and needs only ordinary table rights, so a mistaken script or test
     reset can issue it. The guard costs one function. No path of the service truncates: the sweep deletes
     unreferenced assets row by row, and `no_function_changes_what_is_permanent` already forbids TRUNCATE
     in `repo.rs`.
   - Still not covered: `DROP` and an owner or superuser who disables triggers. ADR-5's Risks narrow to
     these, and `adr-writer` records that as an addendum to ADR-5.
   - Test, on real Postgres: TRUNCATE of each table, and `TRUNCATE letterhead_asset CASCADE`, are refused,
     and the rows are still there.
   - Task: **T12**, together with the migrate path, so the trigger exists before the first deploy (T13).
6. **DB tests in CI (AC-4.3, 4.6, 4.7; ADR-3's CI exception).** T9's
   `.github/workflows/letterhead-api.yml` runs `cargo test --workspace --locked` with a `postgres:17`
   service (compose's version). It sets `LETTERHEAD_TEST_DATABASE_URL` to that service and
   `LETTERHEAD_REQUIRE_DB_TESTS=1`, so a missing database fails the job instead of skipping AC-4.7's
   refusal tests. The bucket-backed tests of T12 and T15 follow the same rule, with a MinIO service and the
   same require flag.

Test strategy additions:

| AC | Level | Test added |
| --- | --- | --- |
| AC-4.6, AC-4.7 | R-int (real Postgres) | TRUNCATE is refused on every table |
| AC-2.3 | R-int | a refused image gives `invalid_content` at its `data` path; an SVG image block is rendered from the rebuilt bytes |
| AC-3.3 | R-unit | a paragraph of empty runs reaches `text_chars` |
| AC-6.6 | R-unit | `unbalanced_bracket` for `[` and for `]` |

## Amendment (2026-11-17) — batch 3: contracts as built (owner to confirm)

Written after eval round 1 (`eval-report.md` § Spec fidelity, items (b) to (d)) during an unattended run. Items 1 and 2
record what the code does. Each was checked against `feat/letterhead-service` with grep, and each cites the file
that answers it. They describe the built contract and do not change it. Item 3 is a decision being implemented now
(T53). Until the owner confirms this section, the sections above stay the approved text. Where they disagree, this
section is the accurate description of the code, and the owner either confirms it or asks for the code to change.
The original text above is left as it was. Its stale statements are listed in item 2.

1. **Error codes added during implementation.** RFC 7807, with a `code`, and never an echo of the request (AC-3.6).
   This is in addition to the tables in § API contracts and to G3.

   letterhead-api (paths under `letterhead-api/`):

   | Status | `code` | Where answered | When | Code |
   | --- | --- | --- | --- | --- |
   | 503 | `render_unavailable`, `Retry-After: 2` | `/v1/render/*`. Also the configurator preview and a save's fit check, which go through the same pool (item 2) | A worker killed over the RSS cap (log outcome `render_memory_exceeded`), a worker that died (`worker_failed`), or a worker that could not be started (`worker_unavailable`). On the render routes, also the database (`db_unavailable`) or the bucket (`storage_unavailable`) not answering | `api/src/routes/render.rs:64, 428-433, 446-457`. Person routes reuse `pool_error`: `routes/preview.rs:76, 180`, `routes/write.rs:58, 352, 364-368` |
   | 422 | `invalid_request` | Person routes: save and restore envelope (`{ baseVersion, config? }`); configurator preview envelope (`config`, `language` required; `layoutVersion`, `pages` optional) | Not a JSON object, a missing or extra member, or a member of the wrong type. Nothing of the request is repeated | `api/src/routes/write.rs:470-472`, `api/src/routes/preview.rs:201-203` |
   | 400 | `bad_request` | Render routes and configurator preview: body aborted mid-send. Upload: a missing or unusable multipart boundary, or a body that is not the `kind` + `file` form | Body aborted, or malformed multipart | `api/src/routes/render.rs:324`, `api/src/routes/preview.rs:526`, `api/src/routes/write.rs:122, 131, 515, 755-756` |
   | 422 | `unknown_layout` | Configurator preview with a `layoutVersion` this binary lacks (G6). Restore of a version whose layout this binary lacks | The engine refuses to draw a version with another layout (ADR-3). On the render routes the same condition is **not** a 422: a stored version this binary cannot lay out is the service's fault, so it is 500 `render_failed` with log outcome `unknown_layout` | `api/src/routes/preview.rs:17-19, 225-231`, `api/src/routes/write.rs:404-410`, `api/src/routes/render.rs:485-487`, `engine/src/layout/mod.rs:197` |
   | 409 | `version_conflict` + `currentVersion` | Save and restore (AC-4.8) | `baseVersion` ≠ the active version. `currentVersion` is the active version now (0 if none), so the form can offer a reload | `api/src/routes/write.rs:7-8, 784-789` |
   | 422 | `invalid_asset` + `reason` | Upload | `reason` is one of 10: the 9 of G3 plus `svg_not_allowed` (batch 2, item 2). A body over the upload limit is `too_many_bytes`, not 413 | `engine/src/assets/mod.rs:50-97` (`Reason::ALL: [Reason; 10]`), `api/src/routes/write.rs:6, 128, 137-140, 195-196` |
   | 503 | `authz_unavailable`, `Retry-After: 2` | Every person route | `GET {AUTH}/authz/resolve` failed. Fails closed: no cached grant is used | `api/src/authz/mod.rs:8, 45-46, 95-104` |

   Also found by the same grep, outside the brief and not in § API contracts. They are recorded here so the table is
   complete:
   - 408 `request_timeout`: body not received within 15 s. `routes/render.rs:59-60, 318-321`, `routes/preview.rs:521-524`, `routes/write.rs:514`.
   - 413 `request_too_large` on the person routes. The configurator preview body is capped at 1 MiB. `routes/preview.rs:16, 465`, `routes/write.rs:513`.
   - 422 `invalid_pages`: a bad `?pages=`, or `pages` in the body. `routes/render.rs:331, 484`, `routes/preview.rs:251`.
   - 500 `render_failed`, with log outcomes `stored_version_unusable`, `asset_missing`, `asset_corrupt` and `unknown_layout`. `routes/render.rs:416-443, 485-488`.
   - 500 / 503 `asset_unavailable`. `routes/write.rs:772-781`, `routes/preview.rs:407-414`, `routes/read.rs:277-285`.
   - 503 `service_unavailable`, `Retry-After`: the database is not answering on the person routes. `routes/write.rs:763-766`, `routes/preview.rs:402-405`, `routes/read.rs:269-274`.
   - 500 `internal_error`. `routes/write.rs:136-149, 358, 366`.
   - 404 `asset_not_found`. `routes/read.rs:233`.
   - 404 `not_found` and 405 `method_not_allowed` for unknown routes and methods. `api/src/main.rs:253-258`, `routes/mod.rs:183`.

   crm-api (paths under `crm-api/src/`):

   | Status | `code` | Where answered | When | Code |
   | --- | --- | --- | --- | --- |
   | 429 | `preview_busy`, `Retry-After: 1`, `Cache-Control: no-store` | Both preview routes: `POST /deals/{id}/offer-draft/preview` and the try-preview route or routes (item 3) | The person already has 2 previews in flight across both routes (`MAX_PREVIEWS_IN_FLIGHT_PER_PERSON = 2`, security review F1, T51 decision). The count is in-process, so with N instances the cap is 2 × N. Taken in the same middleware as the switch, after the route's own guards | `offers/contentSchema.ts:36-72` (`requireLetterheadService`), `:76-78`, `:86-89`, `:112` |
   | 409 | `letterhead_overflow` + `frame` (`header` \| `footer`) + `entity` | Both preview routes and generation (`POST /deals/{id}/offer-draft/generate` and edit/revise through `createOfferVersion`) | The service answered `header_overflow` / `footer_overflow` (AC-5.3) for a value of the entity profile. The frame and entity are named, never the value | `offers/contentSchema.ts:168-187, 228`, `offers/generation.ts:30, 420-421, 457`, `offers/offers.routes.ts:229, 289` |
   | 422 | `section_too_long` + `sections[]` (`{ name, label }`) | Both preview routes, before any service call | A section, the opening or an annex is longer than 20 000 characters: what generation refuses inside `offer_incomplete`, so the preview never draws a truncated unit. QE D1 | `offers/contentSchema.ts:189-205, 214-216`, `offers/engine/vectors/resolve.json:945, 990-992` |
   | 409 | `entity_profile_missing` + `entity` | Both preview routes and generation | The entity's legal name is empty (AC-10.10). **An existing code** (it predates this branch in `entity-profiles/entityProfiles.routes.ts` and generation) and **new on the preview routes** | `offers/blocks.ts:33, 197-206`, `offers/generation.ts:115`, `offer-drafts/offerDrafts.routes.ts:592, 599`, `offer-templates/offerTemplates.routes.ts:517, 529` |
   | 409 | `template_format_mismatch` | Draft preview, when the draft's template is not a wizard template. `/offer-templates/{id}/try-preview`, when the template is not a wizard template | **An existing code** from specs/20261115-crm-offer-wizard. **New on the preview routes** | `offer-drafts/offerDrafts.routes.ts:456, 599, 760`, `offer-templates/offerTemplates.routes.ts:529, 725` |
   | 410 | `letterhead_upload_retired` | With the switch on: `POST /entity-profiles/{entity}/letterhead`, `…/letterhead/confirm`, `GET …/letterhead` (AC-10.11) | Already in § API contracts (crm-api). Confirmed as built | `entity-profiles/entityProfiles.routes.ts:11, 86-100, 134, 144, 155, 166, 181, 188` |
   | 404 | none (the body of an unmounted route) | Both preview routes when `LETTERHEAD_SERVICE_ENABLED` is off | Not 409 and not 503: the CRM has chosen not to use the service yet. This is the last guard, so a caller without the route's capabilities still gets their 401/403, and the switch's state is told only to someone `GET /scope` already tells. Read per request | `offers/contentSchema.ts:36-55`, `offer-drafts/offerDrafts.routes.ts:588, 593, 598`, `offer-templates/offerTemplates.routes.ts:510, 518, 528` |

   The try-preview route also answers the template editor's existing codes: 422 `template_invalid` and
   `answers_invalid`, and a 422 when `entity` or `language` disagree with the template or text
   (`offer-templates/offerTemplates.routes.ts:530, 719-747`). § API contracts' `layout_service_unavailable` (503) and
   `letterhead_not_configured` (409) are unchanged.

2. **Memory, the pool and CORS as built.** These supersede the 1 GiB figure and the pool description above.
   - **Worker RSS cap: 2 GiB by default**, from `LH_WORKER_RSS_MB` (MiB, 64 to 16 384, default 2048)
     (`letterhead-api/api/src/env.rs:29, 121, 172-173`; `DEFAULT_RSS_CAP_MB = 2048` at
     `letterhead-api/api/src/pool/mod.rs:71`). A worker over the cap is killed and the request answers 503
     `render_unavailable` (item 1). Why: on Linux, the worst accepted table peaks at 1.53 GiB (VmHWM, T46,
     `spike.md:120`), above F4's 855 MiB (macOS) and above T41's 1.5 GiB cap.
   - **Container: 5 GB** (`.railway/railway.ts:119-131`, `memoryBytes: 5000000000`, `cpu: 2`). That is 2 workers ×
     2 GiB, plus the supervisor, the queued 20 MiB bodies and the poll's overshoot. It is a cost increase. T46
     orchestrator decision, owner to confirm (`tasks.md:277`).
   - **Reserved PDF slot.** With `LH_WORKERS = n ≥ 2`, interactive jobs (render-route previews, configurator
     previews, a save's fit check) hold at most n − 1 workers at once. A PDF may use all n. With n = 1 nothing is
     reserved (`letterhead-api/api/src/pool/sched.rs:9-19, 25-30, 59`; `pool/mod.rs:20-22, 246-252`;
     `routes/render.rs:170-175`). T48, security review F1. Known gap N1: the queue's places are not reserved, only
     the worker slot.
   - **The fit check is a pool job.** The save's and the configurator preview's header and footer fit check
     (`layout::check_fit`, with 40-character values) runs in a worker as `Job::fit`. It is in the interactive
     class, under the person's queue share (`person:<sub>`), with the deadline and the RSS cap, and it decodes no
     uploaded image in the supervisor (`pool/mod.rs:23-24`, `pool/job.rs:66`, `routes/write.rs:338-368`,
     `api/src/worker.rs:134`). So **a save can now answer 429 `busy`, 503 `render_unavailable` and 504
     `render_timeout`**, which the Save sequence above does not list.
   - **CORS, person routes only.** For an origin exactly in `ALLOWED_ORIGINS` (never `*`):
     `Access-Control-Allow-Origin` is that origin, `Access-Control-Allow-Credentials: true` (the shell's `apiFetch`
     sends `credentials: 'include'`), `Access-Control-Expose-Headers: Retry-After`, and `Vary: Origin` on every
     answer. A preflight allows `GET, POST, OPTIONS`, `authorization, content-type`, max-age 600. The service routes
     get no CORS headers. The service sets no cookie, and the person is identified by the bearer token
     (`letterhead-api/api/src/routes/mod.rs:112-180`, `api/src/main.rs:229-242`, `api/src/env.rs:24`). T48.

   Stale statements above, superseded here and left unedited:
   - line ~49-50 (§ Architecture, Shape): "spike F4: worst accepted request ~855 MiB … workers × 1 GiB cap". Now
     1.53 GiB on Linux, a 2 GiB cap and a 5 GB container.
   - line ~122 (Configurator preview sequence): "Uses the same pool and limits". The same pool, but in the
     interactive class (≤ n − 1 workers), under the person's queue share, and the body is capped at 1 MiB.
   - lines ~124-128 (Save sequence): no fit check is listed. The fit check runs in the pool, with the new failure
     answers listed in the fit-check bullet above.
   - line ~443 (R1): "2 workers at 1 GiB may not fit". Now 2 × 2 GiB in 5 GB. R1's PERF check on Railway is still
     open (T40).
   - batch 2, item 3a: "855 MiB, F4" is still the spike's figure for the macOS run, but the Linux bound is 1.53 GiB.
   - § API contracts, render error table: no 503 row and no `invalid_pages` row. See item 1.
   - § API contracts, Person routes: no `invalid_request`, `unknown_layout`, `authz_unavailable`, `bad_request`,
     408 or the `currentVersion` member. See item 1.

3. **AC-10.14 completion: try-preview for an unsaved template and for a reader (T53, being implemented).** This
   amends G1. The eval found AC-10.14 met only for a saved template and a viewer with `deal:manage`
   (`crm-ui/src/components/templateEditor/TryWizardView.tsx:144, 170, 193`). The decision:
   - **New `POST /offer-templates/try-preview?pages=…` (no id)** for a template that was never saved. Its body
     is G1's: `{ content, answers?, entity, language }`, where `content` is the template PUT body. Because there
     is no saved row, `entity` in the body is the letterhead's entity, and `language` must equal
     `content.language` (else 422). It runs the same checks (`template_invalid`, `answers_invalid`), the same
     `templateToBlocks()` with the entity profile's values, and the same `previewThroughService()`. Its answer and
     errors are those of the `{id}` route, except that there is no 404 for a template and no
     `template_format_mismatch` (the body is a wizard template by schema).
   - **Both try-preview routes take the template editor's read guard only**: `reading` = `crm:access` +
     `deal:financials` (`crm-api/src/offer-templates/offerTemplates.routes.ts:82`, used by
     `GET /offer-templates/{id}`). Not `writing` (`deal:manage`, `:83`, as the `{id}` route has today at `:518`),
     and no `assertInScope(dealScope(c), …)` (today at `:723`). Why: a preview stores nothing and moves no
     version. Every value it draws is already readable to a reader: the template, and the entity profile through
     `GET /entity-profiles` under the same capabilities (`crm-api/src/entity-profiles/entityProfiles.routes.ts:112`).
   - **The switch and the per-person cap apply unchanged.** `requireLetterheadService` stays the last guard on both
     routes: 404 when off, 429 `preview_busy` at 2 in flight, shared with the draft preview. The service-side
     interactive class and the reserved PDF slot (item 2) bound what readers can take from document generation.
   - **crm-ui:** on the service path `TryWizardView` always uses the service (the `{id}` route for a saved
     template, the id-less route otherwise). The approximate browser preview is removed from the service path.
     design.md:977-981's deviation note is closed by this item, not by an A7.
   - **Open point for the owner and the orchestrator.** T53's done-when asks that "an out-of-entity person is
     refused". The read guard has no entity condition: `deal:financials` is unconditioned
     (`auth/src/authz/catalogs/crm.ts:44`), and reads are open to holders of either entity
     (`offerTemplates.routes.ts:15-17`). `dealScope` is derived from `deal:manage` (`crm-api/src/auth/guards.ts:44-47`),
     so applying it would refuse exactly the reader AC-10.14 serves. This plan therefore puts **no entity check**
     on try-preview, consistent with template and profile reads. T53's done-when should read "a person without
     `deal:financials` is refused (403)" instead. If the owner wants try-preview to be stricter than reading the
     same template, that needs an entity-conditioned read capability, which the CRM catalog does not have. That
     would be a spec change, not a plan detail.

Test strategy additions (no row above is removed; the 79-AC table stands):

| AC | Level | Test added |
| --- | --- | --- |
| AC-3.4, AC-3.5 | R-int | worker over `LH_WORKER_RSS_MB` → 503 `render_unavailable` with `Retry-After: 2`; with n = 2, previews saturating the pool still leave a PDF served (reserved slot) |
| AC-4.8 | R-int | `version_conflict` carries `currentVersion` |
| AC-5.3 | B-int | service `footer_overflow` → crm-api 409 `letterhead_overflow` with `frame`, `entity`, no value echoed (preview and generate) |
| AC-10.7 | B-int | third concurrent preview of one person → 429 `preview_busy`, `Retry-After: 1`; switch off → 404 on both preview routes |
| AC-10.14 | B-int, V-ui | id-less try-preview: pages for an unsaved template, nothing stored, cap and switch apply; a reader without `deal:manage` gets pages on both routes; a person without `deal:financials` → 403; crm-ui: never-saved template and read-only viewer show service pages (T53) |
