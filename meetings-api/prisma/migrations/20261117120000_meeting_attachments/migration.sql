-- Files and links attached to a meeting (agenda, slides, notes, documents), deleted with the meeting.
CREATE TYPE "AttachmentKind" AS ENUM ('file', 'link');
CREATE TYPE "AttachmentStatus" AS ENUM ('pending', 'stored');

CREATE TABLE "meeting_attachment" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "status" "AttachmentStatus" NOT NULL,
    "name" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "objectKey" TEXT,
    "storedAt" TIMESTAMP(3),
    "url" TEXT,
    "label" TEXT,
    "addedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_attachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meeting_attachment_objectKey_key" ON "meeting_attachment"("objectKey");
CREATE INDEX "meeting_attachment_meetingId_createdAt_idx" ON "meeting_attachment"("meetingId", "createdAt");

ALTER TABLE "meeting_attachment" ADD CONSTRAINT "meeting_attachment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Raw SQL, the enforcement: a file has its file columns and no link columns, a link the reverse; a link is never pending;
-- a stored file has its storage instant; the lengths the API validates.
ALTER TABLE "meeting_attachment" ADD CONSTRAINT "meeting_attachment_file_shape" CHECK (
  "kind" <> 'file' OR (
    "name" IS NOT NULL AND "contentType" IS NOT NULL AND "sizeBytes" IS NOT NULL AND "objectKey" IS NOT NULL
    AND "url" IS NULL AND "label" IS NULL
    AND (("status" = 'stored') = ("storedAt" IS NOT NULL))
  )
);
ALTER TABLE "meeting_attachment" ADD CONSTRAINT "meeting_attachment_link_shape" CHECK (
  "kind" <> 'link' OR (
    "url" IS NOT NULL AND "status" = 'stored'
    AND "name" IS NULL AND "contentType" IS NULL AND "sizeBytes" IS NULL AND "objectKey" IS NULL AND "storedAt" IS NULL
  )
);
ALTER TABLE "meeting_attachment" ADD CONSTRAINT "meeting_attachment_name_length" CHECK ("name" IS NULL OR char_length("name") BETWEEN 1 AND 200);
ALTER TABLE "meeting_attachment" ADD CONSTRAINT "meeting_attachment_size_range" CHECK ("sizeBytes" IS NULL OR "sizeBytes" BETWEEN 1 AND 20971520);
ALTER TABLE "meeting_attachment" ADD CONSTRAINT "meeting_attachment_url_length" CHECK ("url" IS NULL OR char_length("url") BETWEEN 1 AND 2000);
ALTER TABLE "meeting_attachment" ADD CONSTRAINT "meeting_attachment_label_length" CHECK ("label" IS NULL OR char_length("label") BETWEEN 1 AND 200);
