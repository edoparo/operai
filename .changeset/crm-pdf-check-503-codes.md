---
'@operai/crm-api': patch
'@operai/crm-ui': patch
---

The 503 of the isolated PDF checks is documented and translated. crm-api's OpenAPI now names `pdf_check_busy` and `pdf_check_unavailable` on the six routes that can answer them (letterhead confirm and link, attachment confirm, offer generate and edit, draft generate), and crm-ui says both in English and Italian instead of showing the server's English detail.
