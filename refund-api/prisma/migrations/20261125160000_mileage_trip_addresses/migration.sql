-- A mileage trip's start and end, as chosen from the address suggestions (or typed when they are unavailable).
-- Existing lines have none; only a travel_km line may carry them.
ALTER TABLE "refund_line" ADD COLUMN "fromAddress" TEXT;
ALTER TABLE "refund_line" ADD COLUMN "toAddress" TEXT;
ALTER TABLE "refund_line" ADD CONSTRAINT "refund_line_trip_addresses_mileage_only"
  CHECK (("fromAddress" IS NULL AND "toAddress" IS NULL) OR "type" = 'travel_km');
