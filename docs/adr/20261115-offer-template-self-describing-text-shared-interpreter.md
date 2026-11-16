# 20261115 — Offer templates are self-describing texts, read by one pure engine copied byte-for-byte into crm-api and crm-ui

**Date:** 2026-11-15  
**Status:** Accepted — the architect's decision under the owner's delegation of 2026-11-15 (specs/20261115-crm-offer-wizard, § Delegated decisions DD-4, DD-5, DD-6), pending the owner's review; amended 2026-11-15 (post-design, delegated), see § Amended 2026-11-15: the engine also owns the document's numbering and fixed words  
**Deciders:** Architect, under delegation from Matteo Codogno (owner of specs/20261115-crm-offer-wizard); pending the owner's review  
**Project:** Operai

---

## Context

An offer template (specs/20261102-crm-offer-document) is a full contract text, and the offer wizard (specs/20261115-crm-offer-wizard) must derive from that one text what to ask the person, how the document will read as they answer, and what the PDF will print. The preview must update within one second of a change (AC-3.1), must show the same texts, blocks, rows and cost lines as the PDF (AC-3.2), and must run in the template editor on unsaved text with sample answers and no deal (AC-8.5). AGENTS.md forbids a shared workspace package for the backends, and the suite already copies a few modules on purpose and checks them byte-for-byte (`scripts/check-shared-copies.ts`, e.g. the `manDays` group).

## Decision

We will declare each template's wizard inside its own text, with explicit declarations (`@@field`, `@@list`, `@@table`, `@@block`, `@@choice`, `@@costs`, `@@annex`, `@@step`), and interpret that text in one pure, I/O-free TypeScript engine in `crm-api/src/offers/engine/`. The same engine is copied byte-for-byte into `crm-ui/src/lib/offerEngine/` and the copies are checked by `scripts/check-shared-copies.ts`; both suites run the same golden vectors (`engine/vectors/*.json`).

1. The browser resolves the draft on every change and renders the preview from the resolved structure. crm-api resolves the stored draft with the same code at generation and hands the same structure to the PDF renderer.
2. Nothing other than the engine reads template text, and nothing builds markup, an expression or a cost table from an answer. Every answer inserted into markup is escaped by the resolver; reserved marker characters (U+E000–U+E0FF) are refused in templates, answers and hand edits.
3. Amounts, dates and numbers are formatted by `engine/format.ts` with the document's own rules (DD-21). *Implementation note, derived from DD-21 and not recorded as a separate decision in the plan:* the engine must not call `Intl`, `toLocaleString` or the runtime clock, so the preview and the PDF cannot depend on the locale data of the runtime that draws them.
4. Each copy's shared region is one `shared-copy` group per engine file (`offerEngine.markup`, `offerEngine.syntax`, …), and the workflow path filter covers the engine paths (today it lists only the service-token copies).

## Failure shape

**A document's meaning is computed by more than one implementation of the same rule, or a value a person typed is later read back as structure.** Either way the system stops being able to say what the person reviewed, because each implementation is internally consistent and nothing compares them. When two copies of a rule are byte-equal they still disagree the moment the behaviour they depend on differs, so equal bytes are not evidence of equal behaviour; and when a typed value reaches a place that is parsed as syntax, data has become instruction.

The same shape appears in its mirror-image positions:

- **Reader and writer of one format.** The editor parses a text to report its problems, the wizard parses it to ask questions, the generator parses it again to print. Each can look right alone and disagree together. The writer side is the one that gets missed: a value the engine writes back into a stored answers document is read by the engine again on the next load, so its validation must be the same on the way in and on the way out.
- **Preview and print.** Anything shown on screen before it is printed (the preview, the editor's sample run, a list of missing fields) is a second reader of the same text. The printed document is the one that counts for the client; the screen must be drawn from the same resolved structure, or it is a picture of a different document.
- **Author's text and person's answer.** The template author's own text is also data for the engine's arithmetic (`compute:`) and binding (`source:`). The rule that stops an answer becoming markup applies to the author's text as much as to the answer, and to a value copied from the deal, the estimate or a stored snapshot.
- **Inbound and outbound.** A value that leaves the system (a PDF, a stored snapshot, a link, an email) and returns through a later read is input again. A snapshot read back must not be trusted as already-escaped text unless the write side guaranteed it.

Recognise it anywhere by: a second parser, formatter or arithmetic for a notion the engine already owns; a test that only proves two files are equal; a string built by concatenating a person's value into markup, a path, a query, an expression or a log line; a "preview" drawn by a component other than the one that prints; a route or screen that reads a stored text without going through the one interpreter.

## Options considered

### Option A — Self-describing text, one pure engine, byte-identical copies, resolved in the browser (chosen)

Described in Decision.

**Pros:**
- AC-3.1 (one second) and AC-8.5 (editor preview without a deal or a save) are met with no round trip
- The declarations sit beside the text they describe: renaming a field in the text cannot orphan its label, because there is no second place it is written
- Preview and PDF come from one resolved structure, so AC-3.2 holds by construction for everything the engine resolves
- It follows a pattern the suite already uses and already checks (`check-shared-copies.ts`)
- One syntax: authors keep the 018 markup they already write (DD-5)

**Cons:**
- Two copies to keep behaviourally equal; the byte check proves identity of text, the vectors prove behaviour, and both are needed
- The full template text now reaches the browser (it is business content, not personal data; the context endpoint already serves the personal data)
- The parser runs in the browser on up to 150 000 characters, so it must be linear and fuzz-tested (R8)
- A change to the escape rules changes how a backslash prints in legacy texts too (R13)

### Option B — Metadata in a side JSON or table columns, edited with forms (rejected)

**Pros:**
- Forms are easy for non-developers; the text stays pure 018 markup

**Cons:**
- Two sources of truth for one template: a rename in the text orphans its label, and a rename in the form orphans its occurrences
- AC-8.3 cannot point to the line that is missing a label
- A template is no longer one pasteable artefact, which AC-9.3 needs for the English and Italian-entity versions

### Option C — Server-rendered preview and resolve endpoint, one copy in crm-api (rejected)

**Pros:**
- One implementation; no copy to keep equal; the template text does not leave the server

**Cons:**
- A round trip per change against AC-3.1's one-second rule, and crm-api load on every keystroke
- The editor preview (AC-8.5) must post the unsaved text for every run, and the wizard's preview depends on crm-api being up for each change
- Its availability becomes the wizard's availability: a crm-api slowdown is felt on every change the person makes, not only in the preview pane

### Option D — A shared package or a workspace (rejected)

**Pros:**
- One source file, no copy check

**Cons:**
- AGENTS.md forbids it: a `pnpm-workspace.yaml` or a `workspaces` field makes a package manager treat the apps as one workspace and breaks the per-app installs and the Railway and Vercel builds

### Option E — The engine inside `@operai/ui` (rejected)

**Pros:**
- One compiled copy, shared by the shell as a Module Federation singleton (ADR 20261114-operai-ui-shared-singleton-provided-by-the-shell)

**Cons:**
- Domain logic in the design system: `@operai/ui` is the UI library, and every remote would load the offer grammar whether it uses offers or not

### Option F — A new template syntax, or keep the mockup's heuristics (rejected)

**Pros:**
- A new syntax can be designed for the wizard (Handlebars-like); the mockup's heuristics need no author change

**Cons:**
- A second syntax next to the 018 markup (against the spec's constraint to extend the existing markup), so authors relearn what they already write
- Heuristics on Italian words (a "Totale CHF" header, a "Spett.le" line, a leading section number) would not work in English templates (DD-5)

## Consequences

**Positive:**
- One place interprets a template; the editor's problem list, the wizard's questions, the preview and the PDF cannot disagree about what a text means
- AC-9.3 holds: an English or Italian-entity template is added by pasting a text. The engine has no entity, language or currency literal (a grep test pins this)
- A problem is reported at its line (AC-8.3), because the declarations live in the text

**Negative / trade-offs:**
- Every engine change ships to two copies in one commit, with its vectors. A grammar change also changes what every stored template means, so it is a contract change, not a refactor
- The browser bundle carries the parser and the renderer's data model

**Risks:**
- **Copies drift in behaviour that bytes do not show** (R3). Mitigation: one shared-copy group per engine file, the same vectors in both test suites, and the workflow path filter extended to `crm-api/src/offers/engine/**` and `crm-ui/src/lib/offerEngine/**` (today most copies are not checked on PRs that touch only them).
- **Parser cost on hostile input** (R8). Mitigation: a linear single-pass tokenizer with no backtracking expressions, nesting ≤ 8, template ≤ 150 000 characters, answers ≤ 512 KiB, and a fuzz test that every input completes in < 200 ms and returns problems rather than throwing.
- **Legacy text changes meaning** (R13). A backslash before a markup character becomes an escape. Mitigation: count legacy templates and offer snapshots containing such a sequence before the deploy.
- **Non-printable characters** (R15). The engine maps text to what WinAnsi prints plus "□" before the preview draws it, so the preview shows the same "?" as the PDF (DD-22).

## Amended 2026-11-15 (post-design, delegated)

Source: specs/20261115-crm-offer-wizard, plan § Delegated decisions DD-29 (G3), risk R18 and ADR candidate 6. The Decision and the Failure shape above stand. This note widens what "the same resolved structure" in Decision point 1 covers.

**What the engine now owns.** Besides parsing, outlining, resolving, costing and formatting, the one engine owns the document's numbering and its fixed words:

- `numbering.ts`, `numberOffer(input)`: the section and sub-heading numbers ("2", "2.1", depth-first, list children included), the headings of text annexes, the effort-detail and deal-PDF letters (the next free letters, skipping designations in use), the "Allegati:" list and the index (only when the effort-detail annex prints).
- `costs.ts`: the cost positions and the span arithmetic of the cost-table ADR's amendment.
- `words.ts`: the document's fixed words per offer language ("Allegato", "Annex", "Allegati:", "Pos.", "Totale", the index title). These are document text in the offer's language. They are not UI copy and never go through `strings.ts`.

The resolver drops empty sections and sub-headings before numbering, so numbering always reads the structure after that drop.

**What the renderer does.** `contractPdf.ts` draws what the engine numbered and worded: the letterhead, the page layout, the index and cost-table geometry, and the appended PDFs. It computes no number, letter or fixed word of its own. The preview and the PDF both call `numberOffer` on the same resolved structure. A legacy 018 snapshot builds its `NumberingInput` from the stored sections and goes through the same function, so a legacy offer and a wizard offer are numbered by one copy.

**Consequences.**

- Legacy offers now pass through the engine's numbering. The legacy renderer goldens (AC-9.4) must stay unchanged; that is the evidence the refactor changed nothing. A change to `numbering.ts` or `words.ts` also changes how a legacy offer prints if it is rendered again, which is the R13 concern in a new place.
- Each of `numbering.ts` and `words.ts` is one more shared-copy group, checked by `scripts/check-shared-copies.ts` and covered by the same vectors in both test suites (R18). Changing either is a two-copy change in one commit, like a grammar change.
- The engine's file list is the plan's § Components list: `markup.ts`, `syntax.ts`, `outline.ts`, `resolve.ts`, `edit.ts`, `costs.ts`, `compute.ts`, `answers.ts`, `format.ts`, `numbering.ts`, `words.ts`, `printable.ts`. Decision point 4 applies to each of them.

**Failure shape, extended.** Numbering and fixed words are notions the engine owns, so the Failure shape covers them as it covers parsing and arithmetic. Their mirror-image positions are:

- the number an author writes in the text ("par. 2", "vedi Allegato B") and the number the printer draws beside it;
- the number on the preview and the number on the PDF of the same offer;
- the number of a legacy snapshot and the number of a wizard snapshot of the same shape;
- a section removed before numbering in one place and not in another: every later section renumbers silently, and every reference the text makes to them now points at a different section.

Recognise it in any new screen or renderer by: a component or the renderer computing "1.2", "ALLEGATO B", "Pos. 3", an index entry, the "Allegati:" list or the word "Totale" itself; a letter chosen as "the next free one" anywhere but `numberOffer`; a section filtered out before the engine has numbered the document.

## Amendment 2026-11-15 (owner)

Source: specs/20261115-crm-offer-wizard, § Amendment (2026-11-15, owner) — US-12 (AC-12.1 to AC-12.13), decisions DD-57, DD-58 and DD-61, and the owner's review after testing the wizard by hand. The Decision, the Failure shape and the earlier amendments stand. This note adds one kind of input to the engine: values the CRM supplies from the deal's entity profile, which the person cannot fill.

**A CRM-supplied value is a system source, and a blank one prints nothing.** The legal name and the address of the deal's entity are the system sources `issuer` and `issuerAddress`, read from the entity profile as saved at the moment the preview or the PDF is drawn. The engine reads `context.issuerLegalName` (folded to one line) and `context.issuerAddressLines` (each line folded and trimmed, blank lines dropped, joined with ", "). A blank supplied value resolves to the empty text. It is not a missing field: it is not counted in the missing-field count (AC-3.5), has no focus and no input. Refusing a generation with a blank legal name is a decision outside the engine: crm-api refuses it in the draft generate, before any read, with the absent-profile 409 (DD-61).

**A profile value is escaped the way an answer is.** The legal name and the address are the one place where a value written in Settings, not by the person making the offer, becomes markup in every offer. They pass `escapeValue` on markup surfaces and `plainValue` on plain ones, after the same `printable` filter. A name with a pipe, an asterisk, a bracket or a backslash prints as those characters and never changes the table or the structure around it (AC-12.2). Hostile-name cases are vectors in both copies (`engine/vectors/issuer.json`, the `hostile` group) and in both apps' vector runners.

**`systemRead` reports which system values the printed text read.** `ResolvedOffer.systemRead` lists the sources of system-bound fields that the resolver read while building the printed, non-hand-edited text: an emitted `[NAME]`, or an evaluated condition that names one. The list is sorted and unique. A hand-edited section and a false condition record nothing. The address notice of AC-12.12 is `systemRead.includes("issuerAddress") && address is empty`, the same rule in the wizard's preview and in the Try view (AC-12.13). The notice is computed from the interpreter's output, never from a walk of the AST in the UI.

**Rejected.** (a) Treating a blank supplied value as missing: a placeholder the person cannot fill, counted against them, which AC-12.7 forbids. (b) A stand-in value (a sample name, or a "[ragione sociale]" placeholder) printed in an offer: the client would receive a name nobody chose. (c) An engine-level optional-separator grammar for the address: the existing `{{?…}}` conditional text already says it, and the seeds use it (DD-59).

**Failure shape, extended.** A value the system supplies becomes the same kind of input as a value the person types once it reaches the engine: it can be blank, it can be hostile, and it is read in several places. Its mirror-image positions are:

- **Blank supplied versus blank answered.** A blank answer is a question the person can answer; a blank supplied value is a fact the person cannot change. Treating both as missing asks the person to fix what they cannot; treating a blank answer as "prints nothing" silently drops what the person must fill. The engine tells them apart by source, and any new screen or renderer must too.
- **Preview and PDF read the profile at different moments.** The preview reads the profile when it is drawn, the PDF when it is generated. The mirror case is an offer that keeps a name it printed earlier. The moment of reading is decided by the offer's snapshot (AC-12.4) and by nothing on screen.
- **Editor and wizard.** A supplied field must appear as supplied in the editor's outline and never as a question in the wizard. If they disagree, the author and the person are asked about different documents.
- **Profile write and offer read.** One Settings save changes the text of every future offer. A profile value is written by one person and read by every offer, so the escape rule that protects an answer protects it too.
- **Notice and print.** The address notice is true only if it is computed from what the printed text read. Computed from the source text instead, it warns about an address the document never prints, and misses one it does print.

Recognise it elsewhere by: a value fetched from a record that others edit and the author cannot fill; a blank rule that differs by source with no stated reason; a screen that decides a value is used by reading the template text instead of the resolver's output; a new markup surface that writes a record or profile value without the escape path.

## Compliance notes

- GDPR / data-protection impact: none introduced by the engine. The browser receives client contacts' names and client addresses through the context endpoint, which is `Cache-Control: no-store` and already served before this decision; the template text itself is business content.
- Data residency: compliant with the EU region. The engine adds no service, no processor and no storage.
- Audit trail: not required by this decision. Template rows keep their `version`, `updatedBy` and `updatedAt`, as today.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
