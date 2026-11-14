# 20261113 — The Railway project is declared in one committed file, applied only after a reviewed plan, and the dashboard is never the source of a setting

**Date:** 2026-11-13  
**Status:** Accepted  
**Deciders:** Matteo Codogno (owner; asked to evaluate Railway IaC, then to migrate: "procedi col punto 2", "procedi con gli altri 2 passi")  
**Project:** Operai

---

## Context

Each backend carried a `railway.json` (Railway "Config as Code"): builder, start command, healthcheck, `preDeployCommand` (the Prisma migrations; `auth` also seeds), restart policy, region and the single-replica pins that `notify-api`, `meetings-api`, `auth` and `estimai-api` depend on for correctness (ADR 20260713-sse-stream-auth-short-lived-ticket, ADR 20261104-durable-job-runner-work-queued-state-derived, specs/20260807-estimate-sharing R7).

Railway deprecated Config as Code: new services cannot use it, and existing files are no longer read after **2026-12-01**. On 2026-11-13, `railway config migrate status` showed that only four services (`auth`, `estimai-api`, `notify-api`, `refund-api`) still read their file. Their dashboard settings were entirely different: Railpack instead of the Dockerfile, no start command, no healthcheck and **no pre-deploy command**. After the cutoff, the first deploy of these four would have built differently and started without running its migrations, with nothing failing visibly. The other five services had their settings copied into the dashboard by `provision-tool.sh`. Their `railway.json` was already a file nothing read, kept "as the source of truth" only by convention.

## Decision

The Railway project is declared in **`.railway/railway.ts`** (Railway IaC, TypeScript SDK `railway` pinned exactly in the root `package.json`):

- **What the file declares:** every backend service, the shared Postgres and its volume, the four buckets, the custom domains, and build/deploy settings, replicas and region.
- **How changes are made:** a change is made in the file, committed, previewed with `railway config plan`, and applied with `railway config apply`, which re-plans and asks for confirmation. Apply is a person's step; CI only plans.
- **Variables are not managed** (`variables: { managed: false }`). The file contains no value and no secret. Making variables managed is a separate decision, because then a name missing from the file is deleted.
- **Destructive plans are a stop.** In a single-file setup a resource missing from the file is deleted on apply, and that includes the database volume and the buckets. `--confirm-destructive` is never passed to get past a plan nobody read.
- **Drift is detected.** `.github/workflows/railway-drift.yml` runs `railway config plan --detailed-exit-code` on weekdays and on every push touching `.railway/`, and fails on exit code 2. It needs a project token (`RAILWAY_TOKEN`); without one it skips with a notice.
- **Provisioning a tool** adds its block to the file. `infra/provision-tool.sh` checks the declaration (domain and port, EU replica, bucket region), refuses to apply an uncommitted file, and refuses to apply a declared `source` on an unconnected service without `--connect`, because connecting starts the first build.

The migration was done without a behavioural change. The four services' dashboard settings were first set to the values in their `railway.json`, while the file still took precedence, and verified with a fresh `railway config pull`. Only then did `railway config migrate cutover` switch them off Config as Code. The plan and apply that followed reported no changes. Then the nine `railway.json` files were removed.

## Failure shape

**A setting that matters for correctness lives in a place nobody reads, while the place that is read holds a different value. The difference only shows when the reader changes.**

- **Two sources for one setting.** A committed file that overrides a dashboard value makes the dashboard look wrong but harmless, until the override is withdrawn by the vendor, by a path change, or by deleting the file. Recognise it by a config file and a UI both showing a value for the same field.
- **A file kept "as the source of truth" that nothing reads.** It drifts silently from what runs, and a reviewer trusts it.
- **A switch that acts before the fix.** Railway's cutover redeploys immediately with whatever the dashboard holds. Aligning after the switch would have shipped one deploy without migrations or healthcheck. Any "detach, then reconfigure" step has this gap; the fix is to make the fallback equal first.
- **Absence as deletion.** In a declarative file covering the whole project, forgetting a resource is the same as asking to delete it. A plan's destructive marker is the only signal, and a flag that bypasses it removes the signal.

## Options considered

1. **Do nothing until the cutoff.** Rejected. Four services would lose their migrations and Dockerfile build on the first deploy after 2026-12-01.
2. **Copy every setting into the dashboard and delete the files (no IaC).** This would have worked, but leaves the configuration undeclared and unreviewable: a setting changes by a click with no diff and no history, and drift has no detector.
3. **Railway IaC with managed variables.** Rejected for now. It would put 159 variable names under the file, and a missing name would be deleted on apply. The secrets would stay `preserve()`, but the blast radius of a mistake grows.
4. **Terraform/Pulumi with a Railway provider.** Rejected. It adds a third-party provider and a state backend for a platform that now ships first-party IaC with plan, apply and stale-plan protection.
5. **Railway IaC, variables unmanaged (chosen).**

## Consequences

- One reviewed diff per infrastructure change. `git log .railway/railway.ts` is the history of the Railway project's shape.
- A dashboard edit to a declared field is undone by the next apply and reported by the drift job. Settings outside the file's scope (variables) are still changed in the dashboard, `deploy.sh` or `provision-tool.sh`.
- The root `package.json` gains a dev dependency (`railway`). `pnpm install` at the root is needed before `railway config plan`.
- The IaC path of `provision-tool.sh --apply` on a brand-new tool has not been run yet. That a service declared without a source is created unbuilt is Railway's documented behaviour, not yet observed here, so the first use is supervised.
- Undo: until 2026-12-01, `railway config migrate undo` (with the local `.railway/.cac-migration.json`) restores the file paths, but the files themselves were removed. After that date there is no Config as Code to return to.

## Compliance notes

- Data residency (AGENTS.md § Data residency): every service, the Postgres and its volume are declared in `europe-west4-drams3a`, and the buckets in `ams`. `provision-tool.sh` refuses a block without the EU replica, and a bucket's region cannot change after creation.
- No secret enters the repository: variables are unmanaged and the file has none. The drift job uses a project token scoped to the production environment, held as a repository secret.
