# 20261116 — The preview is the PDF's own compile rasterised to 64-colour PNG pages plus each page's text, and the CRM wizard reaches it through crm-api; this supersedes the HTML preview and the browser-drawn letterhead at the switch

**Date:** 2026-11-16  
**Status:** Accepted — approved plan of specs/20261116-letterhead-service (approved 2026-11-16); owner decisions O10 and O15. **Supersedes, at the switch (`LETTERHEAD_SERVICE_ENABLED`), ADR 20261115-paginated-preview-one-flow-float-rail and ADR 20261115-letterhead-preview-pdfjs-main-thread-in-the-remote.** Per O15 the two old ADR files and specs/20261115-crm-offer-wizard are not edited; the supersession is recorded only here.  
**Deciders:** Matteo Codogno (product owner)  
**Project:** operai

---

## Context

The CRM wizard's preview is an HTML pagination whose page breaks only approximate the PDF's, with the uploaded letterhead drawn behind the pages by pdf.js on the browser's main thread (the two 20261115 ADRs). AC-1.3 now requires that one request rendered as preview and as PDF has the same page count, the same text per page and a pixel difference of at most 0.5 % (A5 of the spec amendments: whitespace normalised; a 1 px, 64/255 tolerant metric against pdfium at the preview's scale). AC-1.2 sets that the preview is images plus text, not HTML (owner). AC-3.1 sets that rendering accepts service credentials only, never a person's token. AC-10.3 and AC-10.4 set that the wizard shows the service's pages, with a preview in 2 s (previously 1 s).

## Decision

We will produce the preview from the same compile as the PDF, rasterised to 64-colour palette PNG pages at 1.5 px per point (893 × 1263) with each page's text alongside, and the CRM wizard will get it through `crm-ui` → `crm-api` `POST /deals/{id}/offer-draft/preview` (the unsaved draft body) → `letterhead-api`, never directly from the browser.

## Failure shape

**A preview, estimate or dry run is produced by a different engine from the thing it previews, so it is a forecast that nothing forces to agree.** Two implementations of one layout stay individually consistent and diverge: each is right by its own tests, and the person is shown a document that the system will not produce. A preview in the browser has the browser's fonts, its line breaking and its rounding. The second half of the failure is **the trusted party and the credential held by different sides**: when a service accepts only service credentials, a browser that must call it either gets a secret it must not hold or forces the service to accept a user token it was designed to refuse.

Where else this shape appears:

- **Preview and generate, in both directions.** The same draft previewed and generated must give the same pages (AC-10.3), and a document generated must be what the preview showed. Both pass through one `draftToBlocks()` in crm-api, so the two paths cannot disagree about the input.
- **Display and text.** Page images and the page text must come from the same compile. A text alternative made by another extractor (screen readers, search, copy) is a second source.
- **Other previews and dry runs:** a cost estimate that recomputes totals in the client, an email preview that renders a template in the browser, a "what will this import do" that uses a different parser, a report preview with a fake data layer.
- **Browser-side calls to restricted services** (inbound from the UI, outbound from a server to a third party): any time a client "just calls" a service whose authentication is not the client's. The route runs through the party that holds the credential and the data.
- **Stored state vs unsaved state.** A preview that renders only what is saved forces a save before it can be seen. Preview takes the draft body; generation reads the stored state.

## Options considered

### Option A — The same compile as the PDF, 64-colour palette PNG plus text, via crm-api (chosen)

**Pros:**
- Preview and PDF cannot diverge: the preview rasterises the `PagedDocument` that the PDF exports
- Byte-identical PDFs and PNGs on two renders of one request (spike)
- Tolerant pixel difference of 0.43 % at most on real pages, against pdfium at the same scale (AC-1.3's limit is 0.5 %); a 1 pt shift gives 2.3 to 3.0 %, so a real divergence is caught
- The wizard's page text is the image's text alternative (AC-10.5)
- crm-api already holds the entity profile values (AC-10.10) and the offer engine that turns a draft into text; the service credential stays on the server

**Cons:**
- A payload of about 65 KiB per page
- One more hop (browser, crm-api, letterhead-api) and one more failure to map (503 `layout_service_unavailable`)
- Text is not selectable on the image; the wizard offers no text selection (AC-10.5)

### Option B — SVG or HTML pages (rejected)

SVG pages were considered because they are smaller and selectable.

**Cons:**
- The browser would lay text out with its own fonts, so AC-1.3 is lost. This is the failure the decision exists to remove, and the owner's AC-1.2 requires images

### Option C — The browser calls letterhead-api directly (rejected)

**Cons:**
- With a person token it breaks AC-3.1 (the render routes refuse person tokens, with the same 401 body as any other bad credential)
- With a delegated service token in the browser it puts a secret in the browser
- The service would also need the draft's blocks and entity values from the client, bypassing the crm-api engine

### Option D — RGBA or 16-colour PNG (rejected)

**Cons:**
- RGBA PNG is 3.0 MiB per 10 pages, about 4.6 times the palette's 650 KiB. 16 colours is about 430 KiB but a tolerant difference of 0.74 %, which fails AC-1.3 (0.5 %)

### Option E — The preview on the last saved draft (rejected)

**Cons:**
- The wizard would wait for autosave before showing a change. The preview takes the draft body unsaved; generation keeps reading the stored state (ADR 20261115-offer-draft-server-held-generated-from-stored-state)

## Decision details

- **The compile.** One function on one layout produces the PDF, the page images and the page text. The preview rasterises with `typst-render` at 1.5 px/pt, so an A4 page is 893 × 1263 (210:297 ±1 px), then quantises to a 64-colour palette. `unprintableCharacters` and `missingPlaceholders` come with the answer.
- **Service routes.** `POST /v1/render/preview?pages=1,2,3` (JSON: `letterheadVersion`, `pageCount`, `missingPlaceholders`, `unprintableCharacters`, and `pages: [{n, image: base64 PNG, text}]`) and `POST /v1/render/pdf` (the PDF with `Letterhead-Version`, `Page-Count`, `Missing-Placeholders`, `Unprintable-Characters` headers). Service JWT with scope `letterhead:render`, audience `SERVICE_AUDIENCE`. All answers `Cache-Control: no-store`.
- **crm-api.** `POST /deals/{id}/offer-draft/preview?pages=…` has the same guard as `GET /deals/{id}/offer-draft`, takes the body of the draft PUT, does not store it, and answers the service's preview answer plus `missingFields`. Service failures (unreachable, 5xx, `busy`, timeout) map to 503 `layout_service_unavailable`; no configured letterhead maps to 409 `letterhead_not_configured` (AC-10.7, AC-10.8). The service credential is a client token with scope `letterhead:render`, cached as `crm-api/src/lib/serviceToken.ts`.
- **crm-ui.** The wizard shows the service's pages; previous pages stay while a new preview is running and when it fails (AC-10.4, AC-10.7). `GET /config` gains `letterheadService: boolean` so the UI knows which preview and Settings to show. A stale answer is discarded by a sequence id. The page image gets `alt` "Page N of M" and its text is available in a visually hidden region (AC-10.5, AC-8.6).
- **Payload and latency.** About 650 KiB per 10 pages (about 870 KiB as base64). `?pages=` lets the wizard ask for the visible pages first; pages are content-hashed so the UI reuses unchanged ones (plan R6). Compute is p95 111 ms for a 10-page preview locally, against a 2 s target.
- **What is superseded, and when.** At the switch (`LETTERHEAD_SERVICE_ENABLED` on, after the switch check of AC-10.12), the following stop being the CRM's behaviour: the paginated HTML preview with one continuous flow and a float rail (ADR 20261115-paginated-preview-one-flow-float-rail; its US-11 pagination, AC-3.2's "page breaks approximate" and AC-11.12's locally drawn page number are replaced by the service's pages, AC-10.3), and the uploaded letterhead drawn in the browser by pdf.js (ADR 20261115-letterhead-preview-pdfjs-main-thread-in-the-remote; the uploaded letterhead is retired at the switch, AC-10.11 and AC-10.12). AC-3.1 of the earlier spec's one second becomes two seconds (AC-10.4). Until the switch the CRM behaves as today, and both ADRs stay in force. After it, they describe code that is no longer used; they are not edited (O15), and this ADR is where a reader learns that. The old preview path and its two ADRs' code are removed in the follow-up that drops the profile columns (plan R8).
- **The earlier PDF-bound ADR.** ADR 20261115-uploaded-pdf-decoded-size-bound-before-parse stays in force for deal PDF annexes and for any uploaded PDF the CRM still reads. Its owner-accepted residual (a crafted uploaded letterhead can freeze a browser tab or reach generated offer PDFs, M-8, M-9, N-1) was accepted "until the letterhead configurator service retires uploaded letterheads"; the switch is that retirement, and the retirement script nulls `EntityProfile.letterheadKey/By/At` and deletes the objects (AC-10.12). That ADR is not edited either.

## Evidence

- spike.md: preview and PDF page count equal on every fixture; text equal with whitespace normalised; naive per-pixel difference 1.4 to 1.9 % (two rasterisers' anti-aliasing), tolerant metric 0.43 % at most; positive control 1 pt shift 2.3 to 3.0 %; two renders byte-identical (PDF and PNG).
- spike.md payload, 10 pages at 1.5 px/pt: RGBA PNG 3.0 MiB; 64-colour palette about 650 KiB at the same 0.435 % difference; 16 colours about 430 KiB at 0.74 % (fails); PDF 240 KiB.
- Timing, 10-page offer: preview (compile, 10 PNGs, texts, cache evicted) p50 109 ms, p95 111 ms (1 thread), 74 ms (4 threads); PDF p95 51 ms.
- Planned, not yet run: R-conf (AC-1.3 on every corpus fixture, with the positive control that must fail); B-int (AC-10.3: preview page count and texts equal the generated PDF's); PERF on the deployed stack (AC-1.9 1 s, AC-1.10 3 s, AC-10.4 2 s p95); V-ui (AC-10.5, 10.7). Latency on Railway is not measured yet (plan R1, R6).

## Consequences

**Positive:**
- The wizard shows what will be generated, with the same fonts, breaks and page numbers (AC-10.3)
- No page-break logic in the browser, and no pdf.js, letterhead fetch or CSP question for the preview
- A caller other than the CRM gets the same preview (AC-9.1)

**Negative / trade-offs:**
- 65 KiB per page over the wire, about 870 KiB for a 10-page offer on a slow link (R6)
- Every preview is a network round trip with a service that can be busy (429, mapped to 503), where before it was local
- Preview text is not selectable in the wizard (AC-10.5)
- Two preview paths live in crm-ui until the switch (R8), chosen by `letterheadService`

**Risks:**
- **The preview misses 2 s on Railway.** Mitigation: PERF before any CRM work; `pages=`; hashed pages.
- **A tolerant metric hides a real divergence.** Mitigation: the 1 pt shift positive control must fail in CI.
- **A reader follows a superseded ADR after the switch.** Mitigation: this ADR's header and the AGENTS.md line name the supersession; the old files are unedited by the owner's choice (O15).

## Escalation triggers

This decision is revisited when any of these happens:

- another caller needs a preview in a browser (a second tool, with a different credential route);
- the palette PNG fails the tolerance on a real letterhead (background artwork, gradients) and a richer encoding is needed;
- PERF on the deployed service misses 2 s with the default pool;
- the owner asks for selectable preview text or an SVG preview (which reopens AC-1.3);
- the switch is rolled back after being on, which makes the old path live again.

## Compliance notes

- GDPR / data-protection impact: medium. The draft body carries client names and financial terms from the browser to crm-api to letterhead-api. `no-store` on every answer; the service keeps nothing after a render (AC-3.7); nothing is cached in a shared place. The page images and text are in the caller's response only.
- Data residency: compliant. All hops are inside the EU deployment.
- Audit trail: not required for this decision.

## Amendment (2026-11-17) — implementation decisions of the preview and its retirement path (owner to confirm)

- **Palette.** The 64-colour quantiser is our own and deterministic (`letterhead-api/engine/src/output/quantize.rs`). exoquant was rejected for nondeterministic hashing, imagequant for its GPL licence.
- **Virtual file names.** Typst file ids are interned for the life of the process, so names are fixed: `/asset/<slot>.<ext>` and `/img/<n>.<ext>`, with the extension taken from the sniffed bytes, never the caller's (`letterhead-api/engine/src/world.rs`).
- **Page text** is in frame order, which matches pdfium extraction (AC-10.3).
- **Refusals.** The configurator preview reuses `invalid_letterhead` / `problems[]` and answers `letterheadVersion: null`. crm-api does not propagate the browser's abort to the service.
- **Switch off.** The CRM preview routes answer 404 as if unmounted. The old upload routes answer 410 `letterhead_upload_retired` with no-store once the switch is on (`crm-api/src/entity-profiles/entityProfiles.routes.ts`).
- **Retirement script** (`crm-api/scripts/retire-uploaded-letterheads.ts`): deletes the object first, then nulls the reference conditionally; `--apply` requires the switch on.
- **Risk noted.** Generation holds the deal lock for up to 35 s of render inside a 50 s transaction; accepted for now, to be revisited if lock waits show in production.
