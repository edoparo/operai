-- specs/20261115-crm-offer-wizard (2026-11-24): which shipped revision of its seed text a seeded wizard template was
-- last decided against. NULL = revision 1 (every row seeded before this column existed). Written only by the seeding,
-- under the entity's template lock; never shown, never sent.
ALTER TABLE "offer_template" ADD COLUMN "seedRevision" INTEGER;
