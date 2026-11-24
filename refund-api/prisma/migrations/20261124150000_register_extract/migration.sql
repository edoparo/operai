-- The accountant's register extract: a second file of the accounting export, logged in the same append-only table with its kind.
-- Existing rows are journal downloads.
ALTER TABLE "refund_batch_export" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'journal';
ALTER TABLE "refund_batch_export" ADD CONSTRAINT "refund_batch_export_kind_check" CHECK ("kind" IN ('journal', 'register'));
