-- Line rejection (specs/007 amendment, 2026-11-10): a reviewer may refuse one
-- expense line, with a mandatory reason, instead of the whole request.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'line_rejected';
ALTER TYPE "AuditAction" ADD VALUE 'line_restored';

-- AlterTable
ALTER TABLE "refund_line" ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "rejectedByEmail" TEXT,
ADD COLUMN     "rejectedByUserId" TEXT,
ADD COLUMN     "rejectionReason" TEXT;
