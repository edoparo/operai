-- specs/20261110-activities US-10: a task in progress. A task is done when completedAt is set, in progress when
-- startedAt is set and it is not done, open otherwise. Every existing task is open or done, as before.
ALTER TABLE "activity" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "activity" ADD COLUMN "startedByUserId" TEXT;

ALTER TABLE "activity"
  ADD CONSTRAINT "activity_started_only_on_tasks" CHECK ("type" = 'task' OR "startedAt" IS NULL),
  ADD CONSTRAINT "activity_started_pair" CHECK (("startedAt" IS NULL) = ("startedByUserId" IS NULL));
