-- specs/20261103-projects-handoff (2026-11-24, owner; specs/20261101-crm US-10): a won public tender is taken as a
-- project WITHOUT a purchase order: the funding body is the project's company, there is no ordine, no ops-manager, no
-- billing, and the project manager is chosen at the take. The tender deal is linked here; the unique index arbitrates
-- two takes of the same tender, as `purchase_order.dealId` does for a deal.
ALTER TABLE "project" ADD COLUMN "tenderDealId" TEXT;
CREATE UNIQUE INDEX "project_tenderDealId_key" ON "project" ("tenderDealId");
-- A project from a tender has a client company and its project manager from the start.
ALTER TABLE "project" ADD CONSTRAINT "project_tender_shape"
  CHECK ("tenderDealId" IS NULL OR ("companyId" IS NOT NULL AND "projectManagerId" IS NOT NULL));
