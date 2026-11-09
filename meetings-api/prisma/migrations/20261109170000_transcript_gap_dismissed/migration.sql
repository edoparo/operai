-- specs/021 A10: the creator can mark a possible gap "no speech here" after listening to it.
ALTER TABLE "transcript_gap" ADD COLUMN "dismissedAt" TIMESTAMP(3),
ADD COLUMN "dismissedBy" TEXT;
