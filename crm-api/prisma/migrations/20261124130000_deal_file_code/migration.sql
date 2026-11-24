-- specs/20261102-crm-offer-document AC-4.4 (2026-11-24, owner): the deal's code in its offers' file names, set by hand.
-- NULL = derived from the deal's title (its initials), as before. Upper-case letters and digits, 1 to 10.
ALTER TABLE "deal" ADD COLUMN "fileCode" TEXT;
ALTER TABLE "deal" ADD CONSTRAINT "deal_file_code_shape" CHECK ("fileCode" IS NULL OR "fileCode" ~ '^[A-Z0-9]{1,10}$');
