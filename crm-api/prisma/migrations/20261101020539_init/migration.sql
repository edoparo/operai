-- CreateEnum
CREATE TYPE "Entity" AS ENUM ('welld_ch', 'welld_it');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('prospect', 'customer', 'former');

-- CreateEnum
CREATE TYPE "DealStage" AS ENUM ('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('CHF', 'EUR');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('note', 'call', 'meeting', 'email', 'task');

-- CreateTable
CREATE TABLE "company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CompanyStatus" NOT NULL,
    "entity" "Entity" NOT NULL,
    "website" TEXT,
    "industry" TEXT,
    "city" TEXT,
    "country" TEXT,
    "notes" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "jobTitle" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stage" "DealStage" NOT NULL DEFAULT 'lead',
    "amountCents" BIGINT NOT NULL,
    "currency" "Currency" NOT NULL,
    "entity" "Entity" NOT NULL,
    "expectedCloseDate" DATE,
    "ownerUserId" TEXT NOT NULL,
    "lostReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity" (
    "id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "contactId" TEXT,
    "dealId" TEXT,
    "authorUserId" TEXT NOT NULL,
    "dueDate" DATE,
    "assigneeUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_status_idx" ON "company"("status");

-- CreateIndex
CREATE INDEX "company_ownerUserId_idx" ON "company"("ownerUserId");

-- CreateIndex
CREATE INDEX "contact_companyId_idx" ON "contact"("companyId");

-- CreateIndex
CREATE INDEX "deal_stage_idx" ON "deal"("stage");

-- CreateIndex
CREATE INDEX "deal_companyId_idx" ON "deal"("companyId");

-- CreateIndex
CREATE INDEX "deal_closedAt_idx" ON "deal"("closedAt");

-- CreateIndex
CREATE INDEX "activity_companyId_occurredAt_idx" ON "activity"("companyId", "occurredAt");

-- CreateIndex
CREATE INDEX "activity_contactId_idx" ON "activity"("contactId");

-- CreateIndex
CREATE INDEX "activity_dealId_idx" ON "activity"("dealId");

-- CreateIndex
CREATE INDEX "activity_assigneeUserId_completedAt_idx" ON "activity"("assigneeUserId", "completedAt");

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal" ADD CONSTRAINT "deal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Enforcement Prisma cannot express (specs/017-crm plan.md § Data model) ──

-- D-11: company names are unique case-insensitively, archived companies included.
CREATE UNIQUE INDEX "company_name_lower_key" ON "company" (lower("name"));

-- Contacts search by email (case-insensitive).
CREATE INDEX "contact_email_lower_idx" ON "contact" (lower("email"));

ALTER TABLE "company"
  ADD CONSTRAINT "company_country_iso2" CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "company_name_not_blank" CHECK (length(btrim("name")) > 0);

-- D-9: integer minor units, never negative. AC-3.3: closedAt is set exactly
-- when the stage is closed; a lost reason only on a lost deal.
ALTER TABLE "deal"
  ADD CONSTRAINT "deal_amount_non_negative" CHECK ("amountCents" >= 0),
  ADD CONSTRAINT "deal_closed_iff_closed_stage"
    CHECK (("stage" IN ('won', 'lost')) = ("closedAt" IS NOT NULL)),
  ADD CONSTRAINT "deal_lost_reason_only_when_lost"
    CHECK ("lostReason" IS NULL OR "stage" = 'lost');

-- Task-only fields live only on tasks; completion is all-or-nothing.
ALTER TABLE "activity"
  ADD CONSTRAINT "activity_task_fields_only_on_tasks"
    CHECK ("type" = 'task' OR ("dueDate" IS NULL AND "assigneeUserId" IS NULL
                               AND "completedAt" IS NULL AND "completedByUserId" IS NULL)),
  ADD CONSTRAINT "activity_completion_pair"
    CHECK (("completedAt" IS NULL) = ("completedByUserId" IS NULL));
