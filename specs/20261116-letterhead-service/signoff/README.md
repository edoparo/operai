# Sign-off of real offers on the letterhead service (T35, AC-10.1, plan R2)

Prepared 2026-11-17, before the CRM is switched over (`LETTERHEAD_SERVICE_ENABLED`). **Approved by the owner on 2026-11-17** (see the last section). The
owner's approval is recorded in the last section. Three real offers were drawn by the service, through crm-api's own routes,
on two letterheads that reproduce the brand templates `Carta_Intestata_WellD_IT_new.docx` and `_CH_new.docx` as closely as the
configurator allows.

## The three offers

| # | File | Entity, language | What it is | Pages | SHA-256 of the PDF |
|---|---|---|---|---|---|
| 1 | `offers/offer-1-it-welld_ch.pdf` | `welld_ch`, it | Seeded wizard template "Progetto a corpo", every optional block on, with the index (effort annex) | 8 | `4de05a8e78fdb3dfa374e83bba6ebf2b68453df86d440b8cda1380488f7886f3` |
| 2 | `offers/offer-2-en-welld_it.pdf` | `welld_it`, en | An English fixed-price template written for this sign-off (no English wizard template is seeded) | 4 | `c16cc6064efc8cdfed6d00b7adcb28ca57d504f06cafed84045825eeaee2931f` |
| 3 | `offers/offer-3-it-welld_it-with-deal-pdfs.pdf` | `welld_it`, it | "Manutenzione e SLA" with **two deal PDFs appended** (3 pages) | 22 = 19 + 3 appended | `13908c6ae86ed2b6ca2fe6d636463f425b4236aa681ed8e8c615feaacd7f85db` |

Page images (PNG, 1.4 px/pt, rasterised from the PDFs with pdfium, not taken from the preview):

- offer 1: `offer-1-it-welld_ch.p1.png`, `offer-1-it-welld_ch.p8-last.png`
- offer 2: `offer-2-en-welld_it.p1.png`, `offer-2-en-welld_it.p4-last.png`
- offer 3: `offer-3-it-welld_it-with-deal-pdfs.p1.png`, `...p19-last-rendered.png` (the last page the service drew, "19 / 19"), `...p22-last-file.png` (the last page of the file: a deal PDF's own page)
- `preview-with-missing-fields.p1.png`: the wizard preview of offer 1's untouched draft, where two fields are still missing and are drawn highlighted with their label (AC-10.4). A generated PDF never contains one.

All three PDFs carry letterhead version 1 of their entity (AC-10.2, read back from the offer row). Generating them a second and a
third time gave the same SHA-256 each time (the service is deterministic, AC-1.4). Fonts embedded in the pages the service drew:
Ubuntu Regular and Bold, Noto Serif Regular and Italic. The deal PDFs of offer 3 keep their own Helvetica.
All names, addresses, amounts and the deal PDFs are fixtures made for this sign-off, not customer data; the deal PDFs say so on
each page.

## What to check

1. **Letterhead fidelity against the brand template** (open the `.docx` beside page 1 of each offer; `letterheads/*.json` hold the versions).
   - Logo `word/media/image1.png` of the template (SHA-256 `e552debbbfe7a2b803892921642cc07e4ff22c3c7a81a5d45278764e3c18234a`, identical in the IT and CH templates), top left, 12.7 mm high (the template draws it 33.3 x 12.7 mm).
   - Footer of four lines, from `word/footer1.xml`: legal name 10 pt bold `#e50339`; address 8 pt `#595c69`; web and e-mail 8 pt; fiscal line 7.5 pt (IT only; the CH template has no fiscal line); a hairline above in `#cccdd1`, 0.5 pt (the template's top border of the first line).
   - "N / M" at 7.5 pt, right-aligned, sitting on the last line of the left block (amendments A1–A3, `valign: bottom`).
   - Same header and footer on every page, as in the template (it has one header and one footer, no different first page): so `first` and `last` page variants are **not** used. Check page 1, a middle page and the last page look the same frame.
   - Values come from the CRM entity profile: IT "WellD Italia", address `Via Corsica 9/7 E, I-16128 Genova (Italia)`, VAT `01975370998`; CH "WellD Sagl", address `Via Pessina 9, Casella postale 1920, CH — 6901 Lugano (Svizzera)`. The IT fiscal line is the literal `R.E.A. Genova 449598` after `CF/ P.IVA {vat}`; the page-number text is "N / M" with spaces (the template writes "N/M").
2. **First page and last page**: page 1 carries the offer's title block, the last page ends with the last section or annex and the footer is complete. In offer 3 the three deal-PDF pages follow page 19 with **no number and nothing added** (the count "M" is the rendered pages only, 19, as in AC-10.1).
3. **"N / M"** on every page of the three offers (1 / 8 ... 8 / 8, 1 / 4 ... 4 / 4, 1 / 19 ... 19 / 19). The service's own preview and PDF text are equal page by page (crm-api's contract test, T31, was re-run against these letterheads: 6 passed, 485 checks).
4. **Missing-field rendering**: `preview-with-missing-fields.p1.png`. The two missing fields ("Oggetto a corpo", "Durata prevista") are highlighted in the body; the reference is the pending label `NNNN/AAAA`. No letterhead placeholder is ever missing here (`missingPlaceholders` is empty): the footers use `{legal_name}`, `{address}` and, for IT, `{vat}`, all of which the CRM sends.
5. **Fonts**: Ubuntu for headings, footer and table headers, Noto Serif for the text, as in the brand (the template's own styles are Word defaults, so the *look* of headings and tables — `#e50339` headings 15/12/10.5 pt bold, light-grey table header, grey cell borders, body 10.5 pt, line spacing 1.2 — is the golden "brand" look of the service, not something the template defines. Check it is the look you want for offers).
6. **The decisions below.**

## Open decisions for the owner

- offer index without page numbers (T27 D1);
- option boxes printed as `[ ]` (no font has U+25A1);
- total-row labels in the item column;
- `{contacts}` not sent by the CRM;
- the bottom margin needed for the brand footer.

Where to see each, and what was done meanwhile:

- **Index without page numbers (T27 D1).** Offer 1, page 1: "INDICE" lists the nine sections and the two annexes, with no page numbers (the pages belong to the service, which the CRM cannot know in advance). The index appears only for an offer with the effort-detail annex.
- **Option boxes as `[ ]`.** Offer 1 page 4 and offer 2 page 3: the optional cost row reads "[ ] Modulo di reportistica avanzata (barrare se desiderata)" and the note "Le voci contrassegnate con [ ] ...". The template text has "□"; none of the five fonts has U+25A1, so the CRM prints `[ ]`.
- **Total-row labels in the item column.** Same pages: "TOTALE" / "TOTAL" sits in the "Voce di costo" / "Item" column of the cost table, and "Totale" of the effort annex (offer 1 page 8) is in its first column: the label is never in a column of its own.
- **`{contacts}` not sent.** The CRM sends four entity values (`legal_name`, `address`, `vat`, `iban`), not `{contacts}` (AC-10.10). The web/e-mail line of both letterheads is therefore the **literal** text `www.welld.it — info@welld.it` / `www.welld.ch — info@welld.ch`, identical in both languages. Using `{contacts}` would need the CRM to send it, or the entity profile to hold it.
- **Bottom margin for the brand footer.** The brand template has 25.4 mm all round (`pgMar` 1440 twips). The save rule of AC-5.2 measures the footer with a 40-character value in every placeholder, which wraps in the left half of the footer, so 25.4 mm is refused (`footer_overflow`). The smallest margin that passes, found by bisection on the configurator's preview route (nothing saved), checked to 0.1 mm: **welld_it 35.9 mm** (35.8 refused), **welld_ch 29.1 mm** (29.0 refused). The difference is IT's fourth, fiscal line: with it left out, welld_it also passes at 29.1 mm (bisected, 29.02 mm). They are saved as such. With the real values the footers are shorter than the test ones, so the free space under the text is about 17 mm on IT pages and about 10 mm on CH pages (the brand footer sits 12.7 mm above the paper edge), and an IT page has a text area about 7 mm shorter than a CH page. Wanting the same margin on both, or the brand's 25.4 mm, means either shortening what the rule measures or a spec change; I did neither.

Other margins: left and right 25.4 mm (the brand's). Top **28.4 mm** (the brand's is 25.4 mm): the service draws the header hugging the body (3 mm gap), so 28.4 mm puts the logo exactly where the template puts it (12.7 mm from the top edge). The smallest top margin that passes is 20.7 mm (20.6 mm is refused), which would put the logo 3 mm higher than in the template.

## Observations to look at (not decisions listed above)

- **CH address wraps.** On `welld_ch` pages "(Svizzera)" falls on a second line. A footer zone is half the text width (the right half holds "N / M") and the 64-character address does not fit it at 8 pt; the template has it on one line. The configurator cannot widen a zone; a shorter address in the entity profile would fit. The IT address fits.
- **CH "N / M" level.** In the CH template the page number sits on a fourth line of its own; here it is level with the last text line (the web line), because an empty line is not drawn. On IT it is level with the fiscal line, as in the template.
- **Space between logo and body.** The logo is 3 mm above the first text line (a fixed gap of the service); in Word the template leaves more room. A heading at the top of a continuation page sits close under the logo (offer 1 page 8).
- **English footer wording is mine.** The brand templates exist only in Italian. For `welld_it` in English the fiscal line reads "Tax ID / VAT {vat}   R.E.A. Genova 449598" (the texts per language are required by AC-5.8). Please confirm or give the wording. The CH footer has no text that differs by language.
- **English offers use the CRM's number format.** In offer 2 amounts read "62.000" and "- 4.000" (dot as thousands separator), as the CRM formats a EUR amount in any language; the CH offer reads "48’500". An English reader may take "62.000" for sixty-two. This is crm-api's formatting, not the letterhead's.
- **Offer 2's text is not a seeded template** and offer 3's text is the seeded CH "Manutenzione e SLA" copied to `welld_it`, so its last bullet names the court of Lugano and Swiss law. These are fixtures to show pages; they are not text for approval.
- **The configurator's own sample preview** prints "CF/ P.IVA P.IVA IT00000000000 (SAMPLE)" for IT because the sample VAT value includes "P.IVA"; with the CRM's value the line reads "CF/ P.IVA 01975370998" as in the offers.

## How they were produced

Base: `lh/T35` at `196cbae0` plus the one code change of this task: `letterhead-api/perf/seed-local.ts` gains `--entity welld_it|welld_ch` (default `welld_it`, anything else exits 2). A second entity needs asset ids of its own (an asset id is the table's primary key and a version may only use its entity's assets), so `welld_ch` gets ids derived from the golden ones; `welld_it` keeps them. Checked on a throwaway database: `welld_it`, `welld_ch` and `welld_ch` again all succeed, both entities end with version 1 in one database. **seed-local was not used for the sign-off letterheads**: they are saved through the person routes.

1. `letterhead-api` image built from this worktree (`docker build letterhead-api`), run on host port 18135 with the Railway limits (2 vCPU, 4 GB), its own database `letterhead_lh_t35` (migrated by `letterhead-api migrate`) and bucket `letterhead-lh-t35` on the local MinIO. Auth faked: a local JWKS and `GET /authz/resolve` answering `letterheads:access` and `letterhead:manage` without conditions, and tokens signed by its key (`iss http://localhost:3001`, `aud operai-suite` for the person, `aud operai-service` and `scope letterhead:render` for crm-api).
2. As that person: `POST /v1/letterheads/{entity}/assets` (kind `logo`, the template's `image1.png`) for each entity; `POST /v1/letterheads/{entity}/preview` to find the smallest passing margins; then `POST /v1/letterheads/{entity}/versions` with `baseVersion: 0` and the configuration. `letterheads/welld_it.v1.json` and `welld_ch.v1.json` are `GET /v1/letterheads/{entity}/versions/1` (version, layout version 1, configuration with the asset id of the uploaded logo). Both entities are at version 1.
3. crm-api (database `crm_lh_t35`, migrated) with `LETTERHEAD_SERVICE_ENABLED=true` and its real letterhead client pointed at the container: its real routes were driven **in-process** through the test world (`app.request`, as T31's contract test does: faked auth and an in-memory CRM bucket, a fake estimai-api), not as a listening server. Steps for each offer: `PUT /entity-profiles/{entity}` with the values above, a company and a qualified deal with a ready estimate, `POST /deals/{id}/offer-draft`, `PUT` of the answers, `POST .../offer-draft/preview` until nothing is missing, `POST .../offer-draft/generate`. The PDF is the object crm-api stored. For offer 3 the two deal PDFs are stored as deal attachments and chosen in the draft; crm-api appends them after the rendered pages.
4. Page images: pdfium (`pypdfium2` 5.15) at scale 1.4.

The driver scripts are scratch and are not committed (this task's `touch:` allows one code file). Everything needed to repeat the letterhead steps is in the JSON files here; the offers repeat from a database with the entity profiles above and the three templates named in the table.

Cleaned up: the `letterhead-api-t35` container was stopped and removed. The databases `letterhead_lh_t35`, `crm_lh_t35`, `letterhead_lh_t35_seed` (the seed-local check) and the buckets `letterhead-lh-t35`, `letterhead-lh-t35-seed` remain on the local Postgres and MinIO (letterhead rows cannot be deleted by design).

## Owner approval

The owner records here, after looking at the PDFs and deciding the open decisions above (copy the hashes if the files changed):

| Field | Value |
|---|---|
| Approved by | Matteo Codogno (owner) |
| Date | 2026-11-17 (in the session, "T35, offerte approvate") |
| Decisions taken (index, `[ ]`, total labels, `{contacts}`, margins, English footer wording) | The three offers are approved as rendered; the listed decisions are accepted as they appear in these PDFs. |
| `offer-1-it-welld_ch.pdf` | `4de05a8e78fdb3dfa374e83bba6ebf2b68453df86d440b8cda1380488f7886f3` |
| `offer-2-en-welld_it.pdf` | `c16cc6064efc8cdfed6d00b7adcb28ca57d504f06cafed84045825eeaee2931f` |
| `offer-3-it-welld_it-with-deal-pdfs.pdf` | `13908c6ae86ed2b6ca2fe6d636463f425b4236aa681ed8e8c615feaacd7f85db` |
