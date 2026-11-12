-- Notes become a rich-text document (TipTap JSON), stored as data, never as HTML. The plain-text column goes:
-- this ships in the same release that created the table, so no notes exist yet to carry over.
ALTER TABLE "meeting_note" DROP CONSTRAINT "meeting_note_text_length";
ALTER TABLE "meeting_note" DROP COLUMN "text";
ALTER TABLE "meeting_note" ADD COLUMN "content" JSONB NOT NULL DEFAULT '{"type":"doc","content":[]}';
ALTER TABLE "meeting_note" ALTER COLUMN "content" DROP DEFAULT;

-- Raw SQL, the enforcement: a document, and the size the API validates.
ALTER TABLE "meeting_note" ADD CONSTRAINT "meeting_note_content_doc" CHECK (jsonb_typeof("content") = 'object' AND "content"->>'type' = 'doc');
ALTER TABLE "meeting_note" ADD CONSTRAINT "meeting_note_content_size" CHECK (octet_length("content"::text) <= 524288);
