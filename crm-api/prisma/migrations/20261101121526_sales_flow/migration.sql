-- CreateEnum
CREATE TYPE "EstimateState" AS ENUM ('requested', 'ready');

-- CreateEnum
CREATE TYPE "OfferLanguage" AS ENUM ('en', 'it');

-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('pending', 'stored');

-- CreateTable
CREATE TABLE "deal_estimate" (
    "dealId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "estimateName" TEXT NOT NULL,
    "technicalUserId" TEXT NOT NULL,
    "state" "EstimateState" NOT NULL DEFAULT 'requested',
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyBy" TEXT,
    "readyAt" TIMESTAMP(3),
    "taskId" TEXT,
    "overrideBy" TEXT,
    "overrideReason" TEXT,
    "overrideAt" TIMESTAMP(3),

    CONSTRAINT "deal_estimate_pkey" PRIMARY KEY ("dealId")
);

-- CreateTable
CREATE TABLE "deal_offer" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "language" "OfferLanguage" NOT NULL,
    "priceCents" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "terms" TEXT,
    "snapshot" JSONB NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "deal_offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_attachment" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "status" "AttachmentStatus" NOT NULL DEFAULT 'pending',
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "deal_attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_profile" (
    "entity" "Entity" NOT NULL,
    "legalName" TEXT NOT NULL,
    "addressLines" TEXT[],
    "vatNumber" TEXT,
    "iban" TEXT,
    "offerTermsEn" TEXT,
    "offerTermsIt" TEXT,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_profile_pkey" PRIMARY KEY ("entity")
);

-- CreateIndex
CREATE INDEX "deal_estimate_technicalUserId_idx" ON "deal_estimate"("technicalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "deal_offer_dealId_number_key" ON "deal_offer"("dealId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "deal_attachment_objectKey_key" ON "deal_attachment"("objectKey");

-- CreateIndex
CREATE INDEX "deal_attachment_dealId_idx" ON "deal_attachment"("dealId");

-- AddForeignKey
ALTER TABLE "deal_estimate" ADD CONSTRAINT "deal_estimate_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_offer" ADD CONSTRAINT "deal_offer_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_attachment" ADD CONSTRAINT "deal_attachment_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- specs/018: domain rules the API also enforces, kept true at the database level.
ALTER TABLE "deal_offer" ADD CONSTRAINT "deal_offer_number_positive" CHECK ("number" > 0);
ALTER TABLE "deal_offer" ADD CONSTRAINT "deal_offer_price_non_negative" CHECK ("priceCents" >= 0);
ALTER TABLE "deal_offer" ADD CONSTRAINT "deal_offer_validity_range" CHECK ("validityDays" BETWEEN 1 AND 365);
ALTER TABLE "deal_offer" ADD CONSTRAINT "deal_offer_deleted_pair" CHECK (("deletedAt" IS NULL) = ("deletedBy" IS NULL));
ALTER TABLE "deal_attachment" ADD CONSTRAINT "deal_attachment_size_range" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 20971520);
ALTER TABLE "deal_attachment" ADD CONSTRAINT "deal_attachment_deleted_pair" CHECK (("deletedAt" IS NULL) = ("deletedBy" IS NULL));
ALTER TABLE "deal_estimate" ADD CONSTRAINT "deal_estimate_ready_pair" CHECK (("state" = 'ready') = ("readyAt" IS NOT NULL) AND ("readyAt" IS NULL) = ("readyBy" IS NULL));
ALTER TABLE "deal_estimate" ADD CONSTRAINT "deal_estimate_override_triple" CHECK (("overrideAt" IS NULL) = ("overrideBy" IS NULL) AND ("overrideAt" IS NULL) = ("overrideReason" IS NULL));
