-- specs/20261101-crm US-10 (2026-11-24, owner): a deal can be a public tender ("bando di gara"), whose company is the
-- body that issues it, with the date by which the bid must be submitted. Every existing deal is `standard`.
CREATE TYPE "DealKind" AS ENUM ('standard', 'tender');
ALTER TABLE "deal" ADD COLUMN "kind" "DealKind" NOT NULL DEFAULT 'standard';
ALTER TABLE "deal" ADD COLUMN "submissionDeadline" DATE;
ALTER TABLE "deal" ADD CONSTRAINT "deal_submission_deadline_only_on_tenders"
  CHECK ("submissionDeadline" IS NULL OR "kind" = 'tender');
CREATE INDEX "deal_kind_idx" ON "deal" ("kind");
