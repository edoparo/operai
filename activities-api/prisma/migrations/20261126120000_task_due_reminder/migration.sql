-- A task's due-date reminder: an email the day before the due date, at 08:00 Europe/Zurich, to the assignee and the
-- participants (src/tasks/dueReminders.ts). "dueReminderSentFor" is the due date a reminder was sent (claimed) for:
-- one reminder per due date, so a task re-dated to another day gets its own. Every existing task has none.
ALTER TABLE "activity" ADD COLUMN "dueReminderSentFor" DATE;

ALTER TABLE "activity"
  ADD CONSTRAINT "activity_due_reminder_only_on_tasks" CHECK ("type" = 'task' OR "dueReminderSentFor" IS NULL);

-- The scheduler's tick reads the open tasks due tomorrow.
CREATE INDEX "activity_dueDate_idx" ON "activity"("dueDate");
