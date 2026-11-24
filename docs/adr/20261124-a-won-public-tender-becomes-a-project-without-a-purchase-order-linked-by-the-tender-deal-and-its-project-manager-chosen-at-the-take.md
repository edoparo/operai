# 20261124 — A won public tender becomes a project without a purchase order, linked by the tender deal, its project manager chosen at the take

**Date:** 2026-11-24  
**Status:** Accepted (decided by the owner, Matteo Codogno, 2026-11-24; amends ADR 20261105-terms-and-purchase-order-two-optional-records-of-a-project-contract-retired and ADR 20261105-handoff-take-and-purchase-order-receive-capabilities-auth-holders-listing-amends-0047)  
**Deciders:** Matteo Codogno (owner), wellD  
**Project:** Operai

---

## Context

wellD answers public tenders (e.g. a Horizon Chips JU call). The CRM now records a tender as a deal
(`kind: tender`, specs/20261101-crm US-10) whose company is a **funding body**: the issuer of the
call, never invoiced, never a customer. Until now a won deal became a project only through the take,
which writes the project, its terms and a **purchase order** in one statement; the purchase order is
the deal's only link to the project (`purchase_order.dealId` UNIQUE) and carries the ops-manager who
later picks the project manager, the client's referent and the Bexio order id. None of that applies
to a tender: there is no order, no billing and no ops-manager hand-over.

## Decision

- **Same queue, same route, a different take.** A won tender appears in the to-start queue
  (`kind: tender`, read live from crm-api's `GET /system/deals`) and is taken with
  `POST /queue/{dealId}/project`. For a tender the body has `projectManagerId` (required, checked live
  as a Projects user like any project's) and **no** `opsManagerId` or `referentContactId` (422
  `not_for_tenders`); for a deal, `projectManagerId` is refused (422 `only_for_tenders`) and
  `opsManagerId` is required (422 `ops_manager_required`). Who may take is unchanged (`handoff:take`
  and `project:manage` for the deal's entity).
- **The project, never an order.** The take writes the project (the funding body as its company,
  its project manager set, `planned`) and its terms in one statement, and **no purchase order**:
  "a purchase order is born only from a deal's take" still holds, a tender simply has none.
- **The link is `project.tenderDealId`**, UNIQUE: the database, not the pre-check, arbitrates two
  takes of the same tender (409 `deal_taken`), as `purchase_order.dealId` does for a deal. A CHECK
  (`project_tender_shape`) requires a company and a project manager on such a project. The queue
  subtracts both links.
- **The CRM sees it the same way.** `GET /system/purchase-orders?dealIds=` also answers a tender's
  project, with `purchaseOrderId: null` and `bexioOrderId: null`, so the CRM's deal page shows the
  project of a won tender with no change in crm-api.

## Consequences

- A project has three origins: hand-made (no link), a deal (purchase order) or a tender
  (`tenderDealId`); never two links (a tender is not a deal with a purchase order).
- Changing a deal's kind after it was taken does not move its project; a later take of the other kind
  is refused only by the pre-check that reads both links (`deal_taken`).
- An older crm-api sends no `kind`: every deal is standard, the old behaviour.

## Rejected

- **A purchase order without an order** (nullable ops-manager, Bexio, referent): the record would
  mean nothing for a tender and every reader of a purchase order would need a tender branch.
- **A separate route** `POST /queue/{dealId}/tender-project`: the same gates, the same terms and the
  same race; one route with a body checked against the deal's kind keeps one take.
- **A new project type "funded"**: the owner chose the existing types and their delivery terms.
