-- specs/020 US-7. Offers that already went out: a deal at "offer sent", won or lost has sent its offers.
-- When and by whom is not known; the creation is the best available answer.
UPDATE "deal_offer" o
SET "sentAt" = o."createdAt", "sentBy" = o."createdBy"
FROM "deal" d
WHERE d."id" = o."dealId"
  AND d."stage" IN ('negotiation', 'won', 'lost')
  AND o."deletedAt" IS NULL;
