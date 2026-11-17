---
'@operai/crm-ui': minor
---

The offer wizard shows the letterhead service's pages when `GET /scope` says `letterheadService` (specs/20261116-letterhead-service): a `ServicePreview` built on `PagePreview` and `useServicePreview` (the latest result wins, with busy and refused states), a `LetterheadNotice` for an entity with no letterhead or a value too long for the header or footer, linking to Letterheads, the same pages in Try the wizard in the template editor, generate errors for the service path, and Settings without the letterhead upload card (the service owns the letterhead). Offers carry `letterheadVersion` in their type, an over-long section is refused like generate does, and English and Italian strings cover the new states. With the switch off, or an older crm-api, the browser-drawn preview and the upload card stay.
