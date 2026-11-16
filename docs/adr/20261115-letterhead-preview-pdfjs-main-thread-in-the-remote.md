# 20261115 — The letterhead behind the preview is drawn in the browser by pdf.js, on the main thread of the crm-ui remote, from one bounded fetch, under the shell's CSP as it stands

**Date:** 2026-11-15  
**Status:** Accepted — the architect's decision under the owner's delegation of 2026-11-15 (specs/20261115-crm-offer-wizard, § Amendment (2026-11-15, owner), DD-53 to DD-56); the L0 spike (T59) returned GO; pending the owner's review. Open item O9: the production welld_it letterhead is still to be rendered before release.  
**Deciders:** Architect, under delegation from Matteo Codogno (owner of specs/20261115-crm-offer-wizard); pending the owner's review  
**Project:** Operai

---

## Context

The owner asked that the offer wizard's preview sit on the entity's letterhead (specs/20261115-crm-offer-wizard US-11, AC-11.1 to AC-11.9). A letterhead is exactly one A4 page, stored by crm-api in its own EU bucket and served today only as a 60-second presigned link to callers holding `deal:financials`. The browser must draw it, and AC-11.7 forbids any third-party renderer and requires the drawing code to work under the suite's content security policy as it stands. That policy (`shell/vercel.json`) has no `worker-src` or `child-src`, so workers fall back to `script-src`, which has neither `blob:` nor `'unsafe-eval'` nor `'wasm-unsafe-eval'`; `object-src` is `'none'`; and crm-ui's chunks load cross-origin from the crm-ui origin.

## Decision

We will draw the letterhead with `pdfjs-dist` pinned to exactly `6.4.299` (no caret; moved from 5.7.284 on 2026-11-15 for GHSA-hq66-cqwq-w95j, see Evidence), imported only by `crm-ui/src/lib/letterhead/renderLetterhead.ts` and only lazily, on the main thread. The worker module is imported first, so pdf.js finds `globalThis.pdfjsWorker` and constructs no `Worker`. The renderer sets no `workerSrc`, `standardFontDataUrl`, `cMapUrl` or `wasmUrl`, disables range requests, streaming, auto-fetch, font faces, system fonts and WebAssembly (`useWasm: false`), and renders page 1 only, 1 600 px wide, after requiring it to be A4 portrait within 2 pt as pdf.js will draw it (crop box, rotation applied) and the canvas to stay within 1600 x 2400 px, onto a canvas context the code creates itself with alpha enabled, producing a transparent PNG `Blob`. The bytes come through the existing `GET /entity-profiles/{entity}/letterhead` link, fetched by the browser with `cache: "no-store"`, `credentials: "omit"`, `referrerPolicy: "no-referrer"` and `redirect: "error"`; the fetch is refused above 5 MiB and unless the bytes start with `%PDF-`. `useLetterhead` makes one attempt per opening under one 10-second budget and fails soft.

## Evidence (L0 spike, T59)

- Under the production CSP header, served by a local static server with crm-ui cross-origin: **0 CSP violations**, no `Worker` or `SharedWorker` constructed, no WebAssembly, and no request made by pdf.js itself.
- The welld_ch letterhead: 62 ms cold, 20 ms warm, a 1600×2260 PNG. Longest main-thread task ≈ 100 ms against the 500 ms threshold (R23). Lazy chunks ≈ 471 kB gzip (R26).
- Two known edges, accepted for the preview only (the PDF is not drawn by pdf.js, so this edge does not apply to it — but see "Correction 2026-11-15 (security round 8, N-1)" for the hostile-letterhead residual). A PostScript-calculator function makes pdf.js try WebAssembly; the CSP refuses it inside a try/catch, pdf.js falls back to JavaScript, and one CSP report is logged without a failure. JPX and JBIG2 images are skipped (O9).
- The plan's `isEvalSupported: false` option does not exist in 5.x; the library has no eval to disable. The AC-11.7 check asserts the absence of `eval` and `new Function` in the pinned build instead.
- Not exercised: Vercel's own CORS headers on crm-ui `/assets/*` (assumed, as for the existing chunks). The production CRM bucket's CORS rule for `GET` is unknown (R22) and is a release check in `infra/README.md`.

## Evidence (security M-3 and L-6: the move to 6.4.299, 2026-11-15)

`pdfjs-dist@5.7.284` lies inside GHSA-hq66-cqwq-w95j (CVE-2026-16633, high: script execution when a viewer renders a malicious PDF's annotations through the scripting sandbox; vulnerable `>=5.6.83 <6.2.108`). crm-ui never reaches that path (canvas only: no annotation layer, no scripting manager, no `pdfjs-dist/web`, CSP without `'unsafe-eval'`), but it is a published advisory on a parser of user files, so the pin moves to `6.4.299` (published 2026-10-03; `pnpm audit --prod` no longer lists `pdfjs-dist`). `crm-ui/src/lib/letterhead/letterheadGuard.test.ts` fails if any crm-ui source imports `pdfjs-dist/web` or `legacy`, names `AnnotationLayer`, `enableScripting`, a scripting manager, a text layer, `workerSrc`, `wasmUrl`, `cMapUrl` or `standardFontDataUrl`, constructs a `Worker`, or if anything but `renderLetterhead.ts` imports `pdfjs-dist`.

API changes in the major bump, all handled in `renderLetterhead.ts`: `PDFDocumentProxy.destroy()` is gone (destroying the loading task now ends the document); a new `useWasm` option (default true) is set to `false`; `page.render` still takes `canvasContext` + `canvas` and still uses the context we created (alpha kept); the worker module path `pdfjs-dist/build/pdf.worker.min.mjs` and the `globalThis.pdfjsWorker` mechanism are unchanged.

L0 re-run under the exact production CSP from `shell/vercel.json` (same local-server method as T59; the built renderer chunks, crm-ui on a second origin; the page's own `eval` and `new Function` blocked, proving the header applies):

- **0 CSP violations** across welld_ch, `shell/e2e/fixtures/letterhead-a4.pdf`, the 4.8 MB stress file and the crafted pages; **no `Worker`/`SharedWorker` constructed, no WebAssembly call, no `fetch` or XHR made by pdf.js**. The 5.x PostScript-function edge (one CSP report) was not seen in this run; no file with such a function was available to force it, so it stays a recorded edge.
- The built chunks contain no `eval(`, no `new Function(`, no `Function("…")` constructor call, no `importScripts` and no `isEvalSupported`. The main chunk holds one `new Worker` (pdf.js's fallback when no `pdfjsWorker` is present, never reached: the spy saw none).
- welld_ch real letterhead: 91 ms cold, 19 ms warm, 1600 x 2260 PNG; the fixture 17 ms, 1600 x 2263, 93 % of its pixels fully transparent (the transparent background is kept; welld_ch paints its own white page). Stress file 231 ms. Longest main-thread task of the whole run 175 ms (the 589 ms task is the 256 MiB inflate case below), against the 500 ms threshold.
- Lazy chunks: `pdf` 129.4 kB + worker module 369.3 kB = 498.7 kB gzip (was 471 kB).
- welld_it still not available locally (O9 unchanged).

L-6, measured: a PDF with an A4 MediaBox and `CropBox [0 0 16 841.89]` (and one with 50 pt) passes the server's `checkLetterhead` but pdf.js reports a 16 x 841.89 viewport; the renderer now refuses it as `letterhead_not_a4` in 0 to 1 ms, before any canvas exists (the tolerance is the server's 2 pt, applied to pdf.js's scale-1 viewport, rotation included). The canvas is also capped at 1600 x 2400 px (a within-tolerance A4 page is at most 1600 x 2276, so the cap is a second guard).

## Failure shape

**Bytes a person supplied are parsed by a large third-party library running in the same page as the person's session and data, and that library has its own channels (workers, WebAssembly, eval, font and map loads, range requests) that the page never agreed to.** The uploaded file crosses from data into the code paths of the library, and the trust boundary we rely on (this origin, this CSP, this session) is only as strong as the library's restraint. What is protected is not the letterhead but the page around it.

The same shape appears in its mirror-image positions:

- **Inbound and outbound of one parser.** Bytes go in; the parser's requests go out: a font or map URL named by the file, a range request, a credential we handed it. Any request a library makes on its own, carrying something we gave it, is a request we did not make. A bearer link belongs in our code's closure, never in the library's options.
- **Preview and generation are two readers of one file.** The preview's renderer and the PDF's server-side reader (`pdf-lib`) both read the letterhead. A file the preview accepts and the PDF refuses, or the reverse, is this shape with two readers and neither authoritative. The preview's failure is soft by design; the PDF's is not.
- **Main thread and worker.** A worker keeps the page responsive, but it is a second context with its own origin, CSP and script loading. Choosing it is the same decision in a new place, and a worker that a remote cannot start from the shell's document is a failure of the same kind as an unannounced CSP change.

Recognise it anywhere by: an `import()` of a library that reads a user-supplied file in the browser; library options naming `workerSrc`, `wasmUrl`, `standardFontDataUrl`, `cMapUrl` or any eval-related flag; a signed URL passed into a library instead of fetched by our code; a CSP relaxation (`blob:`, `worker-src`, `'wasm-unsafe-eval'`, `'unsafe-eval'`) proposed to make a dependency run; a second renderer of a user file that is not the one that prints it.

## Options considered

### Option A — pdf.js on the main thread, pre-imported worker module, own canvas, bytes fetched by our code (chosen)

Pinned, lazy, one page, one bounded fetch, under the CSP as it stands.

**Pros:**
- Inside the approved text: drawn in the browser (AC-11.7), no new origin, no CSP change
- No server dependency and no new bytes read by crm-api; ADR 20261102 unchanged
- The evidence of T59: 0 CSP violations, ≈ 100 ms longest task, once per opening

**Cons:**
- A parser of untrusted bytes runs in the page on the main thread
- Approximate: a letterhead with unembedded fonts or codec-only images may draw incompletely (O9)
- ≈ 471 kB gzip of lazy chunks on the first opening that needs a letterhead
- Every version bump re-opens the evidence

### Option B — crm-api rasterises the letterhead, at confirm or lazily (rejected)

**Pros:**
- No renderer in the browser and no parser in the page; the preview and the PDF read through one service

**Cons:**
- A native canvas dependency (pdf.js with `@napi-rs/canvas`, or pdfium) in a Bun service on Railway
- A second stored object and a backfill for every existing letterhead
- A new byte-reading reason in crm-api, against the trigger of ADR 20261102
- Against the approved text: AC-11.7 says "drawn in the browser"

### Option C — a pdf.js Worker served from crm-ui's origin (rejected)

**Cons:**
- A dedicated worker must be same-origin with the document that starts it; the shell's document cannot start a worker that a remote serves

### Option D — a `blob:` worker, or `'wasm-unsafe-eval'` (rejected)

**Cons:**
- A CSP change (`script-src` has neither `blob:` nor wasm), against AC-11.7's "as it stands"

### Option E — `<object>`, `<embed>` or `<iframe>` showing the PDF (rejected)

**Cons:**
- `object-src 'none'`; `frame-src` falls back to `'self'`
- The browser viewer's own chrome; it cannot sit behind real text (AC-11.1)

### Option F — a PDF preview button that opens the file (rejected; declined by the owner)

**Cons:**
- It shows the file, not the preview; the owner declined it

### Option G — pdf-lib in the browser (rejected)

**Cons:**
- It reads and embeds PDFs; it does not rasterise a page to draw behind text

## Consequences

**Positive:**
- The letterhead sits behind real, selectable text, and the PDF is unchanged (AC-11.8)
- No new origin, no CSP change, no new bytes read by any service; the link is never stored, logged or passed to the library
- One attempt and one 10-second budget mean a failed or slow letterhead never delays the text (AC-11.4)

**Negative / trade-offs:**
- A parser of untrusted bytes runs on the main thread, once per opening
- **The 10-second budget cannot interrupt a synchronous parse.** A deflate content stream is inflated on the main thread; measured here at about 2.3 ms per MiB inflated (64 MiB inflated: 240 ms; 256 MiB: 598 ms, a 589 ms long task, about 520 MB of JS heap) at a ratio of roughly 1 000:1. The 5 MiB byte cap therefore bounds a worst case at roughly 5 GiB inflated, about 12 s of frozen tab or an out-of-memory crash (extrapolated: not run, it would take the browser down). It needs an uploader holding `deal:manage`; no data leaks and no code runs, and the effect ends when the letterhead is replaced. A real bound needs the server to refuse a letterhead whose streams inflate beyond a limit (`checkLetterhead`) or a worker, which needs a CSP change; neither is decided here
- The preview may draw a letterhead incompletely (O9); the PDF draws it as today
- The first opening that needs a letterhead loads ≈ 471 kB gzip of lazy chunks

**Risks:**
- **A later pdf.js version reintroduces eval, worker or wasm loads by default.** Mitigation: the exact pin; a bump re-runs the L0 spike (CSP report count, a `Worker` constructor spy, both production letterheads) before it merges.
- **A letterhead stalls the main thread.** Mitigation: the 5 MiB cap, one page, 1 600 px width; the 500 ms longest-task threshold (R23).
- **The production CRM bucket does not allow `GET` from the shell's origin.** Mitigation: the release check in `infra/README.md` § offer-wizard rollout (R22). The render then fails soft to the "could not be shown" band.

## Escalation triggers

This decision is revisited when any of these happens:

- the shell's CSP changes in any directive that governs workers or scripts (`blob:`, `worker-src`, `child-src`, `'wasm-unsafe-eval'`, `'unsafe-eval'`);
- a second consumer needs a PDF drawn in the browser, in any remote or in `@operai/ui` (a second copy of the library, or a move of the code into the shared singleton);
- pdf.js moves to a new major version (done once, 5 to 6 on 2026-11-15, re-proved as above);
- a letterhead that is not exactly one A4 page is admitted;
- the longest task exceeds 500 ms on a production letterhead;
- the owner asks for a PDF preview (declined on 2026-11-15).

## Compliance notes

- GDPR / data-protection impact: none (low). The letterhead is the company's own document, not personal data. The bytes reach only the browser, from the suite's own bucket; no third party receives them.
- Data residency: compliant with the EU region. The bytes come from the CRM's own EU bucket through its own link.
- Audit trail: not required. The bytes and the link are never stored or logged (AC-11.7).

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*

---

## Amendment 2026-11-15 (OA-3, M-4) — one render on every page, and a server-side decoded-size bound before the main thread parses

**Date:** 2026-11-15  
**Status:** Amended — the architect's decision under the owner's amendment OA-3 "Real A4 pages" and security round 5 finding M-4, both of 2026-11-15 (specs/20261115-crm-offer-wizard, § Amendment OA-3, DD-65, DD-71, DD-74, DD-77; `approved_by: delegated`), pending the owner's review. The rest of this record stands: the mechanism (pdf.js, pinned, main thread, no worker, no CSP change), the rejected options and the evidence of T59 and of the 6.4.299 move. Open item O9 is unchanged.

### What changes

1. **The letterhead is drawn on every preview page from one render.** The paginated preview (ADR 20261115-paginated-preview-one-flow-float-rail) places one decoded image on each page. Every page box holds an `<img>` with the same `blob:` URL: one fetch, one canvas, one decoded image, for N pages. `useLetterhead` keeps the decoded `HTMLImageElement` referenced for the opening, so a page that appears paints the image in the same frame. The renderer is unchanged: `renderLetterhead` still draws page 1 once, at 1 600 px wide, to a transparent PNG.
2. **A main-thread renderer of an uploaded file is acceptable only behind a server-side bound on decoded size.** The 5 MiB cap on the file is not a bound on the work: it bounds the compressed bytes, and pdf.js inflates them on the page's own thread. The bound is `boundPdf`, run by crm-api before the file is stored and before any bytes are sent for drawing (32 MiB decoded in all streams, 8 MiB of it non-image, plus object, stream and image-pixel caps; ADR 20261115-uploaded-pdf-decoded-size-bound-before-parse). The worst case this renderer can be handed is therefore the one the server admits, not the one the file's size suggests. The "Negative / trade-offs" paragraph above, which said that the 10-second budget cannot interrupt a synchronous parse and that a real bound needs the server to refuse a letterhead or a worker, is resolved for this renderer by the server bound. The worker remains rejected (Option C and D: a CSP change).
3. **pdf.js `maxImageSize: 40_000_000` as defence in depth (DD-77).** `renderLetterhead` passes the server's per-image pixel cap, so pdf.js skips an image larger than it. The preview then draws the page without that image; the PDF, which is server-rendered and uses its own reader, is unaffected. `letterheadGuard.test.ts` pins the option. pdf.js has no cap on inflated stream bytes, so this option is not the control; the server bound is.

### Rejected in this amendment

- **A browser-only bound** (a check in the uploader's page before pdf.js runs). It protects that page alone. crm-api inflates the same bytes on confirm and at every offer generation, for every user of the entity, and a browser check cannot reach that heap. The browser cannot bound M-4 itself: pdf.js exposes a per-image pixel cap and no cap on inflated stream bytes.
- **A worker** for the parse. Unchanged from the Options above: it needs `blob:` or a same-origin worker, which the shell's CSP does not allow (AC-11.7).
- **Relying on the 5 MiB file cap.** At the ratio measured in this record (about 1 000:1 for a deflate content stream), a 5 MiB file inflates to about 5 GiB; 256 MiB inflated took 589 ms on the main thread and about 520 MB of heap.

### Evidence

- Main-thread inflate, measured earlier in this record: about 2.3 ms per MiB inflated (64 MiB: 240 ms; 256 MiB: 598 ms). At the server's caps, the 8 MiB non-image part is about 19 ms and the 32 MiB total about 75 ms, at the same rate.
- Server side, T70: a 1 GiB flate bomb inside an object stream is refused in 6 to 14 ms, with 0.2 MiB of resident growth; the two production letterheads and the committed fixture sit at least 4 times below every cap.

### Where the mirror image lives

The same shape, bytes a person supplied inflated by a reader that trusts nothing about their size, has a second reader in the suite: crm-api itself, at confirm and at every generation. A browser bound cannot protect that heap, and the server bound is decided in ADR 20261115-uploaded-pdf-decoded-size-bound-before-parse. The annexes appended to an offer (finding F-3) are the same reader class and are not yet bounded.

### Escalation triggers (added)

- the server bound refuses a production letterhead in the release audit (`crm-api/scripts/check-letterheads.ts`, DD-78): the caps are revisited with the owner before the deploy, not the renderer;
- a second browser renderer of a user file is added, or a new option is proposed that lets pdf.js inflate beyond the server's caps.

## Amendment 2026-11-15 (QE round 5, D23) — the server bound prices the work of drawing, and the main-thread renderer stays on that condition

Item 2 above made a main-thread renderer of an uploaded file acceptable "only behind a server-side bound", the bound being the decoded size of its streams (and, after round 6, the count of forms and operators). QE round 5 showed that the work of drawing is not bounded by either: a 1.2 KB one-page A4 file of `/S1 sh` repeated 10 000 times drew in 50 s (70 s with `ca 0.5` and Multiply) as one long task, and the 10-second budget of `useLetterhead` cannot fire while the thread is blocked. The condition is now stated in terms of what the renderer costs, and the server bound meets it: `checkLetterhead` prices one drawing of the page (every operator, paint, shading, image, soft mask and form, and the graphics state each is drawn under) in units measured with pdf.js 6.4.299 and refuses a letterhead above about one second and about 400 MB above an idle tab, `too_complex` (ADR 20261115-uploaded-pdf-decoded-size-bound-before-parse, Amendment 2026-11-15 D23, with the weights, the measurements at the caps and the residual).

**What this changes for the renderer.** Nothing in `renderLetterhead` changed, and the worker stays rejected. Two consequences: (1) the cost of the worst letterhead the server admits is a figure with a measurement behind it (0.4 to 1.3 s here, memory dominated by soft masks), not an inference from the byte caps; (2) pdf.js draws the normal appearance streams of annotations on the canvas by default, which the server bound now reads, but the renderer need not draw them: the preview shows annotations the offer PDF does not carry (the server-side embed copies the page's content only). **Recommended, not done (crm-ui is outside this fix):** pass `annotationMode: pdfjs.AnnotationMode.DISABLE` to `page.render`, so that the preview and the PDF agree and an annotation is never a render-cost path again; `letterheadGuard.test.ts` would pin it.

**The budget is not a time limit.** The 10-second budget in `useLetterhead` still cannot interrupt a synchronous render, as the Negative paragraph above says. The control is the server's price; the budget remains for slow networks and an aborted fetch. The price is one machine's measurement (Chromium headless, software raster); a slower device draws the same admitted letterhead slower, by a factor the record does not know.

**Escalation trigger (added).** A further render-cost bypass of the server's price (an operator, state or stream pdf.js draws that the walk does not read, found after this amendment) moves the work to **server-side rasterisation of the letterhead at confirm**, the preview then showing the image the server drew instead of running pdf.js on the file. That reverses this ADR (the renderer in the browser) and is the owner's decision, not the implementer's: bounding another program's drawing has now taken three rounds (bytes, forms, cost), and a fourth is the evidence to stop.


## Owner-accepted residual (2026-11-15) — security round 7: the main-thread renderer stays; M-8 and M-9 accepted until the letterhead configurator

**What is accepted.** Security round 7 (specs/20261115-crm-offer-wizard, security-review.md) found two ways a crafted letterhead still freezes the main thread of the browser that previews it, each under 1.5 KB and each passing `checkLetterhead`:
- **M-8**: the walk measures pdf-lib's reading of the file, the preview draws pdf.js's, and two spellings make them differ (the data of an inline image ends at a different `EI`; an object number defined twice, where pdf-lib takes the last definition and pdf.js follows the cross-reference table). Content the walk skips as image data is drawn as operators.
- **M-9**: the price counts operators and a few paint classes, not geometry or functions: dashed strokes with tiny intervals, one long self-intersecting path, a complex clip multiplying later paints, Type 4 functions behind shadings and tint transforms (1.3 KB of dashed strokes: no answer in 60 s).

**Owner-accepted residual (2026-11-15)** *(scope corrected 2026-11-15 — the residual also reaches every generated offer PDF; see "Correction 2026-11-15 (security round 8, N-1)" below)*. The owner, after a plain-language explanation, accepted both as a browser-side residual until the letterhead configurator service retires uploaded PDF letterheads (OA-4: logo, margins, rules, footer text and page numbering set in Operai, with no PDF to parse). Why it is bounded: only a holder of `deal:manage` for the entity can upload a letterhead (an insider, already trusted with the offers themselves); the effect is a frozen tab for whoever opens the preview for that entity, with no data read, written or leaked; the offer PDF and every record are unaffected (the server embeds the page's content with pdf-lib and never draws it), and the way out is to close the tab and replace the letterhead. The escalation trigger of this record (a further render-cost bypass moves the work to the server) was met by M-8 and M-9; the owner chose to accept the residual rather than escalate.

**Rejected for now, with the reason.** (1) *Draw in a terminable worker* (`OffscreenCanvas`, killed after a time limit, the preview then showing no letterhead): the sound containment on the browser side, but it needs the CSP worker allowance in the shell and reverses the main-thread decision of ADR 20261115-letterhead-preview-pdfjs-main-thread-in-the-remote, for a risk the configurator removes. (2) *Server-side rasterisation at confirm*: the preview shows an image the server drew, which removes pdf.js from the browser but adds a renderer to crm-api (the same class of problem on the server, with memory and CPU of its own) and is a larger change than the configurator it would precede. (3) *The preview without the letterhead*: removes the risk by removing what the preview is for (seeing the offer as it will print). Deferred, not rejected: a pdf.js-based check in a worker thread of crm-api, and the cheap interim refusals named in M-8 (`BI`, object-stream and update-chain variants).

**What was fixed now (M-10 and M-11: crm-api availability).** Both are levers on crm-api itself, not on a browser, so they are closed. In `formGraph.ts`, a page's `/Contents` array lists at most 16 streams (`maxContentStreams`; the committed letterhead has one) and the decoded size of each is charged once per time the array lists it, against 8 MiB (`maxContentBytes`), each distinct stream decoded once; the refusal is `too_complex` without `fromException`, so it is a verdict that is remembered, not an exception that repeats at every generate (a 5.7 KB file of 200 entries of a 4 MiB stream held 1.9 GB before, and is refused in about a millisecond now). The most expensive form in scope, which a `Do` that names nothing is charged as, is computed once for each (resources, graphics state, tiling cell) over the distinct forms of the dictionary, not once per call and per name (100 000 names for one form and 1 900 absent `Do`: 36 s of a blocked event loop before, 18 ms now; a scaling test pins the walk as linear in names and calls). A refusal of a duplicate object definition in `boundPdf` was tried and not kept: it also refuses an ordinary PDF embedded in a stream (the header scan reads the embedded file's objects, and `pdfBounds.r6.test.ts` pins that such a file is accepted), so M-8b is left to the residual above.

---

*Amendment generated during a WellForge spec-driven session. Review and amend before committing.*

## Correction 2026-11-15 (security round 8, N-1) — the residual reaches the offer PDF too

The "Owner-accepted residual (2026-11-15)" section above understates its scope where it says the effect is limited to the
preview tab and that the offer PDF is unaffected. That is wrong: `contractPdf.ts` embeds the uploaded letterhead with pdf-lib
`embedPdf` (its content and resources copied verbatim into one Form XObject) and draws it on every offer page, so a crafted
letterhead (M-8/M-9) is carried into **every offer PDF generated while it is stored** and can freeze the **client's** PDF viewer on
every page; replacing the letterhead does not repair PDFs already generated or sent — they must be regenerated. Unchanged: only a
`deal:manage` holder can upload a letterhead (insider-only), and no data is read or changed. **The owner re-confirmed the
acceptance on this corrected scope (2026-11-15)**, until the letterhead configurator service — which builds header and footer
itself instead of copying an uploaded PDF — retires uploaded letterheads. Rejected again: the interim refusals of inline images
and duplicate objects (partial), bringing the configurator into this feature.
