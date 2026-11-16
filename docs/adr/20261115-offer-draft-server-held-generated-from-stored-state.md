# 20261115 — A wizard draft is held on the server, one per deal, and an offer is generated only from the stored draft under its version

**Date:** 2026-11-15  
**Status:** Accepted — the architect's decision under the owner's delegation of 2026-11-15 (specs/20261115-crm-offer-wizard, § Delegated decisions DD-7, DD-8, DD-20), pending the owner's review  
**Deciders:** Architect, under delegation from Matteo Codogno (owner of specs/20261115-crm-offer-wizard); pending the owner's review  
**Project:** Operai

---

## Context

The offer wizard must let a person stop and continue on another device, and let a colleague finish the same offer (specs/20261115-crm-offer-wizard AC-6.1, AC-6.3), while nothing of the draft is stored in the browser (AC-6.7, extending ADR 20260607-jwt-in-memory-never-web-storage). The generated offer is sent to a client and numbered, and it must be the document the person reviewed in the preview (AC-3.2, AC-6.6). The suite's write rule for shared records is already set: integer `version` with a required `If-Match` precondition (ADR 20260807-optimistic-concurrency-version-if-match-cas-amends-0004).

## Decision

We will keep one `offer_draft` row per deal, keyed by `dealId`, saved as a whole document by `PUT` with `If-Match` (created with `If-None-Match: *`) and autosaved after a debounce of one second. We will generate an offer only from the stored draft: `POST /deals/{id}/offer-draft/generate` takes no body, requires the `If-Match` of the draft version, refuses a template version that moved, resolves the stored answers again, and deletes the draft in the generating transaction with a delete conditioned on the version it consumed.

1. A template edit never refuses an autosave. The client reconciles the answers to the new template and shows a notice (AC-8.4). Generation refuses a draft whose `templateVersion` is not the template's current version (`409 template_changed`).
2. The generating transaction takes the per-deal advisory lock already used by 018 for offers. It resolves the offer again with its reference, writes the document, inserts the offer, and deletes the draft with `WHERE "dealId" = $1 AND version = $expected`. Zero rows deleted means `409 version_conflict` and a rollback.
3. The object written to storage during the transaction is removed if the transaction fails after the write, whichever statement failed. The 018 code compensates only the offer insert; the wizard's code must also compensate the draft delete (see Risks).
4. The client sends the answers for autosave only. The write is validated by a strict schema with the caps of the plan (fields ≤ 400, text ≤ 20 000 characters, body ≤ 512 KiB, reserved characters refused). The read path also re-validates the stored answers before they reach the engine; that is this ADR's requirement, beyond the plan's write-side rule (see Risks).

## Failure shape

**The thing that is committed is not the thing that was reviewed.** A commit (a generated document, a sent offer, an approved request, a payment) takes its content from a source other than the version the person checked, or from a version a concurrent writer has since replaced, so what exists afterwards was never reviewed as it is. Two common routes lead there: a body sent with the commit, which the client chooses and which need not match what was saved; and a commit that reads a newer or cached state nobody reviewed.

The same shape appears in its mirror-image positions:

- **Inbound and outbound.** A body the client sends at commit is inbound; the stored state the server reads is outbound. Both must be the same version. A preview drawn from one and a commit drawn from the other is the failure, even when each path is correct alone.
- **Write and delete.** The autosave is a write and is conditioned. The draft's removal on generation is a write too, and it is the one most often left unconditioned. An unconditioned delete removes a draft a colleague saved after the review, so the document is issued from the older state while the newer work disappears without a trace.
- **Create and update.** Creating the draft with `If-None-Match: *` is the same rule in the other direction: a second creation from another tab must be refused, not allowed to replace the first.
- **The template as an input.** The template is also an input to the commit, and it can change after the review. The draft pins the template version, and generation refuses a moved one, for the same reason the draft pins its own version.
- **Where the working copy lives.** Unsaved work in a place the record's owner cannot see or clear (browser storage, a per-user cache, a local file) is the same shape. The review and the commit then rest on a copy nobody else can reconcile.
- **Side effects inside the commit.** An object written to storage inside a database transaction survives a rollback unless compensation covers every statement after the write. The statement most likely to be added later, after the write and after the insert, is the one that goes unprotected.

Recognise it anywhere by: an endpoint named generate, send, approve, publish, pay or confirm that accepts a body with the content it commits; a delete or update of a working copy with no version predicate; an autosave or a PUT with no precondition; a preview computed from a state other than the one the commit reads; a copy of unsaved work outside the record's store; a storage write inside a transaction followed by statements that have no compensation.

## Options considered

### Option A — Server-held draft, whole-document `PUT` with `If-Match`, generation from the stored draft (chosen)

Described in Decision.

**Pros:**
- The generated document is exactly the saved document: the version is pinned from the draft that was previewed
- The delete of the draft is conditioned on the consumed version, so a stale generation cannot remove newer work
- Generate needs no body, so no 50 KB request goes out on the commit
- Resumable on any device (AC-6.1), and a colleague can continue the same draft (AC-6.3)
- The same CAS shape as the rest of the suite (ADR 20260807-optimistic-concurrency-version-if-match-cas-amends-0004), so no new precondition protocol

**Cons:**
- Every autosave sends the whole answers document, up to the 512 KiB cap, not only the field that changed
- A `409` on autosave means a reload, and up to about a second of typing can be lost in a race (R6, accepted by AC-6.3)
- A second store of client personal data (contacts' names, addresses) exists until generation or discard

### Option B — Generation from a client body (rejected)

**Pros:**
- No draft table; one request to generate

**Cons:**
- What is generated can differ from what was autosaved and previewed, and nothing ties the body to a saved version
- A stale tab generates from its own copy, with no conflict signal
- A body of tens of kilobytes travels on every generate

### Option C — Per-field `PATCH` (rejected)

**Pros:**
- Smaller writes; less contention per field

**Cons:**
- Merge rules for lists, tables and cost lines, and more routes
- The server must validate partial states and the whole state at once anyway
- No single compare-and-swap over the whole answers, so the state reviewed can be a mixture that nobody reviewed

### Option D — Browser storage (rejected)

**Pros:**
- No server table; instant

**Cons:**
- Forbidden by AC-6.7; invisible to a colleague (AC-6.3) and to another device (AC-6.1)
- Lost when the browser's storage is cleared, and held where the record's owner cannot clear it

### Option E — Pin the draft to the old template version instead of reconciling (rejected, DD-8)

**Pros:**
- The draft never changes under the person

**Cons:**
- The template has no history, so the old text does not exist to be pinned to; the draft would print a template nobody can read any more

## Consequences

**Positive:**
- The offer that is generated and numbered is the one the person saw in the preview, including across a reload, a second device and a colleague's edit
- A stale generation cannot silently discard newer work, because removing the draft is itself a conditioned write
- Discard (`DELETE`) and generation use the same conditioned delete, so they cannot disagree about what was removed
- The generated offer's snapshot holds `wizard.answers` (DD-20), so reopening the wizard on it reproduces what was entered (AC-6.6)

**Negative / trade-offs:**
- A second store of client personal data, retained until generation or discard, and removed by cascade if the deal is deleted
- The generate endpoint depends on a draft row existing; a deleted draft is a `404` the client must handle as "start again"
- The answers document is validated twice, once on write and once when read back, because a stored value is data that came from a browser

**Risks:**
- **Compensation does not cover the draft delete.** The 018 generation code writes the object inside the transaction and removes it only when the offer insert fails (`offers.routes.ts`). The draft delete comes after the insert, so the wizard's code must wrap the insert and the delete in the same compensation, or a conditioned delete that returns zero rows leaves an unreachable object behind. Mitigation: the integration tests must force both a render failure and a zero-row draft delete, and assert that no object remains and the draft is intact (AC-6.6 names only the first; the second is required by this ADR).
- **A stored answers document read back is trusted without checks.** Mitigation: the strict schema, caps and reserved-character refusal run on every read as well as on every write.
- **Autosave race.** Two people editing one draft lose up to about a second of typing on a conflict (R6). The banner says so, and the reload keeps the other person's saved version intact (AC-6.3).

## Compliance notes

- GDPR / data-protection impact: low. The draft holds client contacts' names and client addresses, which the context endpoint already serves to the same people. It is kept only until generation or discard, removed by cascade with the deal (plan § Data model), never written to browser storage. Logging is limited to identifiers and versions: the plan specifies this for the generation log line (plan step 7), and the same rule is required for the draft routes.
- Data residency: compliant with the EU region. The table is in the crm-api database.
- Audit trail: not required for the draft. The generated offer and its snapshot are the record; the draft's `updatedBy` and `updatedAt` show only the last change.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
