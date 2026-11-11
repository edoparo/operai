-- specs/028-activities T14 (ADR-0083, contract step): activities and tasks now live in activities-api.
--
-- DESTRUCTIVE and irreversible. Ships ONLY in a later push, after the production import report
-- (activities-api scripts/import-crm-activities.ts) shows every row found in these tables present
-- in activities-api. Never deploy it with the switch to activities-api (T12).

-- DropTable: children first (their foreign keys point at "activity")
DROP TABLE "task_blocker";
DROP TABLE "activity_participant";
DROP TABLE "activity";
DROP TABLE "meeting_host_state";

-- DropEnum
DROP TYPE "ActivityType";
