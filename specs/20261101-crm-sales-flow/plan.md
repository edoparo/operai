---
spec: 20261101
status: approved
---

# Plan — CRM sales flow (specs/20261101-crm-sales-flow)

Approved together with the spec on 2026-11-01. Decisions taken here, including the
answers to the spec's open questions O1–O4, are in [decisions.md](./decisions.md).

## Architecture

No new service and no new trust between services:
- `auth`: one catalog permission, one role, an id-keyed form of the app-access decision
  endpoint, and an app filter on the user directory.
- `crm-api`:
  - hides money from callers without the new permission;
  - gates the Qualified → Proposal move on a linked estimate;
  - generates offer PDFs (`pdf-lib`, like refund-api's batch PDF, ADR 20260719-refund-batch-pdf-generation-pdf-lib);
  - stores offers and attachments in its own EU bucket through presigned URLs (ADR 20260716-eu-object-storage-refund-attachments
    pattern, like inventory-api's invoice files).
- `estimai-api`: unchanged. crm-api calls it with the caller's own JWT (forwarded,
  ADR 20260807-third-party-app-access-decision-endpoint-forwarded-jwt style).
- `crm-ui`: hides figures, adds the estimate panel, offers and attachments to the deal
  page, and the entity profile (letterhead and terms) screen.

## auth

| Change | Contract |
|---|---|
| Catalog `crm` | + `deal:financials` (unconditioned). Seed: `admin` and `sales` get it. New system role **`crm-technical`** = `crm:access`. |
| `POST /authz/app-access-check` | body is `{ appId, email }` **or** `{ appId, userId }` (exactly one). Same caller gate, limiter, equalised negative body and response floor. `userId` probe: `id = $1 AND deletedAt IS NULL`. Answer `{ eligible: true, userId }` / `{ eligible: false }`. |
| `GET /authz/users/directory` | optional `?appId=<id>`: only users who hold `(appId, "access")`. Gate, shape, sort and rate limit unchanged. |

ADR 20261101-app-access-check-by-user-id-and-directory-app-filter records both endpoint changes (amends ADR 20260807-third-party-app-access-decision-endpoint-forwarded-jwt and ADR 20261006-user-directory-endpoint-capability-gated).

## crm-api

### Data model (one migration)

```prisma
model DealEstimate {           // 1:1 with a deal
  dealId          String   @id
  estimateId      String   // estimai-api id; never dereferenced by a FK
  estimateName    String
  technicalUserId String
  state           EstimateState  // requested | ready
  requestedBy     String
  requestedAt     DateTime
  readyBy         String?
  readyAt         DateTime?
  overrideBy      String?  // admin override of the gate (AC-3.7)
  overrideReason  String?
}
model DealOffer {              // immutable once written, except deletedAt
  id, dealId, number Int (unique per deal), language (en|it),
  priceCents BigInt, currency, validityDays Int, terms String?,
  snapshot Json,               // the figures and texts printed
  objectKey String, sizeBytes Int, createdBy, createdAt, deletedAt?, deletedBy?
}
model DealAttachment {         // two-phase: pending → stored
  id, dealId, fileName, contentType, sizeBytes, objectKey,
  status (pending|stored), uploadedBy, createdAt, deletedAt?
}
model EntityProfile {          // letterhead + default terms per entity
  entity Entity @id, legalName, addressLines String[], vatNumber?, iban?,
  offerTermsEn?, offerTermsIt?, updatedBy, updatedAt
}
```

### Financial visibility (US-1)

The authz middleware already gives the route the caller's permissions.
`canSeeFinancials(c)` checks for `deal:financials`. View builders take a `financials`
flag. Without it they drop:
- `amountCents`, `currency`, `notes` and offer prices from deals;
- `totals` from `GET /pipeline`, keeping counts only.

`GET /scope` gains `financials: boolean`.

### People checks (US-2)

`requireCrmUsers(c, checks)` replaces `requireActiveUsers`. For every id other than the
caller's, it sends `POST {AUTH_BASE_URL}/authz/app-access-check {appId:"crm", userId}`
with the forwarded JWT:
- `eligible:false` → 422 `owner_not_crm_user`, naming the field;
- network error, 5xx or 429 → 503 `identity_unavailable` (fail closed).

### Estimates (US-3)

| Route | Who | Effect |
|---|---|---|
| `POST /deals/:id/estimate` `{ technicalUserId }` | `deal:manage` in scope | Checks the deal (`lead`/`qualified`, no live request), the technician (crm user) and the technician's email from `GET /authz/users/directory?appId=estimai` (forwarded JWT). Then, as the caller, it calls estimai-api: `POST /estimates` (`name` = "<company> — <deal>", empty content) and `POST /estimates/:id/collaborators {email, accessLevel:"editor"}`. Finally it stores `DealEstimate(requested)` and creates the technician's task. A 403 from estimai → 403 `estimai_access_required`. If the technician has no EstimAI access → 422 `technician_not_estimai_user`. If the collaborator grant fails, the new estimate is deleted. |
| `POST /deals/:id/estimate/ready` | technician, or unconditioned `deal:manage` | `ready`, readyBy/At; completes the request task |
| `POST /deals/:id/estimate/reopen` | requester, technician, or unconditioned `deal:manage` | back to `requested` |
| `POST /deals/:id/estimate/override` `{ reason }` | `deal:manage` **unconditioned** (every entity: the admin) | records the override and adds a note to the timeline |
| `DELETE /deals/:id/estimate` | `deal:manage` in scope | unlinks only; the estimate in EstimAI stays |

`DealView.estimate` is `{ estimateId, name, technical: PersonRef, state, requestedAt,
readyAt, overridden }` or null.

Gate in `POST /deals/:id/stage` and `PATCH` (stage is not patchable): moving **from**
`lead`/`qualified` **to** `proposal`/`negotiation`/`won` needs the estimate `ready` or
overridden, else 409 `estimate_not_ready`. Deals already past `qualified` are
untouched.

### Offers and attachments (US-4)

- **Storage:** `src/lib/storage.ts` and `s3Residency.ts` are copied from inventory-api.
  - Env: `CRM_S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/EU_ENDPOINT_HOSTS`.
  - **All optional as a group** (all or none, EU-validated when set). Without them the
    offer and attachment routes answer 503 `storage_unconfigured`, and the rest of the
    CRM works.
  - The production template lists them as required.
- **Offers:** the PDF is generated server-side with `pdf-lib` and standard Helvetica
  (WinAnsi; unsupported characters replaced), A4 portrait.
  - Content (O1): letterhead, client, title, scope table (release → epic → man-days),
    price, validity, terms, signature block.
  - The figures are computed by `src/offers/scope.ts`, a pure function. Expected =
    PERT + risk, summed per epic and release (AGENTS.md: "Summary always SUMs on
    Expected"). AI-assisted = Expected × (1 − gain). The function has shared test
    vectors against estimai-ui's `pertCalc`.
  - Stored at `offers/<dealId>/<offerId>.pdf`.

| Route | Who | Effect |
|---|---|---|
| `GET /deals/:id/offers` | `deal:financials` | list (without prices for nobody: the route is financial) |
| `POST /deals/:id/offers` `{ priceCents?, validityDays?, terms?, language, aiAssisted }` | `deal:manage` in scope + `deal:financials` | estimate must be `ready`. Reads it from estimai-api (forwarded JWT), builds the snapshot, renders, uploads, then inserts with `number = max+1` under an advisory lock on the deal. |
| `GET /deals/:id/offers/:offerId/download` | `deal:financials` | 60 s presigned GET |
| `DELETE /deals/:id/offers/:offerId` | author or admin | soft delete |
| `GET /deals/:id/attachments` | `crm:access` | stored ones only |
| `POST /deals/:id/attachments` `{ fileName, contentType, sizeBytes }` | `crm:access` | pending row + presigned POST (≤ 20 MiB, allowed types) |
| `POST /deals/:id/attachments/:aid/confirm` | uploader | HEAD → `stored` |
| `GET /deals/:id/attachments/:aid/download` | `crm:access`; a non-financials caller only for their own uploads (AC-1.3) | 60 s presigned GET |
| `DELETE /deals/:id/attachments/:aid` | uploader or admin | soft delete |
| `GET /entity-profiles`, `PUT /entity-profiles/:entity` | read: `deal:financials`; write: `deal:manage` covering that entity | letterhead and terms (O2) |

## crm-ui

- `ScopeContext` gains `financials`. Every amount cell, total, weighted line, the deal
  form's amount field and the notes are rendered only when it is true.
- **Deal page:**
  - an **Estimate** card: request dialog (technician picker from the directory with
    `appId=estimai`), state badge, Open in EstimAI link (`/estimai/estimates/<id>`),
    Mark ready / Reopen / Override;
  - an **Offers** card: generate dialog, version list, download;
  - an **Attachments** card: upload, list, download, delete.
- The board and the stage dialog explain `estimate_not_ready` and link to the
  estimate card.
- **Settings tab:** entity profiles. Visible to `deal:manage` holders.
- People pickers pass `appId=crm` to the directory.

## Tests

- **auth:** catalog/seed (new permission, role), app-access-check by userId (eligible,
  negative body identical to the email path, xor validation), directory `appId` filter.
- **crm-api:**
  - matrix over every new route for outsider, technician (`crm:access`), salesCh and admin;
  - financial redaction on deals, pipeline and scope;
  - estimate lifecycle with a fake estimai-api (request, collaborator failure → estimate
    deleted, ready, reopen, override, gate 409);
  - offers with a fake storage (numbering, snapshot, price defaults, download gate);
  - attachments (two-phase, size/type limits, download rule for technicians);
  - `scope.ts` vectors.
- **crm-ui:** redaction rendering, estimate card states, gate message, offer generate
  dialog, attachment upload flow (fake storage POST).

## Risks

- Forwarding the caller's JWT to estimai-api means a salesperson needs EstimAI access to
  request an estimate. That is intended (they own the estimate), and the 403 says so.
- `scope.ts` duplicates part of EstimAI's arithmetic. Shared test vectors are the guard,
  the same pattern as ADR 20260720-mileage-rate-money-precision-integer-micros's mileage vectors.
- The PDF uses a standard font: characters outside WinAnsi are replaced. A real font is
  a follow-up if needed.
