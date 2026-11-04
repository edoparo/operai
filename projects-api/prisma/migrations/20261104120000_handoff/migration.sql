-- specs/022-projects-handoff: a contract can be made from a won deal.

-- AlterTable: the deal's EstimAI estimate id, copied onto a contract made from the deal. It is the
-- link to the estimate (AC-3.2) and what locks the contract's estimated man-days (AC-3.1).
ALTER TABLE "contract" ADD COLUMN "estimateId" TEXT;

-- ─── CHECK constraints (Prisma cannot express them; specs/022 tasks.md § Data model) ───
-- Written so a NULL operand fails them, as in the initial migration.
-- Existing rows all pass: every contract so far is `manual` and has no deal (specs/021).

-- A contract's origin is `deal` iff it has a deal (the unique `dealId` index is the database half
-- of AC-1.6: a deal feeds at most one contract). Only a contract made from a deal carries an estimate.
ALTER TABLE "contract"
  ADD CONSTRAINT "contract_origin_matches_deal"
    CHECK (("origin" = 'deal') = ("dealId" IS NOT NULL)),
  ADD CONSTRAINT "contract_estimate_needs_deal"
    CHECK ("estimateId" IS NULL OR "origin" = 'deal');
