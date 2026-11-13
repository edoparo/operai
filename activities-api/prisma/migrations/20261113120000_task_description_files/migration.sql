-- A task's rich description and its files (images inside it, attachments under it).
-- ADR-0089. The bucket holds the bytes; these rows are the only way to reach them.

-- CreateEnum
CREATE TYPE "ActivityFileKind" AS ENUM ('image', 'attachment');

-- CreateEnum
CREATE TYPE "ActivityFileStatus" AS ENUM ('pending', 'stored');

-- AlterTable
ALTER TABLE "activity" ADD COLUMN "description" JSONB;

-- CreateTable
CREATE TABLE "activity_file" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "kind" "ActivityFileKind" NOT NULL,
    "status" "ActivityFileStatus" NOT NULL DEFAULT 'pending',
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storedAt" TIMESTAMP(3),

    CONSTRAINT "activity_file_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activity_file_objectKey_key" ON "activity_file"("objectKey");

-- CreateIndex
CREATE INDEX "activity_file_activityId_status_idx" ON "activity_file"("activityId", "status");

-- AddForeignKey: RESTRICT, so a task is deleted only after its files (objects first, then rows).
ALTER TABLE "activity_file" ADD CONSTRAINT "activity_file_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── CHECK constraints ───────────────────────────────────────────────────────
ALTER TABLE "activity"
  ADD CONSTRAINT "activity_description_only_on_tasks" CHECK ("description" IS NULL OR "type" = 'task'),
  ADD CONSTRAINT "activity_description_doc"
    CHECK ("description" IS NULL OR (jsonb_typeof("description") = 'object' AND "description"->>'type' = 'doc')),
  ADD CONSTRAINT "activity_description_size" CHECK ("description" IS NULL OR octet_length("description"::text) <= 131072);

ALTER TABLE "activity_file"
  ADD CONSTRAINT "activity_file_size" CHECK ("sizeBytes" BETWEEN 1 AND 20971520),
  ADD CONSTRAINT "activity_file_stored_pair" CHECK (("status" = 'stored') = ("storedAt" IS NOT NULL));

-- ─── A task's plain-text body becomes its description ────────────────────────
-- One paragraph per line, an empty line an empty paragraph; the text itself is unchanged.
-- A meeting activity is never a task, so no mirrored link is touched. The body is cleared,
-- so a task has exactly one text.
UPDATE "activity" AS a
SET "description" = jsonb_build_object(
      'type', 'doc',
      'content', (
        SELECT jsonb_agg(
                 CASE WHEN line = '' THEN jsonb_build_object('type', 'paragraph')
                      ELSE jsonb_build_object('type', 'paragraph',
                             'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', line)))
                 END
                 ORDER BY n)
        FROM regexp_split_to_table(replace(a."body", E'\r\n', E'\n'), E'\n') WITH ORDINALITY AS t(line, n)
      )),
    "body" = NULL
WHERE a."type" = 'task' AND a."body" IS NOT NULL AND a."body" <> '';

UPDATE "activity" SET "body" = NULL WHERE "type" = 'task' AND "body" = '';
