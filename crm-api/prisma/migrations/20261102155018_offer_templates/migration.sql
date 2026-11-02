-- AlterTable
ALTER TABLE "company" ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "street" TEXT;

-- AlterTable
ALTER TABLE "deal_offer" ADD COLUMN     "sequenceNo" INTEGER,
ADD COLUMN     "sequenceYear" INTEGER;

-- AlterTable
ALTER TABLE "entity_profile" ADD COLUMN     "letterheadAt" TIMESTAMP(3),
ADD COLUMN     "letterheadBy" TEXT,
ADD COLUMN     "letterheadKey" TEXT,
ADD COLUMN     "placeOfIssue" TEXT;

-- CreateTable
CREATE TABLE "offer_template" (
    "id" TEXT NOT NULL,
    "entity" "Entity" NOT NULL,
    "name" TEXT NOT NULL,
    "language" "OfferLanguage" NOT NULL,
    "salutation" TEXT NOT NULL,
    "opening" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "costLines" JSONB NOT NULL,
    "costColumns" JSONB NOT NULL,
    "showTotal" BOOLEAN NOT NULL DEFAULT false,
    "acceptanceLabel" TEXT,
    "annex" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_sequence" (
    "entity" "Entity" NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,

    CONSTRAINT "offer_sequence_pkey" PRIMARY KEY ("entity","year")
);

-- CreateIndex
CREATE INDEX "offer_template_entity_idx" ON "offer_template"("entity");

-- A template's name is unique per entity among the active ones (specs/020 plan.md);
-- an archived template frees its name. Case-insensitive, like company names.
CREATE UNIQUE INDEX "offer_template_entity_name_active_key"
  ON "offer_template" ("entity", lower("name"))
  WHERE "archivedAt" IS NULL;
