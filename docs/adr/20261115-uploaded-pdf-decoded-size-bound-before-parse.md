# 20261115 — An uploaded PDF is measured by what its parser would decode, before any parser runs, and the stored file is the measured bytes

**Date:** 2026-11-15  
**Status:** Accepted — the architect's decision under the owner's amendment OA-3 and security round 5 finding M-4, both of 2026-11-15 (specs/20261115-crm-offer-wizard, § Amendment OA-3 › B, DD-74 to DD-78; `approved_by: delegated`); built and tested in T70 to T72; the release audit (DD-78) is a gate before the deploy. Pending the owner's review. Open item O9 (the production welld_it letterhead is still to be rendered) is unchanged. Finding F-3 (deal PDF annexes) is the same class and was **not** closed by this decision; it is closed by the Amendment of 2026-11-15 below, which also replaces the decoder-prediction rules with an allowlist.  
**Deciders:** Architect, under delegation from Matteo Codogno (owner of specs/20261115-crm-offer-wizard); pending the owner's review  
**Project:** Operai

---

## Context

crm-api reads a letterhead that a person uploads (at most 5 MiB) with pdf-lib, and pdf-lib inflates object streams and cross-reference streams in full while it parses: a small compressed file can allocate gigabytes in the single crm-api process (finding F-2, security M-4, present since specs/20261102). The bytes are read at confirm and again at every offer generation that embeds the letterhead. A second reader needs the same bound: the browser's preview renderer (pdf.js) has no cap on inflated stream bytes, so the server bound is the only control (ADR 20261115-letterhead-preview-pdfjs-main-thread-in-the-remote). Finally, the confirmed upload key has a 60 s POST policy, so the bytes checked at confirm could be replaced within that minute and the profile would point at unchecked bytes (finding F-4).

## Decision

We will run `boundPdf(bytes)` before any PDF parser, and refuse a file whose decoded size, object count, stream count or image pixels exceed fixed caps: 32 MiB decoded in all streams, 8 MiB of it non-image, 10 000 objects, 1 000 streams, 40 million pixels per image and 64 million in total. The bound never trusts a declared `/Length`, decodes each stream from its data start with a streaming inflate counted at every stage, and refuses any filter it cannot bound (`JBIG2Decode`, `Crypt`, an unknown or unresolved filter). On confirm the same checked bytes are copied to a fresh key that no upload policy was ever issued for, the profile points at that copy, and the upload key is deleted. A stored letterhead is used only once checked in this process, by a verdict memo keyed by the immutable object key, and a refusal is a 409 `letterhead_unusable` before any render. A read-only audit (`crm-api/scripts/check-letterheads.ts`) runs against production before the crm-api deploy that brings the bound.

## Failure shape

**A check measures what a file declares about its own work, and the work is done by a reader who decodes what the file actually contains.** A declared `/Length`, a dimension in a header, a filter named in a dictionary, a count an object claims for itself: each is a number the file wrote, and the reader does not have to agree with it. The check passes on the declaration and the consumer pays the cost of the contents. The second half of the same failure is **check and use of different objects**: the bytes measured are not the bytes read, because the name they sit under can still be written by the person who supplied them.

The same shape appears in its mirror-image positions:

- **Declared and decoded.** Anywhere a size, length or count is read from the file and trusted for the reader's allocation: a `/Length` against the stream's data, an image's declared width and height against its codec header, a zip's central directory against its local headers, a `Content-Length` against the body. The mirror is an output whose size is a function of declared input sizes: a generated document that embeds an annex and reserves room from the annex's claim.
- **Check and use.** A verdict recorded for a key and a read of the same key later. Confirm and generation, a link minted and the fetch it authorises, a memo entry and a key rewritten after it was memoised. Recognise it wherever a check happens in one request and the value is used in another.
- **Write and read.** The file we store for later reading must be the file we measured, under a key that nobody else can write. The write-side instance is a copy we made of a checked file, and a generated file read back by a later step.
- **Server and browser.** A renderer in the browser has the same parser and no cap on inflated bytes; a per-image limit in it does not bound the work of the stream that holds the image. A client-side check protects the page of the person who ran it. It does not protect the server heap that the same file would reach on the next read.
- **Inbound and generation.** A file that a person supplies (a letterhead, a deal PDF annexed to an offer) is read once more at generation, when it is embedded in an output we produce. The bound belongs where the bytes first enter a parser and again wherever they are read again.

Recognise the shape by: a call to `PDFDocument.load`, pdf.js `getDocument`, an image decoder, an archive extractor or a zlib inflate of bytes a person supplied; a check that reads a length, a dictionary value or the first bytes of a file; an argument that a file is "under 5 MB" as its size bound; a key a person can still POST to after we verified it.

## Options considered

### Option A — `boundPdf` before any parser, decoded-size caps, copy on confirm, a memo of verdicts per immutable key (chosen)

**Pros:**
- The bound is the cost the parser would pay (decoded bytes, objects, image pixels), not the size of the file; a 1 GiB flate bomb is refused in 6 to 14 ms with 0.2 MiB of resident memory growth (T70)
- Real letterheads are at least 4 times below every cap (`check-letterheads`, T70)
- The stored file is exactly the checked bytes, so the check and the use are one object (closes F-4)
- The same bound is reusable for the other byte readers of the suite (F-3 is the first)

**Cons:**
- The caps are constants that a legitimate letterhead can exceed; a refusal then needs a new file, not a code change
- An unreadable stored letterhead (missing, over 5 MiB, storage down) is not a verdict, so it fails closed as a 500 at confirm and is not memoised
- The memo is process-local: each process reads and checks a key once

### Option B — Check after `PDFDocument.load` (rejected)

**Cons:**
- The parse has already allocated the decoded streams. The check would report the bomb after it had exploded, in the same process. Fails the premise of M-4

### Option C — Trust the declared `/Length` (rejected)

**Cons:**
- `/Length` is a number the file writes. A lying indirect length or an `endstream` forged inside the data hides bytes that the browser's pdf.js would still inflate. Every filter is self-delimiting, so the bound decodes from the data start and never reads the length

### Option D — A compression-ratio limit (rejected)

**Cons:**
- A ratio bounds the shape of the file, not the work. It refuses legitimate, highly compressible scans, and at a permissive ratio it still admits a 5 MiB file that inflates to hundreds of MiB, because the cap in bytes is the one that protects the heap

### Option E — A browser-only bound (rejected)

**Cons:**
- The check runs in the uploader's browser and protects that page only. It cannot stop crm-api's own inflate, which runs at confirm and at every generation for every user of the entity. pdf.js has no cap on inflated stream bytes, so a browser bound cannot be made to stand in for the server one

### Option F — Keep the upload key and point the profile at it (rejected)

**Cons:**
- The upload key's POST policy is valid for 60 s after the check; the uploader can replace the object in that minute, and the profile would then name bytes nobody checked (F-4). The copy on confirm removes this

## Decision details

**The bound (DD-74, `crm-api/src/entity-profiles/pdfBounds.ts`).** `PDF_BOUNDS` holds the caps above. The verdict is `ok` with the figures measured, or one of `too_complex` (objects, streams, nesting, a walk budget of 4 times the size plus 1 MiB, and a work meter of 192 MiB), `decoded_too_large`, `image_too_large` or `unbounded_stream`. The rules, as built in T70:

- Every `N G obj` header is found and counted, as pdf.js reconstructs them, and each object is parsed with pdf-lib's `PDFObjectParser`, which reads a dictionary and slices a stream without decoding it. An object stream adds its `/N` to the object count.
- FlateDecode runs through `node:zlib` streaming inflate with `finishFlush: Z_SYNC_FLUSH`, its output counted in chunks and the stream destroyed the moment a cap is crossed. LZW, RunLength, ASCIIHex and ASCII85 run through pdf-lib's decoders, 64 KiB at a time. Each stage's output feeds the next and is counted at every stage, so `[/FlateDecode /FlateDecode]` cannot double past a cap. A decode error counts what was produced and stops: only a cap refuses. A truncated or checksum-broken stream is not a bomb.
- Image codecs (DCTDecode, JPXDecode, CCITTFaxDecode) are not decoded. An image contributes `W × H × components × ⌈bpc / 8⌉` (components 4 when unknown) from its dictionary; for DCT, the larger of the dictionary and the JPEG start-of-frame header. A codec stream with no width or height is `unbounded_stream`.
- **JBIG2Decode is refused as `unbounded_stream`**: its page bitmap's size lives in its data, not in its dictionary, so no declared figure can be trusted.
- A `/Subtype /Image` with a non-codec filter is decoded up to its declared size plus slack, the excess charged to the non-image budget. This closes a 1 × 1 image that inflates to a large bitmap.
- Duplicate dictionary keys, a disagreement between `/F` and `/Filter`, and an indirect `/Filter` that cannot be resolved through the header table are refused.

The caps are constants justified by measurement: each is at least 4 times the larger production letterhead and the committed fixture. The 32 MiB total admits a full-page 300 dpi RGB image (about 26 MB). The 8 MiB non-image cap bounds what pdf.js parses as operators and fonts on the main thread, at about 2.3 ms per MiB inflated (about 75 ms for 32 MiB, measured in ADR 20261115-letterhead-preview-pdfjs-main-thread-in-the-remote).

**Where the bound runs (DD-74, DD-76).** `checkLetterhead` calls `boundPdf` before `PDFDocument.load`. It is the first check, so a refused file never reaches pdf-lib. The verdict reasons are `not_pdf`, `page_count`, `not_a4`, `unembeddable`, and the four bound reasons.

**Copy on confirm (DD-75).** After `checkLetterhead` passes on the bytes read at confirm, crm-api writes those same bytes under a fresh key of the same shape (`letterheads/<entity>/<uuid>.pdf`) that no upload policy was issued for, stores that key on the profile, then deletes the upload key and the previous letterhead. A failed copy leaves the upload key for a retry. Re-confirming an already-consumed upload key is 409 `upload_missing` (T71), not an idempotent 200. `Storage.putObject`'s comment reads "bytes the server authored or checked".

**Use only once checked in this process (DD-76, `crm-api/src/entity-profiles/letterheadUse.ts`).** The verdict memo is keyed by object key, holds at most 64 entries (first in, first out), and remembers refusals too. This is sound because a key's bytes do not change: new letterheads get new keys, and an old key's upload policy expired long ago. Confirm seeds the memo with `ok` for the key it stores. The link route `GET /entity-profiles/{entity}/letterhead` checks a key it has not seen, and answers 409 `letterhead_unusable` `{ entity, reason }` with `Cache-Control: no-store`, minting no link. Generation (`prepareOffer`, and the draft route) reads the bytes through `usableLetterhead` before rendering: a refusal is the same 409 before any render, with no offer row, no object written and the draft kept. An unreadable letterhead is not a verdict: it is not memoised, and it fails closed as a 500. The log line carries the entity and the reason only.

**The release audit (DD-78, `crm-api/scripts/check-letterheads.ts`).** Read-only, by construction: its storage port exposes `getObject` only. For each entity profile with a letterhead it reads the bytes with the service's own bounded read, runs `checkLetterhead`, and prints one line per profile: the entity, `ok`, `REFUSED <reason>`, `UNREADABLE` or `none`, and the figures the bound measured. It never prints a key, a link or bytes. Exit 0: every stored letterhead is usable. Exit 1: at least one is refused or unreadable. **A person runs it against production before the crm-api deploy.** A refusal blocks the deploy until the file is uploaded again, or the caps are revisited with the owner, because after the deploy that entity's offers would be refused. `infra/README.md` § offer-wizard rollout carries the item. T71 assumed the audit runs from the release checkout with the CRM database's public connection string; the variable name in `infra/README.md` is a placeholder for the owner to confirm.

**The client's defence in depth (DD-77).** `renderLetterhead` passes pdf.js `maxImageSize: 40_000_000`, the server's per-image pixel cap. pdf.js skips a larger image, so the preview draws the page without it and the PDF is unaffected. `letterheadGuard.test.ts` pins the option. It is not a control for the inflate: the server bound is.

**Contract changes.** `POST /entity-profiles/{entity}/letterhead/confirm` answers 422 `letterhead_invalid` with `extras.reason` now including `too_complex`, `decoded_too_large`, `image_too_large` and `unbounded_stream`, and on 200 the profile points at a fresh key. `GET /entity-profiles/{entity}/letterhead` answers 409 `letterhead_unusable`. `POST /deals/{id}/offer-draft/generate` and `POST /deals/{id}/offers` answer 409 `letterhead_unusable` before any render. The wizard's Settings states the four new upload reasons in one message, and the preview shows its `failed` band, with no retry.

## Evidence

- **T70 (the bound, test-after with 7 mutation checks; two weak tests strengthened):** a 1 GiB flate bomb refused in 6 to 14 ms with resident memory up 0.2 MiB; real letterheads at least 4 times below every cap; crm-api 1589 tests pass on its own database, dropped after the run.
- **T71 (copy on confirm, memo, release audit; 6 mutation checks):** crm-api 1615 tests pass. An unreadable letterhead is not memoised and fails closed; the upload key stays for a retry after a failed copy.
- **T72 (client):** crm-ui 1296 tests pass, lint and build green; not rendered. A flaky pre-existing test (`OfferTemplates.test.tsx`, the 5 MiB refusal, apiFetch call count under load) passed three times alone and on rerun, noted for QE.
- **No run recorded:** the release audit (DD-78) against production letterheads is not in the decisions log. It is the gate before the deploy, and welld_it is still not rendered (O9).

## Consequences

**Positive:**
- A file that would exhaust the crm-api heap is refused in milliseconds, before any parser allocates
- The bytes checked are the bytes used: the upload key cannot change what the profile points at (F-4 closed)
- The bound is a named, measured component that the next byte reader in the suite can reuse

**Negative / trade-offs:**
- A legitimate letterhead above a cap is refused, and the person must upload another file; the caps are the owner's to revisit
- A refused letterhead blocks every offer for its entity until it is replaced (409 `letterhead_unusable`)
- Each process checks each key once, on first use after a restart

**Risks:**
- **F-3: the deal PDFs appended as annexes are still loaded unbounded at generation.** Same class, outside this decision and outside OA-3: up to 5 files and 20 MiB, `PDFDocument.load` at `generation.ts` with no bound. It is pre-existing (specs/20261102) and is recorded as a follow-up security bug reusing `boundPdf`, not a change in this release. Until it lands, the offer generation path still has an unbounded parser on user bytes.
- **A production letterhead is refused after the deploy.** Mitigation: the release audit before the deploy (DD-78), and the rule that a refusal blocks the deploy until the file is replaced.
- **A future reader of user PDFs skips the bound.** Mitigation: the bound is the first call in `checkLetterhead` and is the named control; a new reader of a user's bytes revisits this ADR (see the triggers).
- **The pdf-lib parse still runs on up to 32 MiB decoded.** Accepted: the non-image cap bounds the parse's time (about 19 ms at 8 MiB, about 75 ms for the 32 MiB total, at the main-thread rate measured in ADR 20261115-letterhead-preview-pdfjs-main-thread-in-the-remote), and the heap in the process is bounded by the caps.

## Escalation triggers

This decision is revisited when any of these happens:

- a second server-side reader of user PDF bytes is added, or a file the user did not choose is read (F-3 is the first candidate; its fix reuses this bound and must not add a new one silently);
- a production letterhead is refused by the release audit, and the owner asks for a cap change;
- a new PDF filter, a codec, or a JBIG2-style size that lives in the data is supported by a parser the suite uses;
- the process holding the verdict memo becomes more than one (the memo is per process, sound by key immutability, but a second replica changes the cost model);
- a generation path reads a user file that is not a letterhead and not an annex.

## Compliance notes

- GDPR / data-protection impact: low. The letterhead is the company's own document, not personal data. The check and the copy read and write only the bytes the uploader supplied, in the same bucket. The audit and the log lines carry the entity, the verdict and the figures, never a key, a link or bytes.
- Data residency: compliant with the EU region. Both the upload and the copy are in the CRM's own EU bucket (`CRM_S3_*`).
- Audit trail: not required. The profile's letterhead key changes on confirm as it did before; the verdict memo is not a record.

---

## Amendment 2026-11-15 (security round 6: M-5, M-6, M-7, I-11) — allowlist instead of prediction, the `Do` graph, attachments covered

Round 6 found the bound bypassed three ways by files of 0.3 to 1 MiB, each accepted by `boundPdf` and then inflated for gigabytes by pdf-lib in crm-api and pdf.js in the browser (a 1 MiB file: 3.65 GB peak RSS and 3.8 s of blocked event loop). The orchestrator chose the fix under the owner's standing delegation. This amendment supersedes the "Decision details" bullets above that describe LZW, run-length, ASCIIHex and ASCII85 decoding, the JPX and CCITT image handling, and "Every `N G obj` header is found…" where they differ, and closes F-3.

**The failure shape, restated.** A bound that PREDICTS what another program will decode is only as good as the prediction. M-5 was one root cause in three spellings: the module read object headers with `\d{1,10}` and `\d{1,5}` and no comments (pdf-lib and pdf.js accept any digit run and comments as whitespace), stopped an LZW stream at a code from the future (both readers carry on, one byte longer each time) and skipped ASCII85 bytes above 117 (both readers take every non-space byte as a digit). The same file without the trick was refused. Recognise the shape by a module that carries its own copy of another program's decoder or tokenizer to decide how much that program will do.

**M-5, an allowlist.** The module decodes only what it can bound exactly and refuses the rest as `unbounded_stream`. A stream that is not an image has no filter or `FlateDecode` (any number of stages, each counted); an image has `FlateDecode` stages and, last, `DCTDecode`. LZW, RunLength, ASCIIHex, ASCII85, JPX, JBIG2, CCITT, Crypt and any unknown name are refused: a letterhead has no use for them, and the decoders are deleted from the module (about 400 lines). The only decoder left is node's inflate, and:

- **An inflate error other than a bad checksum is a refusal** (`unbounded_stream`). The differential test (below) found within seconds that the round-6 claim "node zlib is stricter than both readers, so it cannot undercount" is false: after an error zlib stops, and pdf-lib's inflate carries on (a byte inserted into a valid stream: pdf-lib decoded 106 134 bytes, the bound counted 16 384). A truncated stream and a bad checksum are not errors of this kind (every reader has produced the same bytes by then) and are still counted, not refused.
- **Object headers** are found as the readers find them: digit runs of any length, whitespace and comments between the three tokens, `endobj4 0 obj`. The scan is linear (the end of a "comment" is remembered, so a `%` after every digit of binary data walks its line once, and every step is charged to the tokenizer budget; the first version of this scan took 80 s on 1.3 MB of ASCII85).
- **Cross-check:** every `stream` keyword that follows a dictionary's `>>` (through whitespace and comments) must belong to an object the module parsed, else the file is refused. A spelling the module cannot see therefore refuses the file instead of hiding a stream: with the digit-run bug re-introduced, the three header vectors are still refused (by the cross-check) and only the reason changes.
- **A predictor's row** (`/Columns` × `/Colors` × `/BitsPerComponent`) wider than the decoded budget is refused `decoded_too_large`; an unreadable one `unbounded_stream`.
- **The differential test** (`pdfBounds.differential.test.ts`) is the regression net for the whole class: for a corpus (the committed letterhead, pdf-lib pages with a logo with and without object streams, every named vector of the rounds, 4 000 zlib header pairs, 1 500 corruptions of a valid stream, 150 random object/xref/chained streams and 1 200 mutations of real letterheads, 7 123 files, 2 231 accepted), whenever the bound says `ok` the bytes pdf-lib's own `FlateStream` produces for every stream (at load and when a generator decodes the page content, summed over every stage of every chain, taken from its buffers) stay within the decoded bytes the bound reported plus one inflate chunk. A soak at 25 times the corpus (171 523 files, 56 053 accepted) found no under-report. Mutation checks: the old module fails it on `gen6` and on the corrupted stream; removing the error rule fails it; re-introducing the digit cap, removing the cross-check and removing the comment memo each fail a named test. pdf.js is not in the differential (it lives in crm-ui); it is the second reader the bound exists for, and its inflate descends from the same code.

**M-6, the `Do` graph** (`formGraph.ts`, run by `checkLetterhead` after the A4 check and before the embed). The bytes of every stream can be small and the cost of drawing still unbounded: a page that calls a Form XObject 30 times, which calls another 30 times, four levels deep, is 1.8 KB and 2.49 million operators for pdf.js (6.0 s, 1.76 GB). After the file loads (safe now), the graph is walked with pdf-lib's own parse and the resources as a reader resolves them (a form with no `/Resources` uses its caller's; the page's are inherited), the content tokenized (names, strings, hex strings, comments and an inline image's data are skipped as a reader skips them; `#xx` names decoded; a `Do` split across the page's content streams still counts). Three figures are held to caps:

| Figure | Cap | Real letterheads (the committed A4 file; a pdf-lib page with text and a rectangle) |
|---|---|---|
| nesting depth of forms | 8 | 0 |
| form invocations, each multiplied by the calls that reach it | 2 000 | 0 |
| content operators executed, calls multiplying the form's own | 500 000 | 69 and 24 |

The caps are 4 or more times (in fact 100 times and more) above the real letterheads and set against what pdf.js 6.4.299 costs the tab at the caps themselves: 498 000 flat operators 0.44 s and 313 MB, 1 900 calls of an 80-line form 0.50 s and 325 MB. A `gs` that switches on a soft mask runs the mask's form, so it counts as a `Do`. A `Do` that cannot be resolved (a name not in the resources, an operand that is no name) is charged as the most expensive form in scope. A cycle is refused, a Type 3 font (glyph procedures run once per glyph shown) is refused, and so is a page whose contents the walk cannot read. Refusal is `too_complex`, with the same 422 at confirm and 409 `letterhead_unusable` at use as every other reason. **Not covered, and recorded:** tiling patterns, shadings and annotation appearance streams are not walked (a tiling pattern is built once as a canvas tile, not per cell, but this was not measured; a letterhead with annotations is not specified); server-side rasterisation of the letterhead at confirm stays rejected here and is the owner's call, since it reverses ADR 20261115-letterhead-preview-pdfjs-main-thread-in-the-remote.

**M-7 / F-3, deal PDF attachments** are covered in two places, and the F-3 risk above is closed. At **confirm** (`attachments.routes.ts`), a `application/pdf` attachment is read once through the bounded `getObject` and measured; a refusal deletes the object, soft-deletes the row and answers 422 `attachment_unreadable` naming the file with a `reason` (the code and the file name generation already used; a failed read is not a verdict, so it propagates and the row stays pending for a retry). Before the **annex load** (`renderContractPdf`, the first thing it does, so both generate routes and the draft preview), every attachment's bytes are measured again, whatever was checked at confirm: a file stored before the bound existed, or rewritten inside its upload policy's minute, was never checked, and there is deliberately **no memo** for attachments (the key is not immutable the way a letterhead copy is, and the check costs milliseconds). A refusal is the existing 422 `attachment_unreadable` naming the file. Images and other types are never read. This is a second server-side reader of attachment bytes at confirm; it is the same bounded read (ADR 20261102-crm-api-reads-attachment-bytes-for-offer-annexes) and is the first reuse of this bound the escalation triggers anticipated.

**I-11, an exception is not a verdict.** `checkLetterhead` maps an exception from pdf-lib (load, embed) to `not_pdf` or `unembeddable`, and the verdict memo remembered it for the life of the process: a transient failure (memory pressure while another request inflated a bomb) condemned a good letterhead until restart or re-upload. Such a refusal now carries `fromException` and is never remembered; a finding about the file (not A4, a page count, every refusal of the bound and the graph) is.

**What was refused or rejected.** Re-implementing each decoder faithfully (the reviewer's second option, run through pdf-lib's `decodePDFRawStream` with `getBytes(cap + 1)`) would keep five filters nobody needs and tie the bound to a second parser's behaviour; a ratio or per-filter size table has the original flaw. Rasterising at confirm needs the owner.

**Escalation triggers added.** A letterhead refused by the allowlist (one produced by an older generator with ASCII85 or LZW, or a scan with JPX) is replaced by re-exporting it or the allowlist is revisited with the owner, never widened by adding a decoder to this module; a new reader of user PDFs (client-side or server-side) runs the differential test's corpus against its decoder first; tiling patterns or annotations turning up in a real letterhead revisit the graph walk.

## Amendment 2026-11-15 (QE round 5, D23) — the bound now prices the work of drawing, not only the bytes

QE round 5 found that the two bounds above (bytes of every stream, then the count of forms and operators) leave the cost of one operator unbounded. A one-page A4 letterhead of 1.2 to 16 KB passed `checkLetterhead`; `/S1 sh` repeated 100 / 1 000 / 10 000 times (one axial shading) drew in pdf.js 6.4.299 in 0.7 / 5 / 50 s as ONE main-thread task, and with `ca 0.5` and `Multiply` 0.7 / 7 / 70 s. The preview's 10-second budget cannot fire while the thread is blocked, so every person opening an offer of the entity froze until the tab was closed. The failure shape is the one this ADR already names (a bound on a proxy, here operators and bytes, for the thing that hurts, here time and memory) in a third spelling: **an operator count says nothing about what an operator costs, and a cost depends on the state the content switched on earlier.** The orchestrator chose the fix under the owner's standing delegation: extend the M-6 walk (`formGraph.ts`) into a render-cost bound, refusal reason `too_complex`.

**Decision.** `boundFormGraph` now prices ONE drawing of the page in `RENDER_WEIGHTS` units (10 microseconds, measured) and refuses above `maxRenderCost` = 100 000 (about one second in pdf.js, the measurement below). The price is the sum of: every operator (1), every path or text paint (30, a page-sized fill is 0.27 ms), every `sh` (600), every image `Do` or inline image (600), every soft mask set by `gs` (6 000, weighed by its memory), every paint made with a gradient pattern set (600) or a tiling pattern set (700 plus the whole price of its cell plus its tile's memory, below), each form called (5), each plus what the graphics state adds. The state is read IN ORDER, as a reader keeps it: `q` and `Q` scope it, the ExtGStates named by `gs` accumulate within a scope, a colour operator (`cs`, `rg`, `g`, `k`, `sc`, `scn` and their stroke twins) replaces the fill or stroke pattern, and what a form is called under is what it is priced under, by every form it calls in turn (memo key: stream, resources, state, cell, so a form called under two states is priced twice). The first version read the state of the whole stream and priced a real macOS Quartz PDF (`form_richiesta_rimborso_spese_WellD_A4_compilabile.pdf`: three tiling patterns, 212 paints) at 2.8 s for a page that draws in 45 ms; read in order it is 0.16 s, 3.5 times its drawing. Four kinds of state add to the paint, the heavy operator or the form:

| State | paint | `sh` / image | form |
|---|---|---|---|
| alpha below 1 (`ca`, `CA`) | 0 | 150 | 250 (a form under alpha is drawn as a group, 2.5 ms) |
| separable blend (Multiply, Screen, Overlay, …) | 100 | 350 | 10 |
| non-separable blend (Hue, Saturation, Color, Luminosity, any unknown name) | 900 | 1 500 | 10 |
| soft mask | 500 | 500 | 800 |

The weights are the measured milliseconds rounded UP, and are documented in the header of `RENDER_WEIGHTS` with the measurements. A mask group is drawn from a fresh state, once per `gs` (a heavy group costs once, not per paint: measured). The caps from M-6 stay (depth 8, invocations 2 000) and **the operator cap goes from 500 000 to 100 000**. The real letterheads cost 84 to 890 units (the committed A4 file: 24 operators, 84; a pdf-lib page with a logo, rule and address block: 80 operators, 890), more than 100 times below the cap.

**What the walk now refuses instead of pricing** (it has no use in a letterhead, and each is unbounded or unattributable):

- **an operator outside the content-stream operators of PDF 1.7** (an allowlist, as `boundPdf` has for filters; `d0` and `d1` belong to Type 3 glyphs, which stay refused);
- **a shading that is not axial or radial**: a function-based shading costs 100 ms per `sh`, and one `sh` over a mesh shading of 1 million vertices (8 MB, inside the non-image cap) was still drawing after 90 s;
- **a pattern the resources do not resolve**;
- **an inline image with a filter** (its decoded size is outside `boundPdf`: it is not an object) or with a size above 4 000 000 pixels or no size at all, and an inline image whose dictionary never reaches `ID`.

**A tiling pattern is priced, not refused** (the first version refused it, and the repo's own PDF, made by macOS Quartz, uses three): pdf.js builds the cell again at every paint made with the pattern, so the cell's whole price (its content, run once and priced as a form) is added to each paint made under it, and so are its operators and invocations, in the stream and in every form called while it is set. 20 `sh` in a cell cost 25 ms a fill (linear: 1, 10 and 30 fills took 45, 273 and 752 ms). The tile is a canvas of the pattern's step, built per paint and not given back inside the task: 136 fills with a 1 100 pt step held 4.8 GB in Chromium. The tile is priced by memory, 250 units a megabyte (400 MB is the budget), from `XStep` x `YStep` x the preview's 2.69 px a point x the pattern's `/Matrix` scale, capped at the 3 000 px pdf.js allows a tile; a step that is missing or zero, and any pattern used INSIDE a form (a `cm` before the `Do` scales it by an amount the walk does not follow), is the largest tile, 36 MB. A pattern set and not painted with costs nothing.

**Annotation appearances are walked.** pdf.js draws the normal appearance streams of a page's annotations on the canvas unless told otherwise, and the walk did not read them: 200 `sh` in a Stamp's appearance took 1.1 s. They are now run as forms called once per annotation (every state of an appearance dictionary). This closes the "annotation appearance streams are not walked" note of the M-6 amendment above; its notes on tiling patterns and shadings are superseded by this section.

**Measured at the caps** (pdf.js 6.4.299 through `renderLetterhead`'s own options, Chromium headless with software raster, 1 600 px wide, 2026-11-15, one run per figure; memory is the whole browser's resident set above an idle tab of 251 MB). For each class, the largest content that passes, found by search:

| Class at the largest count that passes | Drawn | Memory above idle |
|---|---|---|
| 166 axial / 166 radial `sh` | 0.87 / 1.05 s | about +70 MB |
| 3 125 page-sized fills / 757 under Multiply | 0.81 / 1.01 s | about +70 MB |
| 166 fills with a gradient pattern | 0.88 s | about +70 MB |
| 165 page-sized images / 165 inline images | 0.96 / 0.27 s | about +70 MB |
| 16 soft masks set / 15 set, each then a fill | 0.44 / 0.51 s | +413 / +385 MB |
| one mask, then 178 fills / 86 `sh` / 86 images | 1.03 / 1.0 / 0.55 s | +175 / +176 / +135 MB |
| 346 forms under alpha (groups) | 0.86 s | +116 MB |
| 107 fills under Hue or Luminosity / 47 images under Luminosity | 1.01 / 0.98 s | +75 MB |
| 104 images under Multiply / 133 `sh` under alpha | 0.96 / 0.88 s | about +70 MB |
| 166 `sh` in an annotation appearance | 0.91 s | about +70 MB |
| 135 fills with a tiling pattern of an 8 pt step / 73 `scn`-and-fill with a 300 pt step / 11 fills with a 1 100 pt step | 0.89 / 0.52 / 0.11 s | +66 / +247 / +396 MB |
| 7 fills with a tiling cell of 20 `sh` | 0.2 s | +85 MB |
| 2 702 clip-and-fills, 2 941 curve strokes, 2 857 big strokes, 2 857 text lines, 2 000 forms | 0.76, 0.39, 0.36, 0.09, 0.06 s | below +90 MB |
| a mask AND a Luminosity blend together, then 100 page fills | 1.33 s | +175 MB |

The worst figure is 1.05 s for a single class (1.15 s on a second run of the Multiply fills: the runs vary by about 15 %) and 1.33 s for two states together; the memory is dominated by soft masks (about 24 MB each, which is why the weight of a soft mask is set by memory: the 32 sets that time alone would allow were +630 MB). The QE probes: `sh100` and `shgs100` pass (0.6 and 0.7 s), `sh1000`, `sh10000`, `shgs1000`, `shgs10000`, 560 000 tiny strokes, 40 000 fills and 200 000 clips are refused; the two dash probes pass.

**What is refused that was drawn fine.** The price is deliberately a ceiling on a PAGE-SIZED paint, since the walk does not compute areas: a letterhead of more than about 3 100 paths (a vector illustration, outlined text of a long address) is refused though each small path costs microseconds (400 000 tiny strokes drew in 1.3 s). A mesh or function-based shading, a filtered inline image and an operator outside the list are refused even where harmless. The remedy is the existing one (re-export or flatten it; the 409 `letterhead_unusable` and the 422 `too_complex` read the same), and **a letterhead stored before this change that now exceeds the bound is `letterhead_unusable` at its next use** until it is uploaded again (the release audit `crm-api/scripts/check-letterheads.ts` lists them, DD-78).

**Residual, stated.** (1) The weights are one machine's: Chromium headless with software raster on Apple silicon. A browser with GPU raster, or a slower laptop, draws the same content faster or slower by a factor this ADR does not know; the budget is about one second here, and 2 s or 0.3 s elsewhere is plausible. (2) The price adds the cost of the state to each operator by taking the dearest state present, not their sum: two states together measured 1.3 times the price (the last row). (3) A paint is priced as page-sized whatever its path, and the state is the accumulation of the `gs` names of the scope, never withdrawn by a later `gs` that resets a key (a `gs` that sets `ca` back to 1 does not clear an earlier soft mask): both err towards refusing. (4) pdf.js draws annotations and the walk reads their appearances, but a different default or a hidden annotation is still priced as drawn. **Defence in depth, not done here** (crm-ui is outside this change): passing `annotationMode: pdfjs.AnnotationMode.DISABLE` in `renderLetterhead` stops the preview drawing annotations at all, and the server-side embed ignores them already, so the preview and the PDF would agree. (5) Images: one 6 300 x 6 300 RGB image, inside the M-4 caps, drew in 44 ms and held 391 MB of heap in that tab, and the M-4 cap on all images in one file (64 million pixels) allows more than one: memory for several large images is M-4's open residual, not changed here.

**Escalation trigger, added.** **A further render-cost bypass found in the walk (an operator, a state or a stream pdf.js draws that the price does not read, once more after this one) means server-side rasterisation of the letterhead at confirm, and then the preview shows the image the server drew, not the PDF: the owner's decision**, since it reverses ADR 20261115-letterhead-preview-pdfjs-main-thread-in-the-remote. This is the third spelling of one class (bytes, forms, cost), and a fourth is the evidence that bounding another program's drawing from outside is the wrong tool. A letterhead refused by the new rules that the owner cannot re-export is revisited with the owner, never by raising `maxRenderCost` unmeasured: change a weight only with a new measurement in the same commit.


## Owner-accepted residual (2026-11-15) — security round 7: M-8 and M-9 accepted until the letterhead configurator; M-10 and M-11 closed

**What is accepted.** Security round 7 (specs/20261115-crm-offer-wizard, security-review.md) found two ways a crafted letterhead still freezes the main thread of the browser that previews it, each under 1.5 KB and each passing `checkLetterhead`:
- **M-8**: the walk measures pdf-lib's reading of the file, the preview draws pdf.js's, and two spellings make them differ (the data of an inline image ends at a different `EI`; an object number defined twice, where pdf-lib takes the last definition and pdf.js follows the cross-reference table). Content the walk skips as image data is drawn as operators.
- **M-9**: the price counts operators and a few paint classes, not geometry or functions: dashed strokes with tiny intervals, one long self-intersecting path, a complex clip multiplying later paints, Type 4 functions behind shadings and tint transforms (1.3 KB of dashed strokes: no answer in 60 s).

**Owner-accepted residual (2026-11-15)** *(scope corrected 2026-11-15 — the residual also reaches every generated offer PDF; see "Correction 2026-11-15 (security round 8, N-1)" below)*. The owner, after a plain-language explanation, accepted both as a browser-side residual until the letterhead configurator service retires uploaded PDF letterheads (OA-4: logo, margins, rules, footer text and page numbering set in Operai, with no PDF to parse). Why it is bounded: only a holder of `deal:manage` for the entity can upload a letterhead (an insider, already trusted with the offers themselves); the effect is a frozen tab for whoever opens the preview for that entity, with no data read, written or leaked; the offer PDF and every record are unaffected (the server embeds the page's content with pdf-lib and never draws it), and the way out is to close the tab and replace the letterhead. The escalation trigger of this record (a further render-cost bypass moves the work to the server) was met by M-8 and M-9; the owner chose to accept the residual rather than escalate.

**Rejected for now, with the reason.** (1) *Draw in a terminable worker* (`OffscreenCanvas`, killed after a time limit, the preview then showing no letterhead): the sound containment on the browser side, but it needs the CSP worker allowance in the shell and reverses the main-thread decision of ADR 20261115-letterhead-preview-pdfjs-main-thread-in-the-remote, for a risk the configurator removes. (2) *Server-side rasterisation at confirm*: the preview shows an image the server drew, which removes pdf.js from the browser but adds a renderer to crm-api (the same class of problem on the server, with memory and CPU of its own) and is a larger change than the configurator it would precede. (3) *The preview without the letterhead*: removes the risk by removing what the preview is for (seeing the offer as it will print). Deferred, not rejected: a pdf.js-based check in a worker thread of crm-api, and the cheap interim refusals named in M-8 (`BI`, object-stream and update-chain variants).

**What was fixed now (M-10 and M-11: crm-api availability).** Both are levers on crm-api itself, not on a browser, so they are closed. In `formGraph.ts`, a page's `/Contents` array lists at most 16 streams (`maxContentStreams`; the committed letterhead has one) and the decoded size of each is charged once per time the array lists it, against 8 MiB (`maxContentBytes`), each distinct stream decoded once; the refusal is `too_complex` without `fromException`, so it is a verdict that is remembered, not an exception that repeats at every generate (a 5.7 KB file of 200 entries of a 4 MiB stream held 1.9 GB before, and is refused in about a millisecond now). The most expensive form in scope, which a `Do` that names nothing is charged as, is computed once for each (resources, graphics state, tiling cell) over the distinct forms of the dictionary, not once per call and per name (100 000 names for one form and 1 900 absent `Do`: 36 s of a blocked event loop before, 18 ms now; a scaling test pins the walk as linear in names and calls). A refusal of a duplicate object definition in `boundPdf` was tried and not kept: it also refuses an ordinary PDF embedded in a stream (the header scan reads the embedded file's objects, and `pdfBounds.r6.test.ts` pins that such a file is accepted), so M-8b is left to the residual above.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*

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


## Amendment 2026-11-16 (security round 10, M-12) — the checks run in an isolated, time- and memory-bounded child process

**What happened.** Round 10 found M-12: `stateOf` in `formGraph.ts` looped over an ExtGState `/BM` array that nothing charged or capped, once per distinct `gs` name, and a resource dictionary may list one ExtGState object under any number of names. A 1.6 MB file (a `/BM` of 200 000 names listed under 3 000 names) reported `work` 12 003 and `ok`, and walked for 95 s of one task on the Bun event loop of crm-api, for every caller of the service. The sweep that closed it found a second one of the same shape: the key of a graphics state (`keyOf`, a `JSON.stringify` of every `gs` name of the scope) was rebuilt on every change of fill or stroke, and a name may be as long as the stream, so 64 names of 100 KB and a fill flipping between two patterns cost 6 MB of copying per flip, 9.6 s of one task, with the operator count far under its cap. This is the **fourth** time (M-10, M-11, L-10/L-11, M-12) that a loop over something the file supplies was missed by a static count, and each time the failure was the same: the event loop of a service held for as long as the file wanted.

**Decision (the owner's, the architect recording it).** A static bound is only as good as the completeness of the sweep that wrote it, and the sweep has been incomplete four rounds in a row. The checks of an uploaded PDF therefore also run **where the event loop of the service is not**: in a child process, with a wall-clock timeout and a memory ceiling, killed on overrun and refused. The static bounds stay (they refuse a hostile file in milliseconds and keep the child's work small, and the answer must not depend on the machine for the common case); the child bounds whatever they missed.

- **What runs there** (`crm-api/src/entity-profiles/isolatedPdfCheck.ts`, the child `pdfCheckWorker.ts`): `checkLetterhead` as a whole (`boundPdf`, the pdf-lib load, the A4 check, the form-graph walk and the embed probe) at the confirm of a letterhead and at the first use of a stored one; and `boundPdf` on a deal PDF attachment at confirm and before the annex load in `contractPdf.ts`. The in-process functions are unchanged and still what the unit tests, `scripts/check-letterheads.ts` and the child itself call.
- **The child** is `process.execPath --smol <worker> <letterhead|bound>`, started with an **empty environment** and the file on stdin; it imports only the pure checks (pdf-lib, `node:zlib`): no database, no environment validation, no storage client, no credential. It prints one JSON line and exits; the parent accepts at most 4 KiB of output and one verdict of the expected shape.
- **Limits** (`ISOLATED_PDF_CHECK`): timeout 5 s of wall clock from the spawn (the heaviest of 89 crafted files of rounds 7 to 10 takes 225 ms in all, Bun's start-up included, and a committed letterhead 40 to 90 ms); resident memory 512 MiB, polled every 100 ms from outside (the heaviest of those 89 files peaks at 239 MB; `/proc/<pid>/status` on Linux, `ps` on macOS); at most 2 children at once, 6 waiting, and beyond that 503 `pdf_check_busy`. A kill is SIGKILL.
- **What a kill means.** A timeout or a memory kill is a **verdict about the file**, `too_complex` (the same as a count), so `letterheadUse` remembers it per key like any other; for an attachment it is the existing 422 `attachment_unreadable`. A child that cannot answer (cannot start, crashes, prints nothing or something that is not a verdict) is **not** a verdict: 503 `pdf_check_unavailable`, nothing remembered, the row of an attachment stays `pending` for a retry. A letterhead is still checked once per stored key per process (the existing memo and in-flight de-duplication), and an attachment's verdict is remembered by the SHA-256 of its bytes (128 kept), so a deal PDF checked at confirm is not checked again at each generation: the check does not double the cost of a generation, only the first use of a key spawns a child.
- **Not changed:** `pdf-lib` still loads the attachment bytes in the service process after the bound passed (the annex copy), as before; only the bound, which was the hold, moved. The browser-side residual (M-8, M-9, N-1) is untouched: a child process protects crm-api, not the person who previews or opens the PDF.

**Measured** (macOS, Bun 1.4.2; Linux in the production image, Bun 1.4.4, as the unprivileged `bun` user). The M-12 probe, 1.6 MB, 3 000 names: refused in 86 ms by the cap on `/BM` itself. The same file against the code before the fix (95 s of walk) is killed at the timeout, **5 004 ms, with `GET /health` of the parent answering in at most 1 ms (98 samples)**; in-process, the same class of probe (8.3 s) stopped the loop altogether (one sample in 8.3 s). A good letterhead takes 40 to 55 ms isolated. In the production image the child starts from `/app/src`, the memory watchdog reads `/proc`, and a stand-in that allocates is killed at the ceiling without waiting for the timeout.

**What the sweep of `formGraph.ts` closed.** `stateOf` is now read once per ExtGState dictionary per walk (`stateOfExt`, which charges `1 + size` steps on the first read) and refuses a `/BM` array of more than 16 names; the key of a graphics state is charged one step per 64 characters when it is built. Every other loop over a collection the file supplies was read and is charged or capped: `scan` (bytes: bounded by the 8 MiB content cap, one step per operator), the `states`, `patterns` and `groups` loops of `costOf` (charged on entry), each group's `gs`, `Do` and `sh` names (charged per group), `refuseType3` (a step per font), `formsIn` (a step per XObject name), `worstIn` (a step per form), `run` (a step per call), `appearancesOf` (a step per annotation and per appearance state), `/Contents` (at most 16 streams, each decoded once), the mask list (bounded by the `states` loop), `tileMegabytes` (at most 4 entries) and the `/BM` names (at most 16).

**Residual, stated.** (R-1) The memory ceiling is a **watchdog, not a wall**: Bun and JavaScriptCore have no flag that caps a heap, and `ulimit -v` breaks JSC (it reserves address space), so an allocation that outruns one 100 ms poll can exceed 512 MiB before the kill, up to what the container allows; `--smol` only makes the collector more eager. The 5 s timeout bounds the time in any case. (R-2) The timeout is wall clock, so a machine starved of CPU for 5 s could refuse a good letterhead as `too_complex`, and the verdict is remembered until the process restarts or the entity uploads it again; the margin is more than 20 times the slowest measured check, and a restart or re-upload clears it. (R-3) Two children run at once and six wait: a burst of uploads or of first uses of many keys can meet 503 `pdf_check_busy` and retry. (R-4) pdf-lib's own parse of a page tree or xref (outside the walk) is now inside the child, so a loop there is bounded by the timeout too, but the child still spends the full 5 s of one CPU for it. (R-5) The memory watchdog is off where the platform offers no way to read a child's resident set (neither Linux nor macOS); the timeout alone applies and a warning is logged once.

**Escalation trigger, added.** A hostile file that makes the **child** misbehave beyond its limits (a verdict the timeout and the ceiling did not give, or crm-api memory growth during a check), or a need for a hard memory cap (a container limit per check, a separate service), revisits this amendment. A further loop found in `formGraph.ts` is no longer an availability finding against crm-api; it is a gap in the static bound, to be closed and recorded with its test.
