-- specs/017 US-8: the wellD colleagues who took part in an activity (Operai user ids).

-- CreateTable
CREATE TABLE "activity_participant" (
    "activityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_participant_pkey" PRIMARY KEY ("activityId","userId")
);

-- CreateIndex
CREATE INDEX "activity_participant_userId_idx" ON "activity_participant"("userId");

-- AddForeignKey
ALTER TABLE "activity_participant" ADD CONSTRAINT "activity_participant_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

