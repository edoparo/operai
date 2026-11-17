---
spec: 20261116
stage: qe
date: 2026-11-17
branch: lh/qe (round 1, fast-forwarded to feat/letterhead-service at b6d2a66c, "tick T50"); lh/qe2 (round 2, at af331fbb, "tick T52")
verdict: PASS (round 2, 2026-11-17; round 1 was FAIL on D1)
---

# QE report: Letterhead service

> Round 1 (sections up to 9) is kept as written: its verdict was FAIL on D1. **Round 2 at the end of this file (`## Round 2
> (2026-11-17)`) supersedes that verdict: PASS**, with the parts that belong to the owner (T35, T40) still pending.

Every number below comes from a command run in this worktree on 2026-11-17, against my own databases
(`letterhead_lh_qe`, `letterhead_svc_lh_qe`, `letterhead_e2e_lh_qe`, `letterhead_e2e2_lh_qe`, `auth_lh_qe`, `crm_lh_qe`,
`activities_lh_qe`), my own buckets (`lh-qe`, `lh-qe-test`, `lh-qe-crm`) and my own containers and ports (3101, 18391-18395,
18484, 18487, 18541, 5473, 55xx). No compose up/down, no database dropped. The worktree was at `d3f46ab8` when I started; the
feature branch moved to `b6d2a66c` (T34 e2e, T50) meanwhile, so I fast-forwarded and re-ran everything T34/T50 touched
(crm-api, crm-ui, shell, the contract test). letterhead-api sources are identical between the two commits (only `perf/` differs).

## Verdict: FAIL

One design requirement is not met (D1, medium): the wizard answers crm-api's new per-person cap (429 `preview_busy`) with the
generic "The preview could not be updated" notice and never retries, although design F13 says a busy answer is retried once
after its `Retry-After`. All 79 ACs have an executed check; none of them FAILs on its letter. AC-1.9, AC-1.10, the deployed
parts of AC-3.8, AC-8.4 and AC-10.4, and the real-offer sign-off of AC-10.1 are pending the owner (T40, T35).

| Check | Threshold | Actual | Result |
|---|---|---|---|
| AC coverage | 79/79 with an executed check | 79/79 (section 7); 6 with a part pending owner | ✓ |
| AC run results | no failing AC | 0 FAIL; 75 PASS; 4 PASS with a part pending owner (3.8, 8.4, 10.1, 10.4); 2 pending owner (1.9, 1.10) | ✓ |
| Design.md: states, a11y, reuse | all designed states present | F13 "one automatic retry for busy" missing for the 429 path (D1); all other states, a11y and the reuse inventory seen | ✗ |
| letterhead-api fmt | clean | clean | ✓ |
| letterhead-api clippy -D warnings | 0 | 0 warnings (workspace, all targets, `--locked`) | ✓ |
| letterhead-api `cargo test --workspace --locked` (DB + S3 required) | all green | 611 passed, 0 failed, 1 ignored (a manual-script fixture); macOS | ✓ |
| Same, Linux container (rust:1.100.0-bookworm) | all green | 609 passed; 2 residue tests fail for an environment reason (E3) | ✓ (see E3) |
| Conformance with pdfium 8125, `LETTERHEAD_REQUIRE_PDFIUM=1` | pixel diff <= 0.5 %, text equal, 1 pt control fails | max 0.3396 % (limit 0.5), smallest control difference 0.5721 %; 10 fixtures; 2 tests pass | ✓ |
| Worst-case tests, release, Linux container `--memory=5000000000` | green | `pool` 38/38 and `render` 31/31 passed; the 300+ page table gives 422 `too_many_pages` in 22.0 s, the low-cap run is killed in 3.2 s | ✓ |
| Residue test (real `pg_dump` 17, `LETTERHEAD_RESIDUE_REQUIRE_PG_DUMP=1`) | green | 4 passed, 0 failed; 7 temp files scanned, 0 unreadable | ✓ |
| crm-api `bun test` | green | 2109 pass, 2 skip (the contract file when no URL), 0 fail (after one load-induced failure, E4) | ✓ |
| crm-api `tsc --noEmit`; shared-copies | clean | clean; 33 groups in sync, 28 tests pass | ✓ |
| Contract test against my letterhead-api container | green | 6 pass, 0 fail, 510 expects (`LETTERHEAD_REQUIRE_CONTRACT=1`), run at both commits | ✓ |
| auth `bun test`, tsc | green | 922 pass, 0 fail; tsc clean | ✓ |
| operai-ui test / typecheck / lint / storybook build | green | 245 pass; all rc 0 | ✓ |
| letterheads-ui test / `tsc -b` / lint / build | green | 517 pass (one flaky run in 4, D2); others rc 0 | ✓ |
| crm-ui test / `tsc -b` / lint / build | green | 1607 pass (80 files); others rc 0 | ✓ |
| shell test / `tsc -b` / lint / build | green | 639 pass (42 files); others rc 0 | ✓ |
| `check-react-skew.mjs` | one version | OK, 11 frontends on react 19.2.7 | ✓ |
| `check-changeset.test.mjs` | green | 7 pass | ✓ |
| `bun test tools/env-doctor/` | green | 232 pass, 1 fail: notify-api PUSH_ENABLED, the same test fails the same way on main (932de77a) | ✓ (pre-existing) |
| T26 configurator e2e on an image built from this worktree | green | 19 passed (1.9 min), CORS credentials fix included | ✓ |
| T34 CRM service e2e (run here as a supplement) | green | 8 passed (1.6 min); the "no letterhead" journey ran (fresh service DB) | ✓ |
| Rapid typing with the per-person cap (exploratory) | previous pages kept, quiet recovery | pages kept, but a failure notice and no retry (D1) | ✗ |
| Local performance, 10 pages, 2 CPU / 5 GB container | preview p95 < 1 s; PDF p95 < 3 s | preview p95 165 ms, PDF p95 89 ms (50 runs each) | ✓ (supporting only) |
| Secret scan of `932de77a...HEAD` | 0 real secrets | 0 (section 6) | ✓ |
| Critical CVE check | 0 critical | 0 critical in npm and bun trees and in Cargo.lock (section 6) | ✓ |
| Deployed measurements AC-1.9/1.10, 8.4/10.4 p95, region check | owner's step | not run | pending owner (T40) |
| Sign-off of three real offers (T35) | owner approval | not given yet | pending owner (T35) |

## Defects

**D1 (medium, dev for the fix, architect for the cap value). The wizard shows a failure notice and does not retry when crm-api
answers 429 `preview_busy`.**

- Where: `crm-ui/src/components/offerWizard/useServicePreview.ts:83-87` (`askingAgain` retries only `status === 503`); the 429 comes
  from `crm-api/src/offers/contentSchema.ts:60` (cap of 2 in flight per person, `Retry-After: 1`, T49).
- Design: `design.md` F13 says "One automatic retry after the service's `Retry-After` for `busy`." The 503 busy path does that and
  is tested (`useServicePreview.test.tsx:171`); the 429 path was added by T49 after T34's design and has no test and no handling.
- Repro 1, unit level (a throwaway test in crm-ui, deleted): `ask` resolves, then rejects with `ApiError{status 429, code preview_busy,
  retryAfterSeconds 1}`, then would resolve. Result after 1.1 s and after 20 s: `{calls: 2, state: "failed", notice: {kind:"failed"},
  pages: ["kept"]}`. The same script with 503 + `Retry-After: 1` gives `{calls: 3, state: "ready", notice: null, pages: ["fresh"]}`.
- Repro 2, real stack (shell + crm-ui + crm-api with the switch on + auth + letterhead-api container; a 160-paragraph template of
  about 20 pages; one seller typing into "Project subject"; the spec was a throwaway in `shell/e2e/`, deleted). The cause is that
  a request the browser aborts still holds its slot in crm-api (documented at `contentSchema.ts` near the `finally`), so with
  the 250 ms debounce a typist needs about ceil(render time / 250 ms) slots:

  | Service CPU limit | Preview time at crm-api | Typing | Result |
  |---|---|---|---|
  | none | p50 281 ms, max 315 ms (62 requests) | 40, 280, 350, 700 ms per character | 0 of 62 got 429; no notice |
  | 0.7 CPU | p50 396 ms, max 700 ms (44 requests) | 280 ms per character | 3 of 44 got 429; the notice appeared during typing; the next keystroke recovered, final preview current |
  | 0.25 CPU | p50 2.75 s, max 3.37 s (62 requests) | 280 and 350 ms per character | 38 of 62 got 429; after typing stopped the pane stayed `failed` for the 6 s I waited and the last typed text was not in the pages until "Try again" |

- AC reading, answering the question asked: this is not a violation of AC-10.7 as written (a notice, the last pages stay, nothing
  blocks typing or saving, no dialog: all seen). It does not break AC-10.4's timing at normal render speed (the 0.25 CPU case is
  already past the AC's own 2 s). It is a defect against design F13 and against the intent of both ACs: the person sees "The preview
  could not be updated" while typing at an ordinary pace, for a condition the app imposed on itself and that clears in one second.
  I would not ship it as is; if the owner accepts it, it should be accepted explicitly.
- Underlying inconsistency for the architect: AC-10.4 allows a preview to take up to 2 s (p95); with a cap of 2 slots and a
  250 ms debounce the wizard stays quiet only while a preview takes under about 500 ms. Either the cap or the slot accounting
  (release a slot when the browser aborts, and cancel the service call) has to change, or the wizard has to treat 429 as busy.
- Suggested fix: `askingAgain` also returns a `LatestResultBusyError` for `429` + `preview_busy` (Retry-After 1 s), with a test
  next to the 503 one; and crm-api releases the slot of an aborted request (pass `c.req.raw.signal` to the service call).

**D2 (low, dev). A letterheads-ui test races the preview request.** `letterheads-ui/src/pages/ConfiguratorPage.test.tsx:112-118`
asserts the three URLs fetched right after the form appears, without waiting for the preview call, so it fails when the machine is
busy. Seen once in 4 full runs, the failing one while 6 other jobs ran in parallel (`expected [2 urls] to deeply equal [3 urls]`, the missing one is
`/v1/letterheads/welld_it/preview`); the other 3 full runs passed. Fix: `await waitFor` the third call.

**D3 (low, dev/devops). Changesets cover 2 of the 9 changed packages.** `.changeset/` holds only `letterhead-api-scaffold.md` and
`letterheads-ui-scaffold.md`; the diff also changes crm-api, crm-ui, auth, shell, operai-ui, activities-api and meetings-api
(the last two by one line in `problem.ts`). `scripts/check-changeset.mjs --base=932de77a --head=HEAD` exits OK because it asks
for any changeset, not one per package. Their CHANGELOGs and versions will not move at the release.

**D4 (low, devops). No advisory scan covers the Rust tree** (security-review F8, still open). I looked the 507 locked crates up
on OSV (network, not offline): no critical. Two advisories of high availability impact: RUSTSEC-2026-0194 and RUSTSEC-2026-0195
(quick-xml 0.38.4, CVSS 3.1 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`), reached only through typst-library, hayagriva and citationberg
(bibliography parsing, which the service never feeds); plus unmaintained notices for yaml-rust, paste, unsafe-libyaml, bincode,
ttf-parser, rustybuzz and a libsqlite3-sys advisory (`RUSTSEC-2026-0459`, no use of sqlite found in the service's own tree:
`cargo tree -i libsqlite3-sys` prints nothing). A scan step in `.github/workflows/letterhead-api.yml` would have shown these.

**D5 (info, pre-existing). `crm-api/src/entity-profiles/letterheadUse.test.ts` "holds at most LETTERHEAD_MEMO_LIMIT keys" takes
4.7 s alone against a 5 s limit.** It timed out once in the first full crm-api run while a Rust build ran beside it, then passed in
two later full runs (and alone). The file is unchanged from main (932de77a); not caused by this feature.

**D6 (info). One shell vitest run failed (1 file) and I did not capture which test.** The 5 other full runs after the installs of E1 passed 639/639. Unattributed; no evidence it is the feature.

**Observation (not an AC).** `POST /v1/render/pdf` ignores `Content-Type`: `text/plain` with a JSON body is read as JSON (the probe
got 422 `unsupported_content_version` for `{}`, not 415). Harmless; mentioned for the contract.

## Environment faults (not defects)

- **E1** `shell` test `remoteVersionExposes.integration` failed on the first runs: it builds every remote and `estimai-ui` (and
  others) had no `node_modules` in the fresh worktree. Fixed by `pnpm install --frozen-lockfile` in each app; then 42/42 files green.
- **E2** Linux container, first attempts: `include_str!("../../../../docs/fixtures/entity-scope.json")` not found because I
  mounted only `letterhead-api/` (fixed by mounting the repo); then the linker was killed (signal 9) by the Docker VM's 7.65 GiB
  (fixed with `CARGO_BUILD_JOBS=2`). Nothing to do with the code.
- **E3** Linux container: `residue_nothing_of_a_document_is_kept_anywhere` and `residue_no_exporter_is_configured_and_none_is_contacted`
  fail with "LETTERHEAD_S3_ENDPOINT host host.docker.internal does not match ... (127.0.0.1, localhost)": the test starts the
  service with its own loopback allowlist while my MinIO is reached as `host.docker.internal`. The residue test passes on the host
  (macOS, 4/4, with real `pg_dump` 17 through `docker exec`). Checked on the integrated tree: the guard working as designed.
  Not covered here: the Linux-only "write-denied" mode of the residue test (CI runs it on ubuntu).
- **E4** crm-api first full run: one failure (D5's test) and the "Unhandled error between tests" that follows from it, while
  `cargo test` was using the CPUs. The rerun was 2106 pass / 0 fail.
- **E5** `bun run db:release` in `auth` needs the generated Prisma client and the service env; I ran `db:generate` and set the
  env of `auth/src/lib/env.ts`. The `ENABLE_TEST_AUTH` server ran with placeholder OAuth values (never used).

## 1. Rust service (letterhead-api)

- `cargo fmt --all --check`: rc 0. `cargo clippy --workspace --all-targets --locked -- -D warnings`: rc 0.
- `cargo test --workspace --locked -- --skip conformance::` with `LETTERHEAD_REQUIRE_DB_TESTS=1` and the S3 variables:
  api unit 142, `preview` 17, `read` 15, `render` 31, `render_migrate` 5, `residue` 4 (+1 ignored), `write` 23, engine unit 350,
  corpus 24 (golden, layout pinning, injection property and fuzz). 611 passed, 0 failed.
- Conformance table (limit 0.5 %): breaks 0.3395, clusters-stretches 0.2768, every-block 0.1556, glyphs 0.1329, inject 0.1890,
  offer-en 0.3394, offer-it-background 0.2155, offer-it-novariants 0.2428, offer-it 0.3396, one-page 0.1306. The 1 pt controls
  (down, right) differ by 0.5721 % to 3.2589 % wherever they apply, so the control would fail the check as required.
  Margin 0.1604 points: worth watching, not a failure.
- Live probes on a container built from this worktree (service token from `auth`): no credential 401 `unauthorized`; bad JSON
  422 `malformed_json`; unknown entity 422 `unknown_entity`; `contentVersion` 2 422 `unsupported_content_version`; GET on a render
  route 405; a service token on a person route 401; `?pages=abc` 422 `invalid_pages`; a valid PDF 200 with
  `cache-control: no-store`, `letterhead-version`, `page-count`, `unprintable-characters`, `missing-placeholders` headers.

## 2. Rapid typing (item 6)

See D1. In short: the wizard shows the failure notice (`state: failed`, "The preview could not be updated. The pages shown are from
your last successful preview.", with "Try again"), keeps the previous pages, never retries by itself, and recovers on the next
edit. T34's own spec passes because it stops the service, which is a 503, not a 429.

## 3. Design.md checks (UI)

- Screens and states walked by the e2e runs: empty entity (S2), read-only (S5), version view (S6), history (S8), conflict, refused
  values, the preview pane (S7/S9) in loading, updating, failed-first, failed-with-pages and not-configured states, Settings
  without the upload card (S10), "Try the wizard" (F15): all present (letterheads e2e 19/19; T34 e2e 8/8).
- Accessibility: labelled controls and keyboard-only flow (AC-8.3 e2e), axe checks in letterheads-ui, polite non-modal notices,
  page text as the figure's text alternative (AC-10.5): present.
- Component reuse: the 13 NEW components of the inventory exist (`PagePreview`, `ZoneEditor`, `AssetField`, `ColourInput`,
  `CheckboxField`, `ErrorSummary`, `HistoryPanel`, `TextsHelp`, `LetterheadsShell`, `ServicePreview`, `useServicePreview`,
  `LetterheadNotice`, `useLatestResult`). Not in the inventory, all compositions of listed parts: `PreviewPane`, `SaveBar`,
  `VariantCard`, `LoadState`, `PermissionDenied`. No library component duplicated.
- F13 busy retry for the 429 path: missing (D1).

## 4. Tasks that can be ticked on this evidence

T26 (19/19 e2e passed here against an image of this tree) and T34's e2e (8/8 passed here). T35, T40 and T36 are the owner's
or the closing stage's.

## 5. Owner-pending items

AC-1.9 and AC-1.10 on the deployed service (local figures above are supporting only), the deployed-stack p95 of AC-8.4 and AC-10.4
(`letterhead-api/perf/preview-edits.ts`), the region of the deployed service (`.railway/railway.ts` declares the bucket in `ams`;
the service's own region was not checked on Railway), and T35's sign-off of the three real offers (AC-10.1).

## 6. Security floor

- Secret scan of `git diff 932de77a...HEAD` (126 188 diff lines, 343 files added, 75 modified). gitleaks, trufflehog and
  osv-scanner are not installed, so I used my own pattern scan: AWS keys, PEM blocks, GitHub/Slack/Stripe/Google tokens, JWTs,
  URLs with credentials, `password|secret|token|key = "..."` assignments and 64-hex strings. Hits are all test fixtures and checksums:
  `db-pass-7f3a` and `caller-secret` / `crm-secret` (tests that assert secrets are never echoed), `SECRET-SERVICE-TOKEN`
  (a script test), 534 SHA-256 values (Cargo.lock, font and pdfium pins, golden locks, sign-off hashes). No added file has a
  key, certificate, dump or `.env` extension (the `*.env.example` and `tools/env-doctor/templates/production/*.env` files hold only
  Railway references `${{...}}`, 1Password references `${OP:...}`, public hosts and `minioadmin` local defaults).
  The e-mail addresses in added lines are placeholders (`example.*`, `welld.example`, `.invalid`), `info@welld.it`, `info@welld.ch` and `consultant@welld.ch` (letterhead and profile fixtures), and `@operai.test` e2e users.
- Dependencies: `pnpm audit --audit-level=critical`: letterheads-ui 0; crm-ui 1 moderate; operai-ui 2 moderate; shell 26
  (1 low, 8 moderate, 17 high), none critical. `bun audit`: crm-api and auth have high advisories (deepmerge-ts, mysql2, fast-uri)
  and no critical; none comes from a package this feature added (`package.json` changes: new letterheads-ui, a shim, one line in
  operai-ui). Cargo.lock via OSV: see D4. These checks needed the network; there is no offline database on this machine.
- Recommended: an `owasp-reviewer` pass limited to what changed after the review: T48 (fit check in the pool, reserved PDF slot,
  SVG `<style>`, https auth URLs, CORS with credentials) and T49 (per-person cap, retirement script). Their tests pass here and
  the browser contract e2e shows the shell origin allowed with credentials and no other, but they were not re-reviewed.

## 7. AC coverage (79 ACs)

Suites that ran here and that the rows cite: **RU** engine unit (350), **RA** api unit (142), **RI** api integration (render 31,
preview 17, read 15, write 23, render_migrate 5, residue 4), **RG** golden corpus (24), **RC** conformance (2), **RW** worst-case
on Linux (69), **BI** crm-api (2109), **CT** contract (6/510), **AU** auth (922), **UI** operai-ui 245, letterheads-ui 517,
crm-ui 1607, shell 639, **EL** letterheads e2e (19), **EC** T34 e2e (8), **PL** local perf. Test choice per AC is plan § Test
strategy (and its additions); every cited level ran green here unless stated. PEND = pending owner.

| AC | Result | Proof that ran here |
|---|---|---|
| 1.1 | PASS | RI render (PDF of the test caller), RC, CT |
| 1.2 | PASS | RI render and preview (893x1263, `pages=`), EC |
| 1.3 | PASS | RC max 0.3396 %, control; CT page text equality |
| 1.4 | PASS | RG second render identical, RU, CT repeat |
| 1.5 | PASS | RG every-block |
| 1.6 | PASS | RG breaks, RU rules |
| 1.7 | PASS | RU, RI `unknown_style` |
| 1.8 | PASS | RU, RG layout pinning |
| 1.9 | PEND | deployed p95 not measured; PL 165 ms locally |
| 1.10 | PEND | deployed p95 not measured; PL 89 ms locally |
| 2.1 | PASS | RG injection property and fuzz |
| 2.2 | PASS | RU world log, RI pool and worker tests (no network, no file) |
| 2.3 | PASS | RU, RI image `url`/`path` refusal |
| 2.4 | PASS | RG |
| 3.1 | PASS | RI six 401 cases byte-identical |
| 3.2 | PASS | RI log test |
| 3.3 | PASS | RI refusals (413, 422, 301 pages), RW |
| 3.4 | PASS | RI/pool: looping render 504, worker gone, next served |
| 3.5 | PASS | RI/pool: 429 `busy`, caller B served, reserved PDF slot, RW |
| 3.6 | PASS | RI 20 of 25 problems, no echo |
| 3.7 | PASS | residue 4/4 with real `pg_dump` 17; Linux write-denied variant not run (E3) |
| 3.8 | PASS, PEND (deployed region) | `no-store` seen live, RI residency guard tests, `.railway/railway.ts` bucket `ams` |
| 4.1 | PASS | RI write, UI save, EL |
| 4.2 | PASS | RI restore, EL versions |
| 4.3 | PASS | RI router table, trigger refusals on real Postgres |
| 4.4 | PASS | RI read and render versions |
| 4.5 | PASS | RG layout pinning (dummy layout 2) |
| 4.6 | PASS | RI/render_migrate triggers, TRUNCATE refused |
| 4.7 | PASS | RI change rows, UPDATE/DELETE refused |
| 4.8 | PASS | RI `version_conflict`, UI conflict, EL |
| 4.9 | PASS | RI `unknown_entity` on every route |
| 5.1 | PASS | RU bounds, RG, RI write |
| 5.2 | PASS | RU bounds (4 lines, look, valign) |
| 5.3 | PASS | RI/RU `footer_overflow` |
| 5.4 | PASS | RG first-page variant |
| 5.5 | PASS | RG last-page variant |
| 5.6 | PASS | RU, RG rule |
| 5.7 | PASS | RG "Pagina {page} di {pages}" |
| 5.8 | PASS | RG it/en, RI missing language 422, save refusal |
| 5.9 | PASS | RU, RG look options |
| 6.1 | PASS | RU, RI catalog |
| 6.2 | PASS | RU escapes |
| 6.3 | PASS | RI no entityData, residue |
| 6.4 | PASS | RU `missingPlaceholders` |
| 6.5 | PASS | RU address join |
| 6.6 | PASS | RU segments, `unbalanced_bracket` |
| 7.1 | PASS | RU sniffing, RI upload |
| 7.2 | PASS | RU SVG corpus, RI, `<style>` refusal (T48) |
| 7.3 | PASS | RU size and decoded-size limits |
| 7.4 | PASS | RG logos, RI bucket |
| 7.5 | PASS | RU 13 pinned fonts, coverage string |
| 7.6 | PASS | RU, RC glyph rule (A6) |
| 7.7 | PASS | RG background |
| 8.1 | PASS | AU, UI router, EL access |
| 8.2 | PASS | RI 403 and `out_of_scope`, EL access |
| 8.3 | PASS | UI (axe, summary), EL keyboard flow |
| 8.4 | PASS, PEND (deployed 2 s p95) | EL preview follows an edit without save; `preview-edits.ts` not run |
| 8.5 | PASS | RI no outbound call, UI "(SAMPLE)", EL |
| 8.6 | PASS | operai-ui PagePreview and useLatestResult tests, letterheads-ui PreviewPane tests |
| 8.7 | PASS | UI history, EL versions |
| 8.8 | PASS | UI guard and key parity, EL |
| 8.9 | PASS | AU seed, EL access |
| 9.1 | PASS | RI expense table, PDF and preview, `welld_ch` |
| 9.2 | PASS | RU schema-name test |
| 9.3 | PASS | RI "service names no caller in its code" |
| 10.1 | PASS, PEND (T35 sign-off) | BI, CT, EC |
| 10.2 | PASS | BI, CT (letterhead v1 read back) |
| 10.3 | PASS | CT (6 offers, 2 more edits, texts equal), EC |
| 10.4 | PASS, PEND (deployed 2 s p95); see D1 | BI, UI, EC (previous pages kept, never blank, missing field drawn) |
| 10.5 | PASS | UI, EC |
| 10.6 | PASS | BI, UI, EC (service stopped on Generate: nothing created) |
| 10.7 | PASS on its letter; see D1 | BI, UI, EC (503 path); 429 path shows the notice |
| 10.8 | PASS | BI, UI, EC (link only for holders of access) |
| 10.9 | PASS | BI, CT (pre-switch bytes and snapshot identical) |
| 10.10 | PASS | BI, CT |
| 10.11 | PASS | BI 410, UI Settings |
| 10.12 | PASS | BI script tests (switch check, retirement), env-doctor |
| 10.13 | PASS | crm-ui and shell parity tests |
| 10.14 | PASS | BI, UI, EC "Try the wizard" |

## 8. What I changed

Nothing in product code. No test was added: the throwaway hook test and the throwaway Playwright probe for D1 were deleted
(`git status` is clean apart from this file). The built image `letterhead-api:lh-qe` is left for reproduction; my containers and
servers are stopped. The probe's logs are under the session scratchpad, not committed.

## 9. Recommendation

Fix D1 (crm-ui `askingAgain` plus a test, and crm-api releasing the slot of an aborted request), decide the cap against the
2 s preview allowance (architect), then re-run `useServicePreview.test.tsx` and T34's spec. D2 to D4 can go in the same round.
Run the T40 measurements and the T35 sign-off, then `/wellforge:done`.

## Round 2 (2026-11-17)

Worktree `lh/qe2` at `af331fbb` ("tick T52"), the feature HEAD. Fixes under test: T51 (`e0c6c593`, the wizard waits out
429 `preview_busy`; ConfiguratorPage test race), T52 (`929d97d6`, a changeset per package; the `advisories` job), T50
(`678500f6`, the over-long section) and T34 (`ebad4e9d`, e2e), which landed during round 1, plus the OWASP delta review
appended to `security-review.md`. Everything below ran in this worktree after a fresh `pnpm install --frozen-lockfile` /
`bun install --frozen-lockfile` in every app, against my own containers, databases and ports (letterhead-api image
`letterhead-api:lh-qe2` built from this tree; services on 3101, 18484, 18487, 18541, 18542, 18089, 18240; frontends on
5473 and 5575-5584; databases `letterhead_svc_lh_qe`, `letterhead_e2e2_lh_qe`, `letterhead_e2e3_lh_qe`, `crm_lh_qe`,
`crm_lh_qe2_unit`, `auth_lh_qe`, `auth_lh_qe2_unit`, `activities_lh_qe`). No database was dropped (three were created),
no compose up/down. `git status` is clean apart from this file; the throwaway probes (two Playwright specs) were deleted
(copies are in the session scratchpad, not committed). My containers and servers are stopped.

### Verdict: PASS

All six round-1 defects are closed or were never defects of the feature (D5, D6 info). No new defect. AC-1.9, AC-1.10, the
deployed parts of AC-3.8, AC-8.4 and AC-10.4 and the real-offer sign-off of AC-10.1 stay **pending owner** (T40, T35);
the PASS is for everything that can be verified before them.

### Defect status

| Id | Round 1 | Round 2 | Evidence (this section's numbers) |
|---|---|---|---|
| D1 (medium) 429 `preview_busy`: failure notice, no retry | open | **CLOSED** | real stack at 0.7 and 0.25 CPU: no notice at any time, pane `ready` with the latest text; persistent busy: notice after the 4th attempt (see 1) |
| D2 (low) ConfiguratorPage test races the preview call | open | **CLOSED** | `pnpm -C letterheads-ui test`: 517/517 three times in a row, plus twice more with 14 busy loops on a 24-core machine (see 2) |
| D3 (low) changesets cover 2 of 9 packages | open | **CLOSED** | 9 of 9 changed packages have an added changeset; `changeset status --since=932de77a` lists all nine (see 3) |
| D4 (low) no Rust advisory scan in CI | open | **CLOSED** | the `advisories` job's commands run locally: rc 0 with the three documented ignores, rc 1 without them; the two reachability guards pass (see 3) |
| D5 (info) `letterheadUse.test.ts` 4.7 s against a 5 s limit | open (pre-existing) | no action | crm-api full run 2109 pass / 0 fail in 42 s on an idle machine; the file is still unchanged from main |
| D6 (info) one unattributed shell vitest failure | open | no action | shell 639/639 on the full run of round 2 (the `remoteVersionExposes` integration included); no evidence it was the feature |

### 1. D1 on the real stack

Stack: shell and the ten frontends built from this tree and served (`vite preview`), `auth` (ENABLE_TEST_AUTH), activities-api,
crm-api with `LETTERHEAD_SERVICE_ENABLED=true` calling the letterhead-api container directly (`--cpus` set per run), a
160-paragraph Italian template (17 pages), the admin typing a 30-character subject into "Project subject" with the 250 ms
debounce, Playwright driving Chromium. The probe records every preview request (status, time, aborted), whether the failure
notice (`crm-wizard-service-preview-failed`) is ever added to the DOM (a MutationObserver), and, after typing, the pane's
`data-state` and whether a page's text holds the whole typed string.

| Service CPU | Typing | Previews answered (200 / 429) | Browser-aborted | Notice ever shown | End state | Latest text on pages | Time from last key to ready |
|---|---|---|---|---|---|---|---|
| none (smoke) | 300 ms/char | 2 / 0 | 29 | no | ready | yes | 0.5 s |
| 0.7 | 280 ms/char | 2 / 8 | 21 | no | ready | yes | 0.8 s |
| 0.7 | 280 ms/char | 2 / 9 | 21 | no | ready | yes | 1.6 s |
| 0.7 | 350 ms/char | 2 / 3 | 26 | no | ready | yes | 0.8 s |
| 0.25 | 280 ms/char | 2 / 25 | 6 | no | ready | yes | 5.0 s |
| 0.25 | 350 ms/char | 2 / 23 | 7 | no | ready | yes | 4.2 s |
| 0.25 | 280 ms/char | 2 / 25 | 6 | no | ready | yes | 5.8 s |

(The 200s are the first load and the final preview; at 0.25 CPU a preview takes 3.0 to 3.7 s.) Round 1, same rig: 0.7 CPU
showed the notice during typing; 0.25 CPU stayed `failed` for the 6 s I waited with the typed text missing. Now 429 is absorbed
quietly (up to 25 of 27 asks at 0.25 CPU, which is a lot of retrying but invisible), and the pane recovers by itself.

**Persistent busy.** The probe held both of the person's two slots for 14 s from the test (two loops calling the same preview
route as the same user, on the 0.25 CPU container), then typed "Portale". Timeline in ms from page load: typing ended at
4164; preview asks at 4377, 5386, 6406 and 7417, each answered 429 in 0 to 12 ms (about 1 s apart, the `Retry-After`); the notice
was added to the DOM 3255 ms after the end of typing, which is 7419 ms: **immediately after the 4th attempt and not before**.
The pane ends `failed` with the last pages kept, as designed (`Try again` or the next edit starts a fresh budget; the reset is
in the hook and in its test, I did not drive "Try again" in the browser). The T51 hook tests that back this (five, in
`useServicePreview.test.tsx`) pass in the crm-ui run below.

Observation, not a defect: crm-api still holds a person's slot for a request the browser aborted until the service answers
(`contentSchema.ts`, near the `finally`), and the cap stays at 2 (T51: "orchestrator decision, owner to confirm"). The UI now
hides the effect, but at 0.25 CPU the wizard sends about 25 retried asks per 30 keystrokes. If the owner wants less traffic,
the fix is the one round 1 named (release the slot on abort, pass the request's signal to the service call); it is not needed
for the ACs.

### 2. D2: letterheads-ui

`pnpm -C letterheads-ui test` three runs in a row: 24 files, 517 tests, 0 failed each time. Two more runs while 14 `yes`
processes loaded the machine: 517/517 both. The fix is the `waitFor` at `ConfiguratorPage.test.tsx:112`.

### 3. D3 and D4

- Changed packages against `932de77a...HEAD`: activities-api, auth, crm-api, crm-ui, letterhead-api, letterheads-ui,
  meetings-api, operai-ui (`@operai/ui`), shell: nine. Changesets added on the branch: `auth-letterheads-catalog` (auth,
  minor), `crm-api-letterhead-service` (minor), `crm-ui-letterhead-service` (minor), `letterhead-api-scaffold` (minor),
  `letterheads-shell-wiring` (shell, minor), `letterheads-ui-scaffold` (minor), `operai-ui-page-preview` (`@operai/ui`,
  minor), `problem-title-410` (activities-api and meetings-api, patch). Package names match each `package.json`.
  `pnpm exec changeset status --since=932de77a` (real Changesets, root `pnpm install`) lists patch: activities-api,
  meetings-api; minor: auth, crm-api, crm-ui, letterhead-api, shell, letterheads-ui, `@operai/ui`; no major.
  `node scripts/check-changeset.mjs --base=932de77a --head=HEAD` rc 0; `node --test scripts/check-changeset.test.mjs`
  7 pass. The summaries read accurately against the diffs (crm-api's mentions the over-long-section refusal of T50).
- `advisories` job, commands as in `.github/workflows/letterhead-api.yml`, cargo-audit 0.23.0, fresh RustSec database
  (1509 advisories) over `letterhead-api/Cargo.lock` (509 crates):
  `cargo audit --file letterhead-api/Cargo.lock --deny unsound --deny yanked --ignore RUSTSEC-2026-0194 --ignore RUSTSEC-2026-0195 --ignore RUSTSEC-2026-0459`
  gives **rc 0**: no vulnerability, 6 unmaintained warnings (bincode, paste, rustybuzz, ttf-parser, unsafe-libyaml, yaml-rust),
  printed and not failing. The same command **without** the ignores gives **rc 1** and names exactly those three
  (RUSTSEC-2026-0194 and -0195 quick-xml 0.38.4, severity 7.5; RUSTSEC-2026-0459 libsqlite3-sys 0.37.0, 6.8), so the ignores are
  needed and no more than those. The reachability step: `cargo tree --locked --target all -i libsqlite3-sys` prints nothing
  ("nothing to print"), and the quick-xml 0.38.4 parent list is exactly `citationberg`: both guards pass. `actionlint`
  on the workflow rc 0; the file parses (jobs `letterhead-api`, `advisories`; triggers push, pull_request, schedule
  `17 5 * * 1`, dispatch); the first job is skipped on `schedule`. Observation (info): the sqlite guard runs
  `cargo tree ... 2>/dev/null || true`, so if `cargo tree` itself failed for another reason the guard would read empty and
  pass; the quick-xml guard fails closed (`set -euo pipefail`). Not worth a change request on its own.

### 4. T50: an over-long section

A template with a 90-paragraph section (about 24 000 characters), through crm-api on the real stack:

| Route | Result |
|---|---|
| `POST /deals/{id}/offer-draft/preview` | 422 `section_too_long`, `sections: [{name: "section:SEZIONE TROPPO LUNGA#0", label: "SEZIONE TROPPO LUNGA"}]`, 9 ms (no service call), no text of the section echoed; the same with `?pages=1` |
| `POST /offer-templates/{id}/try-preview` | 422 `section_too_long` with the same `sections`, no text echoed |
| `POST /deals/{id}/offer-draft/generate` (control) | 422 `offer_incomplete` with `invalid: [{... code: "section_too_long"}]`: preview and generate now agree |
| a normal template, draft preview (control) | 200, pages drawn |

Wizard, in Chromium: a template with two long-text fields in one section, first drawn normally (`ready`), then both fields filled with about 10 800 characters each: `data-state` goes to `blocked`, the
`crm-wizard-service-preview-too-long` notice reads "The section "AMBITO DEL LAVORO" is longer than 20 000 characters, so the
preview cannot be updated. The pages shown are from your last preview. Shorten the text and the preview will follow."
(`aria-live=polite`), the pages and their text are the same ones as before (same image sources), no generic failure notice, no
dialog; shortening one field gives `ready`, the notice gone and the new text on the pages. Preview statuses seen: 200, 422, 200.

### 5. Regression

| Suite / gate | Round 1 | Round 2 | Result |
|---|---|---|---|
| letterhead-api `cargo fmt --check`, `clippy --workspace --all-targets --locked -D warnings` | clean | clean (rc 0 both) | ✓ |
| letterhead-api `cargo test --workspace --locked -- --skip conformance::` (DB and S3 required, `LETTERHEAD_REQUIRE_DB_TESTS=1`) | 611 passed, 1 ignored | 611 passed, 0 failed, 1 ignored (142 + 17 + 15 + 31 + 5 + 4 + 23 + 350 + 24) | ✓ |
| Conformance, pdfium 8125 pinned and fetched, `LETTERHEAD_REQUIRE_PDFIUM=1` | max 0.3396 % | max 0.3396 % (limit 0.5 %, margin 0.1604), 2 tests pass | ✓ |
| Worst-case (Linux container), residue with real `pg_dump` | green | not re-run: `git diff d3f46ab8 HEAD -- letterhead-api` shows only `perf/` files; the image build was a full cache hit (1.4 s); round 1's results stand | ✓ (unchanged inputs) |
| crm-api `bun test` (own database `crm_lh_qe2_unit`; the suite truncates its tables) | 2109 pass, 2 skip | 2109 pass, 2 skip, 0 fail, 127 767 expects, 107 files | ✓ |
| crm-api `tsc --noEmit`; shared-copies | clean; 33 groups, 28 tests | clean; 33 groups in sync, 28 pass | ✓ |
| Contract test against my container (`LETTERHEAD_REQUIRE_CONTRACT=1`) | 6 pass, 510 expects | 6 pass, 0 fail, 510 expects | ✓ |
| auth `bun test`, tsc | 922 pass | 922 pass, 0 fail; tsc clean (no `auth/` file changed since round 1) | ✓ |
| operai-ui test / typecheck / lint / build-storybook | 245 pass | 245 pass; all rc 0 | ✓ |
| letterheads-ui test / `tsc -b` / lint / build | 517 pass | 517 pass (5 runs); others rc 0 | ✓ |
| crm-ui test / `tsc -b` / lint / build | 1607 pass (80 files) | 1612 pass (80 files; the 5 new are T51's and T50's); others rc 0 | ✓ |
| shell test / `tsc -b` / lint / build | 639 pass (42 files) | 639 pass (42 files); tsc, lint rc 0; build rc 0 (the shell build of the stack, with the e2e environment) | ✓ |
| `check-react-skew.mjs`; `check-changeset.test.mjs` | OK; 7 pass | OK (11 frontends, react 19.2.7); 7 pass | ✓ |
| `bun test tools/env-doctor/` | 232 pass, 1 fail (same on main) | 232 pass, 1 fail: notify-api web push env, the same test, pre-existing on main | ✓ (pre-existing) |
| T26 configurator e2e (4 spec files), image built from this tree, fresh database | 19 passed | 19 passed (39 s) | ✓ |
| T34 CRM service e2e, relay on, `letterhead_e2e2_lh_qe` (welld_it has no letterhead, so the "no letterhead" journey ran) | 8 passed | 8 passed (24.9 s), none skipped | ✓ |
| Rapid typing with the per-person cap (item 1) | failure notice, no retry | quiet, ready with latest text | ✓ |

### Environment faults (round 2, not defects)

- **E6** First T26 run: 5 failures with "TypeError: fetch failed" or a CORS read: the service container was started on the
  new, empty database `letterhead_e2e3_lh_qe` and logged "2 migration(s) are not applied: run `letterhead-api migrate` first
  (serve never migrates)". Checked on the integrated tree: serve refusing to start on an unmigrated database is the design.
  After `letterhead-api migrate` in a one-off container, all 19 passed.
- **E7** The first crm-api `bun test` of round 2 ran against the default `crm` database that does not exist here: 633 failures
  that are all prisma connection errors. The suite truncates its tables, so I pointed it at a new database
  (`crm_lh_qe2_unit`) rather than at the one the stack uses; 0 failures.
- **E8** One `pnpm -C crm-ui run lint` call failed with rc 254 and "Command crm-ui not found": a quoting mistake of my own loop
  (`pnpm -C <app> <words>`), not the app. Run directly, `pnpm run lint` is rc 0.
- Pre-existing, unchanged: E1 (fresh worktree needs the installs of each app, done), E5 (auth Prisma client generated first).

### AC changes since round 1

AC-10.7 is now PASS on its letter and in its intent (the 429 path no longer shows the notice during ordinary typing; the
notice appears only after four busy answers in a row). AC-10.4 is PASS locally (the pane never blank, previous pages kept) and
keeps its deployed-p95 part pending. AC-10.3 and AC-10.14 gain T50's refusal of an over-long section, on both preview routes
(section 4). The other 74 rows of section 7 are unchanged, and every suite that backs them reran green above.

### Design.md checks, round 2

F13 is met on both paths: one automatic retry for a 503 `busy`, three for a 429 `preview_busy` (previous pages kept in
`updating`, the latest answers re-asked, the notice after the 4th attempt). The new T50 notice is polite, names the section,
keeps the pages, and has English and Italian strings. No new component was built (the notice is the existing `Banner`).

### Security

The OWASP delta review in `security-review.md` closes F2, F3 and F4, bounds F1 (N1, low), and finds no new medium or higher
finding; it ran before T50 to T52, which add no new input surface (T50's 422 echoes only the engine's section name and the
template heading, both written by an authorised author; T51 changes client retry timing only; T52 is CI). Nothing new here to
recommend a further `owasp-reviewer` pass; the owner decisions F5 to F9 and F11 to F14 listed there are still open and
are not QE's to close.

### Remaining

- **Defects:** none.
- **Pending owner (unchanged):** T40 (AC-1.9 and AC-1.10 on the deployed service, the deployed-stack p95 of AC-8.4 and AC-10.4
  with `letterhead-api/perf/preview-edits.ts`, the region of the deployed service), T35 (sign-off of three real offers,
  AC-10.1). T36 (`/wellforge:done`) waits for those two and for the eval report.
- **Owner to confirm (from T51):** the per-person cap of 2 previews in flight.
- **Observations, not defects:** the `POST /v1/render/pdf` Content-Type remark of round 1; the fail-open reading of the sqlite
  guard in the `advisories` job (section 3); an aborted preview still holds its slot at crm-api until the service answers
  (section 1).
