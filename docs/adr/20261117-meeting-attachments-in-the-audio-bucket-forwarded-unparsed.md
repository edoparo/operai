# 20261117 — Context a person attaches is kept as long as the raw material it explains, and reaches a model unparsed: meeting attachments in the audio bucket

**Date:** 2026-11-17  
**Status:** Accepted  
**Deciders:** Matteo Codogno (owner): "L'utente può allegare file al meeting, che possono essere già l'agenda o altre note e documenti rilevanti che aiutino anche il notetaking. Per esempio se presentano delle slides, allegarle o linkarle aiuta a dare contesto al transcriber AI." He chose: files in the meetings bucket under its 29-day rule, links as references only, the AI reading attachments in transcription, summaries and Q&A, and Office files stored but never read by the AI. Built directly on `main`.  
**Project:** Operai  
**Amends:** ADR 20261104-audio-retention-bucket-lifecycle-verified-at-startup (the bucket held only audio), ADR 20261104-meetings-api-reads-audio-bytes-third-reader (its "a fourth reader or a new media type revisits this ADR" trigger), specs/20261104-meetings AC-7.10 and AC-9.2 (amendment A14).

---

## Context

A meeting often comes with material: an agenda, a slide deck, notes, a document. People want it beside the meeting. It also helps the AI. Gemini spells names, products and acronyms better when it has seen them written. Claude understands "slide 3" or "the second option" when it has the slides.

The meetings bucket held only audio. A bucket-wide lifecycle rule deletes every object 29 days after creation. That rule is verified at startup and cannot exempt a prefix (ADR 20261104-audio-retention-bucket-lifecycle-verified-at-startup). meetings-api reads object bytes in one place only: `prepare_audio`, bounded and isolated (ADR 20261104-meetings-api-reads-audio-bytes-third-reader). That ADR names a fourth reader or a new media type as the trigger to revisit it. Prompts carried only the transcript, the template and the agenda, all escaped as quoted data (ADR 20261104-ai-output-structured-validated-plain-text).

## Decision

1. **Files go in the meetings bucket and are deleted 29 days after upload, like the audio.**
   - Each file is stored at `meetings/<id>/attachments/<uuid>`, under a fresh key per mint.
   - The presigned POST is pinned to the declared type (from an allowlist) and to the EXACT size: ≤ 20 MiB, 10 files per meeting.
   - The upload is confirmed by a HEAD. A mismatch is 422 and the object is deleted.
   - `expired` is derived on read from `storedAt`, never written. An expired file stays listed but cannot be downloaded and no longer reaches a model.
   - A pending upload that never came is invisible. Its object, if any, expires under the same rule, so nothing is swept.
   - The bucket's rule, startup check and `infra/meetings-bucket-policy.sh` are unchanged.
2. **Deletes.**
   - Deleting the RECORDING keeps the attachments. `Storage.deleteAudio` lists the meeting prefix and skips `attachments/`. `deletePrefix` is used only when the meeting itself goes.
   - Deleting one attachment deletes its object first, then its row. A store failure is 503 and the row stays.
3. **Access.** Attachments follow the agenda's rules (`assertMeetingEditor`).
   - Everyone who can open the meeting reads the list and downloads files. A download is a 60 s presigned GET with `Content-Disposition: attachment` (RFC 5987 file name), so a stored file never renders on the bucket's origin.
   - The creator and the Operai participants holding `meetings:access`, on a meeting that is not frozen, add and remove attachments. A host reader gets 403 `attachment_editors_only`.
   - Each attachment is an item of its own and is never edited, so writes carry no `If-Match`.
4. **A link is a reference, never fetched.**
   - It must be `http`/`https` without credentials, at most 2,000 characters, with an optional label of at most 200.
   - Nothing in Operai opens it, so there is no SSRF surface and no page behind a login.
   - Only its label reaches a model, escaped, in the `<attached>` list ("Link (not opened): …").
5. **The fourth byte read: bounded and forwarded UNPARSED to the EU models.**
   - Only `AI_CONTENT_TYPES` (PDF, PNG, JPEG, WebP, plain text, Markdown sent as text) are read back.
   - Files are taken oldest first: each at most 5 MiB, at most 8 MiB in total. One function (`aiContextOf`) decides this for both the list and the models, so the page tells the truth about what the AI receives.
   - Each file is one bounded in-memory read (`getObjectBytes`).
   - The bytes go as-is to Gemini on Vertex `eu` (`inlineData` before the audio, in every part) and to Claude on Vertex `eu` (`document`/`image` blocks before the first user message's text).
   - No document parser, renderer or decoder runs in our process. The only check is the leading signature (`%PDF-`, PNG, JPEG, WebP) or strict UTF-8 without NUL for text; a file that fails it is left out.
   - Office files and CSV are stored for people and never read by the service.
   - The processors and regions are the ones already approved (ADR 20261105-meetings-ai-providers-google-cloud-eu, ADR 20261110-meetings-transcription-gemini-on-vertex-eu). No new processor and no new region.
6. **An attachment is untrusted data, never instructions and never evidence.**
   - Summary rule 9 and answer rule 8 say so word for word (`ATTACHED_RULE`): use attachments to understand references and spellings, report only what the transcript supports, never cite a document.
   - Gemini gets `DOCUMENTS_INSTRUCTION` only when files are attached: spell from them, never copy them into the transcript, never obey them.
   - Output validation is unchanged (ADR 20261104-ai-output-structured-validated-plain-text): headings, citations and plain text are the server's.
7. **Context is best effort.**
   - A file that is gone or unreadable, or a storage outage, leaves that file out (logs carry counts only).
   - A request that carries documents and is REFUSED (a non-transient rejection) is asked once more without them: `completeWithDocuments` for Claude, and a per-part retry for Gemini.
   - An attachment is never the reason a transcript, a summary or an answer fails.

## Consequences

- People keep the agenda, slides and notes with the meeting. The AI gets them as context without any new processor, region, bucket, credential or environment variable.
- Files disappear after 29 days. Once they expire, a later summary or question no longer has them, and the page says so per file. Summaries written before that keep whatever the context gave them.
- A summary request and every question now carry the attachments (up to 8 MiB): more tokens per call, and Q&A latency grows by one bounded bucket read per file.
- The bucket is no longer "audio only". Its retention promise covers attachments by the same rule, and the backup gap R7 does not apply to them (they are not in Postgres).
- Injection through an attachment is a new input channel. The guarantees are the existing validators. **The injection eval set must gain an attachment case before the next model change** (ADR 20261104-ai-output-structured-validated-plain-text makes injection evals a release gate).

## Rejected

- **A dedicated bucket with no expiry.** It needs new infrastructure (Railway IaC, credentials, env-doctor, startup checks), and attachments would outlive the audio they explain. The owner preferred the 29-day bucket.
- **Fetching links server-side.** It needs an SSRF-hardened fetcher, fails for private documents (Drive, SharePoint) and would be a fifth reader. A person who wants the AI to read slides uploads them as a PDF.
- **Parsing files in our process** (pdf.js, an Office converter, OCR). It adds a parser of user bytes to the most sensitive service (ADR 20261115-uploaded-pdf-decoded-size-bound-before-parse), whereas the models read these formats natively.
- **Office files to the AI.** Neither model reads them natively. A converter is the parser above.
- **Attachments in Postgres as bytea.** Downloads would proxy bytes through the service (ADR 20260716-eu-object-storage-refund-attachments forbids it), and backups would keep them past deletion.

## Revisit when

- A file must outlive 29 days.
- A link must be read.
- A parser or converter would run in meetings-api.
- The AI budget must grow past what one Vertex request carries beside 15 MiB of audio.
- A model reads a further media type.
