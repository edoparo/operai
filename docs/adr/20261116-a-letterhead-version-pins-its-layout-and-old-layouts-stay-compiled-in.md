# 20261116 — A letterhead version records the layout it was saved with (template, Typst version, font files by SHA-256), old layouts stay compiled in, and a golden corpus in CI guards each one

**Date:** 2026-11-16  
**Status:** Accepted — approved plan of specs/20261116-letterhead-service (approved 2026-11-16); rests on spike finding F9 and owner decision O12. Records a deliberate exception to the repo's current "no CI runs service tests".  
**Deciders:** Matteo Codogno (product owner)  
**Project:** operai

---

## Context

AC-4.5 (owner, O12) requires that a document rendered with letterhead version n has the same page count, the same text on each page and the same position of each line every time it is rendered later, after newer versions exist and after the service has been upgraded, "for as long as the service exists". The spike found byte-identical output for one binary, and that a Typst upgrade or a template change can move lines (F9). AC-1.8 adds the same promise for content: a request of an older content version renders after an upgrade with the same pages. AC-4.6 says no version is ever deleted and there is no cap on their number. A letterhead version therefore cannot mean "the template as it is today"; it has to name the code that lays it out.

## Decision

We will store on every letterhead version a layout version, meaning the template file, the Typst version and the font files pinned by SHA-256; render a version only with its own layout; keep every old layout compiled into the binary, adding a newer Typst as a renamed Cargo dependency; and guard each layout with a golden corpus (page count, page text, baseline and x position of every line) run in a new CI workflow, `.github/workflows/letterhead-api.yml`.

## Failure shape

**A stored record promises to reproduce, but what produces it is whatever code is current, and the record does not name that code.** The promise holds on the day it is made and fails silently on the first upgrade: nothing errors, a line moves, a page break shifts, and an offer already sent no longer matches what a re-render shows. The failure has no error to catch, so it can only be prevented by naming the producing code in the record and by a test that compares output with a recorded earlier output. The second half: **a guard that nobody runs is not a guard**. A corpus that exists but runs only on a developer's machine, or on a CI that does not run service tests, protects nothing.

Where else this shape appears:

- **Write and read.** The version is written with a layout; the read must use it. A render path that takes "the newest layout" because it is the default (an optional field, a missing join) has the same defect. The preview in the configurator is the mirror: it must lay out an unsaved configuration with the layout a save would record.
- **Content as well as layout.** A content version translated forward before rendering (AC-1.8) must not change pages for old requests.
- **Everything the output depends on that is not in the request:** fonts (a font file replaced, a variable font updated), a dependency's patch release, a compiler or standard-library change in a hashing or sorting routine, the locale of the build machine, a default (`text.costs`) that a library changes.
- **Other stores of reproducible artefacts:** a stored report template, a stored query, a seeded text (ADR 20261115-seeded-content-upgraded-in-place-only-when-unedited is the sibling for seeded rows: decide from what was recorded, not from what is current).
- **Newer-code-reads-older-record,** the common case, and **older-code-reads-newer-record** after a rollback: a rolled-back binary meets a layout number it does not know and must refuse, not guess.

## Options considered

### Option A — Layout version on each letterhead version, old layouts compiled in side by side, golden corpus in CI (chosen)

**Pros:**
- AC-4.5 holds by construction: a Typst upgrade or template change is a new layout, never an edit of an old one
- Cargo links semver-incompatible 0.x versions side by side, so layout 2 can use `typst_0_16 = { package = "typst", version = "=0.16.x" }` (the plan's example of a newer Typst) while layout 1 keeps `typst` 0.15.1
- Fonts are in the layout, so a font file changed is a new layout, and the SHA-256 pin makes a silent substitution fail a test
- The golden corpus makes any unintended change fail on the pull request that causes it

**Cons:**
- Binary size and build time grow with each layout (plan R4)
- A security fix in Typst does not reach an old layout without a new layout (see Risks)
- Every layout is a maintained code path for as long as the service exists

### Option B — Render every version with the current engine and accept drift (rejected)

**Cons:**
- Breaks AC-4.5, which the owner set for the life of the service (O12). A document re-rendered after an upgrade would not match the document that was sent

### Option C — Store the rendered result per version (rejected)

**Cons:**
- The service holds nothing of a document after a render (AC-3.7), and a letterhead version is a configuration, not a document. The same configuration is applied to every request's content, so there is no single result to store

### Option D — A frozen worker binary per old layout (rejected as the default; the fallback, plan R4)

A binary built from a frozen tag for each old layout; the supervisor routes a render to the binary of its layout.

**Cons:**
- More artefacts to build, ship and keep alive. It is kept as the fallback if two Typst versions cannot be linked together or the combined build is too slow or too large (R4)

## Decision details

- **A layout is** (template under `engine/layouts/<n>/`, Typst version, the font files). Layout 1 is Typst 0.15.1 with `layouts/1/main.typ` and the 13 font files of AC-7.5, each pinned by SHA-256. The set of fonts is closed (Ubuntu, Noto Serif, DM Sans, DM Mono and Syne in the spike); a render has no font path, so no font is ever fetched.
- **Where it is stored.** `letterhead_version.layout_version int not null` (plan, Data model). A save records the current layout (the newest). A restore creates a new version, so it takes the newest layout too, and the diff of the configuration is in the change record; a restored version's pages can differ from the old version's, which AC-4.2 allows because it restores the configuration, and AC-4.5 constrains a version, not a restore.
- **Unknown layout refuses.** A version whose layout number the running binary does not contain (a rollback) is a refusal, not a render with another layout.
- **Content versions.** `contentVersion: 1` is the only one in this spec; a future content version is translated into the newest before rendering, and the layout stays the version's.
- **The golden corpus per layout.** Fixtures (for example `every-block.json`, `breaks.json`) record, for each, the page count, the text of each page, and every line's baseline and x position. Any difference fails the build. A dedicated test adds a dummy layout 2 and proves that version-1 fixtures are unchanged (AC-4.5). Byte-identical output of two renders (AC-1.4) is a test of its own.
- **The CI workflow.** `.github/workflows/letterhead-api.yml` runs `cargo test`, the golden corpus and the conformance runner (a pinned pdfium binary with a checksum; the fallback is the spike's `pypdfium2` checker, R9) on every change under `letterhead-api/`. **This is a deliberate exception.** Today no workflow in `.github/workflows/` runs any service's tests (the existing ones are the changeset check, env-doctor, react-skew, shared-copies, railway-drift and the meetings eval). For a guarantee that must hold "for as long as the service exists", tests that run only if someone remembers to run them are not enough. The exception is for this service's layout guarantee; it does not make "CI runs service tests" the repo's rule.
- **A workflow is a detection, not a gate, until it is a required check.** As the header of `changeset-check.yml` says of its own job, a failing check blocks a merge only if branch protection requires it, and a direct push to `main` is detected after the fact. Making `letterhead-api` a required status check on `main` is a human decision, not made here; until it is made, the corpus is a tripwire.
- **Adding a layout** is a procedure: new `layouts/<n>/`, new renamed dependency if Typst changed, new golden corpus, the old corpus untouched and still green, the new layout as the one saves record. Editing a file under an existing `layouts/<n>/`, or the pinned Typst or fonts of an existing layout, is never allowed except to fix a defect, and then only with the golden corpus updated in the same commit and the owner told that existing versions will lay out differently.

## Evidence

- spike.md F9: byte-identical output for one binary; a Typst upgrade or a template change can move lines. Two renders of the 10-page offer gave identical PDFs and PNGs.
- spike.md fonts row: Ubuntu 0.83, Noto Serif 2.015, DM Sans 4.004, DM Mono 1.000, Syne 2.200, all `fsType = 0`; variable fonts work in Typst 0.15.
- Planned, not yet run: R-golden (AC-1.5, 1.6, 1.8, 4.5), R-conf (AC-1.3: same page count, whitespace-normalised text, tolerant pixel difference of at most 0.5 %, positive control of a 1 pt shift that must fail), R-unit (AC-1.4, AC-7.5 font hashes).
- Not measured: the build size and time of two Typst versions linked together (R4); it is measured when layout 2 is first needed.

## Consequences

**Positive:**
- An existing version never moves: the engine and template can change for new versions without touching an offer already sent
- The pin is checkable: a font or template change that was meant to be harmless fails a test, with the page and line that moved

**Negative / trade-offs:**
- The service carries every layout it has ever shipped, forever (O12 and AC-4.6 set no cap)
- Fixing a layout defect for old versions is a decision, not a patch
- The repo gains a CI workflow that no other service has

**Risks:**
- **Two Typst versions cannot be linked, or the binary or build becomes too large (R4).** Mitigation: the frozen worker binary per old layout (Option D), with the supervisor routing by layout.
- **A vulnerability in an old Typst stays compiled in.** Mitigation: the worker has no secret, no network client and a cleared environment (ADR 20261116-renders-run-in-killable-worker-processes-and-concurrency-is-bounded-by-memory), so the blast radius is one render. A fix may require a new layout and the owner's agreement that existing versions change.
- **The workflow is ignored** (not a required check, or its pdfium download fails, R9). Mitigation: the required-check decision above; the checksum-pinned download and the `pypdfium2` fallback.
- **Layout drift from something outside the corpus.** A fixture set never covers everything. Mitigation: `breaks.json` and `every-block.json` cover the rules of AC-1.5 and AC-1.6; a defect found in production adds a fixture to the layout it was found in.

## Escalation triggers

This decision is revisited when any of these happens:

- layout 2 is first needed (measure binary size and build time; choose Option A or D then);
- the owner relaxes AC-4.5 ("for as long as the service exists") or asks to retire a layout;
- a second service in this repo adds service tests to CI (the exception then becomes a rule and this ADR's wording should say so);
- a golden-corpus failure is "fixed" by editing the expected output of an existing layout (this must be a visible decision, not a routine update);
- Typst changes its output without a version bump, or a font file is replaced upstream under the same name.

## Compliance notes

- GDPR / data-protection impact: none. A layout is code, a template and fonts; corpus fixtures contain only invented text.
- Data residency: not affected.
- Audit trail: not required for this decision. The layout number is recorded on each version, which are immutable (ADR 20261116-letterhead-versions-assets-and-change-record-are-immutable-in-the-database).


## Amendment (2026-11-17) — layout 1 stays open until first production use, and its details (owner to confirm)

- **Layout 1 may change before its first production use.** Goldens may be re-recorded then, with the list of affected fixtures in the commit message; after that, rule above applies in full. `layout.lock` pins the template SHA-256 and the Typst version (`letterhead-api/engine/tests/golden/layout-1/layout.lock`).
- **Combining marks.** Typst splits combining-mark clusters across lines; `letterhead-api/engine/src/layout/clusters.rs` repairs this after layout, with the PDF drawing unchanged.
- **Unbreakable stretches.** UAX#14 unbreakable stretches are set as boxed chains.
- **Table header.** A header with no room for a body line becomes an ordinary first row.
- **Frame geometry (layout 1).** The frame sits 3 mm from the body and 5 mm from the page edge (`FRAME_GAP_MM`, `FRAME_EDGE_MM` in `engine/src/layout/mod.rs`); fit = margin − 8 mm. Line model: a line is 1 em, baseline 1.2 × spacing × size. Changing any of these is a new layout.
