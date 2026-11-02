---
spec: 020
status: approved
---

# Plan — CRM offer document (specs/020)

## Data model (one migration, crm-api)

- **`Company`**: adds `legalName String?`, `street String?` and `postalCode String?`.
- **`EntityProfile`**:
  - adds `placeOfIssue String?`;
  - adds `letterheadKey String?`, `letterheadBy String?` and `letterheadAt DateTime?`;
  - keeps `offerTermsEn/It`. New offers no longer use them.
- **`OfferTemplate`** (new table):

  | Field | Type | Notes |
  |---|---|---|
  | `id` | string | |
  | `entity` | string | |
  | `name` | string | 1–80 characters, unique per entity among active templates |
  | `language` | `en` \| `it` | |
  | `salutation` | string | |
  | `opening` | string | |
  | `sections` | Json | `[{ heading, body, costs: boolean }]` |
  | `costLines` | Json | `[{ description, kind, amount: "deal" \| "perRelease" \| cents \| { percentBp }, quantity: n \| "manDays" }]` |
  | `costColumns` | Json | `{ position: boolean, unit: boolean }` |
  | `acceptanceLabel` | string? | e.g. "Il Cliente" |
  | `annex` | boolean | |
  | `version` | int | If-Match concurrency, as for deals |
  | `archivedAt` | date-time? | |
  | `updatedBy`, `updatedAt` | | |

  Seeding is lazy and idempotent: the first `GET /offer-templates?entity=` for an entity
  that has no template inserts the fourteen defaults. They live in
  `src/offers/defaultTemplates.ts` and are written from the examples, with client details
  removed.
- **`DealOffer`**: adds `sequenceYear Int?` and `sequenceNo Int?`, both null for older
  offers. `number` remains the generation count and `(dealId, number)` stays unique. The
  printed revision comes from the offer's position among the deal's sequenced offers: none
  for the first, `r1` for the second, and so on.
- **`OfferSequence(entity, year, last)`** (new table), primary key `(entity, year)`. The
  next number is taken with `INSERT … ON CONFLICT DO UPDATE SET last = last + 1 RETURNING
  last`, inside the generation transaction, which already holds the per-deal advisory lock.

## API (crm-api)

| Route | Gate | Behaviour |
|---|---|---|
| `GET /entity-profiles`, `PUT /entity-profiles/{entity}` | as today | Adds `placeOfIssue`. Letterhead metadata is read-only. |
| `POST /entity-profiles/{entity}/letterhead` | as `PUT` | Presigned POST for a PDF of at most 5 MiB, under `letterheads/<entity>/<uuid>.pdf`. |
| `POST /entity-profiles/{entity}/letterhead/confirm` | as `PUT` | Takes `{ key }`. pdf-lib checks the file has one A4 page, then the profile's key is swapped. Otherwise: `422 letterhead_invalid`, and the uploaded object is deleted. |
| `GET /entity-profiles/{entity}/letterhead` | `deal:financials` | Presigned GET, valid 60 s. |
| `GET /offer-templates?entity=&includeArchived=` | `deal:financials` | Lists the entity's templates; seeds the defaults on first read. |
| `POST /offer-templates`, `POST /offer-templates/{id}/duplicate` | `deal:manage` over the entity | Creates a template. |
| `PUT /offer-templates/{id}` | `deal:manage` over the entity | Requires If-Match. |
| `POST /offer-templates/{id}/archive`, `.../restore` | `deal:manage` over the entity | |
| `GET /deals/{id}/offers/draft?templateId=` | same as generate | Returns the prefill with placeholders replaced (AC-3.1). Needs a ready estimate. |
| `POST /deals/{id}/offers` | as today | New body: `{ templateId, salutation, clientLines[], opening, sections[], costColumns, showTotal, costLines[{ description, kind, unitCents \| percentBp, quantity }], acceptanceLabel, contactIds[], annex, attachmentIds[], validityDays, aiAssisted }`. `language` comes from the template. `priceCents`, `terms` and `contactId` are dropped. |
| Companies | as today | Adds `legalName` (≤ 200), `street` (≤ 200) and `postalCode` (≤ 20). |

- `OfferSchema` gains `yearlyCents`. Older offers answer `0`.
- Attachments are read with `storage.getObject`. Their total size is checked against the
  DB's `sizeBytes` before anything is downloaded: ADR-0043's bounded-read rule, applied to
  crm-api's own bucket. This needs **ADR-0057**, because ADR-0043 asks to be revisited when
  a second service reads object bytes.

## Renderer (`src/offers/pdf.ts`, rewritten)

- **Markup parser** (`markup.ts`, pure). It turns a text into blocks (paragraph, bullet
  list, ordered list `1.` or `a.`, nesting, sub-heading, table) whose text is a sequence of
  runs: regular, bold, italic (Helvetica-Oblique) or underlined (a line under the run).
- **Layout engine.**
  - A word-wrapper mixes Helvetica and Helvetica-Bold run by run.
  - Lists are indented and their markers aligned.
  - Table rows split across pages only between rows, and a row taller than a page is
    clipped with a warning in the log.
- **Letterhead.** The letterhead is embedded once with `embedPdf` and drawn on every
  contract and Annex A page with `drawPage`.
  - Body frame: 130 pt from the top, 115 pt from the bottom, 70 pt left and right.
  - The page-number corner is painted white right after the background (D-2).
- **Index**, only with Annex A. The document is rendered twice: the first pass finds the
  page of each section, the second prints those page numbers. The index has a fixed number
  of lines (sections plus the annex), so both passes lay out the same.
- **Cost table** as specified in AC-1.5.
- **Dates** are printed `d.m.yyyy`.
- **After the contract:** Annex A, from `snapshot.scope`, then the chosen PDFs, appended
  with `copyPages`. Page numbers `n/N` count the contract and Annex A pages only.
- **Snapshot** gains:
  - `kind: "contract"`;
  - `template: { id, name }`;
  - `place`, `client`, `salutation`, `opening`, `sections`;
  - `costLines`, `annex`;
  - `attachments` (name and size of each).

  Older snapshots, which have no `kind`, are still listed.

## UI (crm-ui)

- **Settings**, one tab per entity:
  - **Letterhead:** upload, download and replace, with who uploaded it and when; the place
    of issue.
  - **Templates:**
    - a table of templates: name, language, last update, actions (edit, duplicate,
      archive);
    - the template editor, a full page rather than a dialog. It edits name, language,
      salutation, opening and the section list (heading, body textarea, a "costs" radio,
      move up/down, remove, add), plus the default cost lines and the annex switch;
    - a short markup reference beside the textareas.
- **GenerateOfferDialog**, a wide `FormDialog`:
  - template select → load draft;
  - the same section-list editor as the template page, shared as one component;
  - the cost lines editor;
  - contacts (up to 5), the Annex A switch, the PDF attachments to append;
  - validity, AI-assisted;
  - changing the template asks before replacing what is on screen.
- **`OffersCard`**: the price column adds "+ <yearly> per year".
- **`CompanyFormDialog` / `CompanyDetailPage`**: legal name, street, postal code.
- **Library check (D-63):** the section-list editor stays in crm-ui unless a second app
  needs it.

## Tests

### crm-api
- **Sequence:**
  - the first offer is `0001/<year>`;
  - the next deal's first offer is `0002/<year>`;
  - a regeneration is `0001/<year>r1`;
  - two deals generating at once get distinct numbers.
- **Templates:**
  - lazy seeding happens once, even with concurrent reads;
  - CRUD respects the gate and If-Match;
  - an archived template is hidden from the dialog and refused by generate;
  - validation limits.
- **Draft:** placeholders are replaced, the deal amount goes to the right cost line, and
  `{epics}`, `{phases}` and `{timeline}` come from the estimate, and a "per phase" cost line expands to one line per release, with the amount split by man-days and the remainder on the last line.
- **Generate:** validation of cost lines, contacts and attachments (only this deal's PDFs,
  size checked before any download), the price, and `yearlyCents`.
- **Letterhead:**
  - a valid one is accepted;
  - a two-page PDF or a non-PDF is refused, the old letterhead is kept and the uploaded
    object is deleted.
- **Markup parser:**
  - paragraphs, bullets, `1.` and `a.` lists, nesting, bold;
  - sub-heading numbering;
  - tables with `<br>`;
  - a malformed table degrades to paragraphs.
- **Renderer:**
  - the letterhead appears on contract and annex pages but not on appended PDFs;
  - sections are numbered;
  - the total row follows its rule;
  - amounts print as `7'000` and `- 3'000`;
  - the index appears only with the annex and shows the right pages;
  - pages are numbered `n/N`;
  - the seeded templates render without error, in both languages.
- **Matrix:** every new route.

### crm-ui
- Settings: the letterhead upload in three calls, and the template list.
- Template editor: add, remove and reorder sections, choose the costs section, save with
  If-Match, handle a stale version.
- Dialog: load the draft, change the template after confirmation, send the expected body,
  edit cost lines and discounts, choose attachments.
- Offers list: the yearly figure.

## Risks

- **Size.** This is larger than a renderer change: a template editor, a new table and a
  markup engine. Implemented in three agent batches: data and API, renderer, UI.
- **Two-pass index.** Rendering twice costs a few milliseconds for 20 pages.
- **Unreadable PDFs.** An appended PDF that pdf-lib cannot parse (an encrypted one, for
  example) makes the generation fail with a 422 that names the file.
- **Corner mask.** It assumes the page number sits in the bottom-right corner of the
  letterhead, as in the supplied one (D-2).
- **Default texts.** They contain commercial figures (140 CHF/hour, a 25-hour SLA, a
  3-month warranty). They are wellD's standard terms and can be edited per entity. The
  Italian entity must adapt its currency.

## Additions from the Studio V example (D-13)

- `src/offers/timeline.ts` (pure): the elapsed chain for each release, mirroring
  `useEstimator.ts`, for the best case (optimistic values) and the worst case (pessimistic
  values), then converted to months. Its test vectors are shared with estimai-ui, the same
  way as for `scope.ts`.
- Template cost lines: `amount: "deal" | cents | "perRelease"`. A template carries
  `showTotal`, and the offer body carries `showTotal` too.
- Annex lettering is computed at render time, from the order in which the annexes appear
  in the snapshot.
- **Risk:** the elapsed chain is a second piece of estimation logic outside estimai-ui.
  The shared vectors catch any drift. If the two keep diverging, the escalation path is an
  estimai-api endpoint that returns the computed summary.

## Additions from the Cornèr consulting example (D-14)

- The cost table's columns are two switches (`position`, `unit`) instead of a layout enum.
- A percentage discount is stored as basis points (`percentBp`, 1–10 000). Its amount is
  `roundHalfUp(oneOffSum × bp / 10 000)` in cents: one rule, computed once at generation
  time and written to the snapshot.
- A template quantity may be `"manDays"`: the draft fills in the estimate's total man-days,
  rounded half up. The `{manDays}` placeholder uses the same figure.
