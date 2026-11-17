---
spec: 20261116
generated: 2026-11-16
---

# Tasks: Letterhead service — one engine that lays out a whole document, for every tool

Derived from `plan.md` (approved, amended G1–G10), `design.md` (approved) and `spike.md`.
Order: service foundation and engine → early deploy and performance gate on Railway (plan R1) →
service routes → auth → shared UI → configurator → CRM API → CRM UI → closing.
`letterhead-api/` paths: `engine/` = the pure crate, `api/` = the supervisor (HTTP, DB, bucket,
pool; it also holds the `worker` mode).

## Foundation

- [x] T1: Scaffold `letterhead-api` (Cargo workspace `engine` + `api`), its wiring in the monorepo, and the env contract of the whole feature — refs: AC-3.8, AC-9.3 — deps: none
  - touch: `letterhead-api/Cargo.toml`, `letterhead-api/Cargo.lock`, `letterhead-api/engine/Cargo.toml`, `letterhead-api/engine/src/lib.rs`, `letterhead-api/api/Cargo.toml`, `letterhead-api/api/src/main.rs`, `letterhead-api/api/src/env.rs`, `letterhead-api/api/src/health.rs`, `letterhead-api/Dockerfile`, `letterhead-api/package.json`, `letterhead-api/CHANGELOG.md`, `letterhead-api/README.md`, `letterhead-api/.gitignore`, `mise.toml`, `compose.yaml`, `lerna.json`, `AGENTS.md`, `tools/env-doctor/manifest.ts`, `tools/env-doctor/live.test.ts`, `tools/env-doctor/retiredToken.test.ts`, `tools/env-doctor/resolve.test.ts`, `tools/env-doctor/templates/production/letterhead-api.env`, `.github/workflows/changeset-check.yml`, `letterhead-api/.dockerignore`, `.changeset/*`
  - Details:
    - Pin the Rust toolchain in `mise.toml` (ADR-1). Add a `dev` task and port 8088.
    - Dockerfile: multi-stage, ending in non-root `debian:bookworm-slim`.
    - Changesets shim: `package.json` with version and CHANGELOG, plus an entry in `lerna.json`.
    - compose: service, logical DB `letterhead`, MinIO bucket `letterhead`.
    - `env.rs` validates the environment and exits on failure. The S3 EU-residency guard is ported from `crm-api/src/lib/s3Residency.ts`.
    - `GET /health`.
    - env-doctor manifest entries for letterhead-api, letterheads-ui (`VITE_LETTERHEADS_*`) and crm-api (`LETTERHEAD_API_URL`, `LETTERHEAD_SERVICE_ENABLED`).
    - An AGENTS.md "Rust service" section.
  - done when: all four checks pass:
    - `cargo build --release` and `docker build letterhead-api` succeed;
    - `docker compose up letterhead-api` answers `GET /health` 200;
    - a non-EU S3 endpoint makes startup exit non-zero (test);
    - `mise run env:doctor` passes.

- [x] T2: Engine content model v1 and its validation — refs: AC-1.5, AC-1.7, AC-1.8, AC-2.3, AC-3.3, AC-3.6, AC-4.9, AC-9.2 — deps: T1
  - touch: `letterhead-api/engine/src/content/**`
  - Details:
    - serde types for the render request: blocks, runs, named styles (closed set incl. `missing`), entityData, language, entity, contentVersion.
    - Validation:
      - unknown block, style or member → problem;
      - an image with `url`/`path` → refused;
      - more than 5 000 blocks or a text over 200 000 chars → `content_too_large` naming the limit;
      - unknown version, language or entity;
      - at most 20 problems, each `{path, reason}`, never echoing request text.
  - done when: `cargo test -p letterhead-engine content::` passes. It covers each refusal, the 20-problem cap, a no-echo assertion over a corpus of marker strings, and a schema-name test (no deal/offer/request/estimate member).

- [x] T3: Engine LetterheadConfig v1, save validation, placeholder parser, defaults and change vocabulary — refs: AC-5.1, AC-5.2, AC-5.6, AC-5.8, AC-5.9, AC-6.1, AC-6.2, AC-6.6, AC-7.4, AC-7.5 — deps: T1
  - touch: `letterhead-api/engine/src/config/**`
  - Details:
    - Config types per plan § Data model, with the bounds of AC-5.1, 5.2 (A1–A3), 5.6, 5.9 and 7.4.
    - Closed font list.
    - Language completeness: a text filled in one language and empty in the other is refused.
    - Placeholder parser: closed set, `{{ }} [[ ]]`, conditional segments, no nesting, a segment needs a placeholder (spike `resolve.rs`).
    - `problems[] {path (JSON Pointer), reason, name?, language?}` with the reason vocabulary of plan amendment G3.
    - `defaultConfig` (G2).
    - `changed_settings(old, new)` over the closed vocabulary of G9.
  - done when: `cargo test -p letterhead-engine config::` passes, with one test per bound, per reason code, per escape and per segment rule. `defaultConfig` validates clean, and the diff returns only vocabulary names.

- [x] T4: Engine render-time placeholder resolution — refs: AC-2.4, AC-6.3, AC-6.4, AC-6.5, AC-6.6 — deps: T3
  - touch: `letterhead-api/engine/src/resolve/**`
  - Details:
    - Values come from entityData. A missing, empty or whitespace value prints nothing and is listed in `missingPlaceholders`.
    - `{address}` joins the lines with ", ".
    - A segment drops whole when a value inside it is missing.
    - A line left empty is not drawn.
    - `{page}`/`{pages}` stay symbolic.
    - Line styles are keyed to the authored line (spike finding).
  - done when: `cargo test -p letterhead-engine resolve::` passes the cases of AC-6.3–6.6, and a request without entityData resolves.

- [x] T5: Engine fonts, virtual World, layout registry and layout 1 frame (header, footer, variants, logos, backgrounds, page numbers, overflow) — refs: AC-2.2, AC-4.5, AC-5.1, AC-5.2, AC-5.3, AC-5.4, AC-5.5, AC-5.6, AC-5.7, AC-5.8, AC-7.4, AC-7.5, AC-7.6, AC-7.7 — deps: T3, T4
  - touch: `letterhead-api/engine/fonts/**`, `letterhead-api/engine/layouts/1/**`, `letterhead-api/engine/src/world.rs`, `letterhead-api/engine/src/layout/**`, `spikes/letterhead-typst/**`
  - Details:
    - Fonts and licences:
      - Bundle the 13 font files with SHA-256 pins and their licence files, adding the missing OFL texts for DM Sans, DM Mono and Syne.
      - Move them out of `spikes/`, which is then deleted.
    - The World:
      - It serves only `/data.json`, `/img/<n>` and `/asset/<id>.<sniffed-ext>` from a fixed name set (F6, F7) and logs every access.
      - It has no font path.
    - Layout registry: `layout_version → (template, typst)`, with layout 1 = Typst 0.15.1.
    - Template frame:
      - margins, zones with up to 4 lines and their look, valign, rules, logos, background;
      - first and last variants, `{page}/{pages}`;
      - `header_overflow` / `footer_overflow`;
      - `fallback: false` with a notdef count.
  - Amendment 2026-11-17: the frame's fit and overflow checks measure the real height of each value (line breaks included) and the rule's thickness.
  - done when: all of these pass:
    - `cargo test -p letterhead-engine layout::`, with a frame-level check for each AC listed;
    - the World access log equals the allowed set;
    - every font prints the AC-7.5 coverage string with 0 unprintable;
    - the 漢字😀 case gives a visible mark and an exact count;
    - a long legal name gives `footer_overflow`.

- [x] T6: Engine layout 1 body: blocks, block look, named styles and page-break rules — refs: AC-1.5, AC-1.6, AC-1.7, AC-2.1, AC-2.4, AC-5.9 — deps: T5, T2
  - touch: `letterhead-api/engine/layouts/1/**`, `letterhead-api/engine/src/layout/**`
  - Details:
    - Heading 1–3, paragraph runs, lists, tables (header row repeated, relative widths, row kept whole unless taller than the body — spike F1), image, page break (weak).
    - The look from config (AC-5.9).
    - A word wider than its line or cell is broken at the margin (A4).
    - Text is only ever placed as `str` (no eval, plugin or caller-path read).
  - Amendment 2026-11-17: each named style's effect per block type is defined (no effect is allowed, never an error); an image is scaled to fit the body height; `widthRatio` defaults to full width.
  - done when: `cargo test -p letterhead-engine layout::body` passes these frame checks:
    - every block present once, in order;
    - no ink outside the body;
    - a heading is never last on a page;
    - no single-line widow or orphan;
    - a row split only when taller than the body;
    - the header row repeated;
    - no empty page;
    - a 200 000-char word stays inside the margins;
    - the injection set is printed verbatim.

- [x] T7: Engine outputs: one compile → deterministic PDF, 64-colour PNG pages with page text, limits — refs: AC-1.1, AC-1.2, AC-1.4, AC-3.3, AC-7.6 — deps: T6
  - touch: `letterhead-api/engine/src/render.rs`, `letterhead-api/engine/src/output/**`
  - Details:
    - `render(request, version, assets) -> Rendered`.
    - PDF with a fixed ident and no timestamp.
    - Paletted PNG at 1.5 px/pt (893 × 1263) via imagequant or exoquant.
    - Page text in reading order with spike F-text joining.
    - `unprintableCharacters` count.
    - More than 300 pages → `too_many_pages`.
    - `pages=` selection.
  - done when: `cargo test -p letterhead-engine render::` passes. Two renders give byte-identical PDFs, PNG dimensions are 893 × 1263, and a 301-page fixture is refused.

- [x] T8: Engine asset ingestion: sniff, bound, SVG sanitise and re-serialise — refs: AC-2.3, AC-7.1, AC-7.2, AC-7.3 — deps: T1
  - touch: `letterhead-api/engine/src/assets/**`
  - Details:
    - The format is sniffed from the bytes.
    - Size limits: 2 MiB; 25 MP decoded, read from the header before decoding; SVG 10 000 elements.
    - The SVG element and attribute allowlist rejects script, `on*`, `foreignObject`, DOCTYPE/ENTITY and every href/url/`@import`/external `use`. Relative refs are rejected too (F5).
    - The SVG is re-serialised.
    - Upload reasons follow G3.
  - Amendment 2026-11-17: reasons include `svg_not_allowed`; a not-allowed SVG is refused, never stripped (tests already exist; no reopening).
  - done when: `cargo test -p letterhead-engine assets::` passes on a corpus with one fixture per reason, plus a clean SVG whose re-serialised form renders in a World that logs no access beyond the asset itself.

- [x] T9: Golden corpus, conformance runner and the letterhead-api CI workflow — refs: AC-1.3, AC-1.4, AC-1.5, AC-1.6, AC-2.1, AC-4.5, AC-5.4, AC-5.5, AC-5.7, AC-5.8, AC-7.7 — deps: T7
  - touch: `letterhead-api/engine/tests/**`, `letterhead-api/engine/tests/golden/**`, `.github/workflows/letterhead-api.yml`
  - Details:
    - Fixtures (from spike `fixtures/gen.py`): offer it/en, every-block, breaks, inject, glyphs, variants on/off, background, overflow.
    - The golden record holds page count, page text and each line's baseline and x position.
    - pdfium-render with a pinned, checksummed binary implements A5's text and pixel rules, with the 1 pt-shift positive control.
    - Property and fuzz test of injection.
    - "Layout pinning" test: adding a dummy layout 2 leaves layout-1 goldens unchanged.
    - CI runs `cargo test`, golden and conformance on `letterhead-api/**`.
  - Amendment 2026-11-17: the workflow runs `cargo test --workspace --locked` with `postgres:17` and MinIO services and sets `LETTERHEAD_TEST_DATABASE_URL` and `LETTERHEAD_REQUIRE_DB_TESTS=1`.
  - Status note 2026-11-17 (eval round 2): ticked on local evidence (golden failure on a 1 pt change shown and reverted by the implementer; full suite green locally). "Workflow green on the branch" is NOT yet evidenced: the branch has not been pushed — owner step, with T40.
  - done when: the workflow is green on the branch, and a deliberate 1 pt template change makes it fail (shown once, then reverted). Also (amendment 2026-11-17): the api DB tests run (not skip) in the workflow.

- [x] T37: Engine fixes from plan amendment 2026-11-17: empty runs count toward the character limit; `unbalanced_bracket` — refs: AC-3.3, AC-6.6, AC-3.6 — deps: none
  - touch: `letterhead-api/engine/src/content/**`, `letterhead-api/engine/src/config/**`
  - Details: an empty run, list item or address line counts as 1 toward the 200 000-character limit; a stray or unclosed `[`/`]` is `unbalanced_bracket` (name = the bracket), `unbalanced_brace` keeps `{`/`}` only — the closed save-reason list has 18 entries.
  - done when: `cargo test -p letterhead-engine -- content:: config::` passes with a test of a paragraph of empty runs over the limit and one test per save reason (18), including `[` and `]`.

- [x] T38: Engine fixes for the three defects found by T9's corpus — refs: AC-1.3, AC-1.6, AC-2.1, AC-5.1 — deps: T9
  - touch: `letterhead-api/engine/layouts/1/**`, `letterhead-api/engine/src/layout/**`, `letterhead-api/engine/src/output/**`, `letterhead-api/engine/tests/**`
  - Details: the three `#[ignore]`d repros in `engine/tests/corpus` (`cargo test -p letterhead-engine --test corpus -- --ignored`): (1) a combining mark duplicates its cluster in page text and PDF text (Typst emits two text items carrying the whole cluster) — page text and PDF text must print the cluster once; (2) a stretch UAX #14 forbids breaking (`]`, `)`, `!`, `?`, `,`, `.`, `:`, `;`, `/` after spaces) runs off the page — it must be broken at the margin (A4); (3) a table header row taller than the body overflows the bottom margin — it must stay inside the margins (split or refused with a stated code, decided and documented). Layout 1 is not yet in production, so goldens may be re-recorded (`LETTERHEAD_GOLDEN_RECORD=all`), and every re-recorded fixture is listed in the commit message.
  - Spec amendment A6 (2026-11-17): the conformance runner's unprintable-character exception follows AC-1.3 as amended — only when the answer reports N > 0, the PDF text may be the preview text with deletions of characters the font lacks, at most N over the whole document, never changed/added/reordered; equality everywhere else.
  - done when: the three repros are un-ignored and pass; `cargo test --workspace --locked` (with the DB and pdfium env of T9) is green; the conformance max stays ≤ 0.5 % and is reported.

## Service

- [x] T10: Database schema, immutability triggers and repository layer — refs: AC-4.3, AC-4.6, AC-4.7 — deps: T1
  - touch: `letterhead-api/api/migrations/*`, `letterhead-api/api/src/db/**`
  - Details:
    - Tables per plan § Data model (incl. `actor_name`).
    - `BEFORE UPDATE OR DELETE` triggers: the asset DELETE is allowed only when no version references the asset; asset UPDATE is always refused.
    - `sqlx migrate` in `preDeploy`.
  - Amendment 2026-11-17: migrations run through the binary's `letterhead-api migrate` (T12), not `sqlx migrate`.
  - done when: an integration test on compose Postgres passes. Raw UPDATE and DELETE on a version, a version_asset, a referenced asset and a change row are each rejected; DELETE of an unreferenced asset succeeds.

- [x] T11: Worker pool: killable render workers bounded by memory — refs: AC-2.2, AC-3.4, AC-3.5, AC-3.7 — deps: T7
  - touch: `letterhead-api/api/src/pool/**`, `letterhead-api/api/src/worker.rs`, `letterhead-api/api/tests/pool.rs`, `letterhead-api/api/src/main.rs`, `letterhead-api/api/Cargo.toml`
  - Details:
    - Workers are pre-started (`LH_WORKERS`, default 2) and run one job at a time over stdin/stdout. Their environment is cleared, they evict comemo after each job and write nothing to disk.
    - The supervisor kills a worker at 30 s or past its RSS cap and respawns it.
    - Queue: `LH_QUEUE` (default 4), at most 2 per caller.
    - Overload → 429 `busy` with `Retry-After`; deadline → 504 `render_timeout`.
    - A `test-slow` feature provides a looping layout.
  - done when: integration tests pass. A looping render answers 504, its PID is gone and the next request is served. Caller A saturating gets 429 while caller B is served. An strace/dtruss test shows no network syscall in a worker.

- [x] T12: Service authentication and render routes — refs: AC-1.1, AC-1.2, AC-3.1, AC-3.2, AC-3.3, AC-3.6, AC-3.8, AC-4.4, AC-6.3, AC-9.1, AC-9.3 — deps: T2, T8, T10, T11, T37
  - touch: `letterhead-api/api/src/auth/service.rs`, `letterhead-api/api/src/routes/render.rs`, `letterhead-api/api/src/routes/mod.rs`, `letterhead-api/api/src/storage.rs`, `letterhead-api/api/src/log.rs`, `letterhead-api/api/tests/render*.rs`, `letterhead-api/api/src/main.rs`, `letterhead-api/api/build.rs`, `letterhead-api/api/migrations/*`, `letterhead-api/api/src/db/repo.rs`, `letterhead-api/api/src/db/tests.rs`, `letterhead-api/Dockerfile`, `compose.yaml`, `mise.toml`, `letterhead-api/engine/src/content/**`, `letterhead-api/api/Cargo.toml`, `letterhead-api/Cargo.lock`, `letterhead-api/api/src/auth/mod.rs`, `letterhead-api/api/src/db/mod.rs`, `letterhead-api/api/tests/render_db.rs`
  - Details:
    - JWKS verification: issuer, `aud = SERVICE_AUDIENCE`, RS256, scope `letterhead:render`. Every failure gets one identical 401 body, and no person-token path exists.
    - A 20 MiB body limit → 413.
    - `POST /v1/render/preview` and `/v1/render/pdf` (headers per plan), plus `GET /v1/letterheads/status`.
    - Version resolution: 404 for an unknown version, 409 when none is configured, never a fallback.
    - Asset loading from the bucket, cached by asset id.
    - `Cache-Control: no-store`.
    - One log line per render and per refusal.
  - Amendment 2026-11-17: `migrate` subcommand (embedded migrations, `build.rs` `rerun-if-changed=migrations`, reads only `DATABASE_URL`, never prints it; `serve` never migrates); Dockerfile `ENTRYPOINT`→`CMD`; compose one-shot migrate service + `mise run db:migrate`; migration `*_refuse_truncate.sql` (statement-level TRUNCATE trigger on the four tables); `content::ingest_images` calls `assets::ingest` and only the ingested (rebuilt) bytes reach the worker; request admission is bounded before parsing large bodies so concurrent 20 MiB bodies cannot exhaust supervisor memory.
  - Orchestrator note 2026-11-17: `PoolError::MemoryExceeded`, `WorkerFailed` and `Unavailable` map to 503 `render_unavailable` with `Retry-After: 2` (the plan's error table has no entry for them); `Timeout` → 504 `render_timeout`; `Busy` → 429 `busy`. Wire the pool from T11 (`Pool::start`, `admit` before reading the body, `permit.run`).
  - done when: `cargo test -p letterhead-api render` passes: Also (amendment 2026-11-17): `letterhead-api migrate` applies then is a no-op on re-run; TRUNCATE on each table is refused; a refused image block gives 422 `invalid_content` at `/blocks/<i>/data`; an SVG block renders from the rebuilt bytes.
    - the six 401 cases give byte-identical bodies;
    - 413 and the 422 cases;
    - the version cases;
    - the test caller `system:letterhead-test-caller` renders an expense table for `welld_ch` as preview and PDF, configured only through the fake auth's client list;
    - the log lines carry no marker string.

- [x] T13: Prepare letterhead-api for Railway and measure performance in a resource-limited local container (deploy itself is T40, the owner's step) — refs: AC-1.9, AC-1.10, AC-3.8 — deps: T12
  - touch: `.railway/railway.ts`, `infra/README.md`, `letterhead-api/perf/**`, `.github/workflows/letterhead-api.yml`, `letterhead-api/README.md`, `AGENTS.md`, `specs/20261116-letterhead-service/spike.md`
  - Details:
    - Railway service in `europe-west4`, `letterhead` bucket in the EU, logical DB, `resources` memory sized for 2 workers × 1 GiB.
    - `infra/provision-tool.sh letterhead --bucket`.
    - Perf script: 50 sequential 10-page renders with a service credential.
  - Amendment 2026-11-17: `railway.ts` has `start: "letterhead-api"` and `preDeploy: "letterhead-api migrate"`.
  - Also: the CI workflow exports the MinIO test variables (`LETTERHEAD_TEST_S3_ENDPOINT`, `…_ACCESS_KEY_ID`, `…_SECRET_ACCESS_KEY`, `…_BUCKET`) and has `pkill` available; README and AGENTS.md document `letterhead-api migrate`. No `railway up`/apply and no change to live Railway resources (infra apply is a person's step).
  - done when: `.railway/railway.ts` declares the service (europe-west4, `start`/`preDeploy` per amendment, resources), the `letterhead` bucket and DB; `railway config plan` (if the CLI is available without login) or a careful diff review shows only additions; a perf script run against the image in `docker run --cpus=2 --memory=4g` (a proxy for the Railway plan, stated as such) records preview p95 and PDF p95 for the 10-page offer in `spike.md` § Not measured; actionlint passes on the workflow.

- [x] T14: Person authentication, authz, entity scope, and the read routes — refs: AC-6.1, AC-8.2, AC-8.7 — deps: T12, T3
  - touch: `letterhead-api/api/src/auth/person.rs`, `letterhead-api/api/src/authz/**`, `letterhead-api/api/src/routes/read.rs`, `letterhead-api/api/src/routes/mod.rs`, `docs/fixtures/entity-scope.json`, `crm-api/src/authz/conditions.scope-fixture.test.ts`, `letterhead-api/api/tests/read*.rs`, `letterhead-api/api/src/auth/mod.rs`, `letterhead-api/api/src/main.rs`, `letterhead-api/api/Cargo.toml`, `letterhead-api/Cargo.lock`, `letterhead-api/api/src/env.rs`
  - Details:
    - Person JWT (`aud = AUTH_AUDIENCE`).
    - `/authz/resolve` client, cached 30 s per `(sub, perm_epoch)`, answering 503 on an outage.
    - `inScope` ported from `crm-api/src/authz/conditions.ts`, with a shared fixture table run by both crm-api and letterhead-api (R3).
    - Routes: `GET /v1/catalog` (incl. `defaultConfig`), `GET /v1/letterheads` (`activeVersion`, `canManage`), `GET /v1/letterheads/{entity}/versions` (`createdBy {sub,name}`), `GET …/versions/{n}`, `GET /v1/assets/{id}`.
  - done when: `cargo test -p letterhead-api read` and `bun test crm-api/src/authz/conditions.scope-fixture.test.ts` both pass on the same fixture, and access-only, scoped and admin answers have the right `canManage`.

- [x] T15: Write routes: asset upload, save, restore, change record — refs: AC-4.1, AC-4.2, AC-4.7, AC-4.8, AC-8.2, AC-7.4 — deps: T14
  - touch: `letterhead-api/api/src/routes/write.rs`, `letterhead-api/api/src/routes/mod.rs`, `letterhead-api/api/tests/write*.rs`, `letterhead-api/api/src/storage.rs`, `letterhead-api/api/src/authz/mod.rs`, `letterhead-api/api/Cargo.toml`
  - Details:
    - `POST /v1/letterheads/{entity}/assets` (multipart `kind`, `file`) uses T8 and stores to the bucket.
    - `POST …/versions` takes `{baseVersion, config}`. In one transaction: advisory lock, conflict check → 409 `version_conflict`, version n+1 with the current layout, version_asset rows, a change row with `changed_settings`.
    - `POST …/versions/{n}/restore`.
    - 403 / 403 `out_of_scope` with nothing changed.
    - The first save takes `baseVersion: 0`.
    - There is no PUT, PATCH or DELETE route.
  - Amendment 2026-11-17: restore copies `layout_version`, config and asset links, is not re-validated, and `changedSettings` diffs against the `baseVersion` config; a save uses the current layout.
  - From T14: use `Authz::manage_scope`/`can_manage`/`holds_manage` for the 403 / `out_of_scope` checks; person routes are wired in `person_router` (`routes/mod.rs`); CORS already covers POST.
  - done when: `cargo test -p letterhead-api write` passes save → n+1 active, restore copy, conflict, scope refusals, the change row contents, and a router-table test showing no mutating verb other than POST.

- [x] T16: Built-in sample document and the configurator preview route — refs: AC-5.8, AC-8.4, AC-8.5 — deps: T15
  - touch: `letterhead-api/engine/src/sample/**`, `letterhead-api/api/src/routes/preview.rs`, `letterhead-api/api/src/routes/mod.rs`, `letterhead-api/api/tests/preview*.rs`, `letterhead-api/engine/src/lib.rs`
  - Details:
    - A sample document in it and en: at least 3 pages, every block type, entity data marked "(SAMPLE)".
    - `POST /v1/letterheads/{entity}/preview` takes `{config, language, layoutVersion?, pages?}`, validates with the save rules and renders through the pool.
    - It makes no outbound call except to auth.
  - From T15 (2026-11-17): the configurator preview renders through the worker pool (`pool.admit` + `permit.run` with the sample `RenderRequest`), not on a supervisor thread; do not change `pool/**` or `worker.rs` (T41). Reuse T15's write-route check order (forbidden → unknown_entity) for access-only; preview needs `letterheads:access`, not manage.
  - done when: `cargo test -p letterhead-api preview` passes: ≥ 3 pages; every block type in the page texts; the "(SAMPLE)" marker; a fake transport sees no call other than authz; `layoutVersion` honoured.

- [x] T17: Residue test: nothing of a document is kept anywhere — refs: AC-3.7, AC-2.2 — deps: T12, T16
  - touch: `letterhead-api/api/tests/residue.rs`, `letterhead-api/scripts/residue-check.sh`
  - Details:
    - Render with unique markers (success and failure, service and configurator routes).
    - Then search the Postgres dump, the bucket objects, the container filesystem incl. `/tmp`, and the captured logs.
    - Assert no metrics or trace exporter is configured.
  - done when: the residue test passes in compose with 0 marker hits.

- [ ] T40: Owner step — apply the Railway changes, provision the bucket and variables, deploy letterhead-api, and measure AC-1.9/AC-1.10 on the deployed service — refs: AC-1.9, AC-1.10, AC-3.8, AC-8.4, AC-10.4 — deps: T13, T14, T15, T42
  - touch: `specs/20261116-letterhead-service/spike.md`
  - Details: run `infra/provision-tool.sh letterhead --bucket` and the Railway apply per `infra/README.md`; run `letterhead-api/perf/` against the deployed service with a service credential; if preview p95 ≥ 1 s or PDF p95 ≥ 3 s, revisit O10 before the CRM switch.
  - done when: the deployed p95 figures are recorded in `spike.md` and meet AC-1.9/AC-1.10; the configurator and wizard previews' deployed p95 (`letterhead-api/perf/preview-edits.ts`) meet AC-8.4/AC-10.4 (< 2 s); the Railway service region and the bucket region are confirmed EU (AC-3.8).

- [x] T41: A document over the page limit is refused 422 `too_many_pages`, not killed for memory — refs: AC-3.3, AC-3.5 — deps: T13
  - touch: `letterhead-api/api/src/pool/**`, `letterhead-api/api/src/env.rs`, `letterhead-api/api/tests/pool.rs`, `letterhead-api/api/tests/render.rs`, `letterhead-api/README.md`
  - Details: T13 found that a table slightly over 300 pages (within the 5 000-block limit) passes the worker's 1 GiB RSS cap before the page check and answers 503 `render_unavailable`. Raise the default per-worker RSS cap to 1.5 GiB (2 workers × 1.5 GiB + supervisor fit the 4 GB container; T13 measured a 2.17 GB peak for two worst cases) and make it configurable (`LH_WORKER_RSS_MB`); if the cap is still reached for a document whose block/char limits are valid, the answer stays 503. Record the change against ADR-2 in the commit message.
  - done when: a test renders the worst accepted table over 300 pages and gets 422 `too_many_pages`; the memory-cap test still yields 503 with a deliberately low cap; full gate green.
- [x] T42: Fix the provisioning tooling for letterhead-api before the owner's deploy — refs: AC-3.8 — deps: T13
  - touch: `infra/provision-tool.sh`, `infra/check.sh`, `infra/README.md`
  - Details: `provision-tool.sh` must accept the `letterheads-ui` remote name (not `letterhead-ui`) and its `source: github(` check must ignore comment lines; `infra/check.sh` gains the letterhead-api checks the other services have. No live Railway/Vercel change.
  - done when: `bash -n` passes; a dry run (`./infra/provision-tool.sh letterhead --bucket --no-ui --port 8088` without `--apply`) on the current `railway.ts` reports no false refusal; `infra/check.sh` lists letterhead-api.

- [x] T43: CI runs the shared entity-scope fixture on both sides — refs: AC-8.2 — deps: T14
  - touch: `.github/workflows/letterhead-api.yml`
  - Details: the letterhead-api workflow also triggers on `docs/fixtures/**` and `crm-api/src/authz/**`, and runs `bun test src/authz/conditions.scope-fixture.test.ts` in crm-api (bun install there first), so a scope rule changed on one side only fails CI (plan R3).
  - done when: actionlint (if available) or a careful review passes; the step runs locally via the same commands.

- [x] T44: env-doctor and auth wiring for the letterhead switch — refs: AC-9.3, AC-10.12 — deps: T28
  - touch: `tools/env-doctor/manifest.ts`, `tools/env-doctor/templates/production/auth.env`, `tools/env-doctor/templates/production/crm-api.env`, `tools/env-doctor/check.test.ts`, `tools/env-doctor/*.test.ts`
  - Details: add `LETTERHEAD_API_URL` and `LETTERHEAD_SERVICE_ENABLED` to crm-api's production required keys; give crm-api's service client the `letterhead:render` scope in the manifest's service-client links and in auth's production `SERVICE_CLIENTS` template; update the checker fixtures accordingly. No real secret in any template.
  - done when: `bun test tools/env-doctor/` has no failure other than the pre-existing notify-api `PUSH_ENABLED` one; `mise run env:doctor` (production) passes.

- [x] T45: Small fixes found by T30 — refs: AC-10.6, AC-10.2 — deps: T30
  - touch: `crm-api/src/offers/generation.ts`, `crm-api/src/offers/generation.letterhead.test.ts`, `crm-api/src/lib/problem.ts`, `crm-api/src/lib/problem.test.ts`, `crm-ui/src/lib/types.ts`, `crm-api/src/offers/contractPdf.ts`, `meetings-api/src/lib/problem.ts`, `activities-api/src/lib/problem.ts`
  - Details: in `renderOfferThroughService` (and the classic path) a deal PDF with a valid `%PDF` header but no page tree passes `PDFDocument.load` and throws in `copyPages` → must answer 422 `attachment_unreadable`, not 503 (call `getPageIndices()` inside the load try); `problem.ts` gets a title for 410; crm-ui's `Offer` type gains `letterheadVersion: number | null`.
  - done when: a test with a header-only PDF gets 422 `attachment_unreadable` on both paths; the 410 title test passes; crm-api and crm-ui typecheck and suites green.

- [x] T46: Wire the worker RSS cap and run the worst-case tests in CI — refs: AC-3.3, AC-3.5 — deps: T41
  - touch: `letterhead-api/api/src/main.rs`, `letterhead-api/api/tests/render.rs`, `.github/workflows/letterhead-api.yml`, `infra/README.md`, `letterhead-api/api/src/pool/mod.rs`, `letterhead-api/api/src/env.rs`, `letterhead-api/api/tests/pool.rs`, `letterhead-api/README.md`, `.railway/railway.ts`, `specs/20261116-letterhead-service/spike.md`
  - Details: `main.rs` sets `pool_config.rss_cap_bytes = config.worker_rss_mb * 1024 * 1024` so `LH_WORKER_RSS_MB` takes effect; add the HTTP-level low-cap test (503 `render_unavailable` with `LH_WORKER_RSS_MB` low in `server_env`); the CI workflow sets `LETTERHEAD_WORST_CASE_TESTS=1` and runs the worst-case tests in a release build (`cargo test --release -p letterhead-api --test pool --test render` or equivalent) so T41's done-when tests run in CI; `infra/README.md` says 2 × 1.5 GiB.
  - Orchestrator decision 2026-11-17 (owner to confirm): T41 (≈1.35 GiB, macOS) and T46 (1.62/1.78 GiB, macOS ps sampling) disagree. Measure the worst-case pool/render tables' worker peak (VmHWM) on Linux in a container limited to 4 GB. If the Linux peak < 1.4 GiB: keep the 1.5 GiB cap and run the worst-case tests in CI on Linux only (skip on macOS with the reason). Otherwise: default cap 2 GiB, keep 2 workers, raise `.railway/railway.ts` memoryBytes to 5 GB (flag the cost for the owner). Record the Linux numbers in spike.md.
  - done when: the low-cap HTTP test passes; the default 1.5 GiB still yields 422 for the over-limit table (release); actionlint (if available) or a careful review passes the workflow.

- [x] T47: CI runs the residue test with a real pg_dump — refs: AC-3.7 — deps: T17, T46
  - touch: `.github/workflows/letterhead-api.yml`, `letterhead-api/perf/README.md`, `letterhead-api/perf/worst-case.ts`
  - Details: the workflow installs a `pg_dump` matching the postgres:17 service (e.g. `postgresql-client-17` from the PGDG apt repo), sets `LETTERHEAD_RESIDUE_PG_DUMP` and `LETTERHEAD_RESIDUE_REQUIRE_PG_DUMP=1`, and ensures `lsof` and `pgrep` are present so the residue test's socket checks run.
  - Also (from T46): `perf/README.md` and `perf/worst-case.ts` say 4 GB / 1 GiB — update to the 5 GB container and 2 GiB default cap.
  - done when: YAML parse + careful review (actionlint if already available); the install commands are proven locally in a `ubuntu:24.04` container.

- [x] T48: Security fixes in letterhead-api from the OWASP review (F2, F1 service side, F3, F4) — refs: AC-3.4, AC-3.5, AC-7.2, AC-3.1 — deps: T46
  - touch: `letterhead-api/api/src/pool/**`, `letterhead-api/api/src/worker.rs`, `letterhead-api/api/src/routes/write.rs`, `letterhead-api/api/src/routes/preview.rs`, `letterhead-api/api/src/env.rs`, `letterhead-api/api/src/main.rs`, `letterhead-api/api/tests/**`, `letterhead-api/engine/src/assets/**`, `letterhead-api/README.md`, `docs/adr/20261116-renders-run-in-killable-worker-processes-and-concurrency-is-bounded-by-memory.md`, `letterhead-api/api/src/routes/mod.rs`, `letterhead-api/api/src/routes/render.rs`
  - Details (see `security-review.md`): F2 — the save/preview fit check (`check_fit`) runs as a worker-pool job (a new job kind), never on a supervisor thread, so it has the deadline and RSS cap; F1 (service side) — one worker slot is reserved for `/v1/render/pdf` jobs so previews cannot starve generation (state the rule in the ADR amendment); F3 — `<style>` in an SVG is refused at its start tag (`svg_not_allowed`), no panic, and the fuzz covers nested `<style>`; F4 — `AUTH_BASE_URL`/`AUTH_JWKS_URL` must be `https` except loopback/private hosts.
  - Also (found by T26's e2e): the person-route CORS must send `Access-Control-Allow-Credentials: true` on the preflight and on actual responses for an allowed origin — the shell's `apiFetch` always uses `credentials: 'include'`, so today no call succeeds from a real browser; add a Rust test.
  - done when: tests prove each fix (a fit check that loops is killed at the deadline; with all non-reserved slots busy a PDF job is still admitted; the F3 input answers 422; an `http` public auth URL fails startup); full gate green.
- [x] T49: Security fixes in crm-api from the OWASP review (F1 CRM side, F10) — refs: AC-3.5, AC-10.12 — deps: T48
  - touch: `crm-api/src/offers/contentSchema.ts`, `crm-api/src/offer-drafts/offerDrafts.preview.test.ts`, `crm-api/src/offer-templates/offerTemplates.tryPreview.test.ts`, `crm-api/scripts/retire-uploaded-letterheads.ts`, `crm-api/scripts/retire-uploaded-letterheads.test.ts`, `infra/README.md`
  - Details: F1 — the two preview routes allow at most 2 in-flight service previews per person (429 `preview_busy` with Retry-After beyond that); F10 — before deleting anything, the retirement script renders a sample PDF for each entity through the service with crm-api's own client and refuses unless both succeed; the runbook says to enable bucket versioning or copy the letterhead objects to an archive prefix before `--apply`.
  - done when: tests prove the per-person cap and the render pre-check; full crm-api suite and tsc green.

- [x] T50: The CRM preview refuses a section over the length limit instead of truncating it — refs: AC-10.3, AC-10.4 — deps: T34
  - touch: `crm-api/src/offers/blocks.ts`, `crm-api/src/offers/blocks.test.ts`, `crm-api/src/offers/contentSchema.ts`, `crm-api/src/offer-drafts/offerDrafts.preview.test.ts`, `crm-api/src/offer-templates/offerTemplates.tryPreview.test.ts`, `crm-ui/src/components/offerWizard/useServicePreview*`, `crm-ui/src/components/offerWizard/ServicePreview*`, `crm-ui/src/strings/offerWizard.ts`
  - Details (found by T34): a section of more than 20 000 characters previews only its first part and answers 200 with no notice, while generate correctly refuses 422 `section_too_long`. The preview routes must refuse the same way (422 `section_too_long` naming the section, before any service call), and the wizard shows a polite notice naming the section, keeps the last pages, no dialog.
  - done when: tests on both preview routes give 422 `section_too_long` for the T34 repro; the wizard test shows the notice; crm-api and crm-ui suites and typechecks green.

- [x] T51: QE round 1 — the wizard retries `preview_busy` quietly; a configurator test race — refs: AC-10.4, AC-10.7, AC-8.6 — deps: T49
  - touch: `crm-ui/src/components/offerWizard/useServicePreview*`, `crm-ui/src/components/offerWizard/ServicePreview*`, `letterheads-ui/src/pages/ConfiguratorPage.test.tsx`
  - Details (qe-report D1, D2): crm-api's 429 `preview_busy` (Retry-After: 1) is a busy state, not a failure: the wizard keeps the last pages in "updating", waits Retry-After and re-asks with the LATEST input; a notice appears only if busy persists for more than 3 consecutive attempts (design F13). Orchestrator decision 2026-11-17 (owner to confirm): the per-person cap stays 2. D2: `ConfiguratorPage.test.tsx:112-118` waits for the preview call (`waitFor`).
  - done when: a hook test with repeated 429 `preview_busy` ends `ready` with fresh pages and no notice; a test with persistent busy shows the notice after the 4th attempt; the full crm-ui and letterheads-ui suites pass twice in a row.
- [x] T52: QE round 1 — changesets per package and a Rust advisory scan in CI — refs: AC-3.8 — deps: T49
  - touch: `.changeset/*`, `.github/workflows/letterhead-api.yml`
  - Details (qe-report D3, D4; security-review F8): one changeset per changed package (crm-api, crm-ui, auth, shell, operai-ui, activities-api, meetings-api, letterheads-ui, letterhead-api) with an accurate summary and bump; the letterhead-api workflow runs a pinned `cargo-deny check advisories` (or `cargo-audit`) installed with `--locked` and a version pin, with documented ignores only for advisories proven unreachable (RUSTSEC-2026-0194/0195 via typst bibliography parsing — cite the reason).
  - done when: `node --test scripts/check-changeset.test.mjs` passes; the advisory step's command runs locally and reports no unignored advisory; YAML parse + careful review.

- [x] T53: Eval round 1 — Try the wizard previews through the service for an unsaved template and for a read-only viewer (AC-10.14) — refs: AC-10.14 — deps: T52
  - touch: `crm-api/src/offer-templates/offerTemplates.routes.ts`, `crm-api/src/offer-templates/offerTemplates.tryPreview.test.ts`, `crm-api/src/offers/contentSchema.ts`, `crm-api/src/offers/blocks.ts`, `crm-ui/src/components/templateEditor/TryWizardView*`, `crm-ui/src/lib/crmApi.ts`, `crm-ui/src/strings/templates.ts`, `crm-ui/src/pages/OfferWizardPage.generate.service.test.tsx`
  - Details (eval-report AC satisfaction; plan amendment of 2026-11-17 batch 3): a new `POST /offer-templates/try-preview` (no id) accepts the full unsaved template (content + the fields a template needs) with answers, entity and language; both try-preview routes require only the template editor's READ guard (`crm:access` + `deal:financials`, which is unconditioned), not `deal:manage` — the preview stores nothing; the per-person cap and the switch apply as today. `TryWizardView` uses the service in all cases on the service path; the approximate browser preview and its two copy keys are removed from the service path.
  - done when: route tests for the id-less route (success, guards, nothing stored, cap) and the relaxed guard (a reader with `crm:access` + `deal:financials` gets pages without `deal:manage`; a person without `deal:financials` is refused 403 — per plan amendment batch 3, the read guard has no entity condition); crm-ui tests for a never-saved template and a read-only viewer getting service pages; full crm-api and crm-ui suites green.

- [x] T54: Eval round 2 regression — e2e and tests still expecting the pre-T53 Try the wizard — refs: AC-10.14 — deps: T53
  - touch: `shell/e2e/crm-offer-wizard-service.spec.ts`, `shell/e2e/fixtures/crmOfferService.ts`, `crm-ui/src/components/templateEditor/TryWizardView.service.test.tsx`, `crm-ui/src/lib/crmApi.ts`, `specs/20261116-letterhead-service/design.md`
  - Details (eval-report round 2): the e2e journey for a never-saved template (`crm-offer-wizard-service.spec.ts:566-580`) must expect service pages through the id-less route, and add a read-only viewer (deal:financials, no deal:manage) journey; `TryWizardView.service.test.tsx:372` must not test a 403 `out_of_scope` the route can no longer return (replace with a 403 for a person without `deal:financials`); the `crmApi.ts:~495` comment documents the read guard; `design.md:~317` must not say "entity in scope for reading" (the read guard has no entity scope).
  - done when: `pnpm -C shell exec playwright test crm-offer-wizard-service --trace off` passes against a stack built from this tree; `pnpm -C crm-ui test`, `tsc -b`, lint green.

## Auth

- [x] T18: auth: the `letterheads` catalog, the admin-only seed, and the `letterhead:render` service scope — refs: AC-8.1, AC-8.9, AC-3.1, AC-9.3 — deps: none
  - touch: `auth/src/authz/catalogs/letterheads.ts`, `auth/src/authz/catalogs/letterheads.test.ts`, `auth/src/authz/seed.ts`, `auth/src/authz/seed.test.ts`, `auth/src/system/serviceClients.ts`, `auth/src/system/serviceClients.test.ts`, `auth/src/authz/catalogs/uniqueResourceKeys.test.ts`
  - Details:
    - App `letterheads` with `letterheads:access` and `letterhead:manage` (`supportedConditions: ["entity"]`).
    - Registered in `DECLARED_CATALOGS` and `ALL_APP_IDS`.
    - Seed: `admin` holds both, unconditioned; no other role does.
    - `letterhead:render` added to `KNOWN_SERVICE_SCOPES`.
  - done when: `bun test auth/src/authz/seed.test.ts auth/src/authz/catalogs/letterheads.test.ts auth/src/system/serviceClients.test.ts` passes. After seeding only `admin` holds the two permissions, an entity-conditioned grant resolves to scope, and a client with `letterhead:render` mints a token with it.

## Shared UI

- [x] T19: `@operai/ui`: `PagePreview` and `useLatestResult` — refs: AC-8.6, AC-10.4, AC-10.5 — deps: none
  - touch: `operai-ui/src/components/PagePreview/**`, `operai-ui/src/lib/useLatestResult.ts`, `operai-ui/src/lib/useLatestResult.test.ts`, `operai-ui/src/index.ts`, `operai-ui/package.json`, `operai-ui/pnpm-lock.yaml`
  - Details:
    - `PagePreview`: design S7.
      - States: loading, ready, updating, failed, blocked.
      - Each page is a `figure` with `img alt="Page N of M"` and a visually hidden `figcaption` holding the page text (G8).
      - The region is the single tab stop, with `aria-busy`.
      - Previous pages are kept; unchanged images keep their DOM node.
    - `useLatestResult`: debounce, abort, sequence id, discards stale answers, keeps the previous result, retries `busy` after `Retry-After`.
    - Story and docs.
  - done when: Vitest in `operai-ui` passes: a stale answer is discarded, previous pages are kept while updating, the alt and caption are present, there is no live region, and axe reports no violations.

## Configurator (`letterheads-ui`)

- [x] T20: Scaffold `letterheads-ui` and register it in the shell — refs: AC-8.1, AC-8.8 — deps: T1, T18
  - touch: `letterheads-ui/**`, `shell/src/lib/tools.ts`, `shell/src/router.tsx`, `shell/vite.config.ts`, `shell/src/lib/runtimeRemotes.ts`, `shell/src/federation/remotes.d.ts`, `shell/src/strings.ts`, `shell/vercel.json`, `shell/src/lib/session.ts`, `mise.toml`, `lerna.json`, `shell/src/components/Sidebar.tsx`, `shell/vitest.config.ts`, `shell/src/federation/__stubs__/letterheads*`, `shell/src/lib/noHardcodedStrings.test.ts`, `shell/src/lib/tools.test.ts`, `shell/src/italian.test.tsx`, `shell/src/router.letterheads.test.tsx`, `shell/src/lib/session.test.ts`, `shell/src/lib/runtimeRemotes.test.ts`, `shell/src/lib/remoteVersionSpecifiers.test.ts`, `shell/src/lib/remoteVersionExposes.integration.test.ts`, `shell/src/hooks/useRemoteVersions.ts`, `shell/src/components/AboutModal.test.tsx`, `shell/src/index.css`, `shell/public/runtime-config.example.json`, `shell/.env.example`, `.github/workflows/changeset-check.yml`, `.changeset/*`
  - Details:
    - A projects-ui skeleton: `./App`, `./version`, router, strings en/it with parity and no-hard-coded-strings tests, `LetterheadsShell` (catalog + list), `PermissionDenied`, `NotFoundPage`, `api.ts`, `errors.ts`.
    - Shell wiring: `ToolId`, a `TOOLS` entry, the gated route, the remote entry, the CSP origin, the API origin env.
    - mise dev task on port 5182, and a lerna entry.
  - done when: `pnpm -C letterheads-ui test` and `pnpm -C shell test` pass, `/letterheads` is hidden and refused without `letterheads:access`, and the tool mounts with it in `mise run dev`.

- [x] T21: Configurator form: page setup, look, variants, zones and lines, help card — refs: AC-8.3, AC-5.1, AC-5.2, AC-5.4, AC-5.5, AC-5.6, AC-5.9, AC-6.1, AC-6.2, AC-6.6 — deps: T20, T14
  - touch: `letterheads-ui/src/pages/ConfiguratorPage.tsx`, `letterheads-ui/src/lib/formState*`, `letterheads-ui/src/components/VariantCard*`, `letterheads-ui/src/components/ZoneEditor*`, `letterheads-ui/src/components/ColourInput*`, `letterheads-ui/src/components/CheckboxField*`, `letterheads-ui/src/components/TextsHelp*`, `letterheads-ui/src/strings/**`, `letterheads-ui/src/strings.ts`, `letterheads-ui/src/pages/ConfiguratorPage.test.tsx`, `letterheads-ui/src/App.test.tsx`, `letterheads-ui/src/router.test.tsx`, `letterheads-ui/src/components/VariantCardFields*`
  - Details: design S1 and § How the frame model is exposed.
    - A reducer with baseline and dirty state, problems keyed by pointer.
    - Stacked cards.
    - `ZoneEditor`: up to 4 lines, add and remove with the focus rules.
    - `ColourInput` (hex + swatch).
    - First- and last-page toggles.
    - `TextsHelp`: the placeholders from the catalog, plus the brace, bracket and segment help.
    - Starting values come from `defaultConfig` (G2).
  - done when: Vitest passes on the reducer, add/remove focus, a labelled control for every config field (a test iterates the config schema), and keyboard-only operation, and axe is clean.

- [x] T22: Live preview in the configurator — refs: AC-8.4, AC-8.5, AC-8.6, AC-5.8 — deps: T21, T19, T16
  - touch: `letterheads-ui/src/pages/ConfiguratorPage.tsx`, `letterheads-ui/src/components/PreviewPane*`, `letterheads-ui/src/strings/**`, `letterheads-ui/src/strings.ts`, `letterheads-ui/src/components/PreviewPaneRequest.ts`, `letterheads-ui/src/pages/ConfiguratorPage.test.tsx`, `letterheads-ui/src/test-support/fakeApi.ts`
  - Details:
    - `PagePreview` + `useLatestResult` against `POST …/preview`, with the unsaved config.
    - The language switch.
    - A Drawer below `xl`.
    - Notices for a refused or failed preview, polite, with no summary.
    - The sample marker text.
  - From T16 (2026-11-17): the service kills a worker when a preview request is aborted, so the configurator must NOT abort in-flight previews on each edit — let them finish and discard stale answers by sequence id (pass no abort signal, or only abort on unmount/entity switch); a refused preview answers 422 `invalid_letterhead` with `problems[]` (same shape as a refused save) and `letterheadVersion: null`.
  - done when: Vitest passes: an edit triggers one debounced request; a stale answer is discarded; a failure keeps the pages and leaves the form usable; the language switch re-requests; pages have their alt and caption.

- [x] T23: Logo and background upload — refs: AC-7.1, AC-7.2, AC-7.3, AC-7.4, AC-7.7 — deps: T21, T15
  - touch: `letterheads-ui/src/components/AssetField*`, `letterheads-ui/src/components/VariantCard*`, `letterheads-ui/src/strings/**`, `letterheads-ui/src/strings.ts`, `letterheads-ui/src/pages/ConfiguratorPage.tsx`, `letterheads-ui/src/strings.ts`
  - Details: `AssetField` wraps `FilePicker`. It covers upload, thumbnail via `GET /v1/assets/{id}`, Remove, position and height fields shown only while a logo exists, and refusal sentences per G3 reason.
  - Amendment 2026-11-17: one sentence per upload reason (10, incl. `svg_not_allowed` with how to fix it: export a plain SVG or upload a PNG).
  - From T15: the write routes also answer 422 `invalid_request`, 400 `bad_request`, 422 `unknown_layout`, 409 `version_conflict` with `currentVersion`, and an oversize upload as 422 `invalid_asset`/`too_many_bytes`; map each to a sentence (generic for request-shape errors).
  - done when: Vitest passes on each refusal reason mapped to words, upload → thumbnail → config holds the asset id, and Remove.

- [x] T24: Save, refused values, conflict and the leave guard — refs: AC-8.3, AC-8.8, AC-4.1, AC-4.8, AC-8.2 — deps: T22, T23
  - touch: `letterheads-ui/src/pages/ConfiguratorPage.tsx`, `letterheads-ui/src/components/ErrorSummary*`, `letterheads-ui/src/lib/fieldPath*`, `letterheads-ui/src/components/SaveBar*`, `letterheads-ui/src/strings/**`, `letterheads-ui/src/strings.ts`, `letterheads-ui/src/components/AssetField.tsx`, `letterheads-ui/src/lib/formStateContext.ts`, `letterheads-ui/src/hooks/useLetterheads.ts`, `letterheads-ui/src/components/LetterheadsShell*`, `letterheads-ui/src/App.test.tsx`, `letterheads-ui/src/components/PreviewPane.test.tsx`, `letterheads-ui/src/pages/ConfiguratorPage*`, `letterheads-ui/src/components/SaveBar*`
  - Details: design F7, F9, S2, S3, S4.
    - Save bar "Save as version n+1" with `baseVersion`.
    - `ErrorSummary` (`role=alert`) and `fieldPath` (pointer → words, pointer → control).
    - Focus moves to the first refused control.
    - The `version_conflict` banner.
    - The saved outcome.
    - The empty entity state.
    - Leave guard: `registerNavigationBlocker`, `ConfirmDialog` and `beforeunload`.
  - Amendment 2026-11-17: a sentence for `unbalanced_bracket`; `wrong_type`/`missing_member`/`unknown_member` use the generic sentence.
  - From T15: the write routes also answer 422 `invalid_request`, 400 `bad_request`, 422 `unknown_layout`, 409 `version_conflict` with `currentVersion`, and an oversize upload as 422 `invalid_asset`/`too_many_bytes`; map each to a sentence (generic for request-shape errors).
  - From T21: after a save, refresh the shell's letterheads list (`activeVersion`) so it is not stale; switching entity with unsaved changes asks for confirmation (seam in `switchEntity`); replace the generic `describeProblem` with `fieldPath`, using each control's `data-pointer`.
  - From T23: a 403 on upload (or save) turns the page read-only per F7.5/F10/F11, not only the field's sentence.
  - From T22: move the Preview button (`preview.open`) into the save bar; a valid preview clears only problems the preview marked — keep refused-save problems until the next save or an edit of that control.
  - done when: Vitest passes:
    - a refused save shows the summary, puts the error next to each control and moves focus to the first;
    - an unknown reason falls back to words;
    - a conflict disables Save;
    - leaving with changes asks;
    - en/it key parity holds.

- [x] T25: History, version view, restore, and the read-only modes — refs: AC-8.7, AC-4.2, AC-8.2 — deps: T24
  - touch: `letterheads-ui/src/components/HistoryPanel*`, `letterheads-ui/src/pages/ConfiguratorPage.tsx`, `letterheads-ui/src/strings/**`, `letterheads-ui/src/strings.ts`, `letterheads-ui/src/pages/ConfiguratorPage.tsx`, `letterheads-ui/src/pages/ConfiguratorPage.test.tsx`
  - Details: design F8, F10, F11, S5, S6, S8.
    - `DataTable` of versions with names from the G9 vocabulary.
    - Open a version → a version view previewed with its `layoutVersion`.
    - Restore after `ConfirmDialog`.
    - Read-only mode is driven by `canManage`: a `fieldset disabled`, with no Save, Restore or upload rendered.
  - From T21: a copy key for every name in the catalog's `settingNames` (incl. `variants.first`, `variants.last` and per-variant names).
  - From T24: restore refreshes the shell list via the context's `refresh(known?)`; the page's version state lives in `VersionForm`.
  - done when: Vitest passes: the history renders names and the "who" name; restore posts after confirmation; access-only and out-of-scope modes render no mutating control.

- [x] T26: End-to-end tests of the configurator — refs: AC-8.1, AC-8.2, AC-8.3, AC-8.4, AC-8.7 — deps: T25, T17, T48
  - touch: `shell/e2e/letterheads*.spec.ts`, `shell/playwright.config.ts`, `shell/e2e/fixtures/**`
  - Details: access gating, a keyboard-only edit → preview → save, a refused save with focus on the first error, restore, read-only.
  - Status 2026-11-17: specs committed (ec6d29c2); 19/19 pass against a service with the CORS credentials fix; re-run against the committed service after T48.
  - done when: `pnpm -C shell exec playwright test letterheads --trace off` passes against compose.

## CRM

- [x] T27: crm-api: letterhead client and `draftToBlocks()` — refs: AC-10.3, AC-10.4, AC-10.10 — deps: T12, T18
  - touch: `crm-api/src/lib/letterheadClient.ts`, `crm-api/src/lib/letterheadClient.test.ts`, `crm-api/src/offers/blocks.ts`, `crm-api/src/offers/blocks.test.ts`, `crm-api/src/lib/env.ts`
  - Details:
    - The client uses a service token with scope `letterhead:render`, cached via `serviceToken.ts`, with a 35 s timeout. It maps failures to `layout_service_unavailable` / `letterhead_not_configured`.
    - `draftToBlocks(draft | template+answers, profile)` produces content v1 through the offer engine:
      - a missing field is a run in the `missing` style with its label;
      - entityData comes from the profile at that moment;
      - no line lists the appended deal PDFs (G5).
  - Amendment 2026-11-17: `draftToBlocks` omits absent optional members; `null` only for `entityData` values.
  - done when: `bun test crm-api/src/offers/blocks.test.ts crm-api/src/lib/letterheadClient.test.ts` passes on fixtures of the seeded templates (it/en). A blank VAT is omitted and an empty legal name still refuses.

- [x] T28: crm-api: preview routes, `letterheadService` in `GET /scope`, and the switch flag — refs: AC-10.3, AC-10.7, AC-10.8, AC-10.14 — deps: T27
  - touch: `crm-api/src/offer-drafts/offerDrafts.routes.ts`, `crm-api/src/offer-drafts/offerDrafts.preview.test.ts`, `crm-api/src/offer-templates/offerTemplates.routes.ts`, `crm-api/src/offer-templates/offerTemplates.tryPreview.test.ts`, `crm-api/src/scope/scope.routes.ts`, `crm-api/src/lib/env.ts`, `crm-api/.env.example`, `tools/env-doctor/manifest.ts`, `tools/env-doctor/templates/production/crm-api.env`, `crm-api/src/offers/contentSchema.ts`, `crm-api/src/matrix.test.ts`, `tools/env-doctor/templates/production/crm-api.env`
  - Details:
    - `POST /deals/{id}/offer-draft/preview` takes the unsaved PUT body, under the draft GET's guard.
    - `POST /offer-templates/{id}/try-preview` (G1) works without a deal, under the template editor's guard.
    - Errors: 503 `layout_service_unavailable`, 409 `letterhead_not_configured`.
    - `letterheadService` comes from `LETTERHEAD_SERVICE_ENABLED`, which is read as the literal "true".
  - From T27 (2026-11-17): add `LETTERHEAD_API_URL` and `LETTERHEAD_SERVICE_ENABLED` to `crm-api/.env.example`, and to the env-doctor manifest/production template as T1's manifest comment says; a service `header_overflow`/`footer_overflow` (a profile value too long for the letterhead frame) maps to crm-api 409 `letterhead_overflow` with `frame: header|footer`, not to `layout_service_unavailable`; reuse T27's TS content validator from a shared module if useful.
  - done when: `bun test` passes for both routes with a fake service (success, each failure code, guards, nothing stored) and for the scope flag.

- [x] T29: crm-api: generation through the service, and the offer's letterhead version — refs: AC-10.1, AC-10.2, AC-10.6, AC-10.9, AC-10.10 — deps: T28
  - touch: `crm-api/src/offers/generation.ts`, `crm-api/src/offers/generation.letterhead.test.ts`, `crm-api/prisma/schema.prisma`, `crm-api/prisma/migrations/*`, `crm-api/src/offer-drafts/offerDrafts.routes.ts`, `crm-api/src/index.ts`, `crm-api/src/offers/contentSchema.ts`, `crm-api/src/offer-drafts/offerDrafts.preview.test.ts`
  - Details:
    - With the switch on, `createOfferVersion` calls `/v1/render/pdf` inside the existing transaction, then appends the deal PDFs unnumbered as today.
    - Migration: `DealOffer.letterheadVersion Int?`, set from the answer.
    - On any failure the transaction rolls back.
    - With the switch off, behaviour is byte-for-byte as today.
  - From T27 (2026-11-17): `inOfferTransaction`'s 30 s timeout must exceed the client's 35 s bound (e.g. 45 s) so the render call cannot outlive the transaction; reuse the single `requireIssuerName` refusal (blocks.ts duplicates it) where practical.
  - From T28 (2026-11-17): `crm-api/src/index.ts` `isDraftWrite` must also match `/offer-draft/preview` (512 KiB like the draft, not 64 KiB); generation maps `header_overflow`/`footer_overflow` to 409 `letterhead_overflow` via `overflowOf` in `contentSchema.ts`.
  - done when: `bun test crm-api/src/offers/generation.letterhead.test.ts` passes:
    - with the switch on, the frame is not drawn by crm-api;
    - the deal PDFs come after the rendered pages;
    - the version is stored;
    - service down, 500, busy or timeout → no row, sequence unchanged, no object, draft unchanged;
    - pre-switch offers are byte-identical and downloadable;
    - with the switch off, the existing generation tests still pass.

- [x] T30: crm-api: switch check, upload retirement and the retirement script — refs: AC-10.11, AC-10.12, AC-10.1, AC-10.2, AC-10.8 — deps: T29, T13, T44
  - touch: `crm-api/src/entity-profiles/entityProfiles.routes.ts`, `crm-api/src/entity-profiles/entityProfiles.retired.test.ts`, `crm-api/scripts/check-letterhead-service.ts`, `crm-api/scripts/retire-uploaded-letterheads.ts`, `crm-api/scripts/*.test.ts`, `infra/README.md`, `crm-api/src/offers/offers.routes.ts`, `crm-api/src/offers/offers.letterhead.test.ts`, `crm-api/src/offers/offerSchemas.ts`, `crm-api/src/lib/env.ts`, `crm-api/src/authz/conditions.scope-fixture.test.ts`, `crm-api/src/offers/generation.ts`
  - Details:
    - With the switch on, the upload start, confirm and read routes answer 410 `letterhead_upload_retired`, and `letterhead_unusable` is unreachable.
    - The check script refuses unless `/v1/letterheads/status` shows both entities active.
    - The retirement script deletes the bucket objects and nulls `letterheadKey/By/At`.
    - Switch runbook in `infra/README.md`.
  - From T29 (2026-11-17): with the switch on, the classic routes `POST /deals/{id}/offers` and the PATCH edit (`offers.routes.ts`) must also render through the service (`renderOfferThroughService(snapshotToBlocks(snapshot, profileOf(profile), entity), …)`, `renderedOf` for the edit's `letterheadVersion`), else a legacy-template offer after the switch has no letterhead (AC-10.1, AC-10.8); expose `letterheadVersion` in `OfferSchema`; fix the stale `env.ts` comment; fix the pre-existing `tsc` error TS2769 in `conditions.scope-fixture.test.ts` (line 61).
  - done when: `bun test` passes on the 410s, the check script's refusal and success, the retirement leaving old offers openable, and a re-run of the script being a no-op.

- [x] T31: crm-api contract test against the real service — refs: AC-10.3, AC-10.9 — deps: T29, T16
  - touch: `crm-api/src/offers/letterheadContract.test.ts`
  - Details: run against the compose letterhead-api. The draft preview's page count and page texts must equal those of the generated PDF's rendered pages (pdfium-free check: the service's page texts from preview and PDF of the same blocks).
  - From T29 (2026-11-17): include an offer with appended deal PDFs against the real service (pdf-lib must read the Typst PDF).
  - done when: the test passes in compose.

- [x] T32: crm-ui: the wizard's service preview and the not-configured notice — refs: AC-10.3, AC-10.4, AC-10.5, AC-10.7, AC-10.8, AC-10.13 — deps: T19, T28
  - touch: `crm-ui/src/components/offerWizard/ServicePreview*`, `crm-ui/src/components/offerWizard/useServicePreview*`, `crm-ui/src/components/offerWizard/LetterheadNotice*`, `crm-ui/src/components/offerWizard/OfferWizard.tsx`, `crm-ui/src/lib/crmApi.ts`, `crm-ui/src/strings/offerWizard.ts`, `crm-ui/src/lib/types.ts`, `crm-ui/src/hooks/scopeContext.ts`, `crm-ui/src/pages/OfferWizardPage.tsx`
  - Details: design F12, F13, S9.
    - The path is chosen once from `letterheadService`.
    - `PagePreview` is in the same slots (wide pane and Drawer).
    - The failure notice is polite, with no dialog.
    - `letterhead_not_configured` shows the /letterheads link only when `usePermissions().apps` includes `letterheads`.
    - The old path is untouched.
  - From T27 (2026-11-17): show `letterhead_overflow` as a notice naming the frame and pointing to the letterhead (same link rule as not-configured).
  - From T28 (2026-11-17): handle 409 `letterhead_overflow` (`frame`, `entity`), 409 `entity_profile_missing` and 422 `answers_invalid` from the preview route.
  - done when: Vitest passes on the path choice, previous pages kept, the failure notice, the link rule, page text as the alternative and en/it parity, and the existing `DocumentPreview` tests still pass.

- [x] T33: crm-ui: Try the wizard, Settings and the generate error on the service path — refs: AC-10.14, AC-10.11, AC-10.6, AC-10.8, AC-10.13 — deps: T32
  - touch: `crm-ui/src/components/templateEditor/TryWizardView.tsx`, `crm-ui/src/components/templateEditor/TryWizardView.service.test.tsx`, `crm-ui/src/pages/SettingsPage.tsx`, `crm-ui/src/components/offerWizard/OfferWizard.tsx`, `crm-ui/src/lib/crmApi.ts`, `crm-ui/src/strings/templates.ts`, `crm-ui/src/strings/settings.ts`, `crm-ui/src/strings/offerWizard.ts`, `crm-ui/src/pages/OfferWizardPage.tsx`, `crm-ui/src/components/templateEditor/WizardTemplateEditor.tsx`, `crm-ui/src/pages/OfferWizardPage.generate.service.test.tsx`, `crm-ui/src/pages/SettingsPage.service.test.tsx`
  - Details:
    - `TryWizardView` uses `ServicePreview` through try-preview (design F15).
    - `SettingsPage` omits `LetterheadCard`.
    - The Generate failure messages `layout_service_unavailable` and `letterhead_not_configured` are localized.
  - From T28 (2026-11-17): try-preview can answer 409 `entity_profile_missing` (blank legal name) and 409 `template_format_mismatch` (legacy template).
  - From T32: `OfferWizard`'s `servicePreview` prop is generic (`entity`, `identity`, `ask(answers, signal)`) — plug try-preview into it; `LetterheadNotice where="generate"` already exists for the Generate error area; add the generate keys (`layoutUnavailable.*`); the Settings switch reads `letterheadService` from `useCrmCapabilities()`.
  - done when: Vitest passes on the try view's service path, Settings without the card, and the generate error message, with en/it parity.

- [x] T34: End-to-end CRM tests on the service path, and a performance check of both previews on the deployed stack — refs: AC-10.3, AC-10.4, AC-10.7, AC-8.4 — deps: T33, T26, T30
  - touch: `shell/e2e/crm-offer-wizard-service*.spec.ts`, `shell/playwright.config.ts`, `shell/e2e/fixtures/**`, `letterhead-api/perf/**`, `specs/20261116-letterhead-service/spike.md`, `shell/e2e/crm-offer-wizard-service*.spec.ts`
  - Details: the wizard preview, a missing field drawn, the failure notice, generate. A perf script times 40 scripted edits in the configurator and the wizard on the deployed stack: 2 s p95.
  - Orchestrator note 2026-11-17 (owner to confirm): no deployed stack exists until the owner's T40; measure the two previews' p95 on a local stack with the service container limited as on Railway (`--cpus=2 --memory=5000000000`), stated as a proxy; the deployed measurement joins T40. The CRM wizard reaches the service server-side, so the CORS defect routed to T48 does not affect it.
  - done when: the Playwright spec passes against compose, and the deployed perf run's p95 is under 2 s for both previews, with the result recorded in `spike.md`.

- [x] T35: Owner sign-off of real offers on the service, before the switch (plan R2) — refs: AC-10.1 — deps: T29
  - touch: `specs/20261116-letterhead-service/signoff/**`, `letterhead-api/perf/seed-local.ts`
  - Details: render 3 real offers (it/en, with appended deal PDFs) with both entities' letterheads configured to the brand templates, and give them to the owner.
  - From T29 (2026-11-17): one of the three offers has appended deal PDFs.
  - Preparation (orchestrator, 2026-11-17): seed-local gains `--entity welld_it|welld_ch`; configure both entities with letterheads reproducing `Carta_Intestata_WellD_IT_new.docx` / `_CH_new.docx` (logo PNG from the brand template, four-line footer, `{page} / {pages}`), saved through the person routes; render 3 offers through crm-api with the switch on (it/en; one with appended deal PDFs); write `signoff/README.md` with what to check and the PDFs' SHA-256. The owner's approval itself is the remaining step.
  - done when: the owner's approval is recorded in `signoff/README.md`, with the date and the PDFs' hashes.

## Closing

- [ ] T36: All gates green; QE, OWASP review and eval pass; spec status → done via `/wellforge:done` — refs: all — deps: T9, T17, T26, T31, T34, T35, T38, T40, T41, T43, T45, T46, T47, T48, T49, T50, T51, T52, T53, T54
  - touch: `specs/20261116-letterhead-service/spec.md`, `specs/20261116-letterhead-service/qe-report.md`, `specs/20261116-letterhead-service/security-review.md`, `specs/20261116-letterhead-service/eval-report.md`, `letterhead-api/CHANGELOG.md`, `.changeset/*`
  - done when: `/wellforge:done 20261116-letterhead-service` accepts. That means every task is checked, QE gives PASS, the owasp review has no open high, the eval report is fresh and passing, and changesets exist for letterhead-api, letterheads-ui, crm-api, crm-ui, auth, shell and operai-ui.
