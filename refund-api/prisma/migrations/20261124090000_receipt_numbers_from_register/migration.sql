-- specs/20261124-receipt-numbers-from-the-register, T2 (AC-1.6, AC-1.11, AC-1.18, AC-4.3, AC-4.7).
-- One additive-or-safe migration; no applied migration is edited. Production has no numbered line, no counter and no baseline
-- row; dev and test databases do have numbered lines, hence the backfill (step 2) BEFORE guard v3 freezes the new columns.
-- Hand-written SQL below is pinned against drift by src/lib/db.receipt-register.test.ts and
-- src/lib/migration.receipt-register.test.ts.

-- ─── 1. refund_line: origin and split part of a receipt number ───────────────
ALTER TABLE "refund_line"
  ADD COLUMN "receiptOrigin"    TEXT,
  ADD COLUMN "receiptSplitPart" SMALLINT;

-- ─── 2. Backfill the numbers issued before this migration ───────────────────
-- Guard v2 does not name these columns, so the UPDATE is allowed.
UPDATE "refund_line" SET "receiptOrigin" = 'issued', "receiptSplitPart" = 1 WHERE "receiptNumber" IS NOT NULL;

-- ─── 3. CHECKs ───────────────────────────────────────────────────────────────
ALTER TABLE "refund_line"
  ADD CONSTRAINT "refund_line_receipt_origin_all_or_none"
    CHECK (num_nonnulls("receiptNumber", "receiptOrigin", "receiptSplitPart") IN (0, 3)),
  ADD CONSTRAINT "refund_line_receipt_origin_known"
    CHECK ("receiptOrigin" IN ('issued', 'paper', 'paper_split')),
  ADD CONSTRAINT "refund_line_receipt_split_part"
    CHECK ("receiptSplitPart" >= 1 AND ("receiptSplitPart" = 1 OR "receiptOrigin" = 'paper_split')),
  ADD CONSTRAINT "refund_line_receipt_seq_range"
    CHECK (("receiptOrigin" = 'issued' AND "receiptSeq" BETWEEN 1 AND 99999)
        OR ("receiptOrigin" <> 'issued' AND "receiptSeq" BETWEEN 0 AND 99999)),
  ADD CONSTRAINT "refund_line_receipt_number_shape"
    CHECK ("receiptNumber" ~ '^[A-Z]{2,3}[0-9]{2}/[0-9]{1,5}$');

-- ─── 4. Uniqueness: the new key first, then the old one goes ─────────────────
-- The plan's default Prisma name is 74 characters, over PostgreSQL's 63: the name is explicit (and mapped in schema.prisma).
CREATE UNIQUE INDEX "refund_line_receipt_owner_year_seq_part_key"
  ON "refund_line" ("receiptOwnerUserId", "receiptYear", "receiptSeq", "receiptSplitPart");
DROP INDEX "refund_line_receiptOwnerUserId_receiptYear_receiptSeq_key";

-- ─── 5. refund_line_accounting_guard v3 ──────────────────────────────────────
-- The body of v2 (20261119120000_accounting_copies) with "receiptOrigin" and "receiptSplitPart" added to the frozen set of (a).
CREATE OR REPLACE FUNCTION refund_line_accounting_guard() RETURNS TRIGGER AS $$
DECLARE
  parent_status "RefundStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."receiptNumber" IS NOT NULL THEN
      RAISE EXCEPTION 'refund_line % carries receipt number % and cannot be deleted', OLD.id, OLD."receiptNumber"
        USING ERRCODE = 'raise_exception';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."receiptNumber" IS NOT NULL AND (
       NEW."receiptNumber"      IS DISTINCT FROM OLD."receiptNumber"
    OR NEW."receiptOwnerUserId" IS DISTINCT FROM OLD."receiptOwnerUserId"
    OR NEW."receiptYear"        IS DISTINCT FROM OLD."receiptYear"
    OR NEW."receiptSeq"         IS DISTINCT FROM OLD."receiptSeq"
    OR NEW."numberedAt"         IS DISTINCT FROM OLD."numberedAt"
    OR NEW."receiptOrigin"      IS DISTINCT FROM OLD."receiptOrigin"
    OR NEW."receiptSplitPart"   IS DISTINCT FROM OLD."receiptSplitPart"
  ) THEN
    RAISE EXCEPTION 'refund_line % receipt number % is immutable', OLD.id, OLD."receiptNumber"
      USING ERRCODE = 'raise_exception';
  END IF;

  IF OLD."receiptNumber" IS NOT NULL AND (
       NEW."accountNumber"          IS DISTINCT FROM OLD."accountNumber"
    OR NEW."accountName"            IS DISTINCT FROM OLD."accountName"
    OR NEW."ledgerAccountIsDefault" IS DISTINCT FROM OLD."ledgerAccountIsDefault"
    OR NEW."vatCode"                IS DISTINCT FROM OLD."vatCode"
    OR NEW."vatRateBasisPoints"     IS DISTINCT FROM OLD."vatRateBasisPoints"
    OR NEW."vatCodeIsDefault"       IS DISTINCT FROM OLD."vatCodeIsDefault"
  ) THEN
    SELECT "status" INTO parent_status FROM "refund_request" WHERE id = OLD."requestId";
    IF parent_status = 'paid' THEN
      RAISE EXCEPTION 'refund_line % belongs to a paid request: its classification is locked', OLD.id
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;

  IF OLD."fxRateMicros" IS NOT NULL AND (
       NEW."fxRateMicros"   IS DISTINCT FROM OLD."fxRateMicros"
    OR NEW."fxRateMonth"    IS DISTINCT FROM OLD."fxRateMonth"
    OR NEW."fxRateCopiedAt" IS DISTINCT FROM OLD."fxRateCopiedAt"
  ) THEN
    RAISE EXCEPTION 'refund_line % exchange rate copy is write-once and cannot change', OLD.id
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── 6. Split integrity, checked at COMMIT ───────────────────────────────────
-- A confirmed split receipt is several lines sharing ONE number, written in one transaction. For a line that is a part of a split
-- (origin 'paper_split' or part > 1) the group (owner, year, seq) must have a part 1, every member 'paper_split', one number
-- and one expense date.
CREATE FUNCTION refund_line_split_receipt_check() RETURNS TRIGGER AS $$
DECLARE
  n_part_one   integer;
  n_not_split  integer;
  n_numbers    integer;
  n_dates      integer;
BEGIN
  IF NEW."receiptOrigin" = 'paper_split' OR NEW."receiptSplitPart" > 1 THEN
    SELECT count(*) FILTER (WHERE "receiptSplitPart" = 1),
           count(*) FILTER (WHERE "receiptOrigin" IS DISTINCT FROM 'paper_split'),
           count(DISTINCT "receiptNumber"),
           count(DISTINCT "date")
      INTO n_part_one, n_not_split, n_numbers, n_dates
      FROM "refund_line"
     WHERE "receiptOwnerUserId" = NEW."receiptOwnerUserId"
       AND "receiptYear" = NEW."receiptYear"
       AND "receiptSeq" = NEW."receiptSeq";
    IF n_part_one = 0 OR n_not_split > 0 OR n_numbers > 1 OR n_dates > 1 THEN
      RAISE EXCEPTION 'refund_line % is part of a split receipt that is not consistent (number %)', NEW.id, NEW."receiptNumber"
        USING ERRCODE = 'raise_exception';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER refund_line_split_receipt
  AFTER INSERT OR UPDATE OF "receiptNumber", "receiptOrigin", "receiptSplitPart" ON "refund_line"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refund_line_split_receipt_check();

-- ─── 7. Receipt codes ────────────────────────────────────────────────────────
CREATE TABLE "receipt_code" (
    "ownerUserId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "updatedByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_code_pkey" PRIMARY KEY ("ownerUserId")
);

CREATE UNIQUE INDEX "receipt_code_code_key" ON "receipt_code"("code");

CREATE TABLE "receipt_code_change" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "codeBefore" TEXT,
    "codeAfter" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdByEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_code_change_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "receipt_code_change_ownerUserId_createdAt_idx" ON "receipt_code_change"("ownerUserId", "createdAt");

ALTER TABLE "receipt_code"
  ADD CONSTRAINT "receipt_code_shape" CHECK ("code" ~ '^[A-Z]{2,3}$');
ALTER TABLE "receipt_code_change"
  ADD CONSTRAINT "receipt_code_change_shape" CHECK (("codeBefore" IS NULL OR "codeBefore" ~ '^[A-Z]{2,3}$')
                                                AND ("codeAfter"  IS NULL OR "codeAfter"  ~ '^[A-Z]{2,3}$')),
  ADD CONSTRAINT "receipt_code_change_changes" CHECK ("codeBefore" IS DISTINCT FROM "codeAfter");

-- receipt_code is mutable on purpose (UPDATE and DELETE allowed); its history is the append-only receipt_code_change.
CREATE TRIGGER receipt_code_change_no_update BEFORE UPDATE ON "receipt_code_change"
FOR EACH ROW EXECUTE FUNCTION accounting_history_immutable();
CREATE TRIGGER receipt_code_change_no_delete BEFORE DELETE ON "receipt_code_change"
FOR EACH ROW EXECUTE FUNCTION accounting_history_immutable();
