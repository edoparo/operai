# 20261101 — CRM money is its own permission, `deal:financials`, and crm-api leaves it out of the response for anyone without it

**Date:** 2026-11-01
**Status:** Accepted (specs/20261101-crm-sales-flow US-1; the product owner chose this option)
**Deciders:** wellD
**Project:** Operai

---

## Context

In the first version of the CRM (specs/20261101-crm, ADR 20261101-crm-tool-shape-and-authorization), `crm:access` reads everything, deal
amounts included. Its first local use brought in a new kind of user: the **technician**, who
estimates the work and follows the client relationship. The technician needs the companies,
contacts, deals, history and their own tasks, but must not see the money being negotiated.

## Decision

1. **The `crm` catalog gains `deal:financials`.** It has no conditions: money is visible for
   both entities or for neither.
   - The seed grants it to `admin` and `sales`.
   - A new system role, `crm-technical`, holds `crm:access` alone.
2. **crm-api redacts on the server.** For a caller without `deal:financials`, crm-api *omits*
   these fields from the response:
   - a deal's `amountCents` and `currency`;
   - a deal's `notes` (they often carry prices);
   - the pipeline's per-stage `totals`.

   The fields are left out, never zeroed or nulled: a zero could be read as a value. Counts
   stay.
3. **Money-only routes need the permission:**
   - offer documents, which print the price;
   - entity profiles, which hold the commercial terms.

   An attachment may be a signed offer, so a caller without the permission downloads only
   their own uploads.
4. **`GET /scope` reports `financials`,** so crm-ui shows exactly what the server sends.
5. **Holding `deal:manage` without `deal:financials` is unsupported**, because managing a deal
   means setting its amount.
   - The seed never creates that combination.
   - crm-api refuses such a caller every financial route, offer generation included.
   - The authorization matrix tests the combination anyway.

## Alternatives considered

- **Hide the figures in the UI only.** Rejected: the numbers would still reach the browser,
  where anyone can read them.
- **A read-only technical role.** Rejected by the product owner: technicians log calls and
  complete tasks, so they need to write.
- **Technicians see only the deals they estimate.** Rejected: that would be a record-level ACL
  (ADR 20260807-record-level-acl-resource-server-owned-access-primitive's kind of primitive) for a team tool whose reads are deliberately open (ADR 20261101-crm-tool-shape-and-authorization).
- **Entity-scoped financials.** Rejected for v1: no entity needs to hide its prices from the
  other entity's sales staff. If one ever does, the condition can be added to the permission.

## Consequences

- Every view builder of crm-api takes the caller's `financials` flag. A new money field must
  be added to that redaction, and a test in `crm-api/src/deals/financials.test.ts` should pin
  it.
- The deal schema in the OpenAPI document marks the money fields as optional.
- A sales user who loses `deal:financials` keeps their deal reach (`deal:manage`) but loses
  every money route. That is consistent, and the matrix test shows it.
