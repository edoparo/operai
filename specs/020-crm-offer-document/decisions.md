# Decisions — specs/020 CRM offer document

**D-1 — The letterhead is an uploaded PDF background (owner, 2026-11-02).**
- Whoever owns the brand keeps the graphics, and a new letterhead needs no release.
- Rejected: drawing the logo and footer in code.

**D-2 — The page-number corner is painted white.**
- The clean letterhead (2026-11-02) has an empty body but still prints "1/1" at the bottom
  right. The renderer paints that corner white and writes `n/N` there.
- A letterhead with text or a watermark in the body is not supported.

**D-3 — Offer kinds are editable templates, not fixed types.**
- The owner first chose fixed types, then sent four examples:
  - section 3 is either "SLA" or "Attività e tempistiche";
  - section 5 sometimes adds "garanzia, manutenzione";
  - definitions, conditions of supply and validity vary from offer to offer;
  - AELCO puts a table inside the object.
- A fixed set of sections, with types that only change the prefill, cannot reproduce all
  of them. A template, that is an ordered list of headed sections per entity and language,
  can.
- Four templates are seeded from the examples. Rejected:
  - fixed types in code, because every new kind of offer would need a release;
  - standard texts plus overrides per type, which is harder to understand than a full
    template.

**D-4 — Effort detail as an optional Annex A (owner).**
- The contract body quotes a fixed price, as every example does. The man-days go to an
  annex, with no prices.
- A ready estimate stays required for every offer (owner), even when the annex is off.

**D-5 — Numbering `NNNN/YYYY` with an `rN` revision (owner).**
- The number is per entity and per year, taken from a counter row inside the generation
  transaction.
- The first generation has no suffix (`0017/2026`); later ones add `r1`, `r2`…
- A deal keeps its number for all its revisions, even across a year change.

**D-6 — The stored price is the one-off total, net of discounts.**
- Yearly lines are recurring, so they are shown apart.
- The deal amount stays the salesperson's figure and is never overwritten.

**D-7 — The total row is a switch, with its default set by the template.**
- AELCO (one line) and Cornèr (line and discount) print "TOTALE"; DroneVia and LWP (one-off
  and yearly lines) do not.
- Studio V does not print it either, with three one-off lines and no yearly one, so no
  rule derived from the lines fits every example. This replaces the earlier rule, "printed
  when there is no yearly line".

**D-8 — The index is printed only with Annex A.**
- The 17-page DroneVia offer has one. The shorter ones (4–6 pages) do not.

**D-9 — Placeholders are resolved in the draft, not at render time.**
- The user sees and edits the final text, so the document prints exactly what was
  reviewed, and the snapshot holds plain text.

**D-10 — A discount is a kind of cost line.**
- A discount line has no position, is printed as "- 3'000", and reduces the one-off total.

**D-12 — Città di Lugano adds four details, all inside the template model.**
- An editable client block, because a department line is not a company field.
- `*italic*`, for clauses such as the TIC general-conditions reference.
- A second cost-table layout with unit price and quantity, for packages. A cost line
  always has a quantity, 1 by default.
- An optional acceptance label ("Il Cliente").

**D-11 — Deal PDFs can be appended as annexes (proposal).**
- Cornèr's Annex A was a separate PDF listed under "Allegati:".
- crm-api reads attachment bytes to append them. This is a second service reading object
  bytes, so ADR-0057 records the bounded-read rule: total size is checked from the DB
  before any download.

**D-13 — Studio V ties the offer to the estimate's releases.**
- The phases of a phased fixed price are the estimate's releases. A template cost line can
  therefore expand into one line per release, splitting the deal amount by expected
  man-days. The draft only prefills these lines, and the salesperson adjusts them.
- `{phases}` lists each release with its epics, and `{timeline}` gives a range of months
  for each one, from the best case to the worst case.
- `{timeline}` needs the elapsed chain of the estimate model in crm-api: PERT, risk,
  planning, parallelism, FTE and working days per month. crm-api already mirrors the
  expected-effort part of `useEstimator.ts` in `scope.ts`, with shared test vectors. The
  elapsed chain is mirrored the same way, as one more set of shared vectors, so that the
  two cannot drift.
- Annexes are lettered A, B… in order. Studio V's two PDFs are "Allegato A" and
  "Allegato B".
- `__underline__` is added, because the warranty sentence is underlined in AELCO and in
  Studio V.

**D-14 — Cornèr's consulting offer: columns as switches, percentage discounts, man-days
quantity.**
- The examples combine the columns differently:
  - Città di Lugano has unit price and quantity but no position;
  - Cornèr's consulting offer has all three columns;
  - the other examples have only a position.

  So the cost table has two independent switches, replacing the two fixed layouts.
- A discount can be a percentage of the one-off sum. It is computed and rounded once, at
  generation time, as money is everywhere else (ADR-0025 posture).
- A "giornate" offer takes its quantity from the estimate's man-days, so the draft
  prefills it. The daily rate is a fixed amount in the template.
- Column labels follow the latest example (`CHF / unità`, `Qt.`). Città di Lugano's
  longer labels are not kept.
