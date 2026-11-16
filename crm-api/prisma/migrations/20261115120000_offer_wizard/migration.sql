-- specs/20261115-crm-offer-wizard T15 (plan.md § Data model, ADR 20261115-offer-template-format-supersession-per-entity-language).
-- Adds the template format and the draft table. It changes no existing row and never touches `deal_offer`
-- (AC-9.4): the only mention of it is a foreign key on the NEW offer_draft table. No migration archives a
-- template: supersession happens lazily, in the transaction that makes the first wizard template active.

-- CreateEnum
CREATE TYPE "OfferTemplateFormat" AS ENUM ('sections', 'wizard');

-- CreateEnum
CREATE TYPE "OfferDraftTarget" AS ENUM ('new', 'edit', 'revision');

-- AlterTable
ALTER TABLE "offer_template" ADD COLUMN     "description" TEXT,
ADD COLUMN     "format" "OfferTemplateFormat" NOT NULL DEFAULT 'sections',
ADD COLUMN     "seedKey" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "uses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "salutation" DROP NOT NULL,
ALTER COLUMN "opening" DROP NOT NULL,
ALTER COLUMN "sections" DROP NOT NULL,
ALTER COLUMN "costLines" DROP NOT NULL,
ALTER COLUMN "costColumns" DROP NOT NULL;

-- CreateTable
CREATE TABLE "offer_draft" (
    "dealId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "targetKind" "OfferDraftTarget" NOT NULL DEFAULT 'new',
    "targetOfferId" TEXT,
    "targetOfferVersion" INTEGER,
    "answers" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_draft_pkey" PRIMARY KEY ("dealId")
);

-- CreateIndex
CREATE INDEX "offer_draft_templateId_idx" ON "offer_draft"("templateId");

-- AddForeignKey
ALTER TABLE "offer_draft" ADD CONSTRAINT "offer_draft_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_draft" ADD CONSTRAINT "offer_draft_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "offer_template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_draft" ADD CONSTRAINT "offer_draft_targetOfferId_fkey" FOREIGN KEY ("targetOfferId") REFERENCES "deal_offer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A template's content follows its format (the Prisma schema cannot express this, so it is enforced here).
-- Existing rows are `sections` with every legacy column set, so they satisfy it without being touched.
ALTER TABLE "offer_template" ADD CONSTRAINT "offer_template_format_content" CHECK (
  ("format" = 'sections' AND "salutation" IS NOT NULL AND "opening" IS NOT NULL
     AND "sections" IS NOT NULL AND "costLines" IS NOT NULL AND "costColumns" IS NOT NULL
     AND "source" IS NULL)
  OR ("format" = 'wizard' AND "source" IS NOT NULL AND char_length("source") <= 150000)
);

-- A seed is created once per (entity, seedKey), archived rows included; templates without a seedKey never collide.
CREATE UNIQUE INDEX "offer_template_entity_seed_key"
  ON "offer_template" ("entity", "seedKey")
  WHERE "seedKey" IS NOT NULL;

-- A draft for a new offer has no target offer; an edit or a revision has the offer and the version it was opened at.
ALTER TABLE "offer_draft" ADD CONSTRAINT "offer_draft_target" CHECK (
  ("targetKind" = 'new') = ("targetOfferId" IS NULL)
  AND ("targetOfferId" IS NULL) = ("targetOfferVersion" IS NULL)
);
