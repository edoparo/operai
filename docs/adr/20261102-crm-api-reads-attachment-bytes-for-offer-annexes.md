# 20261102 — crm-api reads its own bucket's bytes to build an offer: the bounded-read rule, second caller

**Date:** 2026-11-02
**Status:** Accepted (specs/20261102-crm-offer-document; D-11, the product owner's proposal)
**Deciders:** wellD
**Project:** Operai

---

## Context

ADR 20260716-eu-object-storage-refund-attachments says no service proxies file bytes: files go up through a presigned POST, come down
through a presigned GET, and the service only HEADs them. ADR 20260908-request-archive-export-refund-api-reads-attachment-bytes made one bounded exception.
refund-api may READ attachment bytes to compose a derived document it authors itself (the
archive export), and it asked to be revisited when a SECOND `getObject` caller appeared.

specs/20261102-crm-offer-document is that second caller, in another service. wellD's real offers list annexes, and
some of them are separate PDFs: a client's requirements, a training programme. The generate
dialog lets the salesperson pick up to five PDFs already attached to the deal. The generated
offer appends them page by page, unchanged, after the contract and Annex A. Nothing less than
reading their bytes does this. crm-api also reads the entity's letterhead PDF (specs/20261102-crm-offer-document D-1)
to draw it behind every page.

Both are objects in crm-api's own EU bucket (`CRM_S3_*`). Nothing is read from another
service's bucket, and nothing is handed to a client.

## Decision

1. **crm-api may read object bytes in exactly two places, both while it authors a document:**
   - the deal PDFs a user chose for an offer (`attachmentIds`, at most 5);
   - the entity's letterhead PDF, which it also reads once to validate it at upload.

   Proxying a file a client asked for stays forbidden (ADR 20260716-eu-object-storage-refund-attachments). Downloads remain presigned
   GETs.
2. **The size is bounded from the database BEFORE any download** (ADR 20260908-request-archive-export-refund-api-reads-attachment-bytes's rule). The sum of
   the chosen attachments' `sizeBytes` columns must be at most **20 MiB**, else
   `422 attachments_too_large`, and no `getObject` has happened yet. A letterhead is at most
   **5 MiB**, enforced by the presigned POST policy and re-checked from a HEAD at confirm.
   `Storage.getObject(key, maxBytes)` takes a second, hard limit: the DB size for an
   attachment, 5 MiB for a letterhead.
3. **Only validated objects are read.**
   - An attachment must belong to this deal, be `stored`, not deleted, and of content type
     `application/pdf`; anything else is `422 attachment_invalid` or `attachment_not_pdf`.
   - A letterhead key must match `letterheads/<entity>/<uuid>.pdf` of the entity being edited,
     before it is read or deleted, so confirm can never be pointed at another object.
4. **An unreadable file fails the whole generation.** A PDF that pdf-lib cannot parse
   (encrypted, damaged) or an object missing from the bucket gives
   `422 attachment_unreadable` naming the file, and nothing is stored: no placeholder page, no
   skipped annex. The offer is a document sent to a client and is never re-checked, so a
   silently incomplete one is worse than a refusal (ADR 20260908-request-archive-export-refund-api-reads-attachment-bytes's reasoning). The generation
   transaction rolls back, so the offer number is not consumed.
5. **Memory is bounded** by points 2 and 3: at most 20 MiB of attachments, 5 MiB of letterhead,
   and the rendered PDF, held at once, per request.
6. **Nothing is stored beyond the offer PDF** and its snapshot: names and sizes of the
   appended files, never their bytes.

## Alternatives considered

- **Link to the attachments instead of appending them.** The offer would stop being one
  self-contained document, and a client would need a login or a loose link per file. Rejected
  by the owner (the examples append their annexes).
- **Do the merge in the browser.** The browser would need every file's bytes and the rendered
  PDF, and the server could no longer stand behind what was sent. Rejected.
- **Pre-merge on attach, or in a queue.** Adds a stored derived copy and a worker for a
  few-millisecond operation (ADR 20260714-invitation-lifecycle-derived-expiry-state, ADR 20260719-refund-batch-pdf-generation-pdf-lib posture). Rejected.
- **Skip an unreadable annex and warn.** Rejected for the reason in point 4.
- **Revisit nothing: treat it as ADR 20260908-request-archive-export-refund-api-reads-attachment-bytes's own case.** ADR 20260908-request-archive-export-refund-api-reads-attachment-bytes asked for a revisit at the
  second caller rather than a quiet extension. This is that revisit; the rule is unchanged,
  it is now stated for two services.

## Consequences

- **Positive:**
  - One bounded-read rule, written down once, covers refund-api's export and crm-api's offers.
  - An offer is self-contained and printable, with the letterhead on its own pages.
- **Negative:**
  - crm-api now holds up to ~25 MiB of file bytes in memory during a generation. A burst of
    simultaneous generations multiplies that; the advisory lock is per deal, not global.
  - A user can attach a PDF that cannot be merged and learns it only when generating (the
    422 names the file).
  - The letterhead is trusted to put its page number in the bottom-right corner (D-2); that is
    a rendering assumption, not a read-path one.
- **Escalation trigger:** a THIRD service reading object bytes, or any need to read a file a
  user did not choose, to read more than 25 MiB in one request, or to read an object that is
  not a PDF. Revisit this ADR rather than extending it quietly.
