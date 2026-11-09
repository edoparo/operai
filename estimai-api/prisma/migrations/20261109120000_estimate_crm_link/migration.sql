-- AlterTable
ALTER TABLE "estimate" ADD COLUMN     "crmDealId" TEXT,
ADD COLUMN     "crmLinkAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "estimate_closedAt_idx" ON "estimate"("closedAt");
