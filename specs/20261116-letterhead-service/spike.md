---
spec: 20261116
date: 2026-11-16
status: done
---

# Spike — Typst embedded in Rust, before the plan

The Constraints of spec.md ask for a short Typst spike BEFORE the plan: a real offer as blocks, a
different first page, a footer "N/M", and the preview latency; the figures marked "to confirm"
(O10) are settled by it. Code: `spikes/letterhead-typst/` (Rust crate, the one template, fixture
generator and checker). Not production code.

## Set-up

- Typst **0.15.1** (`typst`, `typst-layout`, `typst-pdf`, `typst-render`) embedded as a library,
  Rust 1.100. One compile of the request gives one `PagedDocument`; the preview (PNG per page +
  page text) and the PDF are both produced from that same document object.
- The World is fully virtual: the template and the fonts are compiled into the binary; the only
  "files" are the request's `/data.json`, its images (`/img/<n>`) and the letterhead's assets
  (`/asset/<name>`). Any other path is refused and logged.
- Text reaches Typst only as JSON strings placed as `str` values: nothing is ever parsed as markup,
  and the template uses no `eval`, `plugin` or caller-chosen `read`.
- Reference letterhead: `Carta_Intestata_WellD_IT_new.docx` (welld-brand skill): logo 33.3 × 12.7 mm
  top-left; footer of **four** lines (legal name red `#e50339` bold 10 pt, address and web 8 pt,
  fiscal line 7.5 pt grey `#595c69`), "N / M" right-aligned on the last line; Ubuntu for the
  frame, Noto Serif for the body. It carries no artwork beyond the logo; the background-image
  variant (AC-7.7) was exercised with a coloured band SVG on page 1.
- Real offer: crm-api `defaultTemplates.ts` (Italian, nine sections, cost table with header row
  and totals, bold/italic/underline runs, ordered and bulleted lists, an image, a page break).
- Measured on an Apple M2 Ultra, single process, release build. **Not** on the deployed service
  (see "Not measured").

## Results

| What | Result |
| --- | --- |
| Real offer as blocks, first page different, last page different, "N / M", background band | Works. 4 pages; first page full footer and logo, middle pages small logo + "Offerta – pagina N di M", last page full footer again. `[IBAN {iban}]` with a blank IBAN disappears whole (AC-6.6). |
| Same request in `en` | "Offer – page 2 of 4", same page breaks (AC-5.8). |
| Preview vs PDF page count (AC-1.3) | Equal on every fixture. |
| Preview text vs PDF text (pdfium extraction) | Equal on every page **with whitespace normalised** (runs collapsed to one space). Exact whitespace differs between extractors. |
| Pixel difference preview vs PDF rasterised by pdfium, same scale | Naive per-pixel: 1.4–1.9 % of pixels differ by > 64/255 (anti-aliasing of two rasterisers). **AA-tolerant metric** (a pixel differs only if no pixel within 1 px of it in the other image is within 64/255): **max 0.43 %** on real pages. Positive control (preview shifted by 1 pt): 2.3–3.0 % → a real divergence is caught. |
| Determinism (AC-1.4) | Two renders: PDF **byte-identical**, PNGs byte-identical. |
| Injection set (AC-2.1) + `#import`, `#image("/etc/passwd")`, `#plugin`, `#eval`, `#json("/data.json")`, `]#panic("x")[` in headings, runs, lists, cells and entity data | Every string printed verbatim; page size unchanged; the only files read were `/data.json` and the letterhead assets (AC-2.2). |
| 10-page offer, preview (compile + 10 PNG + texts), comemo cache evicted after each render | p50 109 ms, p95 111 ms (1 thread); p95 74 ms (4 threads) |
| 10-page offer, PDF (compile + export), cache evicted | p95 51 ms |
| Same, cache kept between identical requests | preview p95 42 ms, PDF p95 3.5 ms |
| Fresh process per render (spawn + font parse + 10-page preview + PDF) | 132 ms |
| Preview payload, 10 pages at 1.5 px/pt (893 × 1263) | RGBA PNG 3.0 MiB; **64-colour palette PNG ~650 KiB** with the same 0.435 % tolerant difference; 16 colours ~430 KiB but 0.74 % (fails). PDF 240 KiB. |
| 5 000 blocks | 180 pages, compile 0.6 s, whole render 1.1 s |
| One 200 000-character paragraph | 48 pages, 0.35 s, RSS 187 MiB |
| 5 000 runs in one paragraph | 0.15 s |
| Table of 1 660 rows × 3 (≈ 5 000 blocks) | 220 pages, compile **1.35 s**, RSS **855 MiB** (with the row measuring of AC-1.6 below) |
| Header/footer taller than its margin | Detected by measuring in the template; render refused `footer_overflow` (AC-5.3). |
| Characters outside the fonts (漢字 😀 ⨌ ᚠ) | `text(fallback: false)`: drawn as a visible box (.notdef), counted exactly (5) from the frames (AC-7.6). |
| Font coverage (AC-7.5) | Ubuntu 0.83, Noto Serif 2.015 (italic 2.013), DM Sans 4.004, DM Mono 1.000, Syne 2.200: all cover IT/FR/DE accents, €, ’ ‘ “ ” – — «»; all `fsType = 0` (installable embedding). Variable fonts work in Typst 0.15. Syne has no italic. |
| Page-break rules (AC-1.6), 71-page fixture | Headings never last on a page; table header repeated on every continued page; two consecutive page breaks give no empty page; widows/orphans prevented by Typst by default (`text.costs`) — **not** checked automatically in the spike. |

## Findings that change the plan

- **F1 — Row taller than a page.** `table.cell(breakable: false)` on a row taller than the page
  body makes the row run off the page, over the footer (text lost). Fix proven: the template
  measures every row and sets `breakable` only when the row cannot fit an empty page. Cost: the
  1 660-row table goes from 0.9 s to 1.35 s.
- **F2 — A word wider than the line** (200 000 "x", a long URL, an IBAN in a narrow cell) is not
  broken and overflows the right margin. AC-1.6 ("no word is split") and AC-5.1 ("only inside
  the margins") cannot both hold. → spec amendment A4.
- **F3 — No cancellation in Typst.** A compile cannot be interrupted from outside. AC-3.4 (stop at
  the timeout, nothing continues in the background) therefore needs each render in a **worker
  process** that is killed at the deadline. The fresh-process cost (132 ms for 10 pages) is
  affordable; a pool of pre-started workers avoids it.
- **F4 — Memory.** The comemo memoisation cache keeps laid-out content of past renders in memory;
  evicting after each render costs ~2.5× on a repeated request but keeps nothing (AC-3.7 spirit).
  The worst accepted request peaks at ~855 MiB: the concurrency bound of AC-3.5 is set by memory
  (worker RSS cap), not by CPU.
- **F5 — SVG references inside the engine.** Typst 0.15 refuses URLs and absolute paths in an SVG,
  but **resolves relative ones through the World**: an SVG logo with `href="../img/0"` read the
  request's image. AC-7.2's sanitizer is load-bearing; in addition the service stores a
  re-serialised SVG (no `href`, no `style`, no `use` to outside) and the World serves an asset's
  files only under names it chose.
- **F6 — Image format by name.** Typst picks the decoder from the file extension; the service must
  name assets by the format sniffed from their bytes (AC-7.1), never by the uploaded name.
- **F7 — File ids are interned forever** (max 65 536 per process): virtual paths must come from a
  fixed set (`/img/0…`), never per-request names.
- **F8 — The reference letterhead does not fit the spec's frame model** → amendments A1–A3.
- **F9 — Layout reproducibility across upgrades (AC-4.5).** Byte-identical output for one binary;
  a Typst upgrade or a template change can move lines. A letterhead version must record the
  *layout version* (template + Typst version) it was saved with, and old layout versions must stay
  renderable.

## Proposed spec amendments (owner to approve before the plan)

- **A1 (AC-5.2)** A zone holds up to **four** lines (the brand footer has four). The "fits its margin
  with 40-character values" save check is unchanged.
- **A2 (AC-5.2, AC-5.9)** Each header/footer line has its own look from a closed set: size (6 to 14 pt),
  weight (regular/bold), colour (six-digit hex). The brand footer needs a red bold first line and a
  smaller last one; today the spec gives the frame only a font.
- **A3 (AC-5.2)** Each header and footer sets its zones' vertical alignment (top or bottom), so a
  one-line "N / M" sits on the last line of a four-line left zone, as in the brand template.
- **A4 (AC-1.6)** A word wider than its line or cell is broken at the margin (the only case where a
  word is split); nothing is ever drawn outside the margins.
- **A5 (AC-1.3)** Text equality is compared with whitespace normalised; the 0.5 % is measured with
  the AA-tolerant metric above (1 px neighbourhood, 64/255), against pdfium at the preview's scale.

## Figures marked "to confirm" (O10)

| AC | Proposed | Spike | Plan value |
| --- | --- | --- | --- |
| AC-1.3 pixel tolerance | 0.5 % | 0.43 % max (tolerant metric) | 0.5 % with A5's metric |
| AC-1.9 preview 10 pages p95 | 1 s | 0.11 s local | 1 s, confirmed on Railway in the first deploy task |
| AC-1.10 PDF 10 pages p95 | 3 s | 0.05 s local | 3 s, same |
| AC-3.3 limits | 20 MiB / 5 000 blocks / 200 000 chars / 300 pages | worst accepted: 1.35 s, 855 MiB | kept |
| AC-3.4 timeout | 30 s | worst 1.8 s local | kept at 30 s (headroom for a slower vCPU) |
| AC-5.1 margins | 5–100 mm, body ≥ 100 × 150 mm | brand: 32/34/25.4/25.4 mm | kept |
| AC-7.3 logo limits | 2 MiB / 25 MP / 10 000 SVG elements | not stressed | kept |
| AC-8.4 / AC-10.4 preview in 2 s | 2 s | compute ≤ 0.11 s + ~650 KiB payload | kept |

## Not measured

- **Worker memory of the worst accepted table on Linux (T46, 2026-11-17).** VmHWM of the render worker, read from `/proc/<pid>/status` every 50 ms, in `rust:1.100.0-bookworm` run as Railway runs the service (`--cpus=2 --memory=4000000000`), release build, `LETTERHEAD_WORST_CASE_TESTS=1`, cap raised to 4 GiB so nothing is killed, one fresh worker per table (`api/tests/pool.rs`, 1 660 rows x 3 cells, 4 984 blocks): the 300-page table (accepted) **1 604 448 kB = 1.53 GiB**, the 301-page table (refused 422) **1 606 372 kB = 1.53 GiB**. That is above T41's 1.35 GiB (macOS) and above the 1.5 GiB cap it set, so the default cap is 2 GiB and the container 5 GB (`infra/README.md`). On macOS `ps` showed 1.62 and 1.78 GiB for the same two tables (macOS RSS accounting differs; both are under 2 GiB). One run each; the figures are for these two letterhead-less layouts of `config("F", None)`, not a bound for every layout (the limits of AC-3.3 do not bound pages).

- Latency on the deployed service (Railway `europe-west4`): the targets have a 9×–60× margin
  locally; the first deploy task (T40, the owner's step) measures AC-1.9/1.10 there before the CRM work starts.
  Still not measured: what follows is a **local constrained-container proxy**, not that measurement.
- **The two previews, end to end, on a local proxy stack (T34, 2026-11-17; `letterhead-api/perf/preview-edits.ts`).** AC-8.4 (configurator) and
  AC-10.4 (CRM wizard) ask for the new pages within 2 s of an edit in 95 % of edits. Measured in headless Chromium through the real shell, signed in as a
  real administrator, against the real `auth`, crm-api (`LETTERHEAD_SERVICE_ENABLED=true`, calling the service directly) and letterhead-api: 40 scripted
  edits per preview after 2 uncounted ones, 500 ms of quiet between edits, from the field's `input` event to the pages that carry the new text being in the
  DOM, `ready`, and painted (two animation frames); nearest-rank p50 = 20th and p95 = 38th of 40. The service is the image of this branch (rebased on
  T48, `ec1de120`, no patch) as Railway starts it, `--cpus=2 --memory=5000000000`, `LH_WORKERS` default 2 (so a preview uses one worker), with Postgres 17
  and MinIO of the compose stack on the same machine (the host of T13's proxy, shared with other jobs). **A proxy, not the deployed stack**: no network, other CPUs, a
  warm service; the deployed run joins T40.

  | Preview (document) | pages | run 1 p50 / p95 | run 2 p50 / p95 | service's own time, p50 / p95 (runs 1, 2) | Budget |
  | --- | --- | --- | --- | --- | --- |
  | Configurator (the sample document, footer text edited) | 4 | 445 / 466 ms | 451 / 476 ms | not logged (person routes) | 2 s (AC-8.4) |
  | Wizard, 10-page offer (90 numbered paragraphs, subject edited) | 10 | 502 / 524 ms | 508 / 546 ms | 189 / 201, 190 / 199 ms | 2 s (AC-10.4) |
  | Wizard, longest offer of the journeys (seeded SLA template, every field long, hand-edited section, two annexes) | 25 | 1 257 / 1 323 ms | 1 267 / 1 330 ms | 908 / 987, 942 / 989 ms | 2 s (AC-10.4) |

  Worst p95 of any series: **1 330 ms** (the 25-page worst case); the 4-page and 10-page previews are under 550 ms. The screen's 250 ms debounce is in every figure.
  What this does not say: Railway's CPU and network, a cold service (the first render reads the logos), and several people editing at once (one editor, sequential
  edits; with one preview worker a second concurrent preview waits in the queue). The configurator's sample document is 4 pages, so the 10-page figure is the wizard's.
  A section of an offer over 20 000 characters is cut at the limit in the PREVIEW without any notice in the pane (generation refuses it with `section_too_long`);
  found while sizing the 10-page document, which is why it is made of sections of at most 40 paragraphs.
- **Local constrained-container proxy (T13, 2026-11-17; `letterhead-api/perf/`).** The service image
  (`docker build -t letterhead-api:T13 letterhead-api`, built from this branch at d0c6cd29, T12's code) run as Railway starts it (`letterhead-api`,
  `RAILWAY_PRIVATE_DOMAIN` set, so it binds `[::]`) with `--cpus=2 --memory=4000000000 --memory-swap=4000000000`: the
  `limitOverride` that `.railway/railway.ts` declares for the service (2 vCPU, 4 GB), so the proxy is the declared size, not
  a guess at the plan. `LH_WORKERS=2`, `LH_QUEUE=4`. Postgres 17 and MinIO are the compose ones, on the same machine, in a database and
  a bucket of their own; one `welld_it` version (the golden `brand` letterhead, layout 1, logo, small logo, background
  band). The client is `perf/render-perf.ts` on the same machine, with a service JWT from a JWKS it serves itself. Host: Apple M2 Ultra
  (24 cores, Docker VM with 8 GB) shared with other jobs; the container's 2 CPUs are a cgroup quota on those fast cores, not
  Railway vCPUs. The document is `offer-it` repeated to 10 pages (125 blocks, 23 469 bytes; there is no 10-page fixture, see
  `perf/README.md`). 50 sequential renders per series after 2 uncounted ones; client wall clock; nearest-rank percentiles.

  | Series (10 pages) | run 1 p50 / p95 | run 2 p50 / p95 | run 3 p50 / p95 | worst p95 | Target | Margin |
  | --- | --- | --- | --- | --- | --- | --- |
  | Preview (PNG and text of every page, ~870 KB) | 148 / 153 ms | 163 / 169 ms | 151 / 171 ms | **171 ms** | 1 s (AC-1.9) | 5.8× |
  | PDF (~126 KB) | 68 / 71 ms | 68 / 71 ms | 70 / 88 ms | **88 ms** | 3 s (AC-1.10) | 34× |

  The server's own log line agrees with the client to within a few milliseconds (run 3: preview p50 148 ms, PDF p50 67 ms). The
  calibration renders that precede each series have already read the logos from the bucket, so the series measure a warm service. The
  spike's numbers (preview p95 111 ms, PDF 51 ms, one thread, no container) are 1.4 to 1.5× (preview) and 1.4 to 1.7× (PDF) lower, as
  expected with a CPU quota and a database and a bucket in the path; the spread between the three runs (up to 12 % on a p95 of the
  preview, 24 % on the PDF's) is the noise of a shared host.
  What this does **not** say: Railway's CPU is slower per core than an M2 Ultra, and its neighbours differ; the logos here are
  130 to 232 bytes (the corpus's), so a real logo's decode time is not in it; the bucket is a MinIO on the same host, and the supervisor
  keeps the assets after the first read, so the figures hold for a warm service. A run from outside Railway also includes the network.
  T40 repeats the same script against the deployed service and the figures there are the ones that count.

  Memory, with `perf/worst-case.ts` (a table of 1 660 rows x 3 cells, 4 984 blocks, 100 to 135 characters in the middle cell):
  - The 10-page series leaves the busy worker at about 116 MB resident at its high-water mark; the whole container peaked at 138 MB.
  - Two worst-case previews at once (277 pages, 18 MiB answer each, 6.0 s on 2 CPUs) and two worst-case PDFs (277 pages,
    4.9 to 5.0 s) all answered 200; over the whole series the container peaked at 2.17 GB of its 4.0 GB, no OOM kill, no restart, so
    2 workers plus the supervisor fit with about 1.8 GB to spare. A worker that had rendered a 56-page version of the same table still held
    470 to 520 MB resident afterwards (the allocator does not return it); the 1 GiB cap kills a worker that grows past that.
  - At the edge of the page limit: the 135 and 140 character versions lay out to 299 pages and answer 200 (PDF, 4.8 to 5.5 s). At 145
    characters (PDF) and 150 (preview and PDF) the worker passes its 1 GiB cap while laying the document out, and the answer is
    **503 `render_unavailable`** (the log says `render_memory_exceeded`), not the **422 `too_many_pages`** that AC-3.3 gives a document
    over 300 pages. I did not establish the page count of these, but the 140 character one is already at 299, so they are at or over the
    limit. The supervisor kills the worker, the container is untouched and the next requests are served. Reported for T12's owner; not changed here.
- The CH letterhead (same structure as IT, other texts) was not rendered.
- Automated widow/orphan check over frames: becomes a plan test.
