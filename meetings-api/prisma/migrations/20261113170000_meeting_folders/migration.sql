-- Personal meeting folders (ADR-0090): each person's own, one level, a meeting in at most one folder per person.
CREATE TABLE "meeting_folder" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_folder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "meeting_folder_entry" (
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_folder_entry_pkey" PRIMARY KEY ("meetingId","userId")
);

CREATE INDEX "meeting_folder_ownerUserId_idx" ON "meeting_folder"("ownerUserId");
CREATE INDEX "meeting_folder_entry_userId_folderId_idx" ON "meeting_folder_entry"("userId", "folderId");

ALTER TABLE "meeting_folder_entry" ADD CONSTRAINT "meeting_folder_entry_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "meeting_folder_entry" ADD CONSTRAINT "meeting_folder_entry_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "meeting_folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Raw SQL, the enforcement: the name the API validates, unique per owner ignoring case.
ALTER TABLE "meeting_folder" ADD CONSTRAINT "meeting_folder_name_length" CHECK (char_length("name") BETWEEN 1 AND 80 AND "name" = btrim("name"));
CREATE UNIQUE INDEX "meeting_folder_owner_name_key" ON "meeting_folder"("ownerUserId", lower("name"));
-- An entry files a meeting in a folder of the SAME person (no filing into someone else's folder, even by a bug).
CREATE UNIQUE INDEX "meeting_folder_id_owner_key" ON "meeting_folder"("id", "ownerUserId");
ALTER TABLE "meeting_folder_entry" ADD CONSTRAINT "meeting_folder_entry_owner_fkey" FOREIGN KEY ("folderId", "userId") REFERENCES "meeting_folder"("id", "ownerUserId") ON DELETE CASCADE ON UPDATE CASCADE;
