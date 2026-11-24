/**
 * Receipt codes: the prefix of an employee's NEW receipt numbers (specs/20261124-receipt-numbers-from-the-register; plan D8;
 * ADR 20261124-a-receipt-code-per-employee-overrides-the-derived-initials-for-new-numbers-only-...).
 *
 * T4 created the file with `receiptPrefix` only; T5 adds the list, set/change/clear and history of the codes, behind
 * `receipt-code:manage` (AC-4.1, AC-4.2, AC-4.3, AC-4.6, AC-4.7, AC-4.9, AC-4.10, AC-4.11; design sync DS-2, DS-8).
 */

import { db } from "../lib/db";
import type { Prisma } from "../lib/generated/prisma/client";
import { initials, normaliseReceiptCode } from "./receiptNumber";

type Client = Prisma.TransactionClient;

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

export interface Actor {
  readonly userId: string;
  readonly email: string;
}

/** One employee of the Receipt codes list (plan § API contracts; DS-2, DS-8). */
export interface ReceiptCodeRow {
  readonly userId: string;
  readonly name: string | null;
  readonly email: string;
  readonly initials: string;
  readonly code: string | null;
  readonly prefix: string;
  readonly prefixSource: "code" | "initials";
  readonly lastNumber: string | null;
  readonly changedAt: string | null;
  readonly changedByEmail: string | null;
  readonly sharesPrefix: boolean;
}

export interface ReceiptCodeHistoryEntry {
  readonly codeBefore: string | null;
  readonly codeAfter: string | null;
  readonly changedBy: { readonly userId: string; readonly email: string };
  readonly changedAt: string;
}

/**
 * Every employee known to Refund (at least one request, any status), with the newest request's name and email. The list is
 * gated, so the email is shown to capability holders only (accounting already sees it in review).
 */
async function loadEmployees(tx: Client): Promise<{ userId: string; name: string | null; email: string }[]> {
  const rows = await tx.$queryRaw<{ ownerUserId: string; ownerName: string | null; ownerEmail: string }[]>`
    SELECT DISTINCT ON ("ownerUserId") "ownerUserId", "ownerName", "ownerEmail"
      FROM "refund_request"
     ORDER BY "ownerUserId", "createdAt" DESC, "id" DESC`;
  return rows.map((r) => ({ userId: r.ownerUserId, name: r.ownerName, email: r.ownerEmail }));
}

/**
 * All rows of the list, ordered by name (a missing name last) then user id. `sharesPrefix` (DS-8) is true when the employee's
 * prefix (code, else initials) equals, for another employee: that employee's code; or that employee's derived initials when it
 * has no code; or the prefix of any number issued or imported to that employee, in any year.
 */
async function loadRows(tx: Client): Promise<ReceiptCodeRow[]> {
  const employees = await loadEmployees(tx);
  const codes = new Map((await tx.receiptCode.findMany({ select: { ownerUserId: true, code: true } })).map((r) => [r.ownerUserId, r.code]));
  const changes = await tx.$queryRaw<{ ownerUserId: string; createdAt: Date; createdByEmail: string }[]>`
    SELECT DISTINCT ON ("ownerUserId") "ownerUserId", "createdAt", "createdByEmail"
      FROM "receipt_code_change"
     ORDER BY "ownerUserId", "createdAt" DESC, "id" DESC`;
  const changeOf = new Map(changes.map((c) => [c.ownerUserId, c]));
  const numbered = await tx.$queryRaw<{ ownerUserId: string; prefix: string }[]>`
    SELECT DISTINCT "receiptOwnerUserId" AS "ownerUserId", substring("receiptNumber" from '^[A-Z]+') AS "prefix"
      FROM "refund_line" WHERE "receiptNumber" IS NOT NULL`;
  const numberPrefixes = new Map<string, Set<string>>();
  for (const n of numbered) numberPrefixes.set(n.ownerUserId, (numberPrefixes.get(n.ownerUserId) ?? new Set()).add(n.prefix));
  const lastNumbers = await tx.$queryRaw<{ ownerUserId: string; receiptNumber: string }[]>`
    SELECT DISTINCT ON ("receiptOwnerUserId") "receiptOwnerUserId" AS "ownerUserId", "receiptNumber"
      FROM "refund_line" WHERE "receiptNumber" IS NOT NULL
     ORDER BY "receiptOwnerUserId", "receiptYear" DESC, "receiptSeq" DESC, "receiptSplitPart" DESC, "id" DESC`;
  const lastOf = new Map(lastNumbers.map((l) => [l.ownerUserId, l.receiptNumber]));

  const base = employees.map((e) => {
    const code = codes.get(e.userId) ?? null;
    const derived = initials(e.name, e.email);
    return { ...e, code, derived, prefix: code ?? derived };
  });
  const rows = base.map((e): ReceiptCodeRow => {
    const others = base.filter((f) => f.userId !== e.userId);
    const sharesPrefix = others.some(
      (f) => f.code === e.prefix || (f.code === null && f.derived === e.prefix) || (numberPrefixes.get(f.userId)?.has(e.prefix) ?? false),
    );
    const change = changeOf.get(e.userId);
    return {
      userId: e.userId,
      name: e.name,
      email: e.email,
      initials: e.derived,
      code: e.code,
      prefix: e.prefix,
      prefixSource: e.code !== null ? "code" : "initials",
      lastNumber: lastOf.get(e.userId) ?? null,
      changedAt: change ? change.createdAt.toISOString() : null,
      changedByEmail: change ? change.createdByEmail : null,
      sharesPrefix,
    };
  });
  return rows.sort((a, b) => {
    if ((a.name === null) !== (b.name === null)) return a.name === null ? 1 : -1;
    const byName = (a.name ?? "").localeCompare(b.name ?? "");
    return byName !== 0 ? byName : a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });
}

/** `GET /accounting/receipt-codes`. */
export async function listReceiptCodes(client: Client = db): Promise<ReceiptCodeRow[]> {
  return loadRows(client);
}

export type SetReceiptCodeOutcome =
  | { readonly kind: "ok"; readonly row: ReceiptCodeRow }
  | { readonly kind: "invalid" }
  | { readonly kind: "employee_not_found" }
  | { readonly kind: "in_use" };

/** Thrown inside the transaction to roll it back with a refusal that is not an error. */
class Refusal extends Error {
  constructor(readonly outcome: "employee_not_found" | "in_use") {
    super(outcome);
  }
}

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";

/**
 * `PUT /accounting/receipt-codes/{userId}`: set, change or clear (AC-4.1, AC-4.2, AC-4.3, AC-4.7), in ONE transaction:
 * - the employee's edits are serialised by `pg_advisory_xact_lock(hashtext('receipt-code:' || userId))`, so `codeBefore` is exact;
 * - the input is normalised first (`""` and `null` clear, two or three letters set, anything else is `invalid`);
 * - "in use" (409, names nobody): another employee holds the code, or another employee has a number issued or imported with that
 *   prefix. The unique index on `receipt_code.code` decides a race between two employees (P2002 is the same 409);
 * - saving the current value writes nothing; otherwise the current row is upserted or deleted and one append-only
 *   `receipt_code_change` row records who and when (the actor comes from the JWT only).
 * Numbers already issued or imported are never touched (AC-4.4, AC-4.12).
 */
export async function setReceiptCode(userId: string, input: unknown, actor: Actor): Promise<SetReceiptCodeOutcome> {
  const wanted = normaliseReceiptCode(input);
  if (wanted.kind === "invalid") return { kind: "invalid" };
  try {
    const row = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`receipt-code:${userId}`}))`;
      const known = await tx.refundRequest.findFirst({ where: { ownerUserId: userId }, select: { id: true } });
      if (!known) throw new Refusal("employee_not_found");
      const current = await tx.receiptCode.findUnique({ where: { ownerUserId: userId }, select: { code: true } });
      const before = current?.code ?? null;
      const after = wanted.kind === "code" ? wanted.code : null;
      if (before !== after) {
        if (after !== null) {
          const heldByAnother = await tx.receiptCode.findFirst({ where: { code: after, ownerUserId: { not: userId } }, select: { ownerUserId: true } });
          const numberedForAnother = await tx.$queryRaw<{ one: number }[]>`
            SELECT 1 AS one FROM "refund_line"
             WHERE "receiptOwnerUserId" <> ${userId} AND substring("receiptNumber" from '^[A-Z]+') = ${after} LIMIT 1`;
          if (heldByAnother || numberedForAnother.length > 0) throw new Refusal("in_use");
          await tx.receiptCode.upsert({
            where: { ownerUserId: userId },
            create: { ownerUserId: userId, code: after, updatedByUserId: actor.userId, updatedByEmail: actor.email },
            update: { code: after, updatedByUserId: actor.userId, updatedByEmail: actor.email },
          });
        } else {
          await tx.receiptCode.delete({ where: { ownerUserId: userId } });
        }
        await tx.receiptCodeChange.create({
          data: { ownerUserId: userId, codeBefore: before, codeAfter: after, createdByUserId: actor.userId, createdByEmail: actor.email },
        });
      }
      return (await loadRows(tx)).find((r) => r.userId === userId)!;
    });
    return { kind: "ok", row };
  } catch (error) {
    if (error instanceof Refusal) return { kind: error.outcome };
    if (isUniqueViolation(error)) return { kind: "in_use" };
    throw error;
  }
}

/** `GET /accounting/receipt-codes/{userId}/history`: newest first; `null` when no request has this `ownerUserId` (404). */
export async function receiptCodeHistory(userId: string, client: Client = db): Promise<ReceiptCodeHistoryEntry[] | null> {
  const known = await client.refundRequest.findFirst({ where: { ownerUserId: userId }, select: { id: true } });
  if (!known) return null;
  const rows = await client.receiptCodeChange.findMany({ where: { ownerUserId: userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  return rows.map((r) => ({
    codeBefore: r.codeBefore,
    codeAfter: r.codeAfter,
    changedBy: { userId: r.createdByUserId, email: r.createdByEmail },
    changedAt: r.createdAt.toISOString(),
  }));
}
