---
spec: 020
status: in-progress
---

# Tasks — CRM offer document (specs/020)

| ID | Task | Depends on | State | Verified by |
|---|---|---|---|---|
| T1 | Spec, plan, decisions; shared types `crm-api/src/offers/contract.ts`; Italian seed templates `defaultTemplates.ts` | — | [x] | typecheck |
| T2 | crm-api renderer: `markup.ts` (parser), `pdf.ts` → `renderContractPdf(snapshot, inputs)` with letterhead, corner mask, index (two passes, only with annex), cost table, acceptance, annex lettering, Annex A, appended PDFs, `n/N`; legacy 018 renderer kept for old snapshots only if still referenced | T1 | [x] | `markup.test.ts` (14) + `contractPdf.test.ts` (34, incl. long-word timing and index alignment); seven templates rendered on the real letterhead and checked visually |
| T3 | crm-api data + API: migration (Company fields, EntityProfile place + letterhead, OfferTemplate, OfferSequence, DealOffer sequence columns); templates CRUD + lazy seed (IT + EN translations); letterhead upload/confirm/download; `timeline.ts` + shared vectors; draft route (placeholders, perRelease split, manDays); generate route (new body, cost math, numbering, attachments bounded read); companies fields; ADR-0057; matrix rows | T1 | [x] | crm-api 239 tests on `crm_test` + typecheck; estimai-ui `useEstimator.test.ts` (4); migration `20261102155018_offer_templates`; ADR-0057 |
| T4 | crm-ui: company fields; Settings letterhead + templates list + template editor; generate dialog on templates; offers list yearly figure; strings en/it | T3 | [x] | crm-ui lint, build, 178 tests (43 new or rewritten) |
| T5 | Changeset, AGENTS.md (crm-api note, ADR-0057), crm-api README | T2–T4 | [x] | `.changeset/crm-offer-document.md`, AGENTS.md crm-api note + ADR-0057 line |
| T6 | Visual check: generate the seven templates against the real letterhead and compare with the examples | T2, T3 | [x] | seven Italian templates rendered on the real letterhead (renderer task); full-flow PDFs pending T7 |
| T7 | Browser smoke through the stack | T4 | [ ] | after `mise run dev` restart |
