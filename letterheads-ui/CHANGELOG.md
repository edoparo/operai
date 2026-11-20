# @operai/letterheads-ui

## 0.4.0

### Minor Changes

- 1e948ef: The look of the document title is now adjustable in Letterheads. The look section of the configurator has a new "Document title" group next to the three heading levels, with size (8 to 36 pt), bold and colour. It styles the title line of a document, such as the "CONTRATTO DI FORNITURA" line of a CRM offer, which is always set in the headings font. The default is the 20 pt bold black used until now, so a version saved earlier opens unchanged and prints exactly as it did; a change of the title is listed as a change of "Headings and document title" in the version history.
- 856635d: Letterheads can now be set in Inter, and the distance between the header or footer and the body is adjustable. Inter (regular, bold and italic) joins the font list for the body text, the headings and the header and footer. Each header and footer has a new "Distance from the body (mm)" field, between 0 and 40 mm, 3 mm by default: increase it to move the logo and header text further from the body. A distance that no longer fits the margin together with the header or footer is refused on save as before ("does not fit the top margin"), and a version saved earlier opens with 3 mm and prints exactly as it did.

## 0.3.0

### Minor Changes

- 8048f95: The configurator preview now says where the company details come from: the real name, address, VAT number, IBAN and contacts of the entity, in the preview language, with the body of the page as sample text, and a link to edit them in Legal entities (or, for a person who cannot, who keeps them). A legend explains the look of a detail that is not filled in yet. When the details cannot be read, a notice says every detail is shown as missing, that the settings are unaffected and that documents are not made meanwhile. All of it in English and Italian.

## 0.2.1

### Patch Changes

- 5ddbb9a: A refused preview lists each refused value with a link to its control, and a header that does not fit because of its logo says so — in the summary, under the Header heading and under the logo's height. The logo height hint says the logo must fit the top margin with the header lines.

## 0.2.0

### Minor Changes

- 4b6e43e: Add letterheads-ui (specs/20261116-letterhead-service): the Letterheads tool as a federated remote at `/letterheads`, gated by `letterheads:access`. It has the configurator form for the letterhead of an entity (variants, zones, colours, texts and their placeholders, a refused-values error summary), logo and background upload, a live preview of the sample document through `PagePreview`, save with refused values, conflict handling and a leave guard, and the history with version view and restore, with read-only modes for a holder of access without `letterhead:manage` on the entity. It also has the 403, 503 and failure states, English and Italian copy with parity and no-hard-coded-strings tests, and the API client for letterhead-api.
