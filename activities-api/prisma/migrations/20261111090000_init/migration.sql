-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('pre_sales', 'operational');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('note', 'call', 'meeting', 'email', 'task');

-- CreateEnum
CREATE TYPE "HostApp" AS ENUM ('crm', 'projects');

-- CreateTable
CREATE TABLE "activity" (
    "id" TEXT NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "type" "ActivityType" NOT NULL,
    "hostApp" "HostApp" NOT NULL,
    "hostType" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "contactId" TEXT,
    "dealId" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "dueDate" DATE,
    "assigneeUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "completionSeq" INTEGER,
    "meetingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_participant" (
    "activityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_participant_pkey" PRIMARY KEY ("activityId","userId")
);

-- CreateTable
CREATE TABLE "task_blocker" (
    "blockedId" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_blocker_pkey" PRIMARY KEY ("blockedId","blockerId")
);

-- CreateTable
CREATE TABLE "meeting_mirror_state" (
    "meetingId" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_mirror_state_pkey" PRIMARY KEY ("meetingId")
);

-- CreateIndex
CREATE UNIQUE INDEX "activity_meetingId_key" ON "activity"("meetingId");

-- CreateIndex
CREATE INDEX "activity_hostApp_hostType_hostId_occurredAt_idx" ON "activity"("hostApp", "hostType", "hostId", "occurredAt");

-- CreateIndex
CREATE INDEX "activity_contactId_idx" ON "activity"("contactId");

-- CreateIndex
CREATE INDEX "activity_dealId_idx" ON "activity"("dealId");

-- CreateIndex
CREATE INDEX "activity_assigneeUserId_completedAt_idx" ON "activity"("assigneeUserId", "completedAt");

-- CreateIndex
CREATE INDEX "activity_participant_userId_idx" ON "activity_participant"("userId");

-- CreateIndex
CREATE INDEX "task_blocker_blockerId_idx" ON "task_blocker"("blockerId");

-- AddForeignKey
ALTER TABLE "activity_participant" ADD CONSTRAINT "activity_participant_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_blocker" ADD CONSTRAINT "task_blocker_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_blocker" ADD CONSTRAINT "task_blocker_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── CHECK constraints (specs/028 plan § Data model) ─────────────────────────
-- Prisma cannot express these; they are the ENFORCEMENT, and src/db.constraints.test.ts
-- proves each one refuses its violating row.

-- Where an activity lives decides what it can be: a CRM activity is pre-sales work on a
-- company; a projects activity is an operational task on a project, with no contact, deal
-- or meeting (AC-3.6).
ALTER TABLE "activity"
  ADD CONSTRAINT "activity_host_shape"
    CHECK (("hostApp" = 'crm' AND "hostType" = 'company' AND "kind" = 'pre_sales')
        OR ("hostApp" = 'projects' AND "hostType" = 'project' AND "kind" = 'operational'
            AND "type" = 'task' AND "contactId" IS NULL AND "dealId" IS NULL AND "meetingId" IS NULL));

-- Task-only fields live only on tasks; completion is all-or-nothing; only a meeting activity
-- can mirror a meeting (the three CRM CHECKs, carried over unchanged).
ALTER TABLE "activity"
  ADD CONSTRAINT "activity_task_fields_only_on_tasks"
    CHECK ("type" = 'task' OR ("dueDate" IS NULL AND "assigneeUserId" IS NULL
                               AND "completedAt" IS NULL AND "completedByUserId" IS NULL)),
  ADD CONSTRAINT "activity_completion_pair"
    CHECK (("completedAt" IS NULL) = ("completedByUserId" IS NULL)),
  ADD CONSTRAINT "activity_meeting_id_only_on_meetings"
    CHECK ("meetingId" IS NULL OR "type" = 'meeting');

-- A task never blocks itself. Same-host blockers and cycles are application checks (AC-4.3).
ALTER TABLE "task_blocker"
  ADD CONSTRAINT "task_blocker_not_self" CHECK ("blockedId" <> "blockerId");
