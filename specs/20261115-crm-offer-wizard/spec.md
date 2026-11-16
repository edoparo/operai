---
id: 20261115
slug: crm-offer-wizard
status: done
approved: 2026-11-15
done: 2026-11-16
rigor: production
created: 2026-11-15
amends: 20261102
---

# CRM offer wizard — a guided offer built from the template

> **Origin.** The people who prepare offers found the template system of specs/20261102-crm-offer-document
> hard to use: every offer starts as a long text that must be read and edited by hand,
> section by section, to find what changes for this client. Working with them, wellD
> produced a mockup of a wizard (`WellD_OperAI_Wizard_Offerte.html`, 2026-11-14). It is the
> **UX reference** for this spec, not code to adopt. Decisions taken by the owner on
> 2026-11-15 are marked *(owner)*.
>
> **What this amends in specs/20261102-crm-offer-document:**
> - **Kept:** letterhead, page layout, numbering, revisions, sent/edit lifecycle, annexes and
>   cost-table rendering (US-1 except AC-1.6, US-4, US-5, US-7, US-8, AC-2.1, AC-2.4, AC-2.5,
>   AC-3.4 to AC-3.7).
> - **Replaced:** the template's content and markup (AC-1.6), template management (AC-2.2),
>   the seed (AC-2.3) and the generate dialog (AC-3.1 to AC-3.3).

> **Amendments (2026-11-15, applied unattended on the owner's delegation; confirmed by the
> owner (2026-11-15) after review).** Six corrections to ACs that contradicted AC-9.1 (the seven mockup
> templates must work), proposed in the plan's "Proposed spec amendments" (SA-1 to SA-4) and
> found by the fidelity test (SA-5). Each changed or added AC carries a marker naming its
> amendment.
> - **SA-1** — cost table: several labelled total rows, option lines, and "at least one
>   one-off *or yearly* line" (AC-4.1, AC-4.3, new AC-4.6, AC-4.7).
> - **SA-2** — template fields: the `amount` kind, text fields with a fixed list of options,
>   and options or blocks that fill other fields (domain language, AC-1.3, AC-8.1, new
>   AC-1.8, AC-1.9).
> - **SA-3** — an invalid answer blocks generation like a missing field (AC-3.5, new AC-3.6).
> - **SA-4** — "the mockup's texts" holds except for a stated list of print differences
>   (AC-9.1, new AC-9.6); with it, the text annexes that the resolution of O1 needs (new
>   AC-9.5, delegated decision DD-2).
> - **SA-5** — three more print differences found by the fidelity test, listed in AC-9.6:
>   the decimal comma of Italian number fields, the amount format and a discount row's unit
>   and quantity, and where a row added by the person is printed. Chosen over changing the
>   frozen engine; open question O4 asks whether the first should change in a follow-up.
> - **SA-6** — two field labels that named "CHF" ("Risorse a tempo" tariff, "Formazione"
>   additional-participant price) are written without a currency, so AC-2.5 holds for a
>   non-CHF deal; extended to field hints and examples (the "Formazione" AI-budget example
>   "es. 25 EUR" reads "es. 25"); listed in AC-9.6 (QE defects D4 and D8).
>
> Open questions O1 and O2 are resolved by the plan, also on delegation (see the end).

> **Amendments (2026-11-15, owner).** Two requirements added by the owner after testing the
> wizard by hand, **reviewed and approved by the owner on 2026-11-15**: US-11 and US-12 as
> written (the first-page-only letterhead included, since superseded by OA-3 below), with the
> issuer's address bound too (see OA-2). Unlike SA-1 to SA-6 they are the owner's own
> decisions, not delegated ones; each new or changed AC is marked "(added 2026-11-15, owner)"
> or "(changed 2026-11-15, owner)". The scope frozen at gate 1 is extended on purpose, and
> only by these amendments.
> - **OA-1 — the letterhead behind the HTML preview.** New US-11 (AC-11.1 to AC-11.9). The
>   owner chose to draw the entity's letterhead as the background of the HTML preview, over a
>   fuller "Generate a PDF preview", which they declined. They were told it looks closer to the
>   PDF but is not exact (margins and page breaks still differ) and adds a PDF renderer in the
>   browser. Changed: AC-3.2 (what "same content" excludes), AC-8.5 (the editor's "Try the
>   wizard"). On review the owner accepted that the preview's text may run over the
>   letterhead's graphics on the first page (O5, accepted as risk) — **superseded by OA-3**.
> - **OA-2 — the issuer's legal name and address come from the entity profile, never from a
>   seeded template's text.** New US-12 (AC-12.1 to AC-12.13). The seeded templates hardcoded
>   "WellD Sagl" while the profile's legal name reads "wellD SA". On review the owner chose to
>   bind the issuer's address too (AC-12.9 to AC-12.13): the SLA annex's parties table printed
>   a fixed street address. Changed: AC-9.6 (two more print differences from the mockup). A
>   template written or edited by a person keeps its literal names and addresses and nothing
>   detects them (O6, accepted as risk).
> - **OA-3 — the preview is split into real A4 pages (2026-11-15, owner).** The owner tested
>   the letterhead preview and found the text running over the letterhead's graphics (O5, which
>   had been accepted as a risk). Offered three options, they chose **"Real A4 pages"**: the
>   preview is split into A4 pages with the letterhead behind each page, as the PDF draws it,
>   the text inside the PDF's frame margins, and page breaks that approximate the PDF's —
>   accepting that breaks can still differ from the real PDF, which stays the authority.
>   Rejected by the owner: a header strip only; a full first page with frame margins. Changed:
>   AC-3.2 (page breaks approximate, no longer "may differ"), AC-11.1 to AC-11.6, AC-11.8 and
>   AC-11.9 (every page, not the first only; the pages keep their frame in every letterhead
>   state), the caption of AC-11.2 (en and it), Non-goals (the letterhead on every page and the
>   PDF's margins are no longer excluded), Constraints. Added: AC-11.10 (the frame), AC-11.11
>   (what a page break guarantees), AC-11.12 (reading order and assistive technology) and
>   AC-11.13 (narrow widths, zoom and text size). O5 is closed as superseded; O8 is new.
> - **OA-3 follow-up — three readings settled by the plan, applied under the owner's standing
>   delegation (2026-11-15, "continua fino alla fine senza chiedermi nulla"; owner to
>   review).** The plan (§ Amendment OA-3, O11 to O13; decisions.md "Plan amendment OA-3 +
>   M-4") found that the 12 px floor of AC-11.13 roughly doubles the page count in the inline
>   pane of the default 1280 × 800 layout, and that two lines of AC-11.11 contradicted its own
>   rules. Changed, none added or removed: **AC-11.13** (the text floor is **10 CSS px**,
>   superseding 12 px; O8 resolved), **AC-11.11** (no page is blank, and a page ends early only
>   where a keep-together rule or an annex start moves content on; a table row taller than a
>   page continues at a line boundary, nothing lost). Each is marked "(changed 2026-11-15,
>   delegated)".
> - **M-4 — an unusable letterhead (2026-11-15, applied under the owner's standing
>   delegation; confirmed by the owner 2026-11-15).** The security fix M-4 (decisions.md "Plan amendment OA-3 +
>   M-4"; plan DD-76) makes crm-api answer 409 `letterhead_unusable` on the letterhead link
>   and on both generate routes when the stored letterhead fails the decoded-size bound, so an
>   offer cannot be generated until the letterhead is uploaded again. AC-11.4's failed band
>   ("still added in the PDF") is false for that cause (design finding G18). Changed, none
>   added: **AC-11.4** gains a paragraph for this cause (its own band copy, the same page
>   frame, Generate blocked with that reason); the wording for a fetch or render failure is
>   kept. Marked "(changed 2026-11-15, delegated)". The AC count is unchanged at 79.
> - **AC-11.11 relaxation order (2026-11-15, applied under the owner's standing delegation;
>   confirmed by the owner 2026-11-15).** decisions.md (T73 ladder R3, R2, R5, R4; T74 "open, orchestrator") and
>   plan DD-68 (R7) fix an order in which the keep-together rules give way when one cannot be
>   met even on an empty page. Changed, none added: **AC-11.11** gains one bullet stating that
>   order and its limits. Marked "(changed 2026-11-15, delegated)". The AC count is unchanged
>   at 79.
> - **OA-4 — the preview prints the PDF's page number and hides the letterhead's own
>   (2026-11-15, owner).** The owner saw that the letterhead PDF's own baked-in "1/1" shows on
>   every preview page, while the generated PDF paints a white box over that corner and prints
>   the real "N/M" there (`crm-api/src/offers/contractPdf.ts` `NUMBER_CORNER`, `NUMBER_RIGHT`,
>   `NUMBER_BASELINE`). The owner chose to close this feature with the preview doing exactly
>   what the PDF does: paint the same corner over the letterhead and print "N/M" in the same
>   place and style on every preview page. N is the preview page and M the preview's page
>   count, so it can differ from the PDF's; the PDF is the authority and the caption of AC-11.2
>   already says the breaks are approximate. Mirroring the PDF, the number is printed always
>   and the corner is painted only when a letterhead is shown. The letterhead configurator —
>   a SEPARATE Operai service, with its own backend, callable by the other services (refund,
>   CRM, projects and others) to obtain an entity's letterhead, header, footer and
>   page-numbering configuration, retiring the uploaded letterhead PDF — is the NEXT spec and
>   out of this feature's scope. Changed, none added: **AC-11.10** and **AC-11.12**, AC-3.2
>   (what "same content" excludes), Non-goals (page numbers and page count are no longer
>   excluded; the configurator is recorded) and Constraints. Marked "(changed 2026-11-15,
>   owner)". The AC count is unchanged at 79.
> - **Owner review (2026-11-15).** The owner confirmed, as they are, every delegated amendment (SA-1 to SA-6), every delegated decision (DD-*), the resolutions of O3, O4 (decimal comma kept for both entities), O8, O9, O11 to O13, and every "OWNER REVIEW" item in decisions.md. Later changes are follow-ups.
> - **Running AC count:** 53 before, **75 after OA-1 and OA-2** (22 added: AC-11.1 to AC-11.9,
>   AC-12.1 to AC-12.13; AC-3.2, AC-8.5, AC-9.6 and AC-12.2 changed, none renumbered, none
>   removed), **79 after OA-3** (4 added: AC-11.10 to AC-11.13; AC-3.2 and AC-11.1 to AC-11.6,
>   AC-11.8, AC-11.9 changed again, none renumbered, none removed), **still 79 after the
>   OA-3 follow-up** (AC-11.11 and AC-11.13 reworded only), **after M-4** (AC-11.4
>   reworded only) **and after the relaxation order** (AC-11.11 reworded only) **and after OA-4** (AC-11.10 and
>   AC-11.12 reworded only). The first draft of OA-2
>   counted 70; the five ACs for the address (AC-12.9 to AC-12.13) were added after the
>   owner's review.

## Problem

An offer template today is a full contract text. To make an offer, a person reads every
section and edits it by hand: they decide which clauses apply, fill in names and figures
wherever they appear, and find what is still missing. Nothing marks which parts must change
for this client, so mistakes go unnoticed: a forgotten placeholder, a clause about AI
costs left in for a client that uses none. The people who prepare offers do not use the
system as intended, because it is quicker to copy last month's offer in a word processor.

## Domain language

- **offer template** — as in specs/20261102-crm-offer-document (owned by one entity, written in one language),
  but its text now declares what the wizard asks for. In it:
  - **template field** — a named value the person fills in ("Durata prevista"), with a
    label, an optional hint, a kind (text, long text, number, date, percentage, amount) and
    an optional default. An **amount** is money in the offer's currency. A text field may
    offer a fixed list of **options**, from which the person picks one; an option, or an
    optional block, may **fill** other fields with given values when it is chosen or
    switched on (the SLA profile of "Servizi a canone") *(delegated amendment SA-2,
    2026-11-15 — confirmed by the owner 2026-11-15)*. A field the text only uses inside its own conditional
    text is **optional**.
  - **list field** — a field that takes any number of items, each printed as a bullet
    ("Attività", "Funzionalità o deliverable").
  - **repeatable table** — a table whose rows the person adds and removes; each column is a
    field ("Profilo · FTE · Giornate · Tariffa").
  - **optional block** — a passage the person switches on or off, with a label, a
    one-line explanation and a default ("Clausola dati critici").
  - **block choice** — a group of optional blocks of which exactly one is on ("Rinnovo
    tacito" / "Nessun rinnovo automatico").
  - **conditional text** — text printed only when a given field is filled in, or only when
    it is empty (the fallback).
  - **text annex** — an annex written in the template's text, with a designation its author
    chooses ("A", "SLA", "DPA"). It is distinct from the **effort-detail annex**, which the
    CRM generates from the estimate (the "Annex A" of specs/20261102-crm-offer-document)
    *(delegated decision DD-2, 2026-11-15 — confirmed by the owner 2026-11-15)*.
  - **issuer field** — a template field bound to the **issuer's legal name**: the legal name
    saved in the entity profile (CRM Settings) of the deal's entity. The person is never
    asked for it *(added 2026-11-15, owner)*.
  - **issuer address field** — a template field bound to the **issuer's address**: the
    address lines saved in that same entity profile, joined on one line. Likewise never asked
    *(added 2026-11-15, owner)*.
- **letterhead** — the one-page A4 PDF uploaded in an entity's profile
  (specs/20261102-crm-offer-document AC-2.1), drawn behind every page of the PDF offer. An
  entity whose profile has none gets a plain header (the issuer's name and address and a
  footer rule) *(added 2026-11-15, owner)*.
- **preview page** — one A4 page of the preview (US-11): the letterhead behind it when it is
  shown, and the offer's text inside the **frame** the PDF keeps on each of its pages (AC-11.10)
  *(added 2026-11-15, owner)*.
- **cost line kinds** — `one_off`, `yearly` and discount as in specs/20261102-crm-offer-document, and
  **option line**: a line the client may tick, with a number and a price, never counted in
  any total *(delegated amendment SA-1, 2026-11-15 — confirmed by the owner 2026-11-15)*.
- **total row** — a labelled row of the cost table that sums the one-off and yearly lines
  since the previous total row (or the start of the table), minus the discounts of that
  stretch *(delegated amendment SA-1, 2026-11-15 — confirmed by the owner 2026-11-15)*.
- **wizard** — the guided steps that turn a template into an offer: Template, Client,
  Scope, Conditions, Costs, Annexes (only when the template has something to ask there),
  Preview.
- **offer draft** — the wizard's work in progress on one deal: the chosen template and
  everything entered so far. One per deal. It is not an offer: it has no number and no PDF.
- **missing field** — a required field still empty in the draft.
- **invalid answer** — a value that is filled in but outside what its kind allows: a derived
  percentage below 0, a fractional quantity, a date out of range *(delegated amendment SA-3,
  2026-11-15 — confirmed by the owner 2026-11-15)*.
- **hand-edited section** — a section whose text the person rewrote in the last step for
  this offer only. From then on, the wizard's fields no longer change it.

## User stories and acceptance criteria

### US-1 The wizard asks only what changes for this client

As a person who prepares offers, I want to answer questions instead of editing a contract,
so that I write only what is specific to this client.

- **AC-1.1** Given a deal with no offer draft, when the person starts a new offer, then the
  wizard opens on the Template step, listing the active wizard templates of the deal's
  entity grouped by language. Each shows its name, a one-line description and its typical
  uses ("Sviluppo · MVP e PoC · Evolutive"). The chosen template sets the offer's language.
- **AC-1.2** Given a chosen template, then each later step shows only the template fields,
  list fields, repeatable tables, optional blocks and block choices of the sections assigned
  to that step, in the order they appear in the text. A step with nothing to ask is not
  shown.
- **AC-1.3** Given a field, then it shows its label, hint, kind and default as defined in
  the template; a field of kind amount is entered and shown in the offer's currency. An
  optional field is marked "optional" and never counts as missing. *(delegated amendment
  SA-2, 2026-11-15 — confirmed by the owner 2026-11-15)*
- **AC-1.4** Given an optional block, then it shows its label and explanation as a switch,
  set to its default. Given a block choice, then it shows as a group with exactly one
  option selected.
- **AC-1.5** Given a field that is used only inside an optional block, when that block is
  off, then the field is not shown and does not count as missing.
- **AC-1.6** Given any step, when the person selects another visited step or uses Back and
  Next, then the wizard moves there without losing anything entered.
- **AC-1.7** Given a list field or a repeatable table, when the person adds, removes or
  reorders items or rows, then the preview and the document follow that order. An empty item
  or an empty row is not printed.
- **AC-1.8** Given a text field that declares options, then it is shown as a select offering
  exactly those options, and a value that is not one of them cannot be entered or saved.
  *(delegated amendment SA-2, 2026-11-15 — confirmed by the owner 2026-11-15)*
- **AC-1.9** Given an option, or an optional block, that fills other fields, when the person
  chooses that option or switches that block on, then each of those fields takes the value
  the template gives it and shows it, and the person can still change it afterwards.
  *(delegated amendment SA-2, 2026-11-15 — confirmed by the owner 2026-11-15)*

### US-2 The CRM fills in what it already knows

As a person who prepares offers, I want the client, the reference and the estimate figures
to come from the deal, so that I never retype them or get them wrong.

- **AC-2.1** Given a deal, when the wizard starts, then the client block, contacts, place
  and date are prefilled from the deal and its company, as in specs/20261102-crm-offer-document AC-1.2, and
  remain editable in the Client step.
- **AC-2.2** The offer reference is never entered by the person. The wizard shows "assigned
  when the offer is generated" until generation, and the generated PDF carries the reference
  of specs/20261102-crm-offer-document US-4 and US-8.
- **AC-2.3** Given a deal with a ready estimate, then the values of specs/20261102-crm-offer-document AC-1.6 —
  man-days, epics, phases, timeline, the per-phase cost lines and Annex A — are available to
  templates and prefilled as they are today. The person can still change any prefilled value
  in the wizard.
- **AC-2.4** The estimate rule of specs/20261102-crm-offer-document AC-3.6 is unchanged: no ready estimate and no
  admin override means no offer, and the wizard says so on the Template step instead of
  letting the person fill in steps they cannot generate.
- **AC-2.5** The offer's currency is the deal's currency. Every amount the wizard shows or
  prints uses it.

### US-3 I see the document while I fill it in

As a person who prepares offers, I want to see the offer take shape as I answer, so that I
know what the client will read.

- **AC-3.1** On every step after Template, a preview of the document is shown next to the
  form on wide screens and can be opened on narrow ones. It updates within one second of a
  change.
- **AC-3.2** Given the same draft, then the preview and the generated PDF contain the same
  texts, in the same order, with the same blocks, list items, table rows and cost lines.
  The preview's page breaks approximate the PDF's under the rules of AC-11.11 and may still
  differ from them. The letterhead drawn behind the pages of the preview (US-11), the frame
  that keeps the text off it, the page number "N/M" the preview prints on each page (AC-11.12,
  whose N and M are the preview's own and can differ from the PDF's), and what the PDF prints in
  its place (the plain header) are not part of that content: the preview is an approximation of the
  PDF, and the PDF is the authority. *(changed 2026-11-15, owner)*
- **AC-3.3** A missing field is shown in the preview as a highlighted placeholder with its
  label.
- **AC-3.4** The Preview step lists every missing field. Selecting one opens the step that
  holds it and focuses the field.
- **AC-3.5** Given at least one missing field or invalid answer, then the offer cannot be
  generated: the generate action is disabled, with the number of missing fields and of
  invalid answers shown next to it, and a generation requested by any other means is
  refused and creates no offer. *(delegated amendment SA-3, 2026-11-15 — confirmed by the owner 2026-11-15)*
- **AC-3.6** The Preview step also lists every invalid answer, with the label of its field
  and the reason, next to the missing fields of AC-3.4. Selecting one opens the step that
  holds the field and focuses it. A derived field (AC-4.5) is never missing but can be
  invalid. *(delegated amendment SA-3, 2026-11-15 — confirmed by the owner 2026-11-15)*

### US-4 The costs add up on their own

As a person who prepares offers, I want the cost table to compute itself from what I enter,
so that totals and discounts are never wrong.

- **AC-4.1** The Costs step shows the template's cost lines with their description, unit
  amount, quantity and total, and the total rows of AC-4.6. Totals and discounts follow
  specs/20261102-crm-offer-document AC-1.5 (integer cents, one rounding, the entity's grouping), with the
  total rows of AC-4.6 in place of its single TOTAL row. *(delegated amendment SA-1,
  2026-11-15 — confirmed by the owner 2026-11-15)*
- **AC-4.2** Given a cost line tied to a template field (a day rate, a number of days), then
  editing either the field or the line changes both.
- **AC-4.3** The person can add cost lines beyond those of the template and remove the ones
  they added. The limits of specs/20261102-crm-offer-document AC-3.3 on cost lines still apply (1 to 10 lines,
  counting option lines and the lines a repeatable table expands into), except that the
  requirement of at least one `one_off` line becomes at least one `one_off` or `yearly`
  line. *(delegated amendment SA-1, 2026-11-15 — confirmed by the owner 2026-11-15)*
- **AC-4.4** Given an optional block that brings a cost line ("Seconda voce di costo",
  "Scontistica accordata"), when it is switched off, then its line is neither shown nor
  counted.
- **AC-4.5** Given a field derived from another one (balance = 100 % − deposit), then it is
  computed, shown read-only, and never missing.
- **AC-4.6** Given a template with one or more total rows, then each total row prints its
  own label and the sum of the `one_off` and `yearly` lines since the previous total row (or
  the start of the table), minus the discounts in that stretch; a discount lowers only the
  total row of its own stretch. Example: a one-off line of 1 000.00, a yearly line of 500.00
  and a total row "TOTALE primo anno", then a yearly line of 200.00, a discount of 50.00 and
  a total row "TOTALE successivo", print 1 500.00 and 150.00. Given a table with a single
  total row and only `one_off` lines, then the printed total is the one of specs/20261102-crm-offer-document.
  The offer's price and yearly figure shown in the deal's offers list are computed as in
  specs/20261102-crm-offer-document and do not depend on where the total rows fall. *(delegated amendment
  SA-1, 2026-11-15 — confirmed by the owner 2026-11-15)*
- **AC-4.7** Given an option line, then it is printed with its description, unit amount,
  quantity and total, is numbered like the other numbered lines when the table has a position
  column, and is counted in no total row and not in the offer's price or yearly figure.
  *(delegated amendment SA-1, 2026-11-15 — confirmed by the owner 2026-11-15)*

### US-5 I can change the wording when the template does not fit

As a person who prepares offers, I want to rewrite a section's text for one offer, so that an
unusual client does not force a change to the template.

- **AC-5.1** In the Preview step, the person can open any section's text, as resolved from
  the current answers, and edit it in the offer markup *(owner)*.
- **AC-5.2** Once saved, the section is marked "edited by hand" in the wizard and in the
  preview. Changing a field or block that this section uses no longer changes it, and the
  wizard shows a notice on that field naming the hand-edited section.
- **AC-5.3** The person can restore a hand-edited section to the wizard's text, after a
  confirmation that names what will be lost.
- **AC-5.4** A hand-edited section is subject to the limits of specs/20261102-crm-offer-document AC-3.3 (heading,
  body length).

### US-6 The draft is kept on the deal

As a person who prepares offers, I want my work to stay on the deal, so that I can stop,
continue later or on another device, and let a colleague finish it.

- **AC-6.1** Every change in the wizard is kept in the deal's offer draft without an explicit
  save. Closing the wizard, reloading the page or opening the deal on another device and
  reopening the wizard shows the draft exactly as left *(owner)*.
- **AC-6.2** The draft is visible and editable by everyone who may generate offers on that
  deal (specs/20261101-crm-sales-flow: `deal:manage` in scope and `deal:financials`), and by no one else. A person
  without `deal:financials` does not learn that a draft exists.
- **AC-6.3** Given two people editing the same draft, when one saves a change based on an
  older version, then the change is refused and that person is told to reload; nothing the
  other person saved is lost *(owner)*.
- **AC-6.4** The deal page shows that a draft exists, who changed it last and when, with
  "Continue" and "Discard". Discarding asks for confirmation and removes the draft.
- **AC-6.5** Given a draft, when the person chooses another template, then after a
  confirmation the template-specific answers are replaced; the client block and contacts are
  kept.
- **AC-6.6** Given a generated offer, then the draft it came from is removed, and the offer's
  snapshot holds everything needed to reopen the wizard on it (specs/20261102-crm-offer-document AC-3.7).
- **AC-6.7** No part of the draft is stored in the browser's storage.

### US-7 Editing and revising an offer go through the wizard

As a person who prepares offers, I want to correct or revise an offer with the same wizard,
so that I do not re-enter what it already says.

- **AC-7.1** Editing an unsent offer (specs/20261102-crm-offer-document AC-7.2) opens the wizard on that offer's
  answers, hand-edited sections included. Generating it replaces that offer under the same
  reference.
- **AC-7.2** "New revision" on a sent offer (specs/20261102-crm-offer-document AC-7.4) opens the wizard on the sent
  offer's answers and generates the next revision. The sent offer stays unchanged.
- **AC-7.3** Given an offer made with a template from before this spec, when the person edits
  or revises it, then it opens the way it did before this spec (the dialog of specs/20261102-crm-offer-document)
  while its entity and language have no wizard template; otherwise the wizard opens on the
  Template step, with the client block and contacts of that offer prefilled.

### US-8 wellD maintains its templates in Settings

As a person who manages an entity's deals, I want to write and change the offer templates
myself, so that a new clause or a new kind of offer needs no developer *(owner)*.

- **AC-8.1** In Settings, the people of specs/20261102-crm-offer-document AC-2.1 list, create, duplicate, edit and
  archive their entity's templates, as in specs/20261102-crm-offer-document AC-2.2. A template is now edited as:
  - name, language, one-line description and typical uses;
  - its text, with fields, list fields, repeatable tables, optional blocks, block choices and
    conditional text written inline;
  - for each section, the wizard step it belongs to;
  - for each field: label, hint, kind (text, long text, number, date, percentage or amount)
    and default; for a text field, optionally its list of options;
  - for each option or optional block, the fields it fills and the values it gives them;
  - for each optional block: label, explanation and default; for each block choice: its
    name and options.

  *(delegated amendment SA-2, 2026-11-15 — confirmed by the owner 2026-11-15)*
- **AC-8.2** While editing, the editor shows what the wizard will ask for this template — every
  step and, under it, its fields, list fields, tables, blocks and choices — updated as the
  text changes.
- **AC-8.3** Given a text that cannot be read (a block opened and not closed, a field or
  block with no label, a block choice with fewer than two options, no costs section), then
  the template cannot be saved and each problem is listed with its line.
- **AC-8.4** Given a template edited after offers or drafts were made from it, then generated
  offers keep their snapshot (specs/20261102-crm-offer-document AC-2.2). A draft started from it shows a notice
  that the template changed and keeps the answers whose fields still exist.
- **AC-8.5** A template can be previewed in the wizard with sample answers, without a deal,
  from the editor. The sample view reads nothing else from the CRM except the entity's
  letterhead, legal name and address, as AC-11.9, AC-12.8 and AC-12.13 say. *(changed
  2026-11-15, owner)*

### US-9 The seven templates of the mockup are the starting point

As wellD, I want the templates agreed with the people who prepare offers to be there on day
one, and the old ones to step aside only once a replacement exists, so that no entity is
ever left unable to make an offer.

- **AC-9.1** When this ships, entity `welld_ch` gets the seven templates of the mockup, in
  Italian, as active templates: Progetto a corpo, Risorse a tempo, Manutenzione e SLA,
  Formazione, Consulenza e assessment, Servizi a canone, Progetto a corpo con SLA. Their
  texts, labels, hints, defaults and steps are the mockup's, except for the differences
  listed in AC-9.6. *(delegated amendment SA-4, 2026-11-15 — confirmed by the owner 2026-11-15)*
- **AC-9.2** For each entity and language, the existing templates of specs/20261102-crm-offer-document are
  archived when that entity and language get their first wizard template, and not before
  *(owner)*. Until then, offers for that entity and language are generated with the dialog
  of specs/20261102-crm-offer-document.
- **AC-9.3** The other versions (WellD CH in English, WellD IT in Italian and in English)
  are added as templates from Settings when their texts are ready, with no further
  development *(owner)*. Every template feature of US-8 works for any entity, language and
  currency.
- **AC-9.4** Offers generated before this spec keep their reference, PDF and snapshot
  unchanged.
- **AC-9.5** Given a template with text annexes, then the PDF prints them after the contract
  sections, before any other annex, in the template's order, each headed with its
  designation in the heading style of specs/20261102-crm-offer-document ("ALLEGATO A – …"). The effort-detail
  annex and then the deal PDFs follow, lettered with the next free letters in order,
  skipping any letter a text annex already uses (a text annex "A" makes the effort-detail
  annex "Allegato B"; one designated "SLA" leaves it "Allegato A"). The index of annexes is
  printed only when the effort-detail annex is printed, as in specs/20261102-crm-offer-document, and then lists
  the text annexes too. A template has at most 5 text annexes of at most 30 sections each; a
  template beyond that cannot be saved and the problem is listed (AC-8.3). *(delegated
  decision DD-2 and DD-3, resolving O1 and O2, 2026-11-15 — confirmed by the owner 2026-11-15)*
- **AC-9.6** Given each of the seven templates and the same answers, then the printed offer
  has the mockup's text for every sentence, label, hint and default, and differs in these
  ways only:
  - the page-1 header (salutation, client block, contacts, place and date, title with the
    reference), the acceptance block and the "Allegati:" list are drawn by the CRM from the
    deal and the offer (AC-2.1, AC-2.2), not written in the template; the mockup's two
    opening paragraphs are the template's opening;
  - section numbers are assigned by the renderer;
  - an annex heading uses the style of specs/20261102-crm-offer-document ("ALLEGATO A – …");
  - the free "Allegati" field of "Consulenza e assessment" is replaced by the picker of the
    deal's PDF files;
  - a literal "CHF" printed next to an amount is the deal's currency (AC-2.5);
  - the mockup's table column-width hints are not kept;
  - a number or percentage field of an Italian-language template is printed with a decimal
    comma, so a value the mockup printed as "0.5" or "99.5%" is printed "0,5" or "99,5%"
    (for a Swiss-entity offer too: see O4) *(delegated amendment SA-5, 2026-11-15 — owner
    to review)*;
  - an amount is printed in the amount format of specs/20261102-crm-offer-document (for
    example "48’000", with the typographic apostrophe as thousands separator), where the
    mockup printed "48'000.-"; and a discount row of the cost table prints a unit and a
    quantity in its unit and quantity columns, which the mockup leaves blank *(delegated
    amendment SA-5, 2026-11-15 — confirmed by the owner 2026-11-15)*;
  - a cost row the person adds in the Costs step (AC-4.3) is printed immediately before the
    table's last total row, after any discount row, where the mockup printed it before the
    discount row *(delegated amendment SA-5, 2026-11-15 — confirmed by the owner 2026-11-15)*;
  - a field label, hint or example that names a currency in the mockup is written without
    a currency in the template (the "CHF / giorno" tariff label of "Risorse a tempo" reads
    "Tariffa / giorno"; the "(CHF)" of the additional-participant price label of
    "Formazione" is dropped; the AI-budget example of "Formazione", "es. 25 EUR", reads
    "es. 25"), so that no field label, hint or example of any template names a currency,
    whatever the deal's currency *(delegated amendment SA-6, 2026-11-15 — owner to
    review)*;
  - the issuer's legal name, which the mockup writes as "WellD Sagl" in the opening, the
    privacy clause and the SLA annex, is printed as the legal name saved in the entity
    profile (AC-12.3) *(changed 2026-11-15, owner)*;
  - the issuer's address, which the mockup writes as "Via Pessina 9, CP 1920, CH-6901
    Lugano" in the parties table of the SLA annex, is printed as the address saved in the
    entity profile (AC-12.10) *(changed 2026-11-15, owner)*.

  *(delegated amendment SA-4, 2026-11-15 — confirmed by the owner 2026-11-15)*

### US-10 Copy

As an Italian- or English-speaking user, I want the wizard in my language.

- **AC-10.1** All wizard and template-editor copy exists in English and Italian. Template
  texts, field labels and hints are written by the template author in the template's
  language and are not translated by the application.

### US-11 The preview is drawn on the entity's letterhead *(added 2026-11-15, owner; reshaped into real A4 pages 2026-11-15, owner)*

As a person who prepares offers, I want the preview to be laid out in A4 pages on my entity's
letterhead, so that I see something close to what the client will receive, text kept off the
letterhead's graphics, while knowing the PDF is the real document.

Verified before writing: the entity profile may exist without a letterhead (the upload is a
later step, `entityProfiles.routes.ts:171-174`), and the wizard context answers 409
`entity_profile_missing` only when there is no profile at all (`generation.ts:106-118`,
`context.ts:79`); without a letterhead the PDF prints a plain header
(`contractPdf.ts:319-323`, `generation.ts:214`); a letterhead is exactly one A4 page
(`entityProfiles.routes.ts:239`) and the PDF draws it on every page (`contractPdf.ts:315-323`).
Added with the A4 pages: the PDF's pages are 595 × 842 pt and its text is kept inside a frame
of 120 pt from the top, 110 pt from the bottom and 71 pt left and right, with or without a
letterhead (`contractPdf.ts:76`, `:315-318`); it breaks pages line by line, never leaves one
line of a longer paragraph alone at the bottom or the top of a page (`:409-411`), never leaves a
section heading alone at the bottom of a page, keeping it with its first lines or the table's
header and first row (`:565-566`), keeps the acceptance block on one page (`:617-618`) and
starts every text annex and the effort-detail annex on a new page (`:837`, `:849`).

- **AC-11.1** Given the entity of the offer has a letterhead and it is shown, then **each
  page** of the preview has the letterhead's page as its background, at the page's full width
  and in A4 proportions, behind all content. The preview's texts, missing-field placeholders
  (AC-3.3) and "edited by hand" marks stay real text drawn above it: selectable, found by the
  browser's search, and unchanged in the document structure (a page break adds no heading, list
  or table of its own). The letterhead itself is decorative on every page: hidden from
  assistive technology and not selectable. *(added 2026-11-15, owner; changed 2026-11-15,
  owner)*
- **AC-11.2** The preview is drawn as **real A4 pages stacked vertically**, with a visible gap
  between one page and the next (at least 16 CSS px, and clearly distinguishable from the
  paper in both themes). Each page is exactly one A4 page at its width (its height is its
  width × 297 / 210). While the letterhead is shown it is the background of **every** page —
  the same letterhead on each, as the PDF draws it — so the whole letterhead is visible on
  every page, and the text never overlaps the letterhead's header or footer area because every
  page keeps the frame of AC-11.10. While the letterhead is shown, the band of AC-11.3 to
  AC-11.4 is replaced by the caption "The letterhead is shown on every page. Page breaks are
  approximate: the PDF is the authority." (Italian: "La carta intestata è mostrata su ogni
  pagina. Le interruzioni di pagina sono approssimative: fa fede il PDF."). *(added
  2026-11-15, owner; changed 2026-11-15, owner)*
- **AC-11.3** Given the entity's profile has no letterhead, then nothing is drawn behind the
  pages, the pages are still shown as A4 pages with the same frame as when a letterhead is
  shown (AC-11.10), and the preview does not draw the plain header the PDF prints in its
  place: the band tells it. The band reads "No letterhead is set for {entity}: the PDF uses a
  plain header with the entity's name and address." (Italian: "Nessuna carta intestata
  impostata per {entity}: il PDF usa un'intestazione semplice con nome e indirizzo
  dell'entità."), where {entity} is the issuer's legal name of AC-12.2. The wizard opens and
  works as today. Given the entity has no profile at all, the wizard behaves as today (409
  `entity_profile_missing` on the wizard context). *(added 2026-11-15, owner; changed
  2026-11-15, owner)*
- **AC-11.4** Given the entity has a letterhead that cannot be shown — it cannot be fetched
  (network, permission or storage failure, the file replaced or removed meanwhile), the
  browser cannot render it, or it is not ready 10 seconds after the preview first needed it —
  and the cause is not the one of the "Unusable letterhead" paragraph below, then nothing is
  drawn behind the pages, the pages are still shown as A4 pages with the same
  frame (AC-11.10), and the band reads "The letterhead of {entity} could not be shown here. It
  is still added in the PDF." (Italian: "Non è stato possibile mostrare qui la carta intestata
  di {entity}. Viene comunque aggiunta nel PDF."). The failure is soft: the preview's text
  appears and updates as in AC-3.1 and never waits for the letterhead, no dialog or toast is
  raised, and the missing and invalid counts, autosave, the Preview step and the generate
  action are unaffected. Until the letterhead is shown or has failed, the pages are shown the
  same way without it and the band reads as today: "The letterhead of {entity} is added in the
  PDF." (Italian: "La carta intestata di {entity} viene aggiunta nel PDF."). The letterhead
  arriving, or failing, changes nothing but what is drawn behind the text: no text moves and no
  page break changes. A failure is tried again the next time the wizard is opened, never in a
  loop. *(added 2026-11-15, owner; changed 2026-11-15, owner)*

  **Unusable letterhead (security fix M-4).** Given the stored letterhead fails the service's
  decoded-size bound, so that crm-api refuses both the letterhead link and offer generation
  with 409 `letterhead_unusable`, then the wording "It is still added in the PDF" above is
  false and is **not** used. Nothing is drawn behind the pages, the pages keep the same frame
  (AC-11.10) and are shown as in the failed case, and the band reads "The letterhead of
  {entity} can no longer be used. Upload it again in CRM Settings. Offers for this entity
  cannot be generated until then." (Italian: "La carta intestata di {entity} non può più
  essere usata. Caricala di nuovo nelle Impostazioni CRM. Non si possono generare offerte per
  questa entità finché non lo fai."); the first two sentences are the copy of
  `offers.errors.letterheadUnusable` ({entity} being the legal name of AC-12.2). The generate
  action is disabled with that same `letterheadUnusable` text as its reason, and when a
  generation answers 409 `letterhead_unusable` whatever the preview showed, the wizard shows
  that text, creates no offer and does not send the person to an error page. Nothing else
  changes: the preview's text, the missing and invalid counts, autosave, the Preview step and
  the saving of the draft work as in AC-3.1, the band raises no dialog or toast, and the
  generate action works again once the letterhead has been uploaded again and the wizard is
  opened again. In the template editor's "Try the wizard" (AC-8.5, AC-11.9) the band is shown
  and there is nothing to block. *(changed 2026-11-15, delegated)*
- **AC-11.5** Given the suite is in its dark theme, then every page, and the letterhead on
  it, stay light and look the same as in the light theme: nothing is inverted, dimmed or
  tinted. The gap between the pages follows the suite's theme, and each page's edge stays
  distinguishable from it in both themes. *(added 2026-11-15, owner; changed 2026-11-15,
  owner)*
- **AC-11.6** Given a viewport where the preview opens in the Drawer (AC-3.1), then the Drawer
  shows the same pages, letterhead and bands as the wide pane — the same text in the same
  order on A4 pages with the same frame proportions — scaled to the Drawer's width as AC-11.13
  says; opening and closing the Drawer, or growing the viewport so that the inline pane takes
  over, does not fetch the letterhead again nor change what is shown. *(added 2026-11-15, owner;
  changed 2026-11-15, owner)*
- **AC-11.7** The letterhead never leaves the suite's own services. It is read from crm-api's
  storage (the entity profile's letterhead in the CRM's own EU bucket) through the short-lived
  download link crm-api gives callers who hold `deal:financials`, and drawn in the browser;
  no request goes to any other origin — no third-party renderer, font or content network —
  and the code that draws it is served from the suite's own origins and works under the
  suite's content security policy as it stands. The letterhead's bytes and the link are never
  stored in the offer draft, the offer or its snapshot, nor in the browser's storage
  (as AC-6.7), and are never logged. *(added 2026-11-15, owner)*
- **AC-11.8** The letterhead is fetched at most once per entity each time the wizard is
  opened, whatever the person types, adds or removes, and the preview it is drawn on is the
  entity profile's letterhead at that time. That one fetch, and one rendering of it, serve
  every page: the number of pages never adds a request, and a page that appears or goes as the
  person types shows the same letterhead at once, with no new request and no moment on which
  it is blank. The PDF is unchanged by this: it keeps drawing the letterhead it reads at
  generation, and an offer already generated keeps the PDF it has (AC-9.4). *(added
  2026-11-15, owner; changed 2026-11-15, owner)*
- **AC-11.9** The same applies wherever the wizard's preview appears: opening a draft, editing
  an unsent offer and making a new revision (US-7), and the template editor's "Try the wizard"
  (AC-8.5), where it is the letterhead of the template's own entity, shown or reported by the
  bands above, on the same A4 pages. In the editor, a person who cannot read it gets the band
  of AC-11.4, never an error. *(added 2026-11-15, owner; changed 2026-11-15, owner)*
- **AC-11.10** Every page keeps the frame the PDF's pages keep, as proportions of the page: 120
  / 842 of its height at the top, 110 / 842 at the bottom, and 71 / 595 of its width on the
  left and on the right (the PDF's frame of 120, 110, 71 and 71 pt on a 595 × 842 pt page).
  The offer's texts, placeholders, marks, lists and tables are drawn only inside that frame, on
  every page, so none of them touches the top or bottom area where a letterhead has its
  graphics; a long word or a wide table wraps inside the frame and is never clipped or pushed
  into a margin. The preview itself adds nothing in the margins except the page number of
  AC-11.12. The frame is the same whether the letterhead is shown, still loading, failed or not
  set (AC-11.3, AC-11.4). *(added 2026-11-15, owner; changed 2026-11-15, owner)*
- **AC-11.11** Where the preview breaks a page, then, whatever the letterhead and whatever
  the width of the page: *(added 2026-11-15, owner; changed 2026-11-15, delegated)*
  - nothing is lost, repeated or cut: read in order, the pages hold every line of the offer
    exactly once, no line is cut horizontally by a break, a word is never split by one, and a
    block taller than a page continues on the next page;
  - as in the PDF, a section or annex heading is never the last thing on a page: it is
    followed on the same page by at least its first lines, or by the cost table's header and
    first row;
  - as in the PDF, a paragraph or list item of more than one line is never left with a single
    line alone at the bottom of a page or at the top of the next, and a list item's marker is
    on the page of its first line;
  - a table row is not split between two pages, unless it is taller than a page's frame, in
    which case it continues on the next page, cut between two lines, and nothing of it is lost
    *(changed 2026-11-15, delegated)*;
  - the acceptance block stays together on one page;
  - each text annex, and the effort-detail annex when the offer has it, starts on a new page,
    and the first page starts with the page-1 header; the deal PDFs that the PDF appends
    unchanged are not drawn as pages, only listed as today;
  - no page is blank or holds only a gap; a page ends before its frame is full only where a
    rule of this AC moves what follows to the next page (a keep-together rule above, or the
    start of an annex); the last page may end anywhere, and an offer with no text still shows
    one page *(changed 2026-11-15, delegated)*;
  - when a keep-together rule above cannot be met even on an empty page (for example, at a
    narrow width a table's header and first row together are taller than a page's frame), the
    rules give way in one fixed order: heading-with-next first, then widow and orphan, then
    keep-together blocks, then table rows. They give way only as far as needed for every page
    to hold content, and never so that text is lost, repeated or put in a margin
    *(changed 2026-11-15, delegated)*;
  - the pages are laid out again within the second of AC-3.1 after a change, and the
    letterhead stays on every page meanwhile.

  The page count and the place of each break are **not** promised to equal the PDF's: they are
  approximate, the caption of AC-11.2 says so, and the PDF is the authority.
- **AC-11.12** Page boundaries never disturb reading or assistive technology: the pages are
  in the document's reading order, the same as the PDF's; a page, a gap or a page boundary is
  not a landmark, a heading, a list or a live announcement and says nothing to a screen
  reader, and the decorative letterhead of each page is hidden from it
  (AC-11.1); the preview remains the one labelled, keyboard-focusable and scrollable region of
  AC-3.1 with no stop for Tab on any page or gap; text selected or copied across a page break
  comes out as the continuous text of the offer, without a character, space or line added or
  repeated by the break, and a sentence that a break splits is found by the browser's search as
  one sentence.
  **Page number.** Every preview page prints "N/M" as the PDF does, in the same place and
  style: right edge on the right end of the letterhead's rule (the page width less 72 pt, as a
  proportion of the page width), baseline 35.5 pt from the bottom (as a proportion of the page
  height), 8.5 pt regular, soft grey, scaled with the page. N is the page's position in the
  preview and M the preview's page count, so M can differ from the PDF's page count; the PDF is
  the authority and the caption of AC-11.2 says the breaks are approximate. The number belongs
  to the page's decorative, aria-hidden layer like the letterhead: it is not announced, not
  selectable, not copied, not found by search and not a landmark, heading, list or live region,
  and it adds nothing to the continuous text of the offer.
  **Corner.** While the letterhead is shown, a white rectangle covers the letterhead's own
  baked-in page number before the number is printed (the PDF's corner: x 480, y 26 from the
  top, 60 × 22 pt of a 595 × 842 pt page, as proportions), so the letterhead's own "1/1" never
  shows on any page. When no letterhead is shown (none set, still loading, failed or unusable:
  AC-11.3, AC-11.4) nothing is painted and the number is still printed, as the PDF prints
  numbers always and paints the corner only when a letterhead exists. The number never changes
  where the text or a page break falls. *(added 2026-11-15, owner; changed 2026-11-15, owner)*
- **AC-11.13** The pages scale to the width they are given, in the wide pane and in the Drawer
  alike: a page is as wide as its container allows, up to a maximum, keeps its A4 proportions
  and its frame (AC-11.10), and shows the letterhead whole; the preview never needs horizontal
  scrolling at a width of 320 CSS px. The text of the pages is never smaller than 10 CSS px, so
  on a narrow page more text falls on each page's height and the breaks differ more from the
  PDF's (approximately, as AC-11.11 says). Given the browser zoomed to 200 %, or the text size
  doubled, then the text stays readable and nothing is clipped, overlaps the letterhead's
  graphics or leaves its frame: the same offer simply runs over more pages. Text and the
  pages keep following the suite's theme and the person's browser settings. *(added 2026-11-15,
  owner; changed 2026-11-15, delegated: floor 10 CSS px, superseding 12 px)*

### US-12 The issuer's legal name and address come from the entity profile *(added 2026-11-15, owner)*

As wellD, I want the name and the address of the company making the offer to be written once,
in the entity profile, so that no seeded template names or locates it and no offer can carry
an outdated one.

Verified before writing: the seven seeded templates write "WellD Sagl" in their text
(`crm-api/src/offer-templates/wizardSeeds/welldChIt.T1.ts:14` and the others), while the
profile's legal name is another string, and the preview band and the PDF's own header use the
profile's (`context.ts:114`, `generation.ts:248`). The template grammar already has a
system-bound field for the issuer (`source: issuer`, `syntax.ts:159`, `resolve.ts:426-427`) that
no seeded text uses; the legal name of a profile is required when saved
(`entityProfiles.routes.ts:46`). The profile also holds the address: `addressLines`, zero to
five lines of at most 200 characters, optional and empty by default
(`crm-api/prisma/schema.prisma:253`, `entityProfiles.routes.ts:47`), printed by the PDF's own
plain header and footer (`pdf.ts:250`, `contractPdf.ts:331,340`). So the address needs no new
profile field, but a template cannot read it today: `source: issuer` yields the legal name only
(`resolve.ts:426-427`, `answers.ts:38`). The only seeded place that prints the issuer's address
is the "Fornitore" row of the SLA annex's parties table, in "Manutenzione e SLA" and in
"Progetto a corpo con SLA" (`welldChIt.T3.ts:172`, `welldChIt.T1T3.ts:266`); the other
templates and the privacy clause print no address.

- **AC-12.1** A template author can bind a field to the issuer's legal name and use it
  anywhere in the text where a field may appear — the opening, any section, a text annex, a
  cost line's description. The wizard never asks for it (it is not a form field and cannot be
  edited), and the editor's outline (AC-8.2) lists it as supplied by the CRM. *(added
  2026-11-15, owner)*
- **AC-12.2** The value of an issuer field is the legal name saved in the profile of the
  deal's entity at that moment. It is read when the preview is drawn and again when the
  offer is generated, never copied into the template, the draft's answers or the template's
  version. The preview and the PDF print the same name. The name is printed exactly as saved:
  a character that the offer markup gives a meaning (a pipe, an asterisk, a bracket) is
  printed as a character and never changes the structure of the text or table around it.
  *(added 2026-11-15, owner)*
- **AC-12.3** None of the seven templates of AC-9.1 contains the literal "WellD Sagl" in its
  text: every place that named the issuer — the opening sentence "Il presente contratto viene
  stipulato tra …", the privacy clause, and the SLA annex of "Manutenzione e SLA" and of
  "Progetto a corpo con SLA" — uses an issuer field. Given a profile whose legal name is
  "wellD SA", every one of those places prints "wellD SA". The SLA annex's short defined term
  «WellD» is not the legal name and stays as written. *(added 2026-11-15, owner)*
- **AC-12.4** What is frozen stays frozen. An offer generated before a change to the profile's
  legal name keeps the name it printed: its PDF and snapshot are unchanged (AC-9.4), and so is
  a sent offer when a revision is made. An unsent offer that is edited (AC-7.1) and a new
  revision (AC-7.2) print the legal name current at their generation. A hand-edited section
  (AC-5.2) keeps the text the person typed, whatever the profile says later. *(added
  2026-11-15, owner)*
- **AC-12.5** Given a database that already holds the seven templates seeded by the earlier
  release (still carrying "WellD Sagl"), then, after this ships and without the owner
  recreating, duplicating or editing anything, each of the seven whose text is still exactly
  the one that release seeded — active or archived — prints the profile's legal name in every
  offer made from it from then on, no later than the first time the wizard lists the entity's
  templates after the release. A draft started from one shows the notice of AC-8.4 and keeps
  its answers, and an offer already generated is unchanged (AC-12.4). The same update leaves a
  template in the state it was: an archived seed stays archived, an active one stays active,
  and no template is created, resurrected or removed by it. *(added 2026-11-15, owner)*
- **AC-12.6** The update of AC-12.5 never overwrites what a person wrote. A seeded template
  whose text differs from the seeded one (a person edited it), a template that took a seed's
  name so the seed was skipped, and any duplicate or template written in Settings, keep their
  text exactly as it is and print what it says. The update takes effect once: a later restart
  or release does not apply it again, and a person's edit made after it is never replaced.
  *(added 2026-11-15, owner)*
- **AC-12.7** Given the entity has no profile, the wizard behaves as today (409
  `entity_profile_missing`, AC-11.3). Given a profile whose legal name read is empty or only
  spaces (which saving a profile does not allow, so it can only come from damaged data), then
  the preview does not print an empty issuer or a stand-in for it, the generate action is
  disabled with the reason "Set the legal name of {entity} in CRM Settings", and a generation
  requested by any other means is refused as for an absent profile and creates no offer. It
  is not counted among the missing fields (AC-3.5), because the person cannot fill it in the
  wizard. *(added 2026-11-15, owner)*
- **AC-12.8** In the template editor's "Try the wizard" (AC-8.5), an issuer field shows the
  legal name of the template's entity profile. When the profile cannot be read, it shows a
  sample name marked as a sample, never the name of a real wellD company that the profile may
  contradict, and the view still works. *(added 2026-11-15, owner)*
- **AC-12.9** *(the issuer's address, chosen by the owner at the review of 2026-11-15)* A
  template author can bind a field to the issuer's address, separately from the legal name of
  AC-12.1, and use it anywhere in the text where a field may appear, a table cell included.
  Like the legal name it is never asked by the wizard, cannot be edited there, and is listed
  by the editor's outline (AC-8.2) as supplied by the CRM. Its value is the address lines
  saved in the profile of the deal's entity at that moment, in their order, printed on one
  line and separated by a comma and a space. It is read when the preview is drawn and again
  when the offer is generated, never copied into the template, the draft's answers or the
  template's version, and the preview and the PDF print the same text. Each line is printed
  exactly as saved, as AC-12.2 says of the name. What is frozen stays frozen as in AC-12.4:
  an offer already generated keeps the address it printed (AC-9.4), an unsent offer that is
  edited and a new revision print the address current at their generation, and a hand-edited
  section keeps what the person typed. *(added 2026-11-15, owner)*
- **AC-12.10** None of the seven templates of AC-9.1 contains the literal "Via Pessina 9, CP
  1920, CH-6901 Lugano" in its text: the "Fornitore" row of the SLA annex's parties table, in
  "Manutenzione e SLA" and in "Progetto a corpo con SLA", prints the issuer's legal name
  (AC-12.3) followed by the issuer's address. Given a profile whose legal name is "wellD SA"
  and whose address lines are "Via Example 1" and "6900 Lugano", that cell reads "wellD SA, Via
  Example 1, 6900 Lugano". The city "Lugano" in the jurisdiction clauses ("il foro competente
  è quello di Lugano") and the place of issue are not the issuer's address and stay as
  written. *(added 2026-11-15, owner)*
- **AC-12.11** The update of AC-12.5 also covers the address: it is one update, not two, and
  AC-12.6 applies to it unchanged. A seeded template of the earlier release that still carries
  the literal address and whose text is otherwise exactly the seeded one — active or archived
  — prints the profile's address in every offer made from it from then on, on the same timing
  as AC-12.5, with the same notice and kept answers for a draft (AC-8.4), the same state left
  as it was, and an offer already generated unchanged. A template a person edited,
  duplicated or wrote, or one that took a seed's name, keeps the literal address it has and
  prints it. The update takes effect once. *(added 2026-11-15, owner)*
- **AC-12.12** Given the entity's profile has no address — no lines, or only lines that are
  empty or spaces, which saving a profile does not allow but damaged data may hold — then a
  field bound to the address prints nothing: no empty separator, no placeholder and no
  address from anywhere else, so the cell of AC-12.10 reads "wellD SA" alone, with no
  trailing comma or space. The wizard stays fully usable and the generate action is not
  disabled, because the offer remains valid and the supplier remains identified by its legal
  name (unlike an absent legal name, AC-12.7); the address is not counted among the missing
  fields (AC-3.5) and a generation requested while it is empty is not refused. The preview
  does not hide the gap, however: while the template in use prints the address and the
  profile has none, a notice near the preview reads "The address of {entity} is not set, so it
  is not printed in the offer. Set it in CRM Settings." (Italian: "L'indirizzo di {entity} non
  è impostato, quindi non viene stampato nell'offerta. Impostalo nelle Impostazioni CRM."),
  {entity} being the legal name of AC-12.2. *(added 2026-11-15, owner)*
- **AC-12.13** In the template editor's "Try the wizard" (AC-8.5) and in the preview of a
  draft, an address field shows the address of the profile of the template's, respectively
  the deal's, entity, and the notice of AC-12.12 appears under the same condition. When the
  profile cannot be read, the "Try the wizard" view shows a sample address marked as a
  sample, never a real wellD address that the profile may contradict, and the view still
  works. *(added 2026-11-15, owner)*

## Constraints

Recorded from the owner's review on 2026-11-14/15; the plan decides how.

- The mockup is a UX reference only: its code, its own styles and its in-browser PDF are not
  adopted.
- The PDF remains the one the CRM generates, stores and numbers (specs/20261102-crm-offer-document): letterhead,
  annexes, numbering, storage and the `deal:financials` gate are unchanged.
- The draft lives on the deal, never in browser storage.
- Prefer extending the existing offer markup to adding a second, unrelated syntax.
- *(added 2026-11-15, owner; changed 2026-11-15, owner)* The preview's letterhead is the
  entity profile's letterhead drawn by the browser behind each page of the HTML preview. The
  owner declined a "Generate a PDF preview" action and accepted that the result is closer to
  the PDF but not exact, and that it adds a PDF renderer in the browser. On 2026-11-15 the
  owner chose, among three options, **real A4 pages**: the preview is split into A4 pages
  with the letterhead behind each, the text inside the PDF's frame, page breaks approximating
  the PDF's; they accepted that breaks can still differ from the real PDF. They rejected a
  header strip only, and a full first page with frame margins. On 2026-11-15 the owner also
  chose that the preview prints the PDF's page number "N/M" and paints the PDF's corner over
  the letterhead (AC-11.12), and that a letterhead configurator replaces the uploaded letterhead
  PDF in a next spec (Non-goals).

## Non-goals

- A visual (WYSIWYG) editor for templates or offers. Texts stay in the offer markup.
- Exporting or importing a draft as a file, or prefilling the wizard from a URL (both in the
  mockup).
- The mockup's own light/dark switch, fonts (Inter, Ubuntu) and logo: the suite's theme and
  the entity's letterhead apply.
- Writing the WellD CH English and WellD IT texts. wellD supplies them; this spec only makes
  them possible (AC-9.3).
- Converting the existing templates of specs/20261102-crm-offer-document to the new form.
- Templates shared between entities (unchanged from specs/20261102-crm-offer-document).
- AI-generated offer text.
- Several drafts per deal, or private drafts.
- Anything the seven templates do not need in the cost table, the field kinds or the
  annexes: the amendments SA-1 to SA-4 add only what AC-9.1 requires.
- Making number formatting depend on the entity (a decimal point for Swiss-entity offers):
  see O4.
- *(added 2026-11-15, owner; changed 2026-11-15, owner)* A "Generate a PDF preview" action, or
  any preview that reproduces the PDF's page breaks exactly: the preview's frame matches the
  PDF's (AC-11.10) but its breaks are only approximate (AC-11.11), and the person cannot
  force, move or remove a page break.
- *(added 2026-11-15, owner; changed 2026-11-15, owner)* A letterhead upload or choice inside
  the wizard or the template editor, and any change to the PDF's own letterhead, header or
  footer. (The letterhead on every page of the preview, formerly excluded here, is now
  AC-11.2.)
- *(added 2026-11-15, owner; changed 2026-11-15, owner)* In the preview: a table of pages or a
  way to jump to a page, the plain header the PDF prints without a letterhead, and the PDF's
  appended deal PDFs as pages. (The page number "N/M" and the page count, formerly excluded
  here, are now printed on each page, AC-11.12.)
- *(added 2026-11-15, owner)* Binding the issuer's VAT number, IBAN, place of issue or any
  other profile field into a template: only the legal name and the address are bound
  (AC-12.1, AC-12.9). An author cannot choose how the address lines are joined or print one
  line alone, and no new field is added to the entity profile.
- *(added 2026-11-15, owner)* Finding or warning about literal company names or addresses in
  templates written by people, and rewriting any template a person has edited (AC-12.6,
  AC-12.11).
- *(added 2026-11-15, owner)* Letterhead configurator (owner, 2026-11-15) — next spec, out of
  this feature's scope: a SEPARATE Operai service with its own backend, callable by the other
  services (refund, CRM, projects and others) to obtain an entity's letterhead, header, footer
  and page-numbering configuration (logo, margins, header and footer rules, footer text, page
  numbering); it retires the uploaded letterhead PDF. Until then the uploaded PDF letterhead and
  the PDF's own header, footer and numbering stay as they are.

## Open questions

> **Accepted as risk at approval (owner, 2026-11-15).** The owner approved with O1 and O2
> open and is away while the plan is written: the plan adopts O1's proposal and resolves O2,
> each recorded as a decision delegated to the architect, for the confirmed by the owner 2026-11-15.

- [x] **O1** Mockup texts that do not match today's rendering. The mockup's templates write
  the salutation, client block, place/date and title themselves; specs/20261102-crm-offer-document AC-1.2 draws
  them from the deal. Its Annex A is "functional scope and estimates", while specs/20261102-crm-offer-document's
  is the effort detail. Proposal: the CRM keeps drawing the page-1 header, and the mockup's
  Annex A is a text annex of the template, alongside the effort detail. — owner: Matteo
  Codogno, before the plan.
  **Resolved by the plan, delegated, 2026-11-15 — confirmed by the owner 2026-11-15:** the CRM keeps drawing the
  page-1 header, the acceptance block and the "Allegati:" list (plan DD-1; AC-9.6); the
  mockup's annexes are text annexes, lettered ahead of the effort-detail annex (plan DD-2;
  AC-9.5).
- [x] **O2** Some limits of specs/20261102-crm-offer-document AC-3.3 may not fit the mockup's templates (for example
  1–15 sections, 1–10 cost lines). They need checking against the seven texts. — owner:
  architect, in the plan.
  **Resolved by the plan, delegated, 2026-11-15 — confirmed by the owner 2026-11-15:** checked against the
  seven texts; the limits are kept except that a cost table needs at least one `one_off` or
  `yearly` line (plan DD-3, SA-1; AC-4.3), and text annexes get their own limits (AC-9.5).
- [ ] **O3** *(raised while applying SA-2)* When a block that fills other fields is switched
  off, or another option is chosen, do the filled fields keep their values or return to
  what they held before? AC-1.9 fixes only that choosing or switching on sets the values and
  that the person can still change them afterwards. — owner: Matteo Codogno, at the review of the
  amendments
- [ ] **O4** *(raised while applying SA-5)* Should Swiss-entity offers print decimals with a
  point (`0.5`) as Swiss convention and the mockup do? That would make number formatting
  depend on the entity, not only the language — a follow-up change to the shared engine.
  Until answered, AC-9.6 prints the decimal comma for every Italian-language template,
  whatever the entity. **Accepted as risk for this delivery** (the owner approved the run
  with open questions accepted as risk, 2026-11-15). — owner: Matteo Codogno
- [x] **O5** *(raised while writing OA-1)* On the first page of a long offer the preview's
  text is not confined to the letterhead's margins as the PDF's is, so it can run over the
  letterhead's header or footer graphics (the letterhead is drawn behind the text, which stays
  legible as text, but not necessarily readable over a dark graphic). It followed from the
  owner's choice of an approximate preview over a PDF preview. Accepted as risk by the owner on
  2026-11-15, then **superseded by the owner's choice of "Real A4 pages", 2026-11-15 (OA-3):**
  the text now stays inside the PDF's frame on every page (AC-11.2, AC-11.10) and the risk no
  longer exists. What remains of the approximation is the page breaks only (AC-11.11).
- [x] **O6** *(raised while writing OA-2)* The issuer's name and address no longer come from
  template text in the seven seeds. **Resolved by the owner, 2026-11-15: bind the address
  too** (AC-12.9 to AC-12.13). What remains: a template a person edited, duplicated or wrote
  keeps the company name and address literally as written (AC-12.6, AC-12.11), and nothing
  finds or warns about them (Non-goals), so after a change of the profile such a template can
  print an outdated name or address. **Accepted as risk — owner, 2026-11-15.**
- [ ] **O7** *(raised while binding the address)* The printed supplier address becomes
  whatever the entity profile holds. The seeds' literal read "Via Pessina 9, CP 1920, CH-6901
  Lugano" (the PO box and the "CH-" prefix included); a profile that holds "6900 Lugano" prints
  that, and one with no address prints none (AC-12.12). Before release, someone checks the
  saved address lines of each entity that has seeded templates. — owner: Matteo Codogno,
  before release
- [x] **O8** *(raised while writing OA-3)* AC-11.13 fixed a floor of 12 CSS px for the
  preview's text, so that a Drawer on a phone stays readable; the price is that on a narrow page
  the breaks drift further from the PDF's than on a wide one (the text is relatively larger
  than on the A4 sheet). It was a product default chosen while writing, not one the owner gave.
  **Resolved by delegation, 2026-11-15 (OA-3 follow-up; plan O11): the floor is 10 CSS px**
  (AC-11.13), because at 12 px the inline pane of the default 1280 × 800 layout (about 488 px)
  would show roughly twice the PDF's pages, defeating "real A4 pages"; 10 px puts body text at
  the PDF's scale from a page width of about 595 px. One constant in the plan, changeable
  without other work. — owner: Matteo Codogno **confirmed 2026-11-15** (confirm 10 px, or choose another
  floor, or scale the text with the page and accept small text)
