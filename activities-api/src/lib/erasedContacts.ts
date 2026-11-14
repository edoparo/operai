/**
 * Contact erasure under concurrency (specs/20261110-activities AC-8.4, ADR 20261110-caller-chosen-ids-replace-cross-service-transactions; OWASP review M1).
 *
 * The contact lives in crm-api, so no foreign key nulls `activity.contactId` when it is deleted:
 * crm-api asks for the links to be removed first. A sweep alone cannot stop a write that passed
 * its checks while the contact still existed from committing the link a moment later, and
 * nothing would ever remove that link. So an erasure leaves a tombstone (the id, nothing else)
 * and every write that sets a `contactId` serialises against it:
 *
 *   erase  : lock(contact) → insert tombstone → null the links → commit
 *   write  : lock(contact) → refuse if tombstoned → write → commit
 *
 * The lock is transaction-scoped and the SAME for both. Under READ COMMITTED a writer's
 * uncommitted row is invisible to the erasure's UPDATE, so the tombstone alone is not enough:
 * the writer holds the lock until it commits, and the erasure's UPDATE (a new statement, taken
 * after the lock) sees it and nulls it. A writer that comes second waits, then sees the committed
 * tombstone and is refused. Either order, nothing refers to an erased contact.
 */

import type { Prisma } from "./generated/prisma/client";
import { unprocessable } from "./problem";

/** A transaction-scoped advisory lock keyed by the contact; released at commit or rollback. */
export async function lockContact(tx: Prisma.TransactionClient, contactId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contact:${contactId}`}, 0))`;
}

/**
 * Called inside the transaction that writes `contactId`, BEFORE the write: takes the contact's
 * lock and refuses a contact crm-api has erased with the same answer as a contact of another
 * company (the caller cannot tell the two apart, and neither can be linked).
 */
export async function assertContactNotErased(tx: Prisma.TransactionClient, contactId: string): Promise<void> {
  await lockContact(tx, contactId);
  if (await tx.erasedContact.findUnique({ where: { contactId }, select: { contactId: true } })) {
    throw unprocessable("The contact does not belong to this company", { field: "contactId" }, "contact_not_in_company");
  }
}

/** The erasure itself: tombstone first, then the links, in one transaction under the lock. Returns how many activities were unlinked. */
export async function eraseContactLinks(tx: Prisma.TransactionClient, contactId: string): Promise<number> {
  await lockContact(tx, contactId);
  await tx.$executeRaw`INSERT INTO "erased_contact" ("contactId") VALUES (${contactId}) ON CONFLICT DO NOTHING`;
  // Raw, so `updatedAt` is left alone: an erasure is not an edit of the activity (the foreign key
  // it replaces would not have touched it either).
  return tx.$executeRaw`UPDATE "activity" SET "contactId" = NULL WHERE "contactId" = ${contactId}`;
}
