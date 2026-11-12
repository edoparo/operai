-- Each person's private notes on a meeting (one row per meeting and person), deleted with the meeting.
CREATE TABLE "meeting_note" (
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_note_pkey" PRIMARY KEY ("meetingId","userId")
);

ALTER TABLE "meeting_note" ADD CONSTRAINT "meeting_note_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Raw SQL, the enforcement: the length the API validates.
ALTER TABLE "meeting_note" ADD CONSTRAINT "meeting_note_text_length" CHECK (char_length("text") <= 20000);
