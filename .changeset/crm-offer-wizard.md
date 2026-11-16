---
"@operai/crm-api": minor
"@operai/crm-ui": minor
"@operai/ui": minor
"@operai/shell": patch
---

CRM offer wizard (specs/20261115-crm-offer-wizard): an offer is now built step by step from a
template that declares what it asks for, instead of editing a long contract text by hand.
Pick a template for the deal's entity and language, fill in its fields, lists, tables and optional
blocks, check the cost table and generate the PDF. The draft lives on the server, so it resumes
after a reload or on another device; a missing or invalid answer blocks generation and says where.
An unsent offer can be edited under the same reference and a sent one revised as the next `rN`; a
legacy contract offer still opens the classic dialog. Administrators write wizard templates in
Settings (self-describing markup with live problems) and try them on sample answers before
saving; the seven standard templates are seeded per entity and language.
- **crm-api:** a new migration (`20261115120000_offer_wizard`, apply it before the UI ships);
  template format `wizard` alongside the classic one, with supersession per entity and language;
  draft routes (create, resume, save with If-Match, discard) and generation from the stored draft;
  renderer support for several total rows and option lines in the cost table.
- **crm-ui:** the offer wizard page, the deal page's offers card (draft row, Continue, Discard,
  Edit, New revision) and the template editor with its "Try the wizard" view.
- **ui:** new paper tokens used by the offer document and wizard preview.
- **shell:** patch only: it ships the library with the new tokens.

The wizard's preview draws the entity's letterhead behind its first page (pdf.js in the browser, fetched
from the CRM's own bucket), and the seeded templates name the issuer — legal name and address — from the
entity profile instead of their text; seeds created earlier and never edited are upgraded once in place.

The preview is laid out as real A4 pages inside the PDF's frame, with the letterhead behind every page and
page breaks approximating the PDF's. Uploaded letterheads are bounded by decoded size before any parser
runs, stored as the checked bytes, and refused (409 `letterhead_unusable`) when a stored one fails the bound.
