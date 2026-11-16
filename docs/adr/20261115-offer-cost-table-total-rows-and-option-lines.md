# 20261115 — A cost table prints a total per span of lines, and option lines that no total counts; the stored price stays the one-off figure

**Date:** 2026-11-15  
**Status:** Accepted — the architect's decision under the owner's delegation of 2026-11-15 (specs/20261115-crm-offer-wizard, § Delegated decisions DD-13, DD-14), pending the owner's review; amended 2026-11-15 (post-design, delegated), see § Amended 2026-11-15, which decides the three open points below and the later open decision on a percentage discount with two or more total rows (decided 2026-11-15, delegated: option (a), refused — plan DD-39). It depends on proposed spec amendment SA-1 (AC-4.1, AC-4.3; 018 AC-1.5, AC-3.3), which changes approved text and is listed with the owner's review of the delegated decisions. If the owner refuses SA-1, see Risks.  
**Deciders:** Architect, under delegation from Matteo Codogno (owner of specs/20261115-crm-offer-wizard); pending the owner's review  
**Project:** Operai

---

## Context

The cost table of specs/20261102-crm-offer-document (018) prints one TOTAL row: the one-off lines, minus the discounts. Yearly lines are shown apart. The stored price of an offer, `deal_offer.priceCents`, is set from the same figure (`priceCents = oneOffCents` in `crm-api/src/offers/offers.routes.ts`), and it is what the offers list shows. The seven mockup templates of specs/20261115-crm-offer-wizard print more than one total: T3 "TOTALE primo anno" (the one-off and yearly lines of the first span), T6 "TOTALE primo periodo", and T13 two totals. Some of their lines are optional ("voce a scelta", which the client ticks and which "non entra nel totale"), and the rule "at least one one-off line" would refuse T3 and T6 when they have no activation line. The mockup's discount is a fixed amount ("come importo").

## Decision

We will let a cost table print several total rows, and add a cost-line kind `option`.

1. A total row (`@@total`) prints the sum of the counted lines since the previous total row, or since the top of the table, and it subtracts the discount lines of that span. Counted lines are one-off and yearly lines whose block is on.
2. An `option` line is printed and numbered (as the other non-discount lines are) and priced, but it is in no total and in no stored figure, and it is a line the client may tick.
3. A table is valid with at least one counted line of kind `one_off` or `yearly` (was: `one_off`).
4. The stored `priceCents` stays the one-off figure after discounts, and the yearly figure in the snapshot stays the sum of the yearly lines, as specs/20261102-crm-offer-document defines them (018 D-6). A printed span total is not stored. Money stays integer cents, and the only rounding is a percentage discount's, once, as today.

## Failure shape

**A figure printed under a label is summed over a scope the label does not state, or over a scope the reader does not expect.** A reader takes "TOTAL" or "price" to cover the lines they believe are in it: the yearly lines, the lines the client did not tick, the lines of a block that is switched off. The number can be right for the field it is stored in and still wrong for the words printed beside it, and nothing fails, because each figure is internally consistent with its own rule.

The same shape appears in its mirror-image positions:

- **Inclusion rule at every sum.** A line with a state (a block on or off, an option not ticked, a discount, one-off or yearly) must be counted by the same rule wherever the sum is made: the engine, the renderer, the stored price, the snapshot, the offers list, and any future report. A line counted in one place and not in another is the failure, and it is invisible in each place alone.
- **Stored and printed.** A stored figure and a printed figure from the same offer have the same ancestry and different scopes here (the stored price is one-off; the printed first-year total includes yearly lines). Every consumer of the stored figure, and the client reading the document, must each be able to tell which figure is which. Where a label is not enough, the figure is ambiguous and is effectively wrong for one of its readers.
- **Discount in the inverse direction.** A discount subtracts from a sum, and its base decides what it is a share of. A percentage over a span and a percentage over the whole document are two different figures with the same word. Any rule that uses a percentage must name its base.
- **Empty scope.** A total over a span with nothing counted is a figure with no basis. Printed as zero it reads as a real amount; the mockup prints a dash, which says the figure does not exist.
- **Choice without a total.** When the client ticks an option, the document changes and the figures do not. A write that changes a printed line without changing any sum, and a sum that changes without a printed line, are the same mistake seen from either side.

Recognise it anywhere by: a total or a price whose label does not state its scope; two different figures labelled price or total on two surfaces of one offer; a sum over a list whose items carry a state, computed without the state filter; a zero printed where no figure exists; a validation rule that names a kind the sum does not use; a percentage without a base.

## Options considered

### Option A — Span totals and option lines; stored price unchanged (chosen)

Described in Decision.

**Pros:**
- The seven texts print the totals their authors wrote, with their labels (DD-13)
- The stored price keeps the meaning it has for every offer already generated (AC-9.4)
- Option lines can appear in a contract without changing the price or any total
- Rounding stays one rule, once, at compute time (ADR 20260720-mileage-rate-money-precision-integer-micros posture)

**Cons:**
- Two different "totals" can appear on one offer: a printed first-year total that includes yearly lines, and a stored price that does not
- The offers list can show a one-off price for an offer whose printed first-year total is larger
- A template with yearly lines only stores a price of 0 (the rule admits it, the stored one-off figure is 0)
- A percentage discount is allowed only in a table with at most one total row, where its base is the whole one-off sum as in 018; with two or more total rows only an amount discount is possible (§ Amended 2026-11-15, rule 8). A template author who wants a percentage alongside span totals cannot write one
- A discount in a yearly-only span lowers the stored one-off price while it is printed under a yearly total (R17)

### Option B — The single TOTAL of 018 (rejected)

**Pros:**
- Renderer, stored meaning and tests unchanged

**Cons:**
- Cannot print T3, T6 or T13 as written; the fallback (R5) is to switch the totals off for those three and drop the option line from T1 and T13

### Option C — Classify the recurring lines as one-off, so that one total prints them (rejected)

**Pros:**
- One total per offer, and the printed total matches the stored price

**Cons:**
- The stored price would then include yearly sums, so every existing reader of the price would see a different figure for the same kind of offer; this falsifies the stored figure and is refused for that reason

## Consequences

**Positive:**
- A template prints its own totals and labels; the authors' wording is what the client reads
- Existing offers keep the price and the figures they were generated with (AC-9.4); the change adds kinds and rows and does not re-price anything
- An option line is a priced choice the client makes, and it never silently enters a total

**Negative / trade-offs:**
- The reader of the offers list must know that the stored price is the one-off figure. A list column labelled "price" with no qualifier is the risk this decision leaves in place
- The engine has a second rule to keep identical in its two copies (ADR 20261115-offer-template-self-describing-text-shared-interpreter)

**Risks:**
- **Percentage base: decided 2026-11-15.** A percentage discount exists only in a table with at most one total row, and its base is the whole one-off sum, which is then also its own span (§ Amended 2026-11-15, rules 2 and 8). Both the per-span and the document-wide discount checks apply (rule 3).
- **Empty span: decided 2026-11-15.** A span with no counted line prints "–" and is not an error; "counted" means present, not non-zero (§ Amended, rule 4). A table with no counted line at all stays `no_counted_line`.
- **SA-1 refused by the owner (R5).** T3, T6 and T13 cannot print their totals. The fallback is to switch the totals off for those three and remove the option line from T1 and T13. The engine is unaffected except for the removed kind.
- **A printed total read as the price.** Mitigation: the snapshot stores `costs.rows` (lines and total rows in order) and `costs.labels`, so the printed figures can be re-derived from the snapshot. This decision does not change the offers list's price column or its label; whether that label needs a qualifier is left for the owner's review (see Consequences).
- **R17 — a discount in a yearly-only span lowers the stored one-off price** (§ Amended, Consequences). It is what AC-4.6 specifies and its own example produces (stored one-off 95 000, not 100 000). Flagged for the owner's review of SA-1: none of the seven seeds has a discount in a yearly span.
- **Stored price depends on where the total rows fall, with a percentage discount: decided 2026-11-15, delegated** (§ Amended, Decided — option (a)). A percentage discount is refused in a table with two or more total rows, so the stored price depends on the lines only, as AC-4.6's last sentence requires. Residual risk: a future template that needs a percentage beside span totals; then the choice between (b) and a per-span percentage printed with its base is reopened.

## Amended 2026-11-15 (post-design, delegated)

Source: specs/20261115-crm-offer-wizard, plan § Delegated decisions DD-34 and DD-35 (the span rules C1–C9 in the plan's `engine/costs.ts` contract, pinned by `engine/vectors/costs.spans.json`), read against AC-4.6, AC-4.7 and SA-1. The Decision and the Failure shape above stand. This note decides the three open points of the 2026-11-15 text and records two consequences that the delegation did not state.

**Rules (normative).**

1. **Span.** A span is the rows since the previous total row, or since the top of the table, up to the total row. A table with no total row is one span, which is 018's base exactly.
2. **Percentage base (C3).** A percentage discount is a share of the whole one-off sum, as in 018. It exists only in a table with at most one total row (rule 8); there the whole table is one span (rule 7 puts every counted and discount line before the last total row), so the base is also the discount's own span. Counted lines are the one-off and yearly lines whose block is on; option lines are never counted. *(As first written 2026-11-15 the base was the one-off lines of the discount's own span in any table; superseded by rule 8.)*
3. **Discount checks, both (C5, C6).** Per span: Σ discounts of the span ≤ Σ counted lines of the span, else `discounts_exceed_span` at the span's first discount, so no printed total is negative. Document-wide: Σ every discount ≤ Σ every one-off line, else `discounts_exceed_one_off` at the last discount, so the stored price is never negative. For a single span of one-off lines the two are one check, which is 018's check.
4. **Empty span (C7).** A span with no counted line prints "–" (U+2013) in the preview and the PDF. It has no figure and is not an error. "Counted" means a one-off or yearly line is present with its block on, not that its value is non-zero: a span holding a 0.00 line prints 0.00. A discount in a span with no counted line is refused by rule 3, not printed as "–". A table with no counted line at all is `no_counted_line`.
5. **Missing value (C8).** A span with a missing value is incomplete: no partial sum is printed, its per-span checks wait, and generation is blocked by the missing value itself.
6. **Percentage without base (C4).** A percentage discount in a table with at most one total row and no one-off line is `discount_without_base`, reported at the discount. It is never printed as "– 0.00". A percentage already refused by rule 8 is not checked again.
7. **Order of the table (DD-35).** A one-off, yearly or discount line after the last total row is `cost_line_after_last_total`; option lines may follow the last total row. The person's extra lines (AC-4.3) go immediately before the last total row, or at the end when the table has none.
8. **No percentage discount with two or more total rows (C3, plan DD-39; decided 2026-11-15, delegated).** Total rows are counted as present after block resolution, whatever the "show totals" switch says (a display switch never decides whether an input is valid). In the template, a declared `unit=<n>%` discount in a costs table with two or more declared `@@total` rows (in a block or not) is the error `percent_discount_multi_total` at that line, and the template cannot be saved. In the answers, a discount entered as a percentage — a template `unit=?` line, or a line the person added — in a table with two or more total rows present is the `invalid` entry `percent_discount_multi_total` at that line; no amount is computed from it, its span is incomplete and the stored figures wait, so generation is refused. Invariant: `oneOffCents` and `yearlyCents` depend on the lines only, never on where the total rows fall.

**Consequences for the stored figures.**

- **R17 — a discount lowers the stored price wherever it sits.** `oneOffCents` is Σ one-off − Σ every discount, so a discount in a yearly-only span lowers the stored one-off price while it is printed under a yearly total. AC-4.6's own example does this: the 50.00 discount sits in the span of 200.00 yearly, the stored one-off price is 95 000 (not 100 000), and `yearlyCents` (70 000) is not reduced. The spec mandates it ("computed as in 018") and the vector pins it. It is flagged for the owner's review of SA-1. The mockup's four discount rows each sit directly above a plain "TOTALE", so no seed has this case.
- **The two discount kinds differ.** An amount discount is accepted in any span, including a yearly-only one, where it lowers the stored price (R17). A percentage discount is refused in any table with two or more total rows (rule 8) and, with at most one, in a table without one-off lines (rule 6). Both follow from the rules, and a template author should expect the difference.
- **A yearly-only table stores a one-off price of 0.** With no discount it is valid. With any discount it is refused by rule 3's document-wide check, because there is no one-off line to subtract from.

**Decision — a percentage discount in a table with two or more total rows. Decided 2026-11-15, delegated: option (a)** (specs/20261115-crm-offer-wizard decisions.md, last entry; plan DD-39; rule 8 above). Recorded under the owner's delegation, pending the owner's review with SA-1.

The question as it was open: the first-written rule 2 (own-span base) made the stored price depend on where the total rows fall. Take the lines one-off 1 000.00, one-off 500.00, a 10 % discount. With the rows ordered "one-off 1 000.00 · TOTAL A · one-off 500.00 · 10 % discount · TOTAL B", TOTAL A prints 1 000.00, TOTAL B prints 450.00, and the stored price is 1 450.00. With the rows ordered "one-off 1 000.00 · one-off 500.00 · 10 % discount · TOTAL", the printed total and the stored price are both 1 350.00. The lines are the same and only the total rows moved. This breaks AC-4.6's last sentence ("do not depend on where the total rows fall") and its "computed as in 018", because 018's base is the whole one-off sum. It is this ADR's own failure shape, in the stored figure. The options are:

- **(a) Refuse a percentage discount in a table with two or more total rows. Chosen.** It costs the seven texts nothing, because the mockup's discount row is an amount ("come importo"). With one total row or none, the span is the whole table, so the stored price does not depend on placement and equals 018's. In the example above, the first ordering is refused (`percent_discount_multi_total` at the discount) and the second stores and prints 1 350.00.
- **(b) Base every percentage on the whole one-off sum, as 018 does.** Rejected. The stored price then matches 018 and does not depend on placement, but a span total's percentage is a share of a base outside its span, which its label does not state: the failure shape moves from the stored figure to the printed one.
- **(c) Keep the span base and amend AC-4.6's last sentence** to admit that the stored price depends on placement. Rejected: it accepts the failure shape in the stored figure and weakens an approved AC to fit the plan.

The vectors for tables with two or more total rows are pinned on rule 8 (plan § Engine contracts, `vectors/costs.spans.json`): the example above in both orderings, the placement-invariance case with an amount discount, and the refusal for a template line and for a person's extra line. Revisit if a template needs a percentage discount beside span totals.

## Compliance notes

- GDPR / data-protection impact: none. Figures are business data, held as integer cents.
- Data residency: compliant; no change to where data is processed or stored.
- Audit trail: not introduced by this decision. A wizard offer's snapshot records the rows and labels it printed (`costs.rows`, `costs.labels`, plan § Data model), so its printed figures can be re-derived; legacy snapshots are unchanged.

---

*This ADR was generated during a WellForge spec-driven session. Review and amend before committing.*
