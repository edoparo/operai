---
"@operai/crm-api": minor
"@operai/crm-ui": minor
---

CRM company status follows the deals (specs/20261101-crm AC-1.8, AC-1.9):
- **Won → customer:** moving a deal to won makes its company a customer if it was a prospect or a former client.
- **Inactive → former client:** a customer with no deal won in the last 12 months and none open reads as a former client, in the record, the list and the status filter. It is derived on read, never written, and the company page says why. A new deal makes it a customer again.
