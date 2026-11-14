---
"@operai/crm-api": minor
"@operai/crm-ui": minor
---

CRM (specs/20261101-crm AC-2.3, AC-3.2):
- **Deal amount optional:** a deal can be created without an amount, which is often only known after the estimate or qualification. It can be set or cleared later. The deal page shows "Not set yet", the pipeline counts the deal without adding it to the totals, and an offer drafted from it leaves the prices blank.
- **Edit a contact from the company:** each contact on a company page has an Edit button that opens the contact form there, without going to the contacts list.
