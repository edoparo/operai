-- The meeting agenda: an ordered list of points people follow during the meeting and a summary can follow.
ALTER TABLE "meeting" ADD COLUMN "agendaVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "agenda_point" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "covered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agenda_point_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agenda_point_meetingId_position_idx" ON "agenda_point"("meetingId", "position");

ALTER TABLE "agenda_point" ADD CONSTRAINT "agenda_point_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Raw SQL, the enforcement: the lengths the API validates.
ALTER TABLE "agenda_point" ADD CONSTRAINT "agenda_point_title_length" CHECK (char_length("title") BETWEEN 1 AND 80);
ALTER TABLE "agenda_point" ADD CONSTRAINT "agenda_point_note_length" CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 500);
