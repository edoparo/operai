-- Offices that hold assets (specs/20261006-hardware-inventory US-14). An asset is held by a person OR an office.
ALTER TYPE "AssetEventAction" ADD VALUE 'assigned_to_office';

CREATE TABLE "office" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entity" "Entity" NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "office_pkey" PRIMARY KEY ("id")
);

-- Raw SQL, the enforcement: one name per office ignoring case, and the length the API validates.
CREATE UNIQUE INDEX "office_name_ci_key" ON "office" (lower("name"));
ALTER TABLE "office" ADD CONSTRAINT "office_name_length" CHECK (char_length(btrim("name")) BETWEEN 1 AND 80);

ALTER TABLE "asset" ADD COLUMN "holderOfficeId" TEXT;
CREATE INDEX "asset_holderOfficeId_idx" ON "asset"("holderOfficeId");
ALTER TABLE "asset" ADD CONSTRAINT "asset_holderOfficeId_fkey" FOREIGN KEY ("holderOfficeId") REFERENCES "office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A person or an office, never both.
ALTER TABLE "asset" ADD CONSTRAINT "asset_one_holder" CHECK ("holderUserId" IS NULL OR "holderOfficeId" IS NULL);

-- The three offices wellD uses today (owner, 2026-11-18); managed in the app from here on.
INSERT INTO "office" ("id", "name", "entity", "updatedAt") VALUES
  ('office_ch_agno', 'CH - Agno', 'welld_ch', CURRENT_TIMESTAMP),
  ('office_ch_lugano', 'CH - Lugano', 'welld_ch', CURRENT_TIMESTAMP),
  ('office_yoroom_milano', 'YoRoom - Milano', 'welld_it', CURRENT_TIMESTAMP);
