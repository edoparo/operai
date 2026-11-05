-- better-auth 1.7 jwt plugin adds three optional columns to its key table
-- (expiresAt, alg, crv); without them its startup schema check refuses to mint
-- tokens. Nullable, so existing RS256 key rows keep working untouched.
ALTER TABLE "jwks" ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "alg" TEXT,
ADD COLUMN "crv" TEXT;
