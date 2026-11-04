-- specs/020 US-7: an offer is edited in place until it is sent; then a change is a new revision.

-- AlterTable
ALTER TABLE "deal_offer" ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "sentBy" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3),
ADD COLUMN     "updatedBy" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;
