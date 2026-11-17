-- specs/20261116-letterhead-service T29 (AC-10.2): the version of the entity's letterhead an offer was drawn with.
-- Nullable and without a default: every offer that exists, and every one crm-api renders itself, has none. No row is touched.

-- AlterTable
ALTER TABLE "deal_offer" ADD COLUMN     "letterheadVersion" INTEGER;
