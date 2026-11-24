-- specs/20261101-crm US-10 (2026-11-24, owner): a company is a client or a funding body (the issuer of a public tender,
-- e.g. Chips Joint Undertaking). A funding body is never invoiced and never becomes a customer. Every existing
-- company is a client.
CREATE TYPE "CompanyKind" AS ENUM ('client', 'funding_body');
ALTER TABLE "company" ADD COLUMN "kind" "CompanyKind" NOT NULL DEFAULT 'client';
