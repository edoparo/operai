---
"@operai/crm-api": minor
"@operai/crm-ui": minor
"@operai/auth": minor
---

CRM sales flow (specs/20261101-crm-sales-flow, ADR 20261101-crm-financial-visibility-permission/0055):
- **Technical role:** a new `crm-technical` role that sees the CRM without the money. The new
  `deal:financials` permission is held by `admin` and `sales`.
- **Estimates:** technical estimates are requested from a deal and created in EstimAI with the
  technician as editor. A deal reaches Proposal only once its estimate is marked ready; an
  admin can override that.
- **Offers and attachments:** offer PDFs are generated and versioned, and files can be
  attached to a deal. Both live in the CRM's own EU bucket.
- **Pipeline:** a card shows a badge while the deal waits for its technical estimate.
- **CRM users only:** owners and task assignees must be users who can open the CRM.

`auth`'s app-access check also answers by user id, and the user directory can be filtered by
app.

The `proposal` and `negotiation` stages are now shown as "Offer in preparation" and "Offer sent", and the newest offer has a "Mark as sent" action that moves the deal to "Offer sent".
