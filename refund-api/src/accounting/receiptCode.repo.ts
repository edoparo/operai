/**
 * Receipt codes: the prefix of an employee's NEW receipt numbers (specs/20261124-receipt-numbers-from-the-register; plan D8;
 * ADR 20261124-a-receipt-code-per-employee-overrides-the-derived-initials-for-new-numbers-only-...).
 *
 * T4 creates the file with `receiptPrefix` only; the list, set/change/clear and history of the codes (T5) extend it.
 */

import type { Prisma } from "../lib/generated/prisma/client";
import { initials } from "./receiptNumber";

/**
 * The prefix a NEW number of this employee takes: the current `receipt_code` when there is one, else the initials derived from the
 * name, then the email (AC-4.4, AC-4.8 of 20261118). A plain read of the committed value at that moment, inside the caller's
 * transaction. `classifyAndNumber` calls it ONCE per call, so every number of one call shares one prefix even when the code is
 * changed meanwhile (AC-4.10); numbers already issued or imported are never recomputed (AC-4.4, AC-4.12).
 */
export async function receiptPrefix(
  tx: Prisma.TransactionClient,
  owner: { readonly userId: string; readonly name: string | null; readonly email: string },
): Promise<string> {
  const row = await tx.receiptCode.findUnique({ where: { ownerUserId: owner.userId }, select: { code: true } });
  return row ? row.code : initials(owner.name, owner.email);
}
