-- specs/018 AC-3.3 (2026-11-05): the estimate is ready when it is closed in EstimAI.
-- The last EstimAI version applied, so a late notice cannot undo a newer one.

-- AlterTable
ALTER TABLE "deal_estimate" ADD COLUMN     "estimaiVersion" INTEGER;
