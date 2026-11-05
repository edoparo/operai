-- CreateTable
CREATE TABLE "access_request" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "firstRequestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "invitationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "access_request_email_key" ON "access_request"("email");

-- CreateIndex
CREATE INDEX "access_request_status_requestedAt_idx" ON "access_request"("status", "requestedAt");

-- AddForeignKey
ALTER TABLE "access_request" ADD CONSTRAINT "access_request_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_request" ADD CONSTRAINT "access_request_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "invitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- specs/023 (ADR-0071): closed value sets, enforced in the database.
ALTER TABLE "access_request"
  ADD CONSTRAINT "access_request_status_check" CHECK ("status" IN ('pending','approved','rejected')),
  ADD CONSTRAINT "access_request_provider_check" CHECK ("provider" IN ('google','github','unknown'));
