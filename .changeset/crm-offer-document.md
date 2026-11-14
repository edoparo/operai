---
"@operai/crm-api": minor
"@operai/crm-ui": minor
"@operai/estimai-ui": patch
---

CRM offer document (specs/20261102-crm-offer-document, ADR 20261102-crm-api-reads-attachment-bytes-for-offer-annexes):
- **Letterhead:** each entity uploads its letterhead PDF in Settings; every offer page is printed on it.
- **Offer templates:** wellD's contract structure as editable templates per entity and language (14 seeded from wellD's own offers, Italian and English), with a template editor in Settings.
- **Generate dialog:** starts from a template; the draft is prefilled from the estimate (epics, phases, timing per release, man-days, amount split per release); cost lines with unit price, quantity, yearly lines and discounts (amount or percentage); deal PDFs can be appended as annexes; optional Annex A with the effort detail.
- **Numbering:** `0017/2026`, then `0017/2026r1` for later revisions of the same deal.
- **Companies:** legal name, street and postal code.
- **Fix:** estimate activities are matched to their release by name as well as id, so the effort no longer lands under "Other".
