# 20261116 — letterhead-api is a Rust service with Typst embedded as a library, for document layout only; every other backend stays Bun, Hono and TypeScript

**Date:** 2026-11-16  
**Status:** Accepted — approved plan of specs/20261116-letterhead-service (approved 2026-11-16), after the Typst spike (spike.md). **Amends ADR 20260703-estimai-api-bun-hono-typescript** ("one backend stack"), for this one service only.  
**Deciders:** Matteo Codogno (product owner)  
**Project:** operai

---

## Context

The letterhead service lays out a whole document (header, footer, page numbers, page breaks) for every tool, and the owner's constraint is "Rust, with Typst embedded as a library" (spec Constraints; an ADR is required to add Rust to the Bun monorepo). ADR 20260703-estimai-api-bun-hono-typescript rejected a second backend stack on the ground that it costs a second language, build system, runtime and test toolchain with no requirement to pay for it. Here there is such a requirement: Typst is a Rust library, and the spike (spike.md) proved that, embedded, it renders a real 10-page offer in 109 ms (preview) and 51 ms (PDF) at p95 with a fully virtual file system, a result that a subprocess or a port would have to re-prove. The same ADR said that the choice would need revisiting if a future requirement needed a library the stack lacks. This is that requirement.

## Decision

We will build `letterhead-api` as a Rust service (Cargo workspace in `letterhead-api/`, axum + tokio, `sqlx`, `aws-sdk-s3`) with Typst 0.15.1 embedded as a library, and we will use Rust for document layout only: every other backend stays Bun, Hono and TypeScript, and a new Rust service needs a new ADR.

## Failure shape

**An exception granted to one capability becomes the template for the next, and the integration points that the old uniform stack gave for free are skipped because the new thing has none of the files that used to trigger them.** In a one-stack repo, versioning, the env contract, the deploy recipe, the residency guard and the conventions each hang on a file the stack always has (`package.json`, a Prisma schema, a Bun test script). A service in another language has none of those files, so each control silently does not apply: it is not that someone decided to skip it, it is that nothing asks.

Where else this shape appears:

- **A different language for the next capability** (a JVM or Python service "just for" one library). Recognise it by a new directory with no `package.json`, no `bun test`, and a line in a plan that says "the library is only available in X".
- **The reverse direction: a port.** Someone moves a TypeScript service into Rust "because we have Rust now". The exception was for a library that exists only in Rust, not for the language.
- **A second runtime inside an existing service** (a sidecar, a native addon, a spawned binary). The same controls are skipped, one level down.
- **Control by absence of trigger:** any release, env or residency check that is driven by the presence of a file rather than by an explicit list of services.

## Options considered

### Option A — A separate Rust service, Typst as a library, with the monorepo's controls re-attached by hand (chosen)

**Pros:**
- Typst is used as designed: one compile gives one `PagedDocument`, from which the preview and the PDF are both produced (ADR 20261116-the-preview-is-the-pdfs-own-compile-as-palette-png-pages-and-the-crm-wizard-reaches-it-through-crm-api)
- The World is fully virtual, so the engine reads only `/data.json`, `/img/n` and `/asset/<id>` (spike, AC-2.2)
- The measured cost is far below the budgets: preview p95 111 ms (1 thread), PDF p95 51 ms, against 1 s and 3 s (AC-1.9, AC-1.10)
- The engine crate has no I/O, no clock and no network, which is what makes AC-1.4 and AC-2.2 provable

**Cons:**
- A second toolchain, a second dependency manager and a second test runner
- Rust is new to the team (plan R10)
- Each monorepo control has to be re-attached by hand (see Decision details)

### Option B — Keep to Bun, Hono and TypeScript (rejected)

**Cons:**
- The owner's constraint is Typst embedded as a library, and the library is Rust. A TypeScript service would have to run Typst as a subprocess or as WebAssembly, neither of which is the constraint and neither of which was measured in the spike

### Option C — Two services, one for rendering and one for the stored letterheads (rejected)

**Cons:**
- The configurator's preview must use the same engine (AC-8.4); every render would become a cross-service read of the stored letterhead. One service holds both families of routes, with separate routers and separate auth middleware so that the render route still refuses a person token (AC-3.1)

## Decision details

- **Scope.** Rust is limited to `letterhead-api/`. A second Rust service, or Rust in any other service, is a new ADR (see the triggers). `letterheads-ui` (the configurator) and `crm-api`, `crm-ui` and `auth` changes stay TypeScript.
- **Toolchain (mise).** `mise.toml` gains a `rust` pin, exact, so that CI, the Docker builder and a developer's machine use the same compiler. The spike ran on Rust 1.100; the plan does not fix the pinned version, and the skeleton task sets it.
- **Docker.** A multi-stage build: a builder stage with the pinned Rust toolchain, then `debian:bookworm-slim`, running as a non-root user. The image contains the one binary, which is both the supervisor and (as `letterhead-api worker`) the worker (ADR 20261116-renders-run-in-killable-worker-processes-and-concurrency-is-bounded-by-memory).
- **Changesets.** The monorepo versions every app with Changesets from a `package.json`. `letterhead-api/` gets a `package.json` shim that carries only the name, a version and a private flag, plus a `CHANGELOG.md`, so that `changeset-check` and the aggregate `operai` version treat it like any other app. The Cargo version is not the source of truth for releases.
- **env-doctor.** The `tools/env-doctor` manifest gains `letterhead-api` entries (auth JWKS URL, `AUTH_AUDIENCE`, `SERVICE_AUDIENCE`, database URL, bucket variables, `LH_WORKERS`, `LH_QUEUE`) so that the pre-deploy contract check covers it. A service that is absent from the manifest is not checked at all.
- **Compose and Railway.** compose gains a `letterhead-api` service, a logical database `letterhead` in the shared Postgres, and a MinIO bucket `letterhead`. `.railway/railway.ts` declares the service in `europe-west4`, the logical database `letterhead` and an EU bucket, with container memory set in `resources` (ADR 20261116-renders-run-in-killable-worker-processes-and-concurrency-is-bounded-by-memory sets what it must hold). Migrations are plain SQL files run by `sqlx migrate` in the Railway `preDeploy`, never edited once applied. The startup residency guard follows `crm-api/src/lib/s3Residency.ts`.
- **Conventions.** AGENTS.md gains a Rust section (formatting, lints, error type, how to run the tests, the rule that the engine crate stays free of I/O). Errors stay RFC 7807 `application/problem+json` with a `code`, as in every other backend.
- **What is not carried over.** Prisma, Effect, Hono and `@hono/zod-openapi` are not used here. Request and answer shapes are specified in the plan's API contracts, not generated by the TypeScript toolchain.

## Evidence

- spike.md: Typst 0.15.1 embedded, Rust 1.100, Apple M2 Ultra, release build. 10-page offer: preview p95 111 ms (1 thread), 74 ms (4 threads); PDF p95 51 ms; two renders byte-identical; injection set printed verbatim and the only files read were `/data.json` and the letterhead assets.
- Not measured: latency on the deployed service (Railway `europe-west4`). The first task after the skeleton deploys letterhead-api and runs the PERF script before any CRM work (plan R1).

## Consequences

**Positive:**
- The one capability that needs Typst gets it as a library, in one process boundary, with its security properties provable in a pure crate
- The exception is explicit and scoped, so the next reader of ADR 20260703 finds the amendment

**Negative / trade-offs:**
- Two dependency graphs, two lockfiles and a longer CI for changes under `letterhead-api/`
- A person who knows only TypeScript cannot review the engine or the supervisor unaided (R10)
- The configurator's and the CRM's TypeScript types for the render request are written by hand against the plan's contract

**Risks:**
- **A control is missed because no file triggers it** (the failure shape). Mitigation: the list above is the checklist, and the skeleton task is complete only when each item exists.
- **Rust becomes the default for "performance".** Mitigation: the scope sentence in the Decision, and the first trigger below.

## Escalation triggers

This decision is revisited when any of these happens:

- a second service, or a second capability in this one, is proposed in Rust;
- the Typst integration moves out of process (a CLI, WebAssembly), which changes the reason for Rust;
- the team cannot review or release `letterhead-api/` without the author (R10 turns into a staffing fact);
- a Typst or Rust release requires a toolchain change that mise cannot pin.

## Compliance notes

- GDPR / data-protection impact: low. The service keeps no document content, entity data, PDF or image after a render (AC-3.7); the choice of language does not change that.
- Data residency: compliant. Railway `europe-west4` and an EU bucket, with a startup residency guard (AC-3.8).
- Audit trail: not required for this decision.

## Amendment (2026-11-17) — auth details of the Rust service (owner to confirm)

- **Service credentials** are authorised by scope only; there is no per-service `sub` allowlist (`letterhead-api/api/src/auth/service.rs`).
- **JWKS policy** for person tokens: 30 s refresh cooldown, 10 min maximum key age, 1 h stale-if-error (`letterhead-api/api/src/auth/person.rs`).
- **CORS** on person routes uses an exact origin allowlist, never `*` (`letterhead-api/api/src/routes/mod.rs`).
- **Entity-scope rules** are ported to Rust (`letterhead-api/api/src/authz/scope.rs`) and pinned by one shared fixture, `docs/fixtures/entity-scope.json`, run by both crm-api (`crm-api/src/authz/conditions.scope-fixture.test.ts`) and letterhead-api in CI (`.github/workflows/letterhead-api.yml`), so the two implementations cannot drift apart.
