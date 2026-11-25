-- A mileage line says whether its trip is there and back (informative: km are always the whole distance).
-- Existing lines are one-way (false); only a travel_km line may be a round trip.
ALTER TABLE "refund_line" ADD COLUMN "roundTrip" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "refund_line" ADD CONSTRAINT "refund_line_round_trip_mileage_only" CHECK (NOT "roundTrip" OR "type" = 'travel_km');
