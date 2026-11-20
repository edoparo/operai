-- specs/20261110-activities US-9: who sees an activity's details. Every existing row is `everyone`,
-- which is exactly what every reader saw before.
CREATE TYPE "DetailsVisibility" AS ENUM ('everyone', 'sales_team', 'author');

ALTER TABLE "activity" ADD COLUMN "detailsVisibility" "DetailsVisibility" NOT NULL DEFAULT 'everyone';

-- Only a CRM (pre-sales) activity may restrict its details; a project task is always `everyone`.
ALTER TABLE "activity" ADD CONSTRAINT "activity_details_visibility_crm_only"
  CHECK ("hostApp" = 'crm' OR "detailsVisibility" = 'everyone');
