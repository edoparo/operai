-- specs/017 AC-3.2 (2026-11-04): a deal's amount is optional until it is known.
-- The deal_amount_non_negative CHECK still holds for every non-null amount.
ALTER TABLE "deal" ALTER COLUMN "amountCents" DROP NOT NULL;
