-- specs/017 US-7: where a company or a lead came from. Both optional: existing rows stay null.

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('inbound', 'outbound', 'event', 'referral', 'other');

-- AlterTable
ALTER TABLE "company" ADD COLUMN     "source" "LeadSource",
ADD COLUMN     "sourceDetail" TEXT;

-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "source" "LeadSource",
ADD COLUMN     "sourceDetail" TEXT;

