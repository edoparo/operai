-- The words of an offer's document title, set per offer template and per language (additive; null = the language's default).
-- Validated by the API (trimmed, one line, printable, at most 60 characters); the CHECK keeps a hand-written row inside the same bounds.
ALTER TABLE "offer_template"
  ADD COLUMN "documentTitleIt" TEXT,
  ADD COLUMN "documentTitleEn" TEXT;

ALTER TABLE "offer_template"
  ADD CONSTRAINT "offer_template_document_title" CHECK (
    ("documentTitleIt" IS NULL OR (char_length("documentTitleIt") BETWEEN 1 AND 60 AND "documentTitleIt" !~ '[\r\n]'))
    AND ("documentTitleEn" IS NULL OR (char_length("documentTitleEn") BETWEEN 1 AND 60 AND "documentTitleEn" !~ '[\r\n]'))
  );
