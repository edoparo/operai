# 20261115 — A page break in an HTML rendering never splits text or adds structure: one continuous flow, a rail of empty floats for the gaps, and a decorative page layer behind it

**Date:** 2026-11-15  
**Status:** Accepted — the architect's decision under the owner's amendment OA-3 "Real A4 pages" of 2026-11-15 (specs/20261115-crm-offer-wizard, § Amendment OA-3, DD-65…DD-71; `approved_by: delegated`); built and measured in T73 to T75. Pending the owner's review. Two items are flagged for that review: the 10 CSS px text floor (O11, which supersedes the 12 px in the plan) and the fixed relaxation order, where a section heading may end a page at Drawer widths (AC-11.11, T74).  
**Deciders:** Architect, under delegation from Matteo Codogno (owner of specs/20261115-crm-offer-wizard); pending the owner's review  
**Project:** Operai

---

## Context

The offer wizard's preview must show the offer as real A4 pages with the entity's letterhead behind every page (owner amendment OA-3, AC-11.1, AC-11.6, AC-11.10 to AC-11.13). The offer text must remain one selectable, searchable run of real text: find-in-page and selection must match a sentence that a page break cuts in two (AC-11.12), and a break must add no structure (AC-11.1). The break positions must follow the PDF's own rules (widows and orphans, keep-with-next, a table row not split, an acceptance block kept whole; `contractPdf.ts`), within the approximation the spec allows (AC-11.11). CSS multi-column with `column-height` is Chromium-only in the time of writing.

## Decision

We will paginate the preview as **one continuous flow of real text**: where a page ends, a rail of empty floats at the start of the flow pushes the lines after the break down past the dead zone (the rest of the frame, the bottom margin, the gap and the next top margin); the page boxes are a decorative, `aria-hidden` and `inert` layer painted behind the flow; the break positions come from a pure `placeBreaks` that mirrors the PDF's rules and is measured on the visible tree, never on a copy; and the page constants are shared byte-identically with the PDF renderer through the `offerPaper` copy group.

## Failure shape

**A layout decision, where a page ends, becomes content.** A break that splits one sentence into two runs, copies a line into a second place, or adds a container that a reader, a search, a copy or an assistive technology will meet changes what the document says it is. Once the screen is paginated by inserting structure into the text, every consumer of that text sees the page as if it were the document. The failure is the decision leaking into the content it was meant to lay out.

The same shape appears in its mirror-image positions:

- **Display and output.** A paginated HTML view and a paginated PDF both decide where a page ends. If the two decide by different rules, or one stores its page structure into the text the other reads, the document has two authorities. Recognise it wherever a page rule exists in two places (an engine and its copy, a preview and a printer, a generator and the reader of its output).
- **Inside and outside the flow.** A decorative layer that carries text (a running header, a page number, a "continued" line) is found, copied and announced as content the moment it contains a character. The mirror case is a decoration that changes with the page count and so carries the count into the document. Keep the layer empty and `aria-hidden`; the test is that the flow's `textContent` is identical paged and unpaged.
- **Measured and displayed.** A layout measured on a copy of the content, or a clip window that shows a copy, is the same failure in its mirror position: the text exists twice, and the two can drift. Measure the tree the reader sees; display one copy of the text.
- **Flow and block.** A new element inside a text flow that establishes its own formatting context, paints a border or clips its box (an overflow other than `visible`, a flex or grid container, an inline block) silently breaks the placement, because the placement assumes that only tables and their cells change the flow's geometry.

Recognise the shape by: a `page`, `column`, `spread`, `slide` or `window` concept laid over one text; per-page wrappers; `overflow: hidden` windows over a duplicated node; a hidden or offscreen copy used for measurement; a new heading, list or live region added by pagination; a break that is announced, numbered or repeated in the markup.

## Options considered

### Option A — One continuous flow, a rail of empty floats, a decorative page layer, placement measured on the real tree (chosen)

**Pros:**
- The text is one run in one element tree: find-in-page matched 4 of 4 sentences that straddle a break (T74); a selection or a copy meets only the paragraph's own text node (AC-11.12)
- Standard CSS 2.1 floats (§ 9.5) do the moving, so the behaviour does not depend on one engine's multicol rules
- Pagination adds no role, landmark, heading, list, table or live region

**Cons:**
- Two layouts per settled change (unpaged, then paged), and a flow invariant that the preview's own markup must keep
- A table split across pages moves its lower rows with `translateY` and its rules are carried by the cells

### Option B — One element per page, the text split at each break (rejected)

**Cons:**
- A paragraph cut by a break becomes two `<p>`: find-in-page does not match across the boundary, a copy gains a line break, a screen reader announces two paragraphs, and the break adds structure. Fails AC-11.1 and AC-11.12

### Option C — Clipped copies of the flow, one per page (rejected)

**Cons:**
- The text is in the DOM once per page: a sentence split by a break is visible, findable and selectable in two copies. `inert` copies would hide exactly the part a reader is looking at. Fails AC-11.12 ("found as one sentence, nothing repeated")

### Option D — CSS multi-column with `column-height` and `column-wrap` (rejected)

**Cons:**
- Chromium-only at the time of writing; `widows`, `orphans` and `break-*` inside multicol differ across engines, so the PDF's keep rules would not hold in each engine
- The frame-shaped gaps need a second layer anyway

### Option E — A hidden measuring copy of the flow (rejected)

**Cons:**
- Doubles the DOM, and its layout can drift from the visible tree; the visible tree's own unpaged render is the measurement, at no extra cost

### Option F — A PDF preview, or the text drawn on a canvas (rejected; declined by the owner)

**Cons:**
- The text stops being real text (AC-11.1), so it cannot be selected, searched or read by a screen reader; the owner declined the PDF preview on 2026-11-15

## Decision details

**The flow and the rail (DD-65, DD-70).** Each page break is a pair of empty, `aria-hidden` floats at the start of the flow: `zₖ` (`width: 0`) carries the run of text before break k, `Fₖ` (`width: 100%`) carries the dead zone k; both are `float: left; clear: left`. A line box that has no room beside a float moves below it (CSS 2.1 § 9.5), so the lines after a break land exactly on the next page's frame top. The page's top margin stays on the previous page, as in the PDF.

**The page layer (DD-71).** Each page is an `aria-hidden`, `inert` box with `bg-paper` and a page edge, on the stage's `bg-ink-mid`, so the gap is visible in both themes. While the letterhead is shown, every box holds one `<img>` with the same `blob:` URL: one fetch, one decoded image, every page (AC-11.8). The geometry and the breaks never read the letterhead state.

**The pipeline (DD-69).** On a settled change (the existing 250 ms debounce), the flow is rendered unpaged in a layout effect while the stage keeps its previous height, so the scroll offset is not clamped; `collectFlowItems` reads the `[data-flow]` elements in document order, `placeBreaks` chooses the breaks, `realize` turns them into styles, and the paged render follows before the browser paints. The unpaged frame is never shown. Pagination observes the region's width only, and `scrollbar-gutter: stable` keeps a scrollbar from changing it.

**Break rules (DD-68), each pinned by vectors and mirroring `contractPdf.ts`.** A page holds what fits (R1). A text block breaks only after line *i* with *i* ≥ 2 and *n − i* ≥ 2, so a 2- or 3-line block never splits (R2). `keepNext` keeps a heading, a table's header row and first body row, or a whole unit with the start of the next item (R3). A table breaks only before a body row that is not its first; a row is not split (R4). The acceptance block never splits (R5). `breakBefore` starts a new page unless the cursor is already at a page's first line, so no blank page is made (R6). Every line and row is on exactly one page, in order (R8).

**The fixed relaxation order (DD-68, R7, AC-11.11).** When a keep rule cannot be met even on an empty page, the rules give way in this order, and only in this order: **R3, then R2, then R5, then R4**. R4's "never split a row" gives way last: a row taller than the page body continues on the next page at a line boundary, with a rail inside each of its cells. Every page holds at least one line, and a break is never inside a line. The order is fixed so that a test can state what a page break promises when the rules collide, and the owner can review it as a rule rather than as a rendering accident.

**Geometry (DD-66, designer D-33 to D-42).** The inset is `min(16, available / 20)`; the page width is `W = min(794, available − 2·inset)` (794 px is 210 mm at 96 px/in); the scale is `s = W / 595.28`; the height is `H = W · 297 / 210`; the frame is `120·s / 110·s / 71·s / 71·s` from the shared frame; the page body is `B = H − 230·s`; the gap is 16 px. The text floor is the one built by T73 (designer G21): each PDF size *p* is drawn at `max(10, (10/16) · rootFontPx, p · s)` CSS px, with `line-height = 1.35 · px` in px. Vertical spacing, list indent and cell padding use the PDF's point values times `k = px(10) / 10`. Values reach the elements as inline `style` through a `PaperTypeContext`, which the token lint permits because they are runtime values. The 10 px floor supersedes the 12 px of the plan (O11, below).

**Shared page constants (DD-67).** The page size, frame, type sizes, line height and spacing points live in `crm-api/src/offers/paper.ts` and `crm-ui/src/lib/offerPaper/paper.ts`, one copy group (`offerPaper`) in `scripts/check-shared-copies.ts`, checked in whole mode, and `contractPdf.ts` imports them instead of literals. A change to the PDF's frame or type moves the preview's pages in the same commit, and the shared-copy check fails until both copies agree.

**The flow invariant (DD-70, checked by a static class scan in the tests).** Inside the flow nothing but tables and table cells establishes a block formatting context (no `overflow` other than `visible`, no `flex`, `grid`, `flow-root`, `inline-block` containers), and no block other than a hand-edited section paints a border or background. A painted element that crosses a dead zone (a hand-edited section's left rule, the cells of an over-tall row) gets a `clip-path` over its box minus the bands, so nothing is drawn in a margin or a gap. Cells wrap anywhere (`wrap-anywhere`) so a long word or a wide table stays inside the frame. Annexes lose their `mt-8 border-t pt-4`: the new page is the separator, as in the PDF.

**Tables (DD-70, as built in T74).** A break between two rows of one table moves the following rows with `transform: translateY(Σ D)` and gives the table room below. The room is `padding-bottom`, not `margin-bottom` as the plan first had it. Tables use `border-collapse: separate; border-spacing: 0` with rules on the cells, so a moved row carries its own rules, and the first row on a page draws its top rule.

### Lessons measured in Chromium (T74)

- **Every cell carries a `border-top`, transparent unless the cell draws the rule** (the header and the first row on a page). A row whose border exists only when it draws the rule has a different height from the same row at a page start, and a row moved by a break drifted by 1 px. Both this and the margin-to-padding change were found as 1 px drifts in Chromium; the record does not isolate each one's exact cause beyond that measurement.
- **Table room is `padding-bottom`, not `margin-bottom`.** The margin variant drifted; the padding variant did not.
- **Chromium lays out in 1/64 px.** A dead zone computed to the exact pixel can leave a line 1/64 px on the wrong side of a boundary, so each dead zone is made 0.05 px longer.

These belong to the next author's first hour with this code: each is a rule that a future table or cell change can break silently, and each is pinned by the in-page measurement (below), not by reading the CSS.

## Evidence

- **T73 (pure core):** `placeBreaks` takes 0.15 ms median for 54 pages. Six configurations of 300 seeded random flows are checked against an independent CSS 2.1 float model and the rule oracle (test-only modules `flowBuilder`, `layoutSim` and `oracle` in `crm-ui/src/components/offerWizard/paper/`); 10 mutation checks.
- **T74 (in the browser):** at 1280 px inline, 1024 and 320 px in the Drawer, 1920 px, a 640 × 450 zoom proxy with a 32 px root font; light and dark; the `shown`, `none`, `failed` and `unusable` letterhead states, the last three by request interception. In-page measurement over every line and cell rectangle: **0 lines in any margin or gap**; headings never last on a page at 1280 and 1920; **0 split rows** (an over-tall row excepted); `window.find` matched **4 of 4** sentences that straddle a break; the same page count and offsets in every letterhead state; one fetch serves every page.
- **T75 (end to end):** `shell/e2e/crm-offer-wizard-pages.spec.ts` (8 journeys) with `shell/e2e/helpers/previewPages.ts` (the T74 measurement, ported). The wizard, revise and pages suites pass 22 of 22, twice. A long offer lays out to 30 pages at 1440 px inline and 91 pages in the 1024 px Drawer; a mutation of the frame top (120 → 140) fails the frame journey.
- **Open at T74:** at Drawer widths (320 and 1024 px) a cost table's header and first row can be taller than a page body, so under R7 a section heading may end a page. Accepted under the plan's fixed relaxation order and written into AC-11.11 (cb3ac6bd). Owner review.

## Consequences

**Positive:**
- The offer is one run of text in one tree: find, copy, selection and the screen reader see the document, not the pages
- The letterhead is one fetch and one decoded image, drawn on every page
- The breaks follow the PDF's rules, so the two outputs approximate each other from one set of constants

**Negative / trade-offs:**
- The preview's markup is constrained: a new element in the flow must respect the flow invariant, or pagination breaks silently
- Two layouts per settled change; the pure core is cheap, the DOM measurement is the cost (within AC-3.1's 1 s)
- **Text floor (O11, for the owner):** at the default 1280 × 800 layout the inline page is about 488 px wide, so 10 pt body text is drawn at 10 px, about 1.2 times the PDF's relative size. A page holds less text than the PDF's, and the preview has more pages than the PDF. AC-11.2 says the PDF is the authority. The floor is one constant; a lower floor, or a wider pane, is a later choice with no other work

**Risks:**
- **A future element breaks the flow invariant without failing any unit test.** Mitigation: the static class scan in the tests, and the in-page measurement in the e2e journeys. A change that moves a line into a margin fails the frame journey.
- **The PDF's page rules change and the preview does not follow.** Mitigation: the `offerPaper` shared-copy group covers the constants; the breaks follow the same rule list, pinned by vectors in both apps. A rule change is a change to both, in one commit.
- **Browser engines differ on the float model beyond Chromium.** Not measured here: only Chromium was run in the browser (T74, T75). Mitigation: the e2e journeys run in the suite's browser; an engine-specific failure is a new evidence item, not a change to the mechanism.

## Escalation triggers

This decision is revisited when any of these happens:

- a break splits a sentence, adds a text node or places a line in a margin or gap in any browser the suite runs (the in-page measurement finds it);
- a second paginated view is needed in any remote or in `@operai/ui`: the pure core (`placeBreaks`, `realize`, `pageGeometry`) would then move into the shared library (ADR 20261114-operai-ui-shared-singleton-provided-by-the-shell);
- the owner changes the text floor (O11) or the relaxation order (AC-11.11);
- the PDF's frame or type changes in `contractPdf.ts` without the `offerPaper` copies moving with it;
- an engine that the suite supports cannot satisfy the float model in the measurement.

## Compliance notes

- GDPR / data-protection impact: none. No new data flow: the preview draws the text it already drew, from the same request, and the letterhead is one fetch as before.
- Data residency: not applicable. No new hop.
- Audit trail: not required.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
