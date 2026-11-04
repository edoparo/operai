-- specs/017 US-6: "blocked by" between tasks of the same company. Same company, task-only
-- ends and no cycles are checked by crm-api; the CHECK keeps a task from blocking itself.

-- CreateTable
CREATE TABLE "task_blocker" (
    "blockedId" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_blocker_pkey" PRIMARY KEY ("blockedId","blockerId")
);

-- CreateIndex
CREATE INDEX "task_blocker_blockerId_idx" ON "task_blocker"("blockerId");

-- AddForeignKey
ALTER TABLE "task_blocker" ADD CONSTRAINT "task_blocker_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_blocker" ADD CONSTRAINT "task_blocker_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_blocker" ADD CONSTRAINT "task_blocker_not_self" CHECK ("blockedId" <> "blockerId");
