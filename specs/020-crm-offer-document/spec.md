---
id: 020
slug: crm-offer-document
status: approved
approved: 2026-11-02
rigor: mvp
created: 2026-11-02
depends-on: 018
---

# CRM offer document — wellD's letterhead and offer templates

> **Origin.** On 2026-11-02 the owner supplied the letterhead of wellD Sagl and seven
> documents that wellD actually sent, as the model for the generated offer:
>
> | Reference | Client | What it is |
> |---|---|---|
> | 0019/2026r1 | DroneVia | Fixed-price project, with an annex and an index |
> | 0017/2026 | Lugano Wealth Partners | One-off takeover plus a prepaid yearly SLA |
> | 0011/2026 | Cornèr Banca | Training course with a discount and a separate PDF annex |
> | 0005/2026r1 | AELCO | MVP without maintenance: activities and timing instead of an SLA, a feature table, a warranty |
> | 0012/2026 | Città di Lugano | Change request at a fixed price with a maintenance package: a department line in the address, an italic clause, a cost table with unit price and quantity |
> | 0009/2026 | Studio V | Fixed price in phases: one cost line per phase, a timing table with a range of months per phase, billing per phase, two PDF annexes |
> | 0010/2026 | Cornèr Banca | Consulting by the day, billed on actuals: unit price × days with positions, a 10 % discount, monthly billing on a timesheet |
>
> A maintenance annex completed the set; it confirms the general conditions.
>
> The owner chose:
> - **Letterhead:** a PDF uploaded for each entity in the CRM settings, used as the
>   background of every page.
> - **Structure:** the supply-contract structure of the examples.
> - **Offer kinds:** the generate dialog starts from a kind, which prefills everything.
> - **Estimate:** every offer still needs a ready estimate (specs/018), unless an admin let
>   the deal go without one. The effort detail becomes an optional "Annex A".
> - **Reference:** `0017/2026` for the first offer, then `0017/2026r1`, `r2`… for later
>   revisions.
>
> The seven examples share a skeleton: client block, title, opening, nine numbered sections,
> cost table, acceptance block. They differ in the headings and content of almost every
> section. For example, section 3 is "SLA" in three of them and "Attività e tempistiche" in
> AELCO, and section 5 is "Risorse, garanzia, manutenzione" in AELCO. A fixed set of
> sections cannot hold all seven. **Offer kinds therefore become offer templates:** wellD
> edits them in the CRM settings, and seven are seeded from the examples.
>
> This spec replaces the document layout of specs/018 AC-4.1. The rest of 018 US-4 is
> unchanged: versions, storage, download, delete and AC-4.6.

## Problem

The offer that specs/018 generates is a one-page summary on a plain header: effort table,
price, terms, signatures. wellD's real offers are contracts on the company letterhead. Each
has numbered sections whose text depends on the kind of work, a cost table, an acceptance
block and sometimes annexes. As things stand, a generated offer cannot be sent: someone
rewrites it in a word processor, and the version actually sent is once again kept outside
Operai.

## Domain language

- **letterhead** — a one-page PDF per entity containing only the header (logo) and the
  footer (company, address, contacts). The CRM draws everything else, page numbers
  included.
- **offer template** — a named starting point for an offer, owned by one entity and
  written in one language. It holds:
  - the salutation;
  - the opening paragraphs;
  - an ordered list of sections, each with a heading and a body; exactly one of them is the
    costs section;
  - the default cost lines;
  - whether Annex A is on by default;
  - the cost table's optional columns (AC-1.5);
  - an optional label above the signature lines ("Il Cliente").

  Examples: "Progetto a corpo", "Una tantum + SLA prepagato", "Formazione",
  "MVP senza mantenimento", "CR a corpo con pacchetto manutenzione".
- **cost line** — one row of the cost table: a description, a unit amount, a quantity
  (1 unless the layout shows it) and a kind. Its total is unit amount × quantity.
  - `one_off`: charged once.
  - `yearly`: charged every year.
  - `discount`: subtracted from the one-off lines, either as an amount or as a percentage
    of their sum (Cornèr's "Scontistica riservata 10%").
- **offer number** — `NNNN/YYYY`, the next free number of the entity in the year of the
  deal's first offer.
- **revision** — none on the first generation, then `r1`, `r2`… on the same deal.
- **reference** — the offer number followed by the revision: `0017/2026`, `0005/2026r1`.

## User stories and acceptance criteria

### US-1 The offer looks like wellD's offers

- **AC-1.1** Every page of the PDF has the entity's letterhead as background and its body
  inside the letterhead's free area. The page number `n/N` is at the bottom right.
- **AC-1.2** Page 1 shows, from top to bottom:
  1. The template's salutation ("Spett.le", "Spettabile", "To").
  2. The client block: the first line in bold, then the others. The dialog prefills it
     from the company and the user can edit or add lines, such as a department
     ("Divisione informatica"):
     - the legal name (the company's legal name if set, otherwise its name);
     - the street;
     - the postal code and city, as entered (for example `IT-23807 Merate (LC)`);
     - the country, in the offer's language.
  3. "A.c.a." / "Attn." in bold, with the chosen contacts (zero to five, comma-separated).
  4. The place and date, on the right: `Lugano, 9.2.2026`, with no leading zeros on the day
     and the month.
  5. The title, centred and in bold: "CONTRATTO DI FORNITURA – Rif. 0005/2026r1" /
     "SUPPLY CONTRACT – Ref. 0005/2026r1".
  6. An index of the sections with page numbers, only when the offer has Annex A.
  7. The opening paragraphs.
- **AC-1.3** Then come the offer's sections, numbered 1, 2, … in order, with upper-case
  headings. Their sub-headings are numbered within the section: `4.1`, `9.3`. The costs
  section prints the cost table first and its body (the notes) after it.
- **AC-1.4** After the sections:
  - "Per accettazione" / "Acceptance";
  - the template's acceptance label, when set ("Il Cliente", as in LWP and Città di
    Lugano);
  - "Luogo e data:" / "Place and date:", with a line to fill in;
  - "Firma valida del Cliente:" / "Valid signature of the Client:", with a line to fill in;
  - "Allegati:" / "Annexes:", with one bullet per annex, when there are any (AC-1.7).
- **AC-1.5** The cost table has a shaded header row. *Voce di costo* and *Totale
  <currency>* (*Item*, *Total <currency>*) are always printed. Two groups of columns are
  switched on or off by the template, and the offer can override them:
  - **Position**, *Pos.*: one-off and yearly lines are numbered 1, 2, …; discount lines get
    no number. Città di Lugano has no position column; the other examples do.
  - **Unit price and quantity**, *<currency> / unità · Qt.* (*<currency> / unit · Qty*):
    a line's total is unit amount × quantity, in integer cents (Città di Lugano, Cornèr
    consulting). Without these columns, every quantity is 1.

  A discount is printed as `- 2'400`. A percentage discount:
  - is computed on the sum of the one-off lines, rounded half up to the cent, once;
  - shows `10%` in the unit column, or appends ` (10%)` to the description when that
    column is off.
  - **Total row:** a bold "TOTALE" / "TOTAL" row (one-off lines minus discounts), printed
    when the offer's "show total" switch is on. The template sets the default. No rule
    fits all the examples: AELCO and Cornèr print it, while Studio V does not, although it
    has three one-off lines and no yearly one.
  - **Amounts:** whole units when there are no cents, otherwise two decimals. Thousands
    are grouped as the entity groups them: `7'000`, `36'300`.
- **AC-1.6** Template and offer texts support the following markup, which is enough to
  write every section of the examples:
  - paragraphs;
  - `- ` bullets;
  - `1. ` and `a. ` lists, nested by indenting two spaces;
  - `**bold**`, `*italic*` and `__underlined__` runs (Città di Lugano's TIC clause is
    italic; the warranty in AELCO and Studio V is underlined);
  - `### Title` for sub-headings;
  - simple tables: `| a | b |` rows, with the first row as the header and `<br>` for a
    line break inside a cell (AELCO's feature table).

  Placeholders are replaced when the dialog is prefilled, not at render time, so the user
  sees and can edit the result:
  - `{deal}` — the deal title;
  - `{issuer}` — the entity's legal name;
  - `{currency}` — the deal's currency (`140 {currency}/ora`);
  - `{client}` — the client's legal name;
  - `{epics}` — a numbered list of the estimate's epics;
  - `{phases}` — a bullet per release of the estimate, as "<release>: <epic>, <epic>, …"
    (Studio V's phase list);
  - `{timeline}` — a table "Fase | Stima mesi lavorativi" with one row per release,
    giving the elapsed months from the best case to the worst case, rounded
    (`5 - 6`, or `4` when the two are equal). It uses the release chain of the estimate
    model (AGENTS.md § Estimation model) with the estimate's own parameters;
  - `{manDays}` — the estimate's total man-days, rounded half up to whole days (the
    AI-assisted figure when the offer is AI-assisted);
  - `{validityDays}` — the offer's validity in days.
  - `{release}` — in a per-release cost line's description only: that release's name.

  Nothing else is interpreted.
- **AC-1.7** Annexes are lettered A, B, C… in this order and listed under "Allegati:" as
  "Allegato A - <title or file name>":
  - **Annex A — effort detail**, if the offer includes it. It starts on a new page after
    the contract and shows the estimate's releases and epics with man-days to one decimal,
    the total, and the AI-assisted note when it applies. It shows no price.
  - **Deal attachments chosen in the dialog**: PDFs only, at most 5, listed by file name.
    They are appended after the contract and Annex A, page by page and unchanged (no
    letterhead, no page number).

### US-2 Letterhead and templates are set once per entity

- **AC-2.1** In Settings, a `deal:manage` holder of an entity can manage that entity's
  letterhead:
  - upload it: a PDF of one A4 page, at most 5 MiB;
  - see when and by whom it was uploaded;
  - download it;
  - replace it.

  They can also edit the entity's place of issue ("Lugano").
- **AC-2.2** In Settings, the same person manages the entity's offer templates:
  - list them;
  - create one, or duplicate an existing one;
  - edit one: name, language, salutation, opening, sections (add, remove, reorder, edit
    the heading and body, choose the costs section), default cost lines, cost table
    layout, acceptance label, Annex A on or off;
  - archive one. An archived template is hidden from the dialog, and offers already
    generated keep their snapshot.
- **AC-2.3** An entity with no templates is seeded with fourteen: the seven examples in
  Italian, with every client-specific detail removed, and their English translations.
- **AC-2.4** Without a letterhead, the offer is still generated: the entity's legal name and
  address are drawn as header and footer, as in specs/018.
- **AC-2.5** crm-api checks that the uploaded letterhead is a PDF it can read with exactly
  one A4 page. Otherwise it answers `422 letterhead_invalid`, and the previous letterhead
  stays.

### US-3 The dialog starts from a template

- **AC-3.1** The dialog first asks for one of the deal entity's active templates. crm-api
  then builds a draft from it, with the placeholders replaced: the salutation, the opening,
  every section, the cost lines, the "show total" and Annex A switches. A default cost line
  takes either the deal amount or a fixed amount, or expands into one line per release of
  the estimate ("per phase"), with the deal amount split across them in proportion to each
  release's expected man-days, rounded to whole units, with the remainder on the last
  line. The draft fills the dialog.
- **AC-3.2** Everything the document prints can be edited for this offer only: the
  section headings and bodies, the cost lines and layout, the contacts, the annexes, the
  salutation, the client block and the acceptance label. Sections can be added, removed and reordered, exactly as in a template.
  Choosing another template replaces the fields, after a confirmation.
- **AC-3.3** Limits:
  - **sections:** 1 to 15, exactly one of them the costs section; heading 1–120
    characters, body 0–20 000;
  - **opening:** 1–5 000 characters;
  - **client block:** 1–8 lines, each 1–200 characters;
  - **cost lines:** 1 to 10, at least one of them `one_off`;
    - description: 1–200 characters;
    - unit amount: ≥ 0 in the deal's currency (a discount is entered as a positive
      amount), or, for a discount only, a percentage from 0.01 to 100 with two decimals;
    - quantity: a whole number from 1 to 100 000;
    - the discounts may not exceed the one-off lines;
  - **contacts:** at most 5, all from the deal's company;
  - **attachments:** at most 5, all PDFs of this deal, at most 20 MiB together.
- **AC-3.4** The offer's stored price is the one-off lines minus the discounts. The offers
  list shows any yearly lines next to it, as "+ CHF 2'500 per year".
- **AC-3.5** Validity is still asked for and stored as in specs/018. The document prints
  it only where a text uses `{validityDays}`, as AELCO's section 7 does.
- **AC-3.6** Every offer still needs a ready estimate (specs/018), whatever its template.
  - Exception (2026-11-05): a deal whose estimate gate an admin overrode (specs/018 AC-3.7)
    gets an offer without one. Scope, man-days and timeline are left empty, there is no
    annex and no AI-assisted choice; the person writes the scope and sets the costs.
- **AC-3.7** The offer's snapshot stores everything the dialog sent, including the
  template's id and name.

### US-4 Offers are numbered like wellD's

- **AC-4.1** A deal's first offer takes the next number of its entity in the current year,
  starting from 1, printed with four digits and no suffix: `0017/2026`. Every later
  generation on the same deal keeps that number and year and adds `r1`, `r2`…, even when it
  happens in a later year.
- **AC-4.2** Numbers never collide, even when two offers are generated at the same time,
  and are never reused. A deleted revision leaves its gap (018 AC-4.4).
- **AC-4.3** Offers generated before this spec keep their `OF-…` reference and their PDF.

### US-5 The client's details are complete

- **AC-5.1** A company gains optional `legalName`, `street` and `postalCode` fields. They
  are edited in the company form and shown on the company page.

### US-6 Copy

- **AC-6.1** All new UI copy exists in English and Italian. The seeded templates exist in
  both languages.

### US-7 An offer is edited until it is sent, then revised (owner, 2026-11-04)

A mistake found before the offer leaves wellD is corrected in place; once the client has it,
a change is a new revision, so the document the client holds is never rewritten.

- **AC-7.1** While a deal's newest offer has not been marked sent, no new revision can be
  generated (409 `offer_not_sent`); the offer is edited instead. A deal's first offer, and the
  first one after an offer from before this spec, are generated as before.
- **AC-7.2** Editing an unsent offer opens the dialog with that offer's own content (texts,
  cost lines, contacts, still-stored PDFs, validity) and, on save, regenerates its PDF under
  the same reference and version number, dated the day of the edit. Only the newest offer is
  edited; two people editing at once cannot overwrite each other (If-Match, ADR-0038 posture).
- **AC-7.3** "Mark as sent" (specs/018 AC-4.6) now records on the offer when and by whom it
  was sent, and the list shows it. A sent offer can no longer be edited (409 `offer_sent`).
  The deal still moves to "Offer sent" when it was before it.
- **AC-7.4** Once the newest offer is sent, "New revision" opens the dialog with the sent
  offer's content; generating it adds the next revision (`r1`, `r2`…), and the sent one stays
  as it is. Changing the template there still replaces the fields after a confirmation.
- **AC-7.5** Offers of deals already at "Offer sent", won or lost when this ships count as sent.

### US-8 The numbering continues from wellD's document system (owner, 2026-11-04)

Offers were numbered from 1 in the CRM while wellD's documents are already further on; the
two must not collide.

- **AC-8.1** In Settings, for each entity they manage deals for, a person sets the next
  offer number of the current year (1–9999). The entity's next new offer takes it; later
  ones follow it. Revisions keep their deal's number (AC-4.1) and are not affected.
- **AC-8.2** The number can never be set to one an offer of that entity and year already
  carries, a deleted one included (AC-4.2): 409 `offer_number_used` naming the lowest
  allowed. A number never printed may be set lower again.
- **AC-8.3** The current year or the next may be set (the API takes either); past years are
  closed. It needs `deal:manage` over the entity and `deal:financials`, like the rest of the
  entity's offer settings.

## Non-goals
- A visual (WYSIWYG) editor. Texts are written in the markup of AC-1.6.
- Colours, images or hyperlinks in the body.
- Fonts other than the standard Helvetica. Characters outside WinAnsi still print as "?"
  (018 risk).
- Signing the offer in Operai, or a supplier signature block.
- A letterhead with a different first page.
- Appending files that are not PDFs.
- Templates shared between entities.

## Open questions
- **O1 — resolved (owner, 2026-11-02).** The clean letterhead has no body text but still
  prints "1/1" at the bottom right. The renderer paints that corner white and writes `n/N`
  there (D-2).
