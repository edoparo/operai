-- Reminders to confirm a pending assignment (specs/20261006-hardware-inventory US-15).
ALTER TYPE "AssetEventAction" ADD VALUE 'assignment_reminded';

ALTER TABLE "assignment" ADD COLUMN "lastReminderAt" TIMESTAMP(3);
ALTER TABLE "assignment" ADD COLUMN "reminderCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_reminder_count_nonnegative" CHECK ("reminderCount" >= 0);
CREATE INDEX "assignment_status_createdAt_idx" ON "assignment"("status", "createdAt");
