---
id: 018
slug: crm-sales-flow
status: in-progress
rigor: mvp
created: 2026-11-01
approved: 2026-11-01
depends-on: 017
---

# CRM sales flow — technical estimates, offer documents, a money-blind technical role

> **Origin.** The first local use of the CRM (specs/017) surfaced four gaps. On 2026-11-01
> the product owner chose, for each one, the option this spec builds on:
> 1. **Technical role:** a new "see the money" permission. A technician holds only
>    `crm:access` and sees everything except the figures.
> 2. **Estimates:** requested from the CRM. The salesperson picks a technician, the CRM
>    creates the estimate in EstimAI with the technician as editor, and a deal cannot reach
>    Proposal until the technician marks the estimate ready.
> 3. **Offers:** a generated offer PDF plus uploaded attachments, kept in an EU bucket of
>    the CRM's own, with every version retained.
> 4. **Assignees:** auth's app-access decision endpoint also accepts a user id. crm-api
>    refuses a task assignee or an owner without CRM access, and the picker lists only CRM
>    users.
>
> The details the owner did not fix are this spec's proposals. They are listed under
> **Open questions** and in `decisions.md` once planned.

## Problem

The pipeline of specs/017 records deals but not how wellD actually sells. Three things
happen between "qualified" and "proposal":
- a technician estimates the work;
- someone turns the estimate into an offer;
- the offer goes out as a document.

Today:
- **Estimates:** they live in EstimAI with no link to the deal. Nothing stops a deal from
  reaching Proposal without one.
- **Offers:** written outside Operai, and the version actually sent is not kept anywhere.
- **Technicians:** they need the client context (who, what, history, their tasks) but
  must not see the money. Every CRM user sees every amount today.
- **Tasks:** one can be assigned to a person who cannot open the CRM.

## Domain language

- **financials** — every money figure of the CRM: a deal's amount, weighted amount, the
  pipeline's per-stage totals, prices in an offer. Visible only with **`deal:financials`**.
- **technical contact** — the person responsible for a deal's estimate. An active user
  with `crm:access` and access to EstimAI.
- **estimate request** — a deal's link to one EstimAI estimate, created from the CRM, with
  a state of `requested`, then `ready`.
- **offer** — a generated PDF for a deal, numbered `v1`, `v2` and so on, never
  overwritten.
- **attachment** — a file uploaded to a deal (signed offer, specification, …). Kept in
  the CRM's EU bucket, reached only through short-lived presigned URLs.

## User stories and acceptance criteria

### US-1 A technician sees the client, not the money
As a technician, I want the CRM's context on the deals I estimate without seeing amounts,
so that commercial figures stay with sales.

- AC-1.1 The `crm` catalog gains `deal:financials`, unconditioned.
  - The seed grants it to `admin` and `sales`.
  - A new system role, `crm-technical`, holds `crm:access` only.
- AC-1.2 For a caller without `deal:financials`, crm-api omits every financial field from
  every response:
  - deal `amountCents` and `currency`;
  - all pipeline totals and weighted amounts;
  - offer prices.

  The fields are left out of the response, not sent as null or zero. The UI shows the
  deal, its company and stage, and no figures.
- AC-1.3 A caller without `deal:financials` cannot download a generated offer (403). They
  can download attachments only if they uploaded them.
- AC-1.4 Holding `deal:manage` without `deal:financials` is refused at seed time and
  documented as unsupported: managing a deal means setting its amount.

### US-2 Only CRM users receive CRM work
As a salesperson, I want owners and assignees to be people who can open the CRM, so that
nothing is assigned into the void.

- AC-2.1 `auth POST /authz/app-access-check` accepts `{ appId, userId }` as well as
  `{ appId, email }`.
  - Same caller gate, rate limit and byte-identical negative answer (ADR-0035).
- AC-2.2 crm-api refuses an owner or a task assignee without `crm:access` with 422
  `owner_not_crm_user`.
  - The check runs live on every write and fails closed (503) when auth cannot answer.
  - Setting oneself needs no check.
- AC-2.3 The owner, assignee and technical-contact pickers list only users who hold
  `crm:access` (the directory's `appId` filter; see plan).

### US-3 A deal gets its estimate before it becomes a proposal
As a salesperson, I want to ask a technician for an estimate from the deal, so that the
offer rests on a real estimate.

- AC-3.1 On a `qualified` deal, a holder of `deal:manage` chooses a technical contact and
  requests an estimate. In one action:
  - the CRM creates an estimate in EstimAI, owned by the requester and named after the
    deal and company;
  - grants the technical contact `editor` on it (specs/013);
  - links it to the deal as `requested`.
- AC-3.2 The deal page shows the estimate's name, the technical contact and the state,
  with a link that opens it in EstimAI.
- AC-3.3 Only the technical contact (or an admin) marks the estimate `ready`, from the
  deal page or the task list.
  - Marking it ready completes the "estimate requested" task (AC-3.5).
  - The requester can set the estimate back to `requested`.
- AC-3.4 A deal moves from `qualified` (or `lead`) to `proposal` or later only if its
  estimate is `ready`; otherwise 409 `estimate_not_ready`.
  - The board and the stage dialog say why.
  - Moving to `lost` is never blocked.
  - Deals already past `qualified` when this ships are not blocked retroactively.
- AC-3.5 Requesting an estimate creates a task for the technical contact ("Estimate
  <deal>", due in 5 working days, editable).
  - It appears on the deal's timeline as soon as the request succeeds, without a reload.
  - Unlinking the estimate deletes the task while it is still open; a completed one stays
    on the timeline (2026-11-05).
- AC-3.6 The flow needs no new trust between services: every EstimAI call is the
  requester's own (forwarded user JWT). A requester without EstimAI access gets 403
  `estimai_access_required`.
- AC-3.7 If the EstimAI estimate is deleted or the requester loses access, the deal shows
  the link as unavailable.
  - The gate (AC-3.4) then needs a new request.
  - An admin can override it with a reason, which is recorded on the deal's timeline.

### US-4 Offers are generated and kept
As a salesperson, I want to generate the offer from the deal and its estimate and keep
every version I sent, so that the history of what we promised is in one place.

- AC-4.1 On a deal with a `ready` estimate, a holder of `deal:manage` and
  `deal:financials` generates an offer PDF. It contains:
  - the issuing entity's letterhead block (name, address and VAT number, from crm-api
    settings);
  - the client company and contact;
  - the deal title;
  - the scope: the estimate's releases and epics with their man-days (AI-assisted figures
    if the requester chooses);
  - the price, entered when generating: the deal amount by default, in the deal's
    currency;
  - validity (default 30 days) and free-text terms;
  - offer number and date.
- AC-4.2 Each generation stores a new immutable version (`v1`, `v2`, …) with who generated
  it, when, and a snapshot of the figures used. Old versions stay downloadable.
- AC-4.3 Any `crm:access` holder uploads attachments to a deal:
  - PDF, DOCX, XLSX, PNG or JPEG, at most 20 MiB each;
  - uploaded through a presigned POST to the CRM's own EU bucket, confirmed by crm-api;
  - downloadable through a ~60 s presigned GET (ADR-0016 pattern).
- AC-4.4 Attachments and offers can be deleted only by their author or an admin. A
  deleted offer version keeps its number (the gap is visible).
- AC-4.5 Generating an offer on a `qualified` deal offers to move it to `proposal` in the
  same step.
- AC-4.6 (owner, 2026-11-02) `proposal` is shown as "Offer in preparation" and `negotiation`
  as "Offer sent". On a deal in `lead`, `qualified` or `proposal`, a `deal:manage` holder
  marks the newest offer as sent, after a confirmation, and the deal moves to `negotiation`
  (the usual stage change: If-Match, estimate gate, timeline). Generating an offer never
  marks it sent: producing the PDF is not sending it.

### US-5 The rules are visible
- AC-5.1 All new copy exists in English and Italian.
- AC-5.2 The authorization matrix test covers every new route for:
  - no `crm:access`;
  - `crm:access` only (the technician);
  - `deal:manage` without `deal:financials` (refused at seed, but tested);
  - full sales.

## Non-goals
- E-signature, sending the offer by email from Operai, and client-facing links.
- Offer templates other than the one wellD layout; Word export.
- Converting currencies; per-line pricing (the price is one figure per offer).
- Changing EstimAI's computation or its UI beyond what the link needs.
- Notifications for estimate requests (still specs/017 D-14; the task list carries them).

## Open questions
- O1 Offer content: is the scope by release + epic with man-days the right level, or
  should activities be listed? Standard terms text per entity — who provides it?
- O2 Letterhead data (address, VAT number, IBAN?) per entity: does it come from a CRM
  setting or from an existing source?
- O3 Should the technician see the deal's own notes (which may mention prices)? Proposal:
  no. Notes are financial-adjacent and are hidden like amounts.
- O4 Does `crm-technical` also need EstimAI access granted automatically, or does the
  admin grant both roles?
- O5 Infrastructure: a new EU bucket (`CRM_S3_*`) and the crm-api Railway service must be
  provisioned before US-4 can run in production (specs/017 T16).
