/**
 * `classifyAndNumber`: the one place a line's classification is copied and its receipt number issued (T8,
 * specs/20261118-refund-accounting-export; reworked by T20, specs/20261119-accounting; AC-5.1, AC-5.6, AC-6.3, AC-7.1, AC-7.2,
 * AC-4.3 to AC-4.5, AC-4.7, AC-4.10 of 20261118; ADR 20261118-accounting-classification-is-live-until-approval-then-frozen-...
 * and ADR 20261118-receipt-numbers-come-from-a-row-locked-per-employee-and-year-counter-inside-the-approval-transaction-...,
 * both as amended; ADR 20261119-accounting-reference-data-belongs-to-accounting-api-...).
 *
 * Used by the approve transaction (`cause: "approval"`) and, from T22, by the release script (`cause: "release"`). It always
 * runs INSIDE the caller's transaction: a rollback of the caller takes the counters, the numbers, the copies and the audit rows
 * with it, so a refused or failed approval consumes no number and records no copy (AC-6.2).
 *
 * It makes NO call to Accounting. The caller read Accounting BEFORE its transaction (no lock is held across an HTTP call, D11)
 * and passes what it read: the reference data as a snapshot and the rates in effect of the request's foreign-currency pairs.
 * The pair set it read is a superset of what is resolved here, because the line set is fixed while a request is submitted.
 *
 * What it does, in this order
 * 1. Locks the candidate lines (`FOR UPDATE`, by id) and re-reads them, so a line numbered by someone else a moment ago is
 *    skipped, never numbered twice.
 * 2. Resolves every WellD CH line through `resolveClassification`, the same function the review view and the export use, on
 *    the copies stored on the line, Refund's recorded defaults and the snapshot. A stored copy is kept as it is; a half left on
 *    a default takes the entry's CURRENT values from the snapshot, when the entry is active (D11). With `cause: "approval"`
 *    a line that has nothing bookable for a half (no default, or a default that is deactivated, not found or unverifiable)
 *    REFUSES the whole call, before anything is written (AC-6.3). With `cause: "release"` such a line is still numbered and
 *    gets whatever half did resolve, the missing half stays empty and shows up as an export blocker (AC-7.2 of 20261118).
 * 3. Takes the per-(employee, year) counters, years ascending (the lock order that rules out a deadlock between two approvals
 *    of the same employee), each with ONE upsert that adds the number of lines of that year and returns the new `lastSeq`;
 *    the row stays locked until the caller commits (AC-4.10). WHEN A COUNTER IS CREATED for 2026 (and only 2026), it starts after
 *    the employee's hand-issued number: the latest row of `receipt_number_baseline` for each email the owner's user id has used
 *    (highest wins, N-01), lower-cased, else 0 (AC-4.11 to AC-4.13, SO-13 of 20261118). So the first 2026 line of an employee whose paper register ended at 81 is `…26/082`,
 *    whether it is numbered by the release backfill or by an approval months later, and an employee who had no Refund request at
 *    release is covered too. A counter that already exists never reads the baseline again, and 2025, 2027 and later years never do.
 * 4. Writes each line in ONE `UPDATE`: the copies, the exchange-rate copy and the receipt columns together. The database
 *    guard `refund_line_accounting_guard` locks the copies of a paid request only once the line has a receipt number, so the
 *    copies must never be written after the number in a separate statement (IS-1): on a legacy line of a paid request that
 *    second statement would be refused. The rate is copied here when Accounting has one in effect for the line's expense
 *    month; otherwise the line stays "rate pending" and the first export copies it (AC-5.6). A rate copy already on the line
 *    is never written again (write-once).
 * 5. Audits: `line_classified` (WellD CH lines, detail v2: the copies from and to, and `fxRate` for a foreign-currency line)
 *    and `receipt_number_assigned`.
 *
 * specs/20261124-receipt-numbers-from-the-register (T4): the prefix of a NEW number is the employee's receipt code, else the derived
 * initials (`receiptPrefix`), read ONCE per call inside the transaction (AC-4.4, AC-4.10); the optional `paper` input gives lines of a
 * release the number written in the accountant's register instead of the counter's (they do not move the counter, AC-1.6); every
 * numbered line stores its origin and split part, and `receipt_number_assigned` says which (AC-1.17).
 *
 * Numbering order is the expense date, then the line's `createdAt`, then its id (AC-4.4 of 20261118), across all the lines
 * of one call. Lines of two years are numbered in two independent sequences (AC-4.5). WellD Italia lines are numbered like any
 * other (AC-4.1) but never classified (AC-4.9); a rejected line is neither.
 */

import type { Prisma } from "../lib/generated/prisma/client";
import type { Entity, ExpenseType } from "../lib/generated/prisma/enums";
import {
  writeAuditEntry,
  type AuditFxRate,
  type ClassifiedCause,
  type LineClassifiedDetail,
  type ReceiptNumberAssignedDetail,
} from "../requests/audit";
import { ratePairKey } from "./accountingClient";
import type { RatePairWire } from "./accountingWire";
import {
  classifiableInput,
  monthOf,
  monthStart,
  resolveClassification,
  type Classification,
  type MissingPart,
} from "./classification";
import { loadRecordedDefaults } from "./defaults.repo";
import type { ReferenceSnapshot } from "./referenceSnapshot";
import { receiptPrefix } from "./receiptCode.repo";
import { formatReceiptNumber, parseReceiptNumber } from "./receiptNumber";

export type NumberingCause = "approval" | "release";

export interface Actor {
  readonly userId: string;
  readonly email: string;
}

/** What the caller read from Accounting before its transaction (D11). */
export interface AccountingReads {
  readonly snapshot: ReferenceSnapshot;
  /** The rate in effect of each (currency, month) pair of the request's foreign-currency WellD CH lines, by `ratePairKey`. */
  readonly rates: ReadonlyMap<string, RatePairWire>;
}

/**
 * A number taken from the accountant's register instead of the counter (the release only; specs/20261124 T4, AC-1.2, AC-1.6).
 * `number` is the paper text, trimmed and upper-cased by the caller or here; its sequence is the paper sequence (0 is allowed);
 * `splitPart` is 1, or 2..n for the further lines of a confirmed split receipt, whose lines all carry the same number.
 * `registerRows` are the row positions of the register that the line was paired with (audited as positions only, AC-1.17).
 */
export interface PaperAssignment {
  readonly number: string;
  readonly splitPart: number;
  readonly registerRows: readonly number[];
}

export interface ClassifyAndNumberInput {
  /** Every request must belong to this employee: the counters are per employee. */
  readonly owner: { readonly userId: string; readonly name: string | null; readonly email: string };
  /** The requests whose unnumbered, non-rejected lines are to be handled (one for an approval, several for a release). */
  readonly requestIds: readonly string[];
  readonly cause: NumberingCause;
  readonly actor: Actor;
  /**
   * What was read from Accounting, or `null` when the caller knows that no WellD CH line is to be classified (a request with
   * only WellD Italia or rejected lines never calls Accounting, AC-6.4). A WellD CH line met with `null` here is a refusal
   * (`reference_missing`), never a guess.
   */
  readonly reference: AccountingReads | null;
  /** Only lines of these entities are handled; the release script passes `["welld_ch"]` (AC-7.3 of 20261118). Default: all. */
  readonly entities?: readonly Entity[];
  /**
   * The release only: lines that take the paper number written in the register instead of the counter's next number. They are
   * classified like any other line, in the same single `UPDATE`, and do not move the counter. A key that is not a line of this call
   * (not found, already numbered, rejected, another entity) is an error, never a silently dropped number.
   */
  readonly paper?: ReadonlyMap<string, PaperAssignment>;
}

export interface MissingLine {
  readonly lineId: string;
  readonly requestId: string;
  /** `YYYY-MM-DD` */
  readonly date: string;
  readonly type: ExpenseType;
  readonly missing: readonly MissingPart[];
}

export interface NumberedLine {
  readonly lineId: string;
  readonly requestId: string;
  readonly entity: Entity;
  readonly receiptNumber: string;
  readonly year: number;
  readonly seq: number;
  /** Where the number came from: the counter (`issued`) or the register (`paper`, `paper_split`). */
  readonly origin: "issued" | "paper" | "paper_split";
  readonly splitPart: number;
  /** `null` for a WellD Italia line. `missing` is empty when the line is fully classified. */
  readonly missing: readonly MissingPart[] | null;
  /** The exchange-rate copy this call wrote: `null` for a CHF line, a WellD Italia line, or a line left "rate pending". */
  readonly fxRate: { readonly rateMicros: number; readonly month: string } | null;
  /** `true` for a foreign-currency WellD CH line that ends with no rate copy: it is "rate pending" (AC-5.6). */
  readonly ratePending: boolean;
}

export type ClassifyAndNumberResult =
  | { readonly ok: true; readonly lines: readonly NumberedLine[] }
  /** `cause: "approval"` only: nothing was written. */
  | { readonly ok: false; readonly reason: "classification_missing"; readonly missing: readonly MissingLine[] }
  /**
   * A WellD CH line was found that the caller's read of Accounting did not account for (it appeared between the read and the
   * lock): nothing was written and the caller retries from the start. Never a classification from data not read.
   */
  | { readonly ok: false; readonly reason: "reference_missing" };

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/** The one year whose numbering continues the paper register (AC-4.12): 2027 restarts at 001 (AC-4.13), 2025 is not continued. */
export const BASELINE_YEAR = 2026;
/** `receipt_counter.startAfterSetBy` of a counter that started from the baseline. */
export const BASELINE_SET_BY = "baseline";

/** The baseline's key for an employee: the email, trimmed and lower-cased (the table's CHECK says the same). */
export const baselineKey = (email: string): string => email.trim().toLowerCase();

/**
 * The last hand-issued 2026 sequence of this employee: 0 when there is none (no baseline).
 *
 * The table is keyed by email (the register knows people by their address), but the counter is per user id, and an address can
 * change before the first numbering (rename, alias): a lookup by the current email alone would start that person at 001 over
 * numbers already written by hand (N-01 of the sign-off security re-review). So the lookup covers every email this user id has
 * used: the one on the request being numbered plus the `ownerEmail` of every request of the same `ownerUserId`, each normalised
 * like the key. Per email the latest row counts (a correction is a new row, AC-4.11); across emails the HIGHEST of those counts
 * wins, because a number issued twice in the books is worse than a gap. Only emails of THIS user id are read, so another
 * employee's baseline never applies. A person who changed their address before filing anything under the old one leaves no trace
 * to follow: that case needs a baseline row under the new email (stated in the ADR).
 */
async function baselineSeq(tx: Prisma.TransactionClient, userId: string, email: string): Promise<number> {
  const used = await tx.refundRequest.findMany({
    where: { ownerUserId: userId },
    distinct: ["ownerEmail"],
    select: { ownerEmail: true },
  });
  const keys = [...new Set([email, ...used.map((r) => r.ownerEmail)].map(baselineKey).filter((k) => k !== ""))];
  let best = 0;
  for (const emailKey of keys) {
    const row = await tx.receiptNumberBaseline.findFirst({
      where: { emailKey, year: BASELINE_YEAR },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { lastIssuedSeq: true },
    });
    if (row && row.lastIssuedSeq > best) best = row.lastIssuedSeq;
  }
  return best;
}

const accountSummary = (a: { number: string; name: string } | null) => (a ? { number: a.number, name: a.name } : null);
const vatSummary = (v: { code: string; rateBasisPoints: number } | null) =>
  v ? { code: v.code, rateBasisPoints: v.rateBasisPoints } : null;

export async function classifyAndNumber(
  tx: Prisma.TransactionClient,
  input: ClassifyAndNumberInput,
): Promise<ClassifyAndNumberResult> {
  // A paper number for a line this call does not number is an error, also when there is nothing to number at all (never dropped).
  const noLines = (): ClassifyAndNumberResult => {
    for (const lineId of input.paper?.keys() ?? []) throw new Error(`paper number given for line ${lineId}, which this call does not number`);
    return { ok: true, lines: [] };
  };
  if (input.requestIds.length === 0) return noLines();

  // ── 1. Candidates, locked ────────────────────────────────────────────────
  const candidates = await tx.refundLine.findMany({
    where: {
      requestId: { in: [...input.requestIds] },
      rejectionReason: null,
      receiptNumber: null,
      ...(input.entities ? { entity: { in: [...input.entities] } } : {}),
    },
    select: { id: true },
  });
  if (candidates.length === 0) return noLines();
  const lockedIds = (
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "refund_line" WHERE "id" = ANY(${candidates.map((l) => l.id)}::text[]) ORDER BY "id" FOR UPDATE`
  ).map((row) => row.id);

  const lines = await tx.refundLine.findMany({
    where: { id: { in: lockedIds }, rejectionReason: null, receiptNumber: null },
    select: {
      id: true,
      requestId: true,
      date: true,
      type: true,
      entity: true,
      currency: true,
      createdAt: true,
      rejectionReason: true,
      accountNumber: true,
      accountName: true,
      ledgerAccountIsDefault: true,
      vatCodeCopy: true,
      vatRateBasisPoints: true,
      fxRateMicros: true,
    },
  });
  lines.sort(
    (a, b) =>
      a.date.getTime() - b.date.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  if (lines.length === 0) return noLines();

  // ── 2. Resolve ───────────────────────────────────────────────────────────
  const classifiesSomething = lines.some((l) => l.entity === "welld_ch");
  if (classifiesSomething && input.reference === null) return { ok: false, reason: "reference_missing" };
  // Refund's own recorded defaults, read inside the transaction (they are Refund's rows); Accounting was read before it.
  const recorded = classifiesSomething ? await loadRecordedDefaults(tx) : { defaults: {} };

  const resolved = new Map<string, Classification | null>();
  const missingLines: MissingLine[] = [];
  for (const line of lines) {
    const classification =
      input.reference === null
        ? null
        : resolveClassification(classifiableInput(line), recorded.defaults, input.reference.snapshot);
    resolved.set(line.id, classification);
    // A foreign-currency line to copy a rate for must have its pair among the answers the caller read: "Accounting was not
    // asked" is never "Accounting has no rate" (that would leave a line pending that had one).
    if (
      classification !== null &&
      line.currency !== "CHF" &&
      line.fxRateMicros === null &&
      !input.reference?.rates.has(ratePairKey({ currency: line.currency, month: monthOf(line.date) }))
    ) {
      return { ok: false, reason: "reference_missing" };
    }
    if (classification !== null && classification.missing.length > 0) {
      missingLines.push({
        lineId: line.id,
        requestId: line.requestId,
        date: isoDate(line.date),
        type: line.type,
        missing: classification.missing,
      });
    }
  }
  if (input.cause === "approval" && missingLines.length > 0) {
    return { ok: false, reason: "classification_missing", missing: missingLines };
  }

  // ── 3. Paper assignments, the prefix, the counters ───────────────────────
  // A paper line takes the text written in the register and skips the counter (AC-1.6): its sequence is the paper's, so the
  // counter is not moved by it and the baseline (written by the release) is what keeps later numbers above it (AC-3.3).
  const paper = input.paper ?? new Map<string, PaperAssignment>();
  const paperOf = new Map<string, { parsed: NonNullable<ReturnType<typeof parseReceiptNumber>>; assignment: PaperAssignment }>();
  const lineIds = new Set(lines.map((l) => l.id));
  for (const [lineId, assignment] of paper) {
    if (!lineIds.has(lineId)) throw new Error(`paper number given for line ${lineId}, which this call does not number`);
    const parsed = parseReceiptNumber(assignment.number);
    if (parsed === null) throw new RangeError(`paper number of line ${lineId} is not a receipt number`);
    if (!Number.isInteger(assignment.splitPart) || assignment.splitPart < 1) {
      throw new RangeError(`paper split part of line ${lineId} must be an integer of 1 or more`);
    }
    paperOf.set(lineId, { parsed, assignment });
  }
  // One number on several lines is a confirmed split: parts 1..n, each once. A part above 1 with no part 1 is refused here (the
  // database checks the same at commit).
  const partsOf = new Map<string, number[]>();
  for (const { parsed, assignment } of paperOf.values()) {
    partsOf.set(parsed.text, [...(partsOf.get(parsed.text) ?? []), assignment.splitPart]);
  }
  for (const [text, parts] of partsOf) {
    const sorted = [...parts].sort((a, b) => a - b);
    if (sorted.some((part, i) => part !== i + 1)) throw new RangeError(`paper number ${text}: split parts must be 1..${parts.length}, once each`);
  }

  const yearOf = (line: { date: Date }) => line.date.getUTCFullYear();
  const perYear = new Map<number, number>();
  for (const line of lines) if (!paperOf.has(line.id)) perYear.set(yearOf(line), (perYear.get(yearOf(line)) ?? 0) + 1);
  // The prefix of the NEW numbers: read ONCE per call, here, inside the transaction (AC-4.4, AC-4.10, AC-4.12). A code changed
  // by someone else while this call runs is seen by the next call, never by half of this one.
  const prefix = perYear.size > 0 ? await receiptPrefix(tx, input.owner) : null;
  const nextSeq = new Map<number, number>();
  for (const year of [...perYear.keys()].sort((a, b) => a - b)) {
    const count = perYear.get(year)!;
    // Read only when the counter may be created here: the conflict branch below ignores the VALUES of an existing counter, so a
    // baseline never moves a counter that already exists (and `receipt_counter` freezes `startAfter` after insert anyway).
    const start = year === BASELINE_YEAR ? await baselineSeq(tx, input.owner.userId, input.owner.email) : 0;
    const setBy = start > 0 ? BASELINE_SET_BY : null;
    const rows = await tx.$queryRaw<{ lastSeq: number }[]>`
      INSERT INTO "receipt_counter" ("ownerUserId", "year", "lastSeq", "startAfter", "startAfterSetBy", "updatedAt")
      VALUES (${input.owner.userId}, ${year}::int, ${start + count}::int, ${start}::int, ${setBy}::text, now())
      ON CONFLICT ("ownerUserId", "year") DO UPDATE
        SET "lastSeq" = "receipt_counter"."lastSeq" + ${count}::int, "updatedAt" = now()
      RETURNING "lastSeq"`;
    const last = rows[0]?.lastSeq;
    if (typeof last !== "number") throw new Error("receipt_counter upsert returned no row");
    nextSeq.set(year, last - count + 1);
  }

  // ── 4 + 5. One UPDATE per line, then the audit rows ──────────────────────
  const numberedAt = new Date();
  const out: NumberedLine[] = [];
  for (const line of lines) {
    const year = yearOf(line);
    const paperLine = paperOf.get(line.id);
    let receiptNumber: string;
    let seq: number;
    let origin: NumberedLine["origin"];
    let splitPart = 1;
    if (paperLine) {
      receiptNumber = paperLine.parsed.text;
      seq = paperLine.parsed.seq;
      splitPart = paperLine.assignment.splitPart;
      origin = partsOf.get(paperLine.parsed.text)!.length > 1 ? "paper_split" : "paper";
    } else {
      seq = nextSeq.get(year)!;
      nextSeq.set(year, seq + 1);
      receiptNumber = formatReceiptNumber(prefix!, year, seq);
      origin = "issued";
    }
    const classification = resolved.get(line.id) ?? null;

    // The rate of a foreign-currency line of WellD CH: copied when Accounting has one in effect for the expense month, else
    // the line is "rate pending" (AC-5.1, AC-5.6). It is written once: a copy already there is never replaced.
    let fxCopy: { rateMicros: number; month: string } | null = null;
    let ratePending = false;
    if (classification !== null && line.currency !== "CHF") {
      if (line.fxRateMicros !== null) {
        // Already copied (cannot happen on an unnumbered line, but the rule is the same): nothing to write.
      } else {
        const month = monthOf(line.date);
        const answer = input.reference?.rates.get(ratePairKey({ currency: line.currency, month }));
        if (answer?.status === "in_effect") fxCopy = { rateMicros: answer.rateMicros, month };
        else ratePending = true;
      }
    }

    await tx.refundLine.update({
      where: { id: line.id },
      data: {
        receiptNumber,
        receiptOwnerUserId: input.owner.userId,
        receiptYear: year,
        receiptSeq: seq,
        numberedAt,
        // Origin and split part are set with the number, in the same statement (CHECK refund_line_receipt_origin_all_or_none).
        receiptOrigin: origin,
        receiptSplitPart: splitPart,
        ...(classification
          ? {
              accountNumber: classification.bookable.account?.number ?? null,
              accountName: classification.bookable.account?.name ?? null,
              ledgerAccountIsDefault: classification.bookable.account ? classification.accountIsDefault : null,
              vatCodeCopy: classification.bookable.vatCode?.code ?? null,
              vatRateBasisPoints: classification.bookable.vatCode?.rateBasisPoints ?? null,
              // Nothing reads the flag (SO-2): `false` for a copy, NULL for none.
              vatCodeIsDefault: classification.bookable.vatCode ? false : null,
            }
          : {}),
        ...(fxCopy ? { fxRateMicros: fxCopy.rateMicros, fxRateMonth: monthStart(fxCopy.month), fxRateCopiedAt: numberedAt } : {}),
      },
    });

    if (classification) {
      const cause: ClassifiedCause = input.cause;
      const fxRate: AuditFxRate | undefined =
        line.currency === "CHF" ? undefined : fxCopy ? fxCopy : line.fxRateMicros !== null ? undefined : "pending";
      const stored = classifiableInput(line);
      const detail: LineClassifiedDetail = {
        v: 2,
        cause,
        account: {
          from: accountSummary(stored.account),
          to: accountSummary(classification.bookable.account),
          fromDefault: stored.account === null ? true : line.ledgerAccountIsDefault === true,
          toDefault: classification.bookable.account ? classification.accountIsDefault : false,
        },
        vatCode: {
          from: vatSummary(stored.vatCode),
          to: vatSummary(classification.bookable.vatCode),
          fromDefault: false,
          toDefault: false,
        },
        ...(fxRate !== undefined ? { fxRate } : {}),
      };
      await writeAuditEntry(tx, {
        requestId: line.requestId,
        lineId: line.id,
        actorUserId: input.actor.userId,
        actorEmail: input.actor.email,
        action: "line_classified",
        detail: detail as unknown as Record<string, unknown>,
      });
    }
    const assigned: ReceiptNumberAssignedDetail = {
      cause: input.cause,
      receiptNumber,
      year,
      seq,
      origin: origin === "issued" ? "new" : origin,
      ...(paperLine ? { registerRows: [...paperLine.assignment.registerRows] } : {}),
      ...(origin === "paper_split" ? { splitPart } : {}),
    };
    await writeAuditEntry(tx, {
      requestId: line.requestId,
      lineId: line.id,
      actorUserId: input.actor.userId,
      actorEmail: input.actor.email,
      action: "receipt_number_assigned",
      detail: assigned as unknown as Record<string, unknown>,
    });

    out.push({
      lineId: line.id,
      requestId: line.requestId,
      entity: line.entity,
      receiptNumber,
      year,
      seq,
      origin,
      splitPart,
      missing: classification ? classification.missing : null,
      fxRate: fxCopy,
      ratePending,
    });
  }
  return { ok: true, lines: out };
}
