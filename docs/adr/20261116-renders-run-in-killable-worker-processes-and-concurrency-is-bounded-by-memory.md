# 20261116 — Renders run in pre-started worker processes that the supervisor kills at the deadline or at a memory cap, and concurrency is bounded by memory

**Date:** 2026-11-16  
**Status:** Accepted — approved plan of specs/20261116-letterhead-service (approved 2026-11-16); rests on spike findings F3 and F4.  
**Deciders:** Matteo Codogno (product owner)  
**Project:** operai

---

## Context

AC-3.4 requires that a render still running after 30 seconds is stopped, answers 504 `render_timeout`, and does not continue in the background. Typst cannot be cancelled from outside a compile (spike F3). The comemo cache keeps laid-out content of past renders in memory, and the worst accepted request (a 1 660-row table, about 5 000 blocks, 220 pages) peaks at about 855 MiB (F4), so the number of renders that can run at once is limited by memory, not by CPU (AC-3.5). AC-3.7 requires that after a render the service holds nothing of the document. The input is untrusted text and images from callers, fed to a typesetting engine (plan, Security).

## Decision

We will run every render in a pre-started worker process (`letterhead-api worker`) that the supervisor kills at the 30 s deadline or when its resident memory passes a cap and replaces with a fresh one, bound the work by memory (`LH_WORKERS=2`, `LH_QUEUE=4`, at most 2 queued per caller; beyond that 429 `busy` with `Retry-After: 2`), evict the comemo cache after each render, and start workers with a cleared environment, no secrets and no network client.

## Failure shape

**A computation that cannot be stopped from inside runs in the process whose availability, memory or secrets other callers depend on, so a promise to stop it is a promise the code cannot keep.** A deadline implemented as "stop waiting" leaves the work running, still holding memory and CPU, after the caller was told it ended. The second half of the same failure is a limit expressed in the wrong unit: a count of requests, when the resource that runs out is memory per request, and the worst accepted request is some 40 times the typical one. The third half is residue: state kept between jobs (a cache) means one caller's document is still in memory when the next job runs.

Where else this shape appears:

- **Any in-process engine with no cancellation**: an image decoder, a regular expression engine, a PDF or archive parser, a WebAssembly module, a user-supplied formula evaluator. The ADR on the isolated PDF check (20261115-uploaded-pdf-decoded-size-bound-before-parse, amendment of 2026-11-16, M-12) is the same shape in crm-api, solved the same way, with a child process, a wall-clock timeout and a memory ceiling.
- **Inbound and outbound.** A parser of caller bytes (this decision) and a generator whose output size depends on caller input (a table of 1 660 rows is 220 pages). Both need the bound; the output side is easy to forget because it looks like our own code.
- **Fairness as well as size.** A queue shared by all callers is spent by whoever sends the most (the pattern of `crm-api/src/offers/isolatedPdfCheck.ts:51-65`, a per-owner share of the waiting places).
- **Retention.** A memo, cache or pool that keeps the last job's data between jobs (a warm cache, a reused buffer, a reused worker with state) is residue under AC-3.7 even if nothing is written to disk.

## Options considered

### Option A — Pre-started worker processes, killed at the deadline or at an RSS cap (chosen)

A worker renders one job at a time, reads it from stdin, writes one result to stdout, evicts the cache and waits. A kill is SIGKILL; the supervisor starts a replacement.

**Pros:**
- The only way to stop a Typst compile (F3), so AC-3.4 holds and nothing continues in the background
- No spawn cost on the 2 s preview path: a fresh process costs 132 ms for 10 pages (spawn, font parse, preview and PDF), which the pool avoids
- A worker holds no socket, no database, no bucket and no secret, so a crafted document that did take over a render has nothing to steal in that process

**Cons:**
- A pool to supervise (health, replacement, memory polling)
- Jobs and results cross a pipe, so a 20 MiB request is copied into the worker

### Option B — Threads in the service process (rejected)

**Cons:**
- A thread cannot be stopped (F3). A render that passes 30 s would keep running after the 504, which breaks AC-3.4. A worker thread also shares the memory and the secrets of the supervisor

### Option C — A fresh process for every render (rejected as the default; kept as the fallback)

**Pros:**
- Nothing survives a render, which is the strongest reading of AC-3.7
- 132 ms measured for 10 pages: affordable

**Cons:**
- Pays the spawn and the font parse on every render, on the path with a 1 s p95 target (AC-1.9). If a pooled worker misbehaves in a way eviction does not cure, this is the fallback

### Option D — Bound concurrency by request count alone (rejected)

**Cons:**
- The unit that runs out is memory, and the worst accepted request is about 855 MiB against a typical few tens. A count that is safe for the worst case wastes the machine on the typical case, and a count that suits the typical case is an out-of-memory kill under the worst

## Decision details

- **Pool and queue.** `LH_WORKERS` (default 2) workers; `LH_QUEUE` (default 4) waiting jobs, at most 2 per caller identity (the verified service identity, never a claimed id). A request that finds the pool and its caller's share full is answered 429 `busy` with `Retry-After: 2` (AC-3.5). A second caller's request is still served while the first is saturated.
- **The memory rule.** RSS cap per worker 1 GiB, set above the worst accepted request (about 855 MiB, F4). The container must hold workers × 1 GiB plus the supervisor; this is set in `.railway/railway.ts` `resources`. The supervisor polls each worker's resident set from outside. As with the PDF check, the poll is a watchdog and not a wall (an allocation that outruns one poll can exceed the cap before the kill); the 30 s deadline bounds time in any case.
- **Deadline.** 30 s (AC-3.4), overridable in tests (feature `test-slow` adds a layout that loops). Worst accepted request measured 1.8 s locally, so the deadline leaves headroom for a slower vCPU. A kill answers 504 `render_timeout`; the worker's PID must be gone and the next request served by a fresh worker.
- **Eviction.** The comemo cache is evicted after every render. This costs about 2.5 times on a repeated request (preview p95 42 ms with the cache kept, 111 ms with eviction; PDF 3.5 ms against 51 ms) and keeps nothing between jobs (AC-3.7). The supervisor's own cache holds only logos and backgrounds by immutable asset id, which are not document content.
- **Isolation of a worker.** Spawned with a cleared environment: no credential, no database URL, no bucket key, no JWKS. The worker has no network client code, and a test (a dedicated run under `strace -f -e trace=network`) asserts it makes no network syscall. This is containment by construction and by test, not a sandbox: there is no seccomp profile in this decision, and a worker runs as the same user as the supervisor.
- **The World.** The worker's file system is the engine's virtual World: it serves `/data.json`, `/img/<n>` and the asset ids of the version being rendered, under names the service chose (F5, F6, F7). Typst 0.15 resolves a relative `href` inside an SVG through the World (F5), so the SVG sanitizer at upload and the re-serialised stored SVG are load-bearing, and the World's access log is asserted in a test.
- **Images are bounded before they are decoded.** A logo or caller image is limited to 2 MiB, and for a raster image the decoded size is computed from the header and refused above 25 megapixels before any decode; an SVG is refused above 10 000 elements (AC-7.3). This follows ADR 20261115-uploaded-pdf-decoded-size-bound-before-parse (a size is what the decoder would produce, not what the file says), and a header that lies about its dimensions is a test case. The worker memory rule depends on it: an unbounded decode would break the 855 MiB figure.
- **Request limits that make the worst case finite** (AC-3.3): body 20 MiB, 5 000 blocks, 200 000 characters in a text, 300 pages, measured worst accepted 1.35 s of compile and 855 MiB.

## Evidence

- spike.md F3 (no cancellation), F4 (memory), and the rows for 5 000 blocks (180 pages, compile 0.6 s, render 1.1 s), a 200 000-character paragraph (48 pages, 0.35 s, RSS 187 MiB) and the 1 660 × 3 table (220 pages, compile 1.35 s, RSS 855 MiB).
- Fresh process per render, 132 ms; cache kept against evicted, as above.
- Planned tests (not run yet): AC-3.4 (R-int, `test-slow` layout, 504, PID gone, next request served); AC-3.5 (saturate with caller A, 429 plus `Retry-After`, caller B served); AC-2.2 (World access log and network syscall test); AC-3.7 (RES: marker strings searched in Postgres, bucket, the container file system including `/tmp`, logs).
- Not measured: the pool on Railway's smaller vCPU and memory (plan R1). The first task after the skeleton measures it, and the owner hears the result before any CRM task starts.

## Consequences

**Positive:**
- A render that overruns is stopped, not abandoned; the 504 means what it says
- One caller cannot take the whole pool, and a hostile document cannot take the service's secrets because the worker has none
- Memory use has a computable ceiling: workers × 1 GiB plus the supervisor

**Negative / trade-offs:**
- Throughput is two renders at once by default; a burst is answered 429 and callers must retry (crm-api maps `busy` to 503 `layout_service_unavailable`, AC-10.7)
- Eviction makes a repeated identical request cost about 111 ms instead of 42 ms (p95)
- A worker is the same Unix user as the supervisor, so it is not a confidentiality boundary against a code-execution bug in the engine

**Risks:**
- **Railway's vCPU or memory is far below the spike machine**, so two workers at 1 GiB may not fit or the latency may miss AC-1.9 and AC-10.4. Mitigation: R1 (deploy and measure first; container memory in `resources`; lower `LH_WORKERS` to 1 if needed).
- **A pooled worker misbehaves** (leaks past eviction). Mitigation: the RSS cap kills it; if it persists, switch to a fresh process per render (132 ms).
- **The RSS poll misses a fast allocation.** Mitigation: the request limits make the worst case finite and measured; the container limit is the last stop.

## Escalation triggers

This decision is revisited when any of these happens:

- Typst gains cancellation that works inside a compile (the pool would then be a performance choice, not a necessity);
- a worker is found to read, write or send something outside its job (the cleared-environment and no-network assumptions);
- the worst accepted request changes (the limits of AC-3.3 are raised, or a new block type has a different cost) and the 1 GiB cap no longer has headroom;
- PERF on Railway misses AC-1.9, AC-1.10 or AC-10.4 with the default pool;
- a second service in this repo needs to run an uncancellable engine (the pattern should be shared, not copied).

## Compliance notes

- GDPR / data-protection impact: low to medium. The documents carry personal and financial data in transit. The worker has no persistence, the cache is evicted after each render, and AC-3.7 is proven by a residue test; the supervisor logs identifiers and numbers only.
- Data residency: compliant, Railway `europe-west4` and an EU bucket.
- Audit trail: not required. One log line per render or refusal (caller, entity, outcome, pages, milliseconds), never content (AC-3.2).

## Amendment (2026-11-17) — the RSS cap is 2 GiB and the container 5 GB (owner to confirm)

Written from implementation findings (T41, T46) in an unattended run. The text above stays as decided; where it says 1 GiB, this section wins.

- **Decision.** The per-worker RSS cap defaults to 2 GiB (`LH_WORKER_RSS_MB`, 64..=16384; `letterhead-api/api/src/env.rs`). The Railway container is 5 GB: 2 workers × 2 GiB plus the supervisor. A worker over the cap is killed and the request answered as below.
- **Why.** The engine compiles the whole document before the 300-page check. On Linux, run as Railway runs it, the worst accepted table (300 pages) and the over-limit table (301 pages, refused 422) both peak at 1.53 GiB (`specs/20261116-letterhead-service/spike.md`, T46), above the 855 MiB of F4 and the 1.5 GiB first set in T41. One run each, for these two layouts only.
- **Errors.** `MemoryExceeded`, `WorkerFailed` and `Unavailable` all answer 503 `render_unavailable` with `Retry-After: 2` (`letterhead-api/api/src/routes/mod.rs`).
- **An aborted request kills its worker.** The configurator therefore does not abort superseded previews; it lets them finish and discards stale answers by sequence id.
- **Residual risk.** A document far beyond 300 pages that stays within the block limits can still reach the cap and get a 503, because the limits of AC-3.3 do not bound pages. A pre-layout page estimate would fix it; not built.
- **Consequence.** The memory ceiling is workers × 2 GiB plus the supervisor, not × 1 GiB; the "1 GiB cap no longer has headroom" trigger above was met at measurement time and resolved by this change.
- **The fit check is a pool job (T48, security review F2).** The save-time and preview fit check (`check_fit`, up to 12 Typst compiles and the decoding of the person's uploaded images) used to run on a `spawn_blocking` thread of the supervisor, which cannot be cancelled and has no memory cap. It is now a job kind of the pool (`Job::fit`: configuration, assets, the 40-character values, no document), so it has the 30 s deadline, the RSS cap and the kill like a render, and the two route-local semaphores are gone. The refusal shape is unchanged (422 `invalid_letterhead`, problems at the frame path). A fit check that finds the pool full is 429 `busy` with `Retry-After` (before: a wait of up to 10 s for a thread); one past the deadline is 504 `render_timeout`.
- **One worker is reserved for PDFs (T48, security review F1, service side; owner to confirm).** With `LH_WORKERS = n >= 2`, previews (the person's `/v1/letterheads/{entity}/preview` and the service's `/v1/render/preview`) and fit checks together may hold at most `n - 1` workers; a PDF render (`/v1/render/pdf`) may hold all `n`. An interactive job that has no right to a free worker waits in the queue like any other, and a returning worker goes to the longest-waiting job that may have it, so a PDF is served before interactive jobs that are over their limit. So a flood of previews cannot keep offer generation from running, though it can still fill the queue (the CRM-side per-person cap of T49 bounds that). With `n = 1` nothing is reserved: the single worker is shared, because a reservation would stop previews altogether. With the default `n = 2`, previews and fit checks run one at a time.
- **Consequence for sizing.** Interactive throughput is `n - 1` jobs at once; raise `LH_WORKERS` (and the container memory, workers x 2 GiB plus the supervisor) if previews feel slow.
