/**
 * The accounting release script (T11, specs/20261118-refund-accounting-export, plan "refund-api: new script", D2, D6, D7, D13;
 * AC-2.5, AC-7.1, AC-7.2, AC-7.3; rewritten by T22, specs/20261119-accounting, plan § Release scripts, D20; AC-7.4, AC-7.5, AC-6.8;
 * rewritten again by T12 and T13, specs/20261124-receipt-numbers-from-the-register, plan § The release, step by step; ADR
 * 20261124-a-one-off-release-that-needs-human-judgement-runs-as-propose-then-confirm-then-run-...).
 *
 * A one-time, OPERATOR-RUN command, run once after refund-api is deployed (the precedent of `settings:seed`). Until it has run,
 * approving a request is refused with `accounting_release_pending` (D6), so no number can be issued before the legacy lines are
 * numbered. It has THREE steps, because the accountant already numbered most of these expenses by hand in the paper register and a
 * person must confirm which line takes which paper number:
 *
 *   1. PROPOSE   bun run accounting:release --dry-run --register <xlsx> --propose <out.csv> [--sheet 2026] [--offsets <csv>] [--defaults <json>]
 *      reads Accounting and auth, then the accountant's workbook, pairs each pre-release line with register rows by (employee, expense
 *      date, amount), writes the proposed PAIRING FILE (0600, never over an existing file), prints a report with no personal data, and
 *      writes nothing to any database.
 *   2. CHECK     bun run accounting:release --dry-run --register <xlsx> --pairing <in.csv> [...]
 *      validates the decided file and runs the whole release in a transaction that is rolled back, so it prints the exact numbers.
 *   3. RUN       bun run accounting:release           --register <xlsx> --pairing <in.csv> [...]
 *      the same, for real, in ONE transaction.
 *
 * Order of the run, which is the order of the exit statuses (D9):
 *   0. The marker first: a completed release exits 0 "already completed" whatever the inputs, reading nothing and writing nothing.
 *   1. Accounting, read first (exit 2). 2. auth, for the owners' names (exit 4). 3. The inputs given (exit 5). 4. The inputs readable
 *   (exit 6). 5. Stale (exit 7). 6. Decided (exit 8). 7. The transaction (shared prefix, exit 9). 8. The report.
 *   Exit 1 is any other failure (usage, a pairing path that exists, an internal assertion); 3 is retired and never produced.
 *
 * Inside the transaction (a failure anywhere changes nothing): owner names, Refund's default accounts, one baseline row per employee
 * whose computed baseline (max of the offsets row, the register maximum and the imported numbers, AC-3.1) is 1 or more, then per
 * employee `classifyAndNumber(cause: "release", paper)` (the paper lines take the register's text and skip the counter, the others
 * take the next numbers after the baseline), and the marker.
 *
 * Personal data (AC-5.6). The register export and the pairing file name employees: keep them OUTSIDE the repository (the script warns
 * on stderr when a path is inside a git worktree; `.gitignore` refuses the usual names). Nothing the script prints, logs or throws
 * contains a name, an email, a worker, a description or the amount of a row beyond a doubtful pairing's own: an employee is
 * `<prefix> · <first 8 characters of the user id>`, a line is its id, a register row is its position, a malformed cell is its shape.
 * `--show-emails` no longer exists. Run it from an operator shell, never from CI or a job whose output is shipped to a log service.
 */

import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { createQuietDb, db as serviceDb } from "../src/lib/db";
import type { Prisma } from "../src/lib/generated/prisma/client";
import { ExpenseType } from "../src/lib/generated/prisma/enums";
import {
  accountingPort,
  AccountingUnavailableError,
  ratePairKey,
  type AccountingPort,
  type RatePair,
} from "../src/accounting/accountingClient";
import type { RatePairWire, ReferenceDataWire } from "../src/accounting/accountingWire";
import { formatRate, monthOf } from "../src/accounting/classification";
import { OwnerNamesUnavailableError, ownerNamePort, type OwnerNamePort } from "../src/accounting/ownerNames";
import { normaliseOwnerName } from "../src/lib/ownerName";
import { DEFAULTS_ENTITY } from "../src/accounting/defaults.repo";
import { BASELINE_YEAR, baselineKey, classifyAndNumber, type AccountingReads, type PaperAssignment } from "../src/accounting/numbering.repo";
import { initials, parseReceiptNumber } from "../src/accounting/receiptNumber";
import { referenceSnapshot, type ReferenceSnapshot } from "../src/accounting/referenceSnapshot";
import { RELEASE_MARKER_KEY } from "../src/accounting/release";
import { OperatorFileError, parseCsvRows, sha256Bytes, shapeOf, worktreeWarning, writeFileExclusive } from "./lib/operatorFiles";
import {
  analysePrefixes,
  computeBaselines,
  firstNewNumber,
  inventory,
  listWorkers,
  proposePairing,
  proposeWorkerMapping,
  rowsByEmployee,
  withOutsideEmployees,
  type OffsetEntry,
} from "./release/pairing";
import {
  decisionsOf,
  excludedEmployees,
  formatProblems,
  linesDigest,
  outsideEmails,
  PairingFileError,
  readPairingCsv,
  validatePairing,
  workerOwnersFromFile,
  writePairingCsv,
  type PairingFile,
  type PairingFileData,
  type Problem,
} from "./release/pairingFile";
import { readRegisterExport, RegisterExportRefusal } from "./release/registerExport";
import { buildReportInput, employeeRef, formatPairingReport, type EmployeeReportRow, type ReportInput } from "./release/report";
import type { PairingProposal, PreReleaseLine, RegisterRow, ReleaseEmployee } from "./release/types";
import { XlsxRefusal } from "./release/xlsxReader";

export const SEED_ACTOR = { userId: "system:accounting-seed", email: "system-accounting-seed@welld.ch" } as const;
export const RELEASE_ACTOR = { userId: "system:accounting-release", email: "system-accounting-release@welld.ch" } as const;

export const DEFAULT_DEFAULTS_PATH = new URL("./data/accounting-defaults.welld-ch.json", import.meta.url).pathname;

/** The message of AC-7.4, printed when Accounting cannot be read (exit code 2). */
export const ACCOUNTING_UNREADABLE_MESSAGE =
  "Accounting cannot be read: nothing was numbered or classified; run again later";

/** Printed when auth cannot be read for the owners' names (exit code 4). */
export const OWNER_NAMES_UNREADABLE_MESSAGE =
  "Auth cannot be read for the employees' names: nothing was named, numbered or classified; run again later " +
  "(check that refund-api's service client holds the scope users.contact in auth's SERVICE_CLIENTS)";

/** Printed when a real run lacks the register export or the pairing file (AC-2.8, exit code 5). */
export const INPUTS_MISSING_MESSAGE =
  "run the dry run first: the real run needs the register export (--register) and the confirmed pairing file (--pairing) that the dry run " +
  "proposes (--dry-run --register <xlsx> --propose <csv>); lines are never numbered from the offsets list alone. Nothing was written";

/** The exit statuses (plan § The release, exit table). 3 is RETIRED: it is never produced and never reused for another meaning. */
export const EXIT_ACCOUNTING_UNREADABLE = 2;
/** Auth could not be read for the owners' names (T84), nothing written: exit 4. */
export const EXIT_OWNER_NAMES_UNREADABLE = 4;
/** A register export or pairing file not given (real run), or a dry run without its mode (AC-2.8): exit 5. */
export const EXIT_INPUT_MISSING = 5;
/** An input unreadable or malformed (workbook, sheet, header, pairing format, offsets): exit 6. */
export const EXIT_INPUT_UNREADABLE = 6;
/** Stale: the workbook or the pre-release lines are not those of the pairing file (AC-2.7): exit 7. */
export const EXIT_STALE = 7;
/** The pairing is not fully decided or is inconsistent (AC-2.6): exit 8. */
export const EXIT_NOT_DECIDED = 8;
/** A new number would go to an employee who shares a prefix and holds no receipt code (AC-4.11): exit 9. */
export const EXIT_SHARED_PREFIX = 9;

/** Distinct months per call to Accounting: the most it fetches from its official source on a consumer's behalf in one call (D4). */
export const RATE_CHUNK_MONTHS = 6;

// ─── Errors ──────────────────────────────────────────────────────────────────

export class ReleaseError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** The exit status of the command for this failure. */
    readonly exit: number = 1,
  ) {
    super(message);
    this.name = "ReleaseError";
  }
}

/** A real run with no register export or no pairing file, or a dry run with no mode (AC-2.8): exit 5, nothing written. */
export class InputMissingError extends ReleaseError {
  constructor(message: string = INPUTS_MISSING_MESSAGE) {
    super("input_missing", message, EXIT_INPUT_MISSING);
    this.name = "InputMissingError";
  }
}

/** An input that cannot be read: exit 6. The message names the reason, never a cell. */
export class InputUnreadableError extends ReleaseError {
  constructor(message: string) {
    super("input_unreadable", message, EXIT_INPUT_UNREADABLE);
    this.name = "InputUnreadableError";
  }
}

/** The register export or the pre-release lines are not those the pairing file was built from (AC-2.7): exit 7, nothing written. */
export class StaleError extends ReleaseError {
  constructor(message: string) {
    super("stale", message, EXIT_STALE);
    this.name = "StaleError";
  }
}

/** The pairing file is not fully decided or is inconsistent (AC-2.6): exit 8. `problems` name ids only; nothing was written. */
export class NotDecidedError extends ReleaseError {
  constructor(readonly problems: readonly Problem[]) {
    super(
      "not_decided",
      `the pairing file is not fully decided or is inconsistent (${problems.length} ${problems.length === 1 ? "problem" : "problems"}); nothing was written:\n${formatProblems(problems).join("\n")}`,
      EXIT_NOT_DECIDED,
    );
    this.name = "NotDecidedError";
  }
}

/** A new number would go to an employee who shares a prefix with another and holds no receipt code (AC-4.11): exit 9. */
export class SharedPrefixError extends ReleaseError {
  constructor(readonly employees: readonly string[]) {
    super(
      "shared_prefix",
      `a new number would be issued to an employee whose prefix is shared with another employee and who holds no receipt code that settles it (AC-4.11): ${employees.join(", ")}. ` +
        "Set the receipt codes in Settings (runbook step 6), then run again. Nothing was written",
      EXIT_SHARED_PREFIX,
    );
    this.name = "SharedPrefixError";
  }
}

/**
 * What the operator's terminal and any session log get for a failure (F-03). A `ReleaseError` is the script's own: its message was
 * written here and names no cell, name or email. Anything else (a Prisma or driver error) can carry the invocation arguments, an
 * employee's address, a host or connection text, so only its KIND is printed: the error name, and its `code` when that is a
 * plain identifier (`ENOENT`, `P1001`). The same rule as `seed:welld-ch` in accounting-api.
 */
export function describeReleaseFailure(error: unknown): string {
  if (error instanceof ReleaseError) return error.message;
  if (!(error instanceof Error)) return "an unknown error";
  const name = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name) ? error.name : "Error";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,31}$/.test(code) ? `${name} (${code})` : name;
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

const EXPENSE_TYPES = Object.values(ExpenseType) as [ExpenseType, ...ExpenseType[]];

/**
 * Accounts only, and strict at both levels: an entry with a `vatCode` and a file with `foreignCurrencyVatCode` are refused, so a
 * stale file of the old world fails loudly instead of being half-read (20261118 SO-17). `_note` is the one free key.
 */
const DefaultsSchema = z.strictObject({
  _note: z.string().optional(),
  typeDefaults: z.partialRecord(z.enum(EXPENSE_TYPES), z.strictObject({ ledgerAccount: z.string().trim().min(1).nullable() })),
});
export type DefaultsData = z.infer<typeof DefaultsSchema>;

export function parseDefaults(raw: unknown): DefaultsData {
  const parsed = DefaultsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReleaseError("defaults_invalid", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

export interface OffsetRow {
  readonly email: string;
  readonly year: number;
  readonly lastIssuedSeq: number;
}

/** The checks of an offsets row that hold whoever built it (the file parser or a caller). Never quotes the email. */
function checkOffsetRow(row: OffsetRow, where: string): void {
  if (row.year !== BASELINE_YEAR) {
    throw new InputUnreadableError(`${where}: only ${BASELINE_YEAR} continues the paper register (AC-4.12), got ${row.year}`);
  }
  if (!Number.isInteger(row.lastIssuedSeq) || row.lastIssuedSeq < 1 || row.lastIssuedSeq > 99_999) {
    throw new InputUnreadableError(`${where}: lastIssuedSeq must be a whole number from 1 to 99999`);
  }
}

/**
 * `email,year,lastIssuedSeq` per line (delimiter `,` `;` or tab, a BOM and `#` comments allowed, a header line optional). Only 2026 is
 * accepted (AC-4.12), and the same email twice is refused, whatever its case. A file with no row must say so with the header line: an
 * empty or truncated file is refused, because "no employee has a hand-issued number" would number from 001 and could repeat one.
 * Every message names the row, never the email (AC-5.6).
 */
export function parseOffsetsCsv(text: string): OffsetRow[] {
  let table: string[][];
  try {
    table = parseCsvRows(text);
  } catch (error) {
    if (error instanceof OperatorFileError) throw new InputUnreadableError("the offsets file ends inside a quoted field: it is cut off or its quotes are unbalanced");
    throw error;
  }
  const rows: OffsetRow[] = [];
  const seen = new Set<string>();
  let headerSeen = false;
  table.forEach((cells, index) => {
    const trimmed = cells.map((c) => c.trim());
    if (trimmed[0]?.startsWith("#")) return;
    if (trimmed[0]?.toLowerCase() === "email") {
      headerSeen = true;
      return;
    }
    const where = `offsets row ${index + 1}`;
    if (trimmed.length !== 3) throw new InputUnreadableError(`${where}: expected email,year,lastIssuedSeq`);
    const [email, yearText, seqText] = trimmed as [string, string, string];
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new InputUnreadableError(`${where}: the first cell is not an email`);
    if (!/^\d{4}$/.test(yearText) || Number(yearText) < 2000) throw new InputUnreadableError(`${where}: year must be four digits`);
    if (!/^\d{1,5}$/.test(seqText)) throw new InputUnreadableError(`${where}: lastIssuedSeq must be a whole number from 1 to 99999`);
    const row = { email, year: Number(yearText), lastIssuedSeq: Number(seqText) };
    checkOffsetRow(row, where);
    const key = `${baselineKey(email)}|${yearText}`;
    if (seen.has(key)) throw new InputUnreadableError(`${where}: the same email and year appear twice`);
    seen.add(key);
    rows.push(row);
  });
  if (rows.length === 0 && !headerSeen) {
    throw new InputUnreadableError(
      "the offsets file has no header line and no row. For an empty list, write only the header line: email,year,lastIssuedSeq",
    );
  }
  return rows;
}

// ─── The report ──────────────────────────────────────────────────────────────

export interface ReleaseLineReport {
  readonly lineId: string;
  readonly requestId: string;
  /** `MC · 1a2b3c4d`: the employee's prefix in force and the first 8 characters of the user id. No name, no email. */
  readonly employeeRef: string;
  readonly date: string;
  readonly type: string;
  readonly currency: string;
  readonly receiptNumber: string;
  /** Where the number came from: the counter (`new`) or the register (`paper`, `paper_split`). */
  readonly origin: "new" | "paper" | "paper_split";
  /** The account number copied onto the line, or `null`. */
  readonly account: string | null;
  readonly missing: readonly string[];
  /** A foreign-currency line left with no rate: the first export of its batch copies it (AC-5.6). */
  readonly ratePending: boolean;
  /** The rate copied onto the line (`0.9246`), `"pending"`, or `null` for a CHF line. */
  readonly rate: string | null;
}

export interface ReleaseReport {
  /** `propose`: a dry run writing the pairing file; `check`: a dry run on a decided file; `run`: the real run. */
  readonly mode: "propose" | "check" | "run";
  readonly dryRun: boolean;
  /** The release had already been completed when this run started: nothing was read or written. `at` is the marker's time. */
  readonly alreadyCompleted: { readonly at: string } | null;
  /** What Accounting held for WellD CH when it was read, and how many (currency, month) rates were asked. */
  readonly accounting: {
    readonly ledgerAccounts: { readonly active: number; readonly total: number };
    readonly vatCodes: { readonly active: number; readonly total: number };
    readonly ratePairsAsked: number;
  };
  /**
   * Owner names (T84): `employeesNamed` = employees whose unnamed requests got the name from auth (`requestsNamed` requests), `employeesUnnamed`
   * = employees that still have a request with no name after the run (deleted in auth, or auth holds no name). Counts only: no name, no email.
   */
  readonly ownerNames: { readonly employeesNamed: number; readonly requestsNamed: number; readonly employeesUnnamed: number };
  readonly seeded: {
    readonly typeDefaults: string[];
    readonly warnings: string[];
  };
  /** The pairing report of the propose and check modes (AC-2.2); `null` for a real run. */
  readonly pairing: ReportInput | null;
  /** The pairing file the propose mode built, for the caller to write with mode 0600 (never over an existing file). */
  readonly pairingCsv: string | null;
  /**
   * The decisions of the file that differ from the proposal RECOMPUTED from the workbook and the database (never from the file's own
   * `proposed` columns, which a person could edit, AC-2.4), by line id: what was proposed and what the file decides. Paper numbers only.
   */
  readonly differsFromProposal: { lineId: string; proposed: string; decided: string }[];
  /** One entry per employee whose 2026 baseline row the run wrote (or would write), by reference. */
  readonly baseline: { employeeRef: string; baseline: number; outcome: "written" | "unchanged" }[];
  readonly numbered: { employeeRef: string; year: number; count: number; first: string; last: string }[];
  readonly lines: ReleaseLineReport[];
  /** Numbered lines whose account could not be resolved (AC-7.2, AC-7.5). */
  readonly unclassified: ReleaseLineReport[];
  /** Numbered foreign-currency lines with no rate in effect: "rate pending" (AC-5.6). */
  readonly ratePending: ReleaseLineReport[];
  /** WellD Italia lines of approved or paid requests, left without a number (AC-7.3). */
  readonly itLinesLeftUnnumbered: number;
  /** The marker was written by this run; in a dry run, the marker the real run WOULD write (nothing is written). */
  readonly markerWritten: boolean;
}

/** Thrown to roll a dry run back; carries the finished report. */
class DryRunRollback extends Error {
  constructor(readonly report: ReleaseReport) {
    super("dry run");
  }
}

/**
 * The client of the run. As a command (`bun run accounting:release`) it is the quiet one: Prisma's own error log would print the
 * invocation, the source path and the host before `describeReleaseFailure` speaks (T57, F-03). Imported (the in-process tests),
 * it is the shared `db`, which the tests seed and read through.
 */
const db: typeof serviceDb = import.meta.main ? createQuietDb() : serviceDb;

// ─── The run ─────────────────────────────────────────────────────────────────

/** A value, or a function that produces it (so an input file is read only when the run gets that far, after Accounting). */
type Lazy<T> = T | (() => T);
const resolve = <T>(value: Lazy<T>): T => (typeof value === "function" ? (value as () => T)() : value);

export interface ReleaseOptions {
  readonly dryRun?: boolean;
  /** The accountant's workbook (bytes), or a reader of it. Required by every mode that is not "already completed". */
  readonly register?: Lazy<Uint8Array>;
  /** The sheet of the workbook; default `2026`. */
  readonly sheet?: string;
  /** The decided pairing file (text), or a reader of it: the check and the real run. */
  readonly pairing?: Lazy<string>;
  /** `true` in a dry run that PROPOSES the pairing file (the report carries `pairingCsv`); exclusive with `pairing`. */
  readonly propose?: boolean;
  /** The list of last hand-issued 2026 numbers; optional, it complements the register (AC-3.1). */
  readonly offsets?: Lazy<readonly OffsetRow[]>;
  /** Refund's defaults by natural key; default: the file of `scripts/data`. */
  readonly defaults?: DefaultsData;
  readonly now?: () => Date;
  /** How Accounting is read; default: the port every route reads through (the real client of `ACCOUNTING_INTERNAL_URL`). */
  readonly accounting?: AccountingPort;
  /** How auth is asked for the names of employees whose requests have none (T84); default: the real client of `AUTH_BASE_URL`. */
  readonly ownerNames?: OwnerNamePort;
  /**
   * TEST HOOK, never a CLI flag (AC-5.2): called after each employee's lines are numbered, with the number of employees done so far.
   * A test throws from it to prove the whole run is rolled back and a rerun on the same inputs completes.
   */
  readonly afterEmployeeNumbered?: (employeesDone: number) => void;
}

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;

/** The legacy lines that will be classified and numbered: the same predicate as the backfill below. */
const legacyLineWhere = {
  entity: "welld_ch",
  rejectionReason: null,
  receiptNumber: null,
  request: { status: { in: ["approved", "paid"] } },
} satisfies Prisma.RefundLineWhereInput;

/** The distinct (currency, month) pairs of the legacy foreign-currency lines: what Accounting is asked for rates. */
async function legacyRatePairs(client: Client): Promise<RatePair[]> {
  const lines = await client.refundLine.findMany({
    where: { ...legacyLineWhere, currency: { not: "CHF" } },
    select: { currency: true, date: true },
  });
  const pairs = new Map<string, RatePair>();
  for (const line of lines) {
    const pair: RatePair = { currency: line.currency as RatePair["currency"], month: monthOf(line.date) };
    pairs.set(ratePairKey(pair), pair);
  }
  return [...pairs.values()].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

/** The pairs split into groups of at most {@link RATE_CHUNK_MONTHS} distinct months, oldest months first. */
export function chunkByMonths(pairs: readonly RatePair[], months: number = RATE_CHUNK_MONTHS): RatePair[][] {
  const order = [...new Set(pairs.map((p) => p.month))].sort();
  const chunks: RatePair[][] = [];
  for (let start = 0; start < order.length; start += months) {
    const group = new Set(order.slice(start, start + months));
    chunks.push(pairs.filter((p) => group.has(p.month)));
  }
  return chunks;
}

interface AccountingRead {
  readonly data: ReferenceDataWire;
  readonly snapshot: ReferenceSnapshot;
  readonly rates: ReadonlyMap<string, RatePairWire>;
  readonly pairsAsked: number;
}

/**
 * Step one: Accounting, BEFORE anything is written (AC-7.4). The reference data in one operation, then the rates chunk by chunk,
 * each chunk its own operation and so its own 10 s deadline (a long history cannot make one deadline fail the run, nor can one
 * slow month starve the others). Anything but a clean, complete answer throws `AccountingUnavailableError`.
 */
async function readAccounting(accounting: AccountingPort, pairs: readonly RatePair[]): Promise<AccountingRead> {
  const data = await accounting.begin("release").referenceData("welld_ch");
  const rates = new Map<string, RatePairWire>();
  for (const chunk of chunkByMonths(pairs)) {
    for (const answer of await accounting.begin("release").rates(chunk, "welld_ch")) rates.set(ratePairKey(answer), answer);
  }
  return { data, snapshot: referenceSnapshot(data), rates, pairsAsked: pairs.length };
}

/** What auth answered for the employees with an unnamed request: the trimmed name, or `null` for a deleted user or a blank name. */
type ResolvedOwnerNames = ReadonlyMap<string, string | null>;

/**
 * Step two: auth, BEFORE anything is written (T84). One call per DISTINCT employee with a request whose `ownerName` is null.
 * Anything but a clean answer (200 or 404) throws `OwnerNamesUnavailableError`, which the CLI maps to exit 4.
 */
async function readOwnerNames(port: OwnerNamePort, client: Client): Promise<ResolvedOwnerNames> {
  const unnamed = await client.refundRequest.findMany({ where: { ownerName: null }, distinct: ["ownerUserId"], select: { ownerUserId: true } });
  const resolved = new Map<string, string | null>();
  for (const { ownerUserId } of unnamed.sort((a, b) => (a.ownerUserId < b.ownerUserId ? -1 : 1))) {
    const answer = await port.lookup(ownerUserId);
    resolved.set(ownerUserId, answer.state === "found" ? normaliseOwnerName(answer.name) : null);
  }
  return resolved;
}

/** Writes the resolved names where there is none (never over an existing name) and counts what is still unnamed. */
async function fillOwnerNames(tx: Tx, resolved: ResolvedOwnerNames): Promise<ReleaseReport["ownerNames"]> {
  let employeesNamed = 0;
  let requestsNamed = 0;
  for (const [ownerUserId, name] of [...resolved.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (name === null) continue;
    const { count } = await tx.refundRequest.updateMany({ where: { ownerUserId, ownerName: null }, data: { ownerName: name } });
    if (count > 0) employeesNamed++;
    requestsNamed += count;
  }
  const left = await tx.refundRequest.findMany({ where: { ownerName: null }, distinct: ["ownerUserId"], select: { ownerUserId: true } });
  return { employeesNamed, requestsNamed, employeesUnnamed: left.length };
}

// ─── The world: Refund's side of the pairing ─────────────────────────────────

interface World {
  readonly lines: PreReleaseLine[];
  /** Line id -> request id, and the line's own unrounded facts the numbering report needs are read later. */
  readonly requestOf: ReadonlyMap<string, string>;
  /** Every employee known to Refund (a request in any status), `E1`..`En` by user id. */
  readonly employees: ReleaseEmployee[];
  /** The employee's newest request: the name (as the run will have named it) and the email the numbering takes the initials from. */
  readonly latest: ReadonlyMap<string, { readonly name: string | null; readonly email: string }>;
  /** Requests of each employee that hold a pre-release line. */
  readonly requestsOf: ReadonlyMap<string, string[]>;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Reads what the pairing needs from Refund: the pre-release lines, every employee (newest request's name and email, every email used,
 * the receipt code in force, the initials the run would derive AFTER naming the unnamed requests from auth, the prefixes of the numbers
 * already issued), and which requests hold the lines. Plain reads: the caller decides whether they run in the transaction.
 */
async function loadWorld(client: Client, names: ResolvedOwnerNames): Promise<World> {
  const requests = await client.refundRequest.findMany({
    select: { id: true, ownerUserId: true, ownerEmail: true, ownerName: true, createdAt: true, submittedAt: true },
  });
  const byOwner = new Map<string, typeof requests>();
  for (const request of requests) byOwner.set(request.ownerUserId, [...(byOwner.get(request.ownerUserId) ?? []), request]);

  const codes = new Map((await client.receiptCode.findMany({ select: { ownerUserId: true, code: true } })).map((c) => [c.ownerUserId, c.code] as const));
  const numbered = await client.refundLine.findMany({ where: { receiptNumber: { not: null } }, select: { receiptOwnerUserId: true, receiptNumber: true } });
  const numberedPrefixes = new Map<string, Set<string>>();
  for (const n of numbered) {
    const prefix = parseReceiptNumber(n.receiptNumber)?.prefix;
    if (n.receiptOwnerUserId !== null && prefix !== undefined) numberedPrefixes.set(n.receiptOwnerUserId, (numberedPrefixes.get(n.receiptOwnerUserId) ?? new Set()).add(prefix));
  }

  const latest = new Map<string, { name: string | null; email: string }>();
  const employees: ReleaseEmployee[] = [];
  const userIds = [...byOwner.keys()].sort(compareText);
  userIds.forEach((userId, index) => {
    const own = byOwner.get(userId)!;
    const newest = [...own].sort(
      (a, b) => (b.submittedAt ?? b.createdAt).getTime() - (a.submittedAt ?? a.createdAt).getTime() || compareText(b.id, a.id),
    )[0]!;
    const name = newest.ownerName ?? names.get(userId) ?? null;
    latest.set(userId, { name, email: newest.ownerEmail });
    employees.push({
      key: `E${index + 1}`,
      userId,
      name,
      email: baselineKey(newest.ownerEmail),
      emails: [...new Set(own.map((r) => baselineKey(r.ownerEmail)))].sort(),
      code: codes.get(userId) ?? null,
      initials: initials(name, newest.ownerEmail),
      numberedPrefixes: [...(numberedPrefixes.get(userId) ?? [])].sort(),
    });
  });

  const rows = await client.refundLine.findMany({
    where: legacyLineWhere,
    select: { id: true, requestId: true, date: true, createdAt: true, approvedTotalCents: true, requestedAmountCents: true, currency: true, request: { select: { ownerUserId: true } } },
  });
  const lines: PreReleaseLine[] = rows
    .map((r) => ({
      id: r.id,
      ownerUserId: r.request.ownerUserId,
      date: r.date.toISOString().slice(0, 10),
      createdAt: r.createdAt.toISOString(),
      approvedTotalCents: r.approvedTotalCents ?? r.requestedAmountCents,
      currency: r.currency as string,
    }))
    .sort((a, b) => compareText(a.id, b.id));
  const requestOf = new Map(rows.map((r) => [r.id, r.requestId] as const));
  const requestsOf = new Map<string, string[]>();
  for (const r of rows) {
    const list = requestsOf.get(r.request.ownerUserId) ?? [];
    if (!list.includes(r.requestId)) list.push(r.requestId);
    requestsOf.set(r.request.ownerUserId, list);
  }
  return { lines, requestOf, employees, latest, requestsOf };
}

const prefixOf = (e: ReleaseEmployee): string | null => e.code ?? e.initials;
const refOf = (e: ReleaseEmployee): string => (e.userId !== null && prefixOf(e) !== null ? employeeRef(prefixOf(e)!, e.userId) : "not yet in Refund");

/** The 2026 offsets as the pairing reads them; the rows are validated here again, whoever built them. */
function normaliseOffsets(rows: readonly OffsetRow[]): OffsetEntry[] {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    checkOffsetRow(row, `offsets row ${index + 1}`);
    const key = baselineKey(row.email);
    if (seen.has(key)) throw new InputUnreadableError(`offsets row ${index + 1}: the same email and year appear twice`);
    seen.add(key);
  });
  return rows.map((r) => ({ email: baselineKey(r.email), lastIssuedSeq: r.lastIssuedSeq }));
}

/** An offsets email held by more than one employee would start each of them after it and repeat each other's numbers. */
function checkOffsetsAmbiguity(employees: readonly ReleaseEmployee[], offsets: readonly OffsetEntry[]): void {
  offsets.forEach((o, index) => {
    if (employees.filter((e) => e.emails.includes(o.email)).length > 1) {
      throw new InputUnreadableError(`offsets row ${index + 1}: the email belongs to more than one user id`);
    }
  });
}

interface Decided {
  readonly decision: "paper" | "new" | "split";
  readonly paperNumber: string | null;
  readonly group: string | null;
}

/** What the run does with each line, derived from the proposal (propose mode) or from the decided file (check and run). */
function proposedDecisions(proposals: readonly PairingProposal[]): Map<string, Decided> {
  const out = new Map<string, Decided>();
  for (const p of proposals) {
    if (p.proposed === null) continue;
    out.set(p.lineId, { decision: p.proposed, paperNumber: p.proposed === "new" ? null : p.proposedNumber, group: p.group });
  }
  return out;
}

interface Plan {
  readonly employees: ReleaseEmployee[];
  readonly owners: Map<string, string>;
  readonly excluded: Set<string>;
  readonly offsets: OffsetEntry[];
  readonly rows: readonly RegisterRow[];
}

/** The paper numbers the decisions put on lines, per employee key. */
function importedBy(world: World, decisions: ReadonlyMap<string, Decided>): Map<string, string[]> {
  const employeeOfUser = new Map(world.employees.map((e) => [e.userId!, e.key] as const));
  const out = new Map<string, string[]>();
  for (const line of world.lines) {
    const d = decisions.get(line.id);
    if (d === undefined || d.decision === "new" || d.paperNumber === null) continue;
    const key = employeeOfUser.get(line.ownerUserId)!;
    out.set(key, [...(out.get(key) ?? []), d.paperNumber]);
  }
  return out;
}

/** The per-employee rows of the report and the AC-4.11 analysis, for the employees of the plan. */
function analyse(world: World, plan: Plan, decisions: ReadonlyMap<string, Decided>) {
  const imported = importedBy(world, decisions);
  const baselines = computeBaselines({ employees: plan.employees, rows: plan.rows, workerOwners: plan.owners, excluded: plan.excluded, offsets: plan.offsets, imported });
  const newOf = new Set<string>();
  const employeeOfUser = new Map(world.employees.map((e) => [e.userId!, e.key] as const));
  for (const line of world.lines) if (decisions.get(line.id)?.decision === "new") newOf.add(employeeOfUser.get(line.ownerUserId)!);
  const prefixes = analysePrefixes({ employees: plan.employees, rows: plan.rows, workerOwners: plan.owners, excluded: plan.excluded, imported, withNewNumbers: newOf });
  return { imported, baselines, newOf, prefixes };
}

function employeeRows(world: World, plan: Plan, a: ReturnType<typeof analyse>): EmployeeReportRow[] {
  const mapped = rowsByEmployee({ rows: plan.rows, workerOwners: plan.owners, excluded: plan.excluded });
  const linesOf = new Map<string, number>();
  for (const line of world.lines) linesOf.set(line.ownerUserId, (linesOf.get(line.ownerUserId) ?? 0) + 1);
  const out: EmployeeReportRow[] = [];
  for (const e of plan.employees) {
    const b = a.baselines.get(e.key)!;
    const lines = e.userId === null ? 0 : (linesOf.get(e.userId) ?? 0);
    const rowCount = (mapped.get(e.key) ?? []).length;
    if (lines === 0 && rowCount === 0 && b.offsets === 0 && !plan.excluded.has(e.key)) continue;
    out.push({
      ref: refOf(e),
      offsets: b.offsets,
      registerMax: b.registerMax,
      importedMax: b.importedMax,
      baseline: b.baseline,
      firstNew: a.newOf.has(e.key) ? firstNewNumber(e, b.baseline) : null,
      lines,
      noMappedWorker: e.userId !== null && lines > 0 && rowCount === 0,
      needsCode: a.prefixes.needCode.includes(e.key),
      excluded: plan.excluded.has(e.key),
    });
  }
  return out;
}

/** Reads and decodes the inputs of a run (step 4): every failure is an exit-6 error that quotes no cell. */
function readInputs(options: ReleaseOptions): { bytes: Uint8Array; rows: readonly RegisterRow[]; formulasWithoutValue: number; offsets: OffsetEntry[]; pairing: PairingFile | null } {
  const guard = <T>(read: () => T): T => {
    try {
      return read();
    } catch (error) {
      if (error instanceof ReleaseError) throw error;
      if (error instanceof XlsxRefusal || error instanceof RegisterExportRefusal || error instanceof PairingFileError) throw new InputUnreadableError(error.message);
      const code = (error as NodeJS.ErrnoException)?.code;
      if (typeof code === "string" && /^E[A-Z]+$/.test(code)) throw new InputUnreadableError(`an input file cannot be read (${code})`);
      throw error;
    }
  };
  const bytes = guard(() => resolve(options.register!));
  const register = guard(() => readRegisterExport(bytes, options.sheet));
  const offsetRows = options.offsets === undefined ? [] : guard(() => resolve(options.offsets!));
  const offsets = normaliseOffsets(offsetRows);
  const pairing = options.pairing === undefined ? null : guard(() => readPairingCsv(resolve(options.pairing!)));
  return { bytes, rows: register.rows, formulasWithoutValue: register.formulasWithoutValue, offsets, pairing };
}

export async function runAccountingRelease(options: ReleaseOptions = {}): Promise<ReleaseReport> {
  const defaults = options.defaults ?? parseDefaults(JSON.parse(readFileSync(DEFAULT_DEFAULTS_PATH, "utf8")));
  const dryRun = options.dryRun === true;
  const proposeMode = options.propose === true;
  const now = options.now ?? (() => new Date());
  const mode: ReleaseReport["mode"] = proposeMode ? "propose" : dryRun ? "check" : "run";

  // 0. The marker first (AC-5.3, D11): a completed release is a success and reads nothing, from nobody, and writes nothing.
  const marker = await db.refundSetting.findFirst({ where: { key: RELEASE_MARKER_KEY }, orderBy: { createdAt: "desc" }, select: { value: true } });
  if (marker?.value != null && marker.value !== "") return completedReport(mode, dryRun, marker.value);

  const accounting = options.accounting ?? accountingPort();
  const ownerNames = options.ownerNames ?? ownerNamePort();

  // 1. Read first, write after: an unreachable Accounting ends the run here with nothing changed (AC-7.4).
  const read = await readAccounting(accounting, await legacyRatePairs(db));

  // 2. Then auth, for the names of the employees whose requests have none (T84): read, not yet written, like Accounting.
  const resolvedNames: ResolvedOwnerNames = await readOwnerNames(ownerNames, db);

  // 3. The inputs given (AC-2.8): a real run needs the register and the pairing; a dry run the register and exactly one mode.
  if (options.register === undefined) {
    throw new InputMissingError(dryRun ? "a dry run needs the register export (--register <xlsx>). Nothing was written" : INPUTS_MISSING_MESSAGE);
  }
  if (dryRun ? proposeMode === (options.pairing !== undefined) : options.pairing === undefined || proposeMode) {
    throw new InputMissingError(
      dryRun
        ? "a dry run needs exactly one mode: --propose <csv> to write the proposed pairing file, or --pairing <csv> to check a decided one. Nothing was written"
        : INPUTS_MISSING_MESSAGE,
    );
  }

  // 4. The inputs readable (exit 6).
  const inputs = readInputs(options);
  const registerDigest = sha256Bytes(inputs.bytes);
  const sheet = options.sheet ?? "2026";

  if (proposeMode) {
    return propose({ options, read, resolvedNames, inputs, registerDigest, sheet });
  }

  return checkOrRun({ options, mode, dryRun, defaults, now, read, resolvedNames, inputs, registerDigest });
}

function completedReport(mode: ReleaseReport["mode"], dryRun: boolean, at: string): ReleaseReport {
  return {
    mode,
    dryRun,
    alreadyCompleted: { at },
    accounting: { ledgerAccounts: { active: 0, total: 0 }, vatCodes: { active: 0, total: 0 }, ratePairsAsked: 0 },
    ownerNames: { employeesNamed: 0, requestsNamed: 0, employeesUnnamed: 0 },
    seeded: { typeDefaults: [], warnings: [] },
    pairing: null,
    pairingCsv: null,
    differsFromProposal: [],
    baseline: [],
    numbered: [],
    lines: [],
    unclassified: [],
    ratePending: [],
    itLinesLeftUnnumbered: 0,
    markerWritten: false,
  };
}

const accountingSummary = (read: AccountingRead): ReleaseReport["accounting"] => ({
  ledgerAccounts: { active: read.data.ledgerAccounts.filter((a) => a.active).length, total: read.data.ledgerAccounts.length },
  vatCodes: { active: read.data.vatCodes.filter((v) => v.active).length, total: read.data.vatCodes.length },
  ratePairsAsked: read.pairsAsked,
});

type Inputs = ReturnType<typeof readInputs>;

// ─── Propose ─────────────────────────────────────────────────────────────────

async function propose(args: {
  options: ReleaseOptions;
  read: AccountingRead;
  resolvedNames: ResolvedOwnerNames;
  inputs: Inputs;
  registerDigest: string;
  sheet: string;
}): Promise<ReleaseReport> {
  const { read, inputs, resolvedNames } = args;
  const world = await loadWorld(db, resolvedNames);
  const workers = listWorkers(inputs.rows);
  const mapping = proposeWorkerMapping(workers, world.employees);
  const owners = new Map<string, string>();
  for (const w of workers) {
    const key = mapping.find((m) => m.workerId === w.id)!.employeeKey;
    if (key !== null) owners.set(w.key, key);
  }
  const offsets = inputs.offsets;
  const employees = withOutsideEmployees(world.employees, offsets.map((o) => o.email));
  checkOffsetsAmbiguity(world.employees, offsets);
  const pairInput = { lines: world.lines, rows: inputs.rows, employees, workerOwners: owners, excluded: new Set<string>() };
  const result = proposePairing(pairInput);
  const inv = inventory(pairInput, result);
  const plan: Plan = { employees, owners, excluded: new Set(), offsets, rows: inputs.rows };
  const a = analyse(world, plan, proposedDecisions(result.proposals));

  const lineFacts = new Map(world.lines.map((l) => [l.id, l] as const));
  const rowAt = new Map(inputs.rows.map((r) => [r.position, r] as const));
  const employeeByKey = new Map(employees.map((e) => [e.key, e] as const));
  const data: PairingFileData = {
    meta: { register: args.registerDigest, sheet: args.sheet, lines: linesDigest(world.lines), builtAt: (args.options.now ?? (() => new Date()))().toISOString() },
    employees: world.employees.map((e) => ({ key: e.key, label: `${refOf(e)} ${e.name ?? ""}`.trim(), email: e.email })),
    workers: workers.map((w) => ({ id: w.id, text: w.text, employeeKey: mapping.find((m) => m.workerId === w.id)!.employeeKey })),
    lines: result.proposals.map((p) => {
      const line = lineFacts.get(p.lineId)!;
      return { proposal: p, label: refOf(employeeByKey.get(p.employeeKey)!), date: line.date, amountCents: line.approvedTotalCents, currency: line.currency };
    }),
    rows: [
      ...inv.malformed.map((m) => ({ position: m.position, category: "malformed" as const, shape: m.shape })),
      ...inv.noWorker
        .filter((p) => !inv.malformed.some((m) => m.position === p))
        .map((position) => ({ position, category: "no_worker" as const, shape: shapeOf(rowAt.get(position)?.number.kind === "paper" ? (rowAt.get(position)!.number as { text: string }).text : "") })),
    ].sort((x, y) => x.position - y.position),
  };

  const lastDate = inputs.rows.map((r) => r.date).filter((d): d is string => d !== null).sort().at(-1) ?? null;
  const pairing = buildReportInput({
    mode: "propose",
    sheet: args.sheet,
    registerRows: inputs.rows.length,
    registerLastDate: lastDate,
    lines: world.lines,
    proposals: result.proposals,
    inventory: inv,
    formulasWithoutValue: inputs.formulasWithoutValue,
    employees: employeeRows(world, plan, a),
  });
  const itLines = await countItLines(db);
  return {
    mode: "propose",
    dryRun: true,
    alreadyCompleted: null,
    accounting: accountingSummary(read),
    ownerNames: { employeesNamed: 0, requestsNamed: 0, employeesUnnamed: 0 },
    seeded: { typeDefaults: [], warnings: [] },
    pairing,
    pairingCsv: writePairingCsv(data),
    differsFromProposal: [],
    baseline: [],
    numbered: [],
    lines: [],
    unclassified: [],
    ratePending: [],
    itLinesLeftUnnumbered: itLines,
    markerWritten: false,
  };
}

// ─── Check and run ───────────────────────────────────────────────────────────

async function checkOrRun(args: {
  options: ReleaseOptions;
  mode: ReleaseReport["mode"];
  dryRun: boolean;
  defaults: DefaultsData;
  now: () => Date;
  read: AccountingRead;
  resolvedNames: ResolvedOwnerNames;
  inputs: Inputs;
  registerDigest: string;
}): Promise<ReleaseReport> {
  const { read, inputs, resolvedNames, dryRun, mode } = args;
  const file = inputs.pairing!;

  // 5. Stale? The register export or the sheet is not the one the file was built from: refused before the database is touched (AC-2.7).
  if (file.meta.register !== args.registerDigest || file.meta.sheet !== (args.options.sheet ?? "2026")) {
    throw new StaleError("stale: the register export is not the one the pairing file was built from. Run the dry run again to get a new proposal (AC-2.7). Nothing was written");
  }

  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('accounting-release'))`;
        // The marker again, now that nobody else can write it: a run that lost the race is a success that did nothing (AC-5.3).
        const again = await tx.refundSetting.findFirst({ where: { key: RELEASE_MARKER_KEY }, orderBy: { createdAt: "desc" }, select: { value: true } });
        if (again?.value != null && again.value !== "") return completedReport(mode, dryRun, again.value);

        const world = await loadWorld(tx, resolvedNames);
        // 5. Stale? The pre-release lines are not those of the file (a request approved since, a line rejected): a new proposal is needed.
        if (linesDigest(world.lines) !== file.meta.lines) {
          throw new StaleError("stale: the pre-release lines are not those of the pairing file. Run the dry run again to get a new proposal (AC-2.7). Nothing was written");
        }
        // 6. Decided? Every problem of the file, named by id (AC-2.6).
        const problems = validatePairing({ file, lines: world.lines, employees: world.employees, rows: inputs.rows, offsets: inputs.offsets });
        if (problems.length > 0) throw new NotDecidedError(problems);
        const excluded = excludedEmployees(file);
        const employees = withOutsideEmployees(world.employees, [...outsideEmails(file, world.employees), ...inputs.offsets.map((o) => o.email)]);
        checkOffsetsAmbiguity(world.employees, inputs.offsets);
        const owners = workerOwnersFromFile(file, inputs.rows, employees);
        const decisions = decisionsOf(file) as Map<string, Decided>;
        const plan: Plan = { employees, owners, excluded, offsets: inputs.offsets, rows: inputs.rows };
        const a = analyse(world, plan, decisions);
        // 7. Shared prefix (AC-4.11): the codes as they are NOW, before the first write.
        if (a.prefixes.blocked.length > 0) {
          const byKey = new Map(plan.employees.map((e) => [e.key, e] as const));
          throw new SharedPrefixError(a.prefixes.blocked.map((key) => refOf(byKey.get(key)!)));
        }
        const differs = differsFromProposal(world, plan, decisions);

        // 1. Owner names, so every number's prefix and every reference comes from the NAME (T84).
        const namesReport = await fillOwnerNames(tx, resolvedNames);
        // 2. Refund's default accounts.
        const seeded = await seedDefaults(tx, args.defaults, read.snapshot);
        // 3. Baseline rows (AC-3.1).
        const baselineReport = await writeBaselines(tx, world, plan, a.baselines);
        // 4. Number the lines, per employee.
        const backfill = await numberLines(tx, world, plan, decisions, { snapshot: read.snapshot, rates: read.rates }, args.options.afterEmployeeNumbered);
        // AC-1.2: every pre-release line holds exactly one number and no number was issued that no line holds.
        await assertOneNumberPerLine(tx, world, plan, decisions, a.baselines);
        // 5. The marker.
        await tx.refundSetting.create({
          data: { key: RELEASE_MARKER_KEY, value: args.now().toISOString(), createdByUserId: RELEASE_ACTOR.userId, createdByEmail: RELEASE_ACTOR.email },
        });

        const report: ReleaseReport = {
          mode,
          dryRun,
          alreadyCompleted: null,
          accounting: accountingSummary(read),
          ownerNames: namesReport,
          seeded,
          pairing: null,
          pairingCsv: null,
          differsFromProposal: differs,
          baseline: baselineReport,
          numbered: backfill.numbered,
          lines: backfill.lines,
          unclassified: backfill.lines.filter((l) => l.missing.length > 0),
          ratePending: backfill.lines.filter((l) => l.ratePending),
          itLinesLeftUnnumbered: backfill.itLinesLeftUnnumbered,
          markerWritten: !dryRun,
        };
        if (dryRun) throw new DryRunRollback(report);
        return report;
      },
      { timeout: 5 * 60_000, maxWait: 30_000 },
    );
  } catch (error) {
    if (error instanceof DryRunRollback) return error.report;
    throw error;
  }
}

// ── 1. Defaults ──────────────────────────────────────────────────────────────

async function seedDefaults(tx: Tx, defaults: DefaultsData, snapshot: ReferenceSnapshot): Promise<ReleaseReport["seeded"]> {
  const out = { typeDefaults: [] as string[], warnings: [] as string[] };
  const actor = { createdByUserId: SEED_ACTOR.userId, createdByEmail: SEED_ACTOR.email };

  /** The entry as Accounting holds it, when it is active; else a warning and `null`: an entry Accounting no longer offers is never seeded. */
  const usableAccount = (number: string | null, what: string) => {
    if (number === null) return null;
    const found = snapshot.lookupAccount(number);
    if (found.state === "active") return { number: found.number, name: found.name };
    out.warnings.push(`${what}: account ${number} is ${found.state === "deactivated" ? "deactivated" : "not found"} in Accounting, no default account seeded`);
    return null;
  };

  const base = Date.now();
  let tick = 0;
  for (const type of Object.values(ExpenseType)) {
    const entry = defaults.typeDefaults[type];
    if (!entry) continue;
    const existing = await tx.expenseTypeAccountingDefault.count({ where: { entity: DEFAULTS_ENTITY, type } });
    if (existing > 0) continue; // an admin's choice, even an explicit "none", is never overridden
    const account = usableAccount(entry.ledgerAccount, type);
    if (account === null) continue;
    await tx.expenseTypeAccountingDefault.create({
      data: {
        entity: DEFAULTS_ENTITY,
        type,
        accountNumber: account.number,
        accountName: account.name,
        createdAt: new Date(base + tick++),
        ...actor,
      },
    });
    out.typeDefaults.push(type);
  }
  return out;
}

// ── 2. Baseline ──────────────────────────────────────────────────────────────

/**
 * One `receipt_number_baseline` row per employee whose computed baseline is 1 or more and differs from the latest row, keyed by the
 * employee's newest request email (or the email the operator named for an employee not yet in Refund). Append-only: the latest row per
 * email and year counts. It is NOT a counter: `classifyAndNumber` creates the counter when the employee's first new 2026 number is
 * issued (here, or at an approval months later) and starts it after the baseline, so paper-only employees and employees with no
 * request yet are covered too (AC-3.4, AC-3.6). An employee whose 2026 counter already exists cannot be given another start.
 */
async function writeBaselines(tx: Tx, world: World, plan: Plan, baselines: ReturnType<typeof analyse>["baselines"]): Promise<ReleaseReport["baseline"]> {
  const out: ReleaseReport["baseline"] = [];
  for (const employee of plan.employees) {
    const b = baselines.get(employee.key)!;
    if (b.baseline < 1 || plan.excluded.has(employee.key)) continue;
    const ref = refOf(employee);
    const key = baselineKey(employee.userId !== null ? world.latest.get(employee.userId)!.email : employee.email);
    if (employee.userId !== null) {
      const counter = await tx.receiptCounter.findUnique({ where: { ownerUserId_year: { ownerUserId: employee.userId, year: BASELINE_YEAR } } });
      if (counter) {
        if (counter.startAfter === b.baseline && counter.startAfterSetBy !== null) {
          out.push({ employeeRef: ref, baseline: b.baseline, outcome: "unchanged" });
          continue;
        }
        throw new ReleaseError("baseline_pair_has_numbers", `${ref}: the ${BASELINE_YEAR} counter already exists (last ${counter.lastSeq}); a baseline can only be loaded before the first number`);
      }
      const numbered = await tx.refundLine.count({ where: { receiptOwnerUserId: employee.userId, receiptYear: BASELINE_YEAR } });
      if (numbered > 0) throw new ReleaseError("baseline_pair_has_numbers", `${ref}: already has receipt numbers for ${BASELINE_YEAR}`);
    }
    const latestRow = await tx.receiptNumberBaseline.findFirst({
      where: { emailKey: key, year: BASELINE_YEAR },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { lastIssuedSeq: true },
    });
    if (latestRow?.lastIssuedSeq === b.baseline) {
      out.push({ employeeRef: ref, baseline: b.baseline, outcome: "unchanged" });
      continue;
    }
    await tx.receiptNumberBaseline.create({
      data: { emailKey: key, year: BASELINE_YEAR, lastIssuedSeq: b.baseline, createdByUserId: RELEASE_ACTOR.userId, createdByEmail: RELEASE_ACTOR.email },
    });
    out.push({ employeeRef: ref, baseline: b.baseline, outcome: "written" });
  }
  return out;
}

// ── 3. Numbering ─────────────────────────────────────────────────────────────

/** WellD Italia lines of approved or paid requests: never numbered by the release (AC-7.3), only counted. */
const countItLines = (client: Client): Promise<number> =>
  client.refundLine.count({
    where: { entity: "welld_it", rejectionReason: null, receiptNumber: null, request: { status: { in: ["approved", "paid"] } } },
  });

/**
 * Numbers the pre-release lines, per employee in user-id order: the lines the file gives a paper number take it as written (and skip
 * the counter), the others take the next numbers after the baseline, by expense date, then creation time, then id (AC-3.3).
 */
async function numberLines(
  tx: Tx,
  world: World,
  plan: Plan,
  decisions: ReadonlyMap<string, Decided>,
  reference: AccountingReads,
  afterEmployee?: (employeesDone: number) => void,
): Promise<{ numbered: ReleaseReport["numbered"]; lines: ReleaseLineReport[]; itLinesLeftUnnumbered: number }> {
  let employeesDone = 0;
  const lines: ReleaseLineReport[] = [];
  const employeeOfUser = new Map(world.employees.map((e) => [e.userId!, e] as const));
  const mappedRows = rowsByEmployee({ rows: plan.rows, workerOwners: plan.owners, excluded: plan.excluded });
  const byOwner = new Map<string, PreReleaseLine[]>();
  for (const line of world.lines) byOwner.set(line.ownerUserId, [...(byOwner.get(line.ownerUserId) ?? []), line]);

  for (const ownerUserId of [...byOwner.keys()].sort(compareText)) {
    const employee = employeeOfUser.get(ownerUserId)!;
    const own = [...byOwner.get(ownerUserId)!].sort((x, y) => compareText(x.date, y.date) || compareText(x.createdAt, y.createdAt) || compareText(x.id, y.id));
    const paper = new Map<string, PaperAssignment>();
    const partOfGroup = new Map<string, number>();
    const registerRows = mappedRows.get(employee.key) ?? [];
    for (const line of own) {
      const d = decisions.get(line.id);
      if (d === undefined || d.decision === "new" || d.paperNumber === null) continue;
      const part = d.decision === "split" ? (partOfGroup.get(d.group ?? line.id) ?? 0) + 1 : 1;
      if (d.decision === "split") partOfGroup.set(d.group ?? line.id, part);
      const same = registerRows.filter((r) => r.number.kind === "paper" && r.number.text === d.paperNumber);
      const sameDay = same.filter((r) => r.date === line.date);
      // The rows this line is paired with: the row of its own total when there is one (a split of two lines), else every row of that
      // number on its date (one line, two rows), else every row of the number (a pairing made by hand). Positions only (AC-1.17).
      const ownRows = sameDay.filter((r) => r.totalCents === line.approvedTotalCents);
      paper.set(line.id, {
        number: d.paperNumber,
        splitPart: part,
        registerRows: (ownRows.length > 0 ? ownRows : sameDay.length > 0 ? sameDay : same).map((r) => r.position).sort((x, y) => x - y),
        ...(d.decision === "split" ? { split: true } : {}),
      });
    }
    const latest = world.latest.get(ownerUserId)!;
    const result = await classifyAndNumber(tx, {
      owner: { userId: ownerUserId, name: latest.name, email: latest.email },
      requestIds: world.requestsOf.get(ownerUserId) ?? [],
      cause: "release",
      actor: { userId: RELEASE_ACTOR.userId, email: RELEASE_ACTOR.email },
      reference,
      entities: ["welld_ch"],
      paper,
    });
    if (!result.ok) {
      // Only `approval` refuses on a missing classification; `reference_missing` means a legacy line appeared between the read of
      // Accounting and this transaction (a rate pair that was never asked). Nothing is guessed: the run is rolled back.
      throw new ReleaseError(
        "legacy_lines_changed",
        "the legacy lines changed while the release was running, so Accounting was not asked about all of them; run it again",
      );
    }

    const details = await tx.refundLine.findMany({
      where: { id: { in: result.lines.map((l) => l.lineId) } },
      select: { id: true, date: true, type: true, currency: true, accountNumber: true, fxRateMicros: true },
    });
    const detailOf = new Map(details.map((d) => [d.id, d]));
    const ref = refOf(employee);
    for (const numbered of result.lines) {
      const d = detailOf.get(numbered.lineId)!;
      lines.push({
        lineId: numbered.lineId,
        requestId: numbered.requestId,
        employeeRef: ref,
        date: d.date.toISOString().slice(0, 10),
        type: d.type,
        currency: d.currency,
        receiptNumber: numbered.receiptNumber,
        origin: numbered.origin === "issued" ? "new" : numbered.origin,
        account: d.accountNumber,
        missing: numbered.missing ?? [],
        ratePending: numbered.ratePending,
        rate: d.currency === "CHF" ? null : d.fxRateMicros !== null ? formatRate(d.fxRateMicros) : "pending",
      });
    }
    afterEmployee?.(++employeesDone);
  }

  const groups = new Map<string, ReleaseReport["numbered"][number]>();
  for (const line of lines) {
    const year = Number(line.date.slice(0, 4));
    const key = `${line.employeeRef}|${year}`;
    const group = groups.get(key);
    if (group) groups.set(key, { ...group, count: group.count + 1, last: line.receiptNumber });
    else groups.set(key, { employeeRef: line.employeeRef, year, count: 1, first: line.receiptNumber, last: line.receiptNumber });
  }
  return {
    numbered: [...groups.values()].sort((a, b) => compareText(a.employeeRef, b.employeeRef) || a.year - b.year),
    lines,
    itLinesLeftUnnumbered: await countItLines(tx),
  };
}

/**
 * The decisions of the file that differ from the proposal recomputed here, from the workbook and the database with the file's own
 * worker mapping and exclusions (AC-2.4): the file's `proposed` columns are never read, a person could have edited them. Only a
 * proposal that named something is compared; a doubtful line with none is simply decided.
 */
function differsFromProposal(world: World, plan: Plan, decisions: ReadonlyMap<string, Decided>): ReleaseReport["differsFromProposal"] {
  const result = proposePairing({ lines: world.lines, rows: plan.rows, employees: plan.employees, workerOwners: plan.owners, excluded: plan.excluded });
  const text = (kind: string | null, number: string | null) => (kind === null ? "none" : number === null ? kind : `${kind} ${number}`);
  const out: ReleaseReport["differsFromProposal"] = [];
  for (const p of result.proposals) {
    if (p.proposed === null) continue;
    const d = decisions.get(p.lineId)!;
    const proposed = text(p.proposed, p.proposedNumber);
    const decided = text(d.decision, d.paperNumber);
    if (proposed !== decided) out.push({ lineId: p.lineId, proposed, decided });
  }
  return out.sort((a, b) => compareText(a.lineId, b.lineId));
}

/**
 * AC-1.2, checked before the transaction commits: every pre-release line carries exactly one number (the CHECK keeps it to one column
 * set), a line that took a paper number consumed no counter number, and no counter number was issued that no line holds. Per employee
 * and expense year: counter `lastSeq - startAfter` is the number of lines that took a NEW number, and the 2026 counter started after
 * the baseline. Anything else is an internal error: the run is rolled back, exit 1.
 */
async function assertOneNumberPerLine(
  tx: Tx,
  world: World,
  plan: Plan,
  decisions: ReadonlyMap<string, Decided>,
  baselines: ReturnType<typeof analyse>["baselines"],
): Promise<void> {
  const fail = (what: string): never => {
    throw new ReleaseError("assertion", `internal check failed after numbering (${what}): nothing was changed`);
  };
  const numbered = await tx.refundLine.findMany({ where: { id: { in: world.lines.map((l) => l.id) } }, select: { id: true, receiptNumber: true, receiptOrigin: true } });
  if (numbered.length !== world.lines.length || numbered.some((l) => l.receiptNumber === null)) fail("a pre-release line has no number");
  const originOf = new Map(numbered.map((l) => [l.id, l.receiptOrigin] as const));
  const employeeOfUser = new Map(world.employees.map((e) => [e.userId!, e] as const));
  const expected = new Map<string, number>(); // `${userId}|${year}` -> lines that take a new number
  for (const line of world.lines) {
    const d = decisions.get(line.id);
    const isNew = d === undefined || d.decision === "new" || d.paperNumber === null;
    if (isNew !== (originOf.get(line.id) === "issued")) fail("a line took the wrong kind of number");
    if (isNew) {
      const key = `${line.ownerUserId}|${line.date.slice(0, 4)}`;
      expected.set(key, (expected.get(key) ?? 0) + 1);
    }
  }
  const counters = await tx.receiptCounter.findMany();
  const seen = new Set<string>();
  for (const counter of counters) {
    const key = `${counter.ownerUserId}|${counter.year}`;
    seen.add(key);
    if (counter.lastSeq - counter.startAfter !== (expected.get(key) ?? 0)) fail("a counter moved by a different count than the lines that took a new number");
    if (counter.year === BASELINE_YEAR) {
      const employee = employeeOfUser.get(counter.ownerUserId);
      const baseline = employee === undefined ? 0 : (baselines.get(employee.key)?.baseline ?? 0);
      if (!plan.excluded.has(employee?.key ?? "") && counter.startAfter !== baseline) fail("a counter did not start after the baseline");
    } else if (counter.startAfter !== 0) {
      fail("a counter of another year started after a baseline");
    }
  }
  for (const key of expected.keys()) if (!seen.has(key)) fail("lines took new numbers and no counter exists");
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

/** "1 line", "0 lines", "5 lines" (D-10 of the sign-off QE round: a group of one read "1 lines"). */
const linesOf = (n: number): string => `${n} ${n === 1 ? "line" : "lines"}`;

export function formatReport(report: ReleaseReport): string {
  const out: string[] = [];
  if (report.alreadyCompleted !== null) {
    return `The accounting release was already completed on ${report.alreadyCompleted.at}: nothing to do. Nothing was read and nothing was written.`;
  }
  out.push(
    report.mode === "propose"
      ? "DRY RUN (propose): nothing was written to any database. The proposed pairing file is the only output."
      : report.dryRun
        ? "DRY RUN (check): nothing was written. This is what the real run would do."
        : "Accounting release completed.",
  );
  const a = report.accounting;
  const s = report.seeded;
  out.push(
    "",
    "Accounting (WellD CH, read before anything was written)",
    `  ledger accounts: ${a.ledgerAccounts.active} active of ${a.ledgerAccounts.total}`,
    `  VAT codes: ${a.vatCodes.active} active of ${a.vatCodes.total}`,
    `  exchange rates asked for ${a.ratePairsAsked} (currency, month) pairs of the legacy lines`,
    // No VAT code is needed to approve, release or export (AC-7.5): only an empty account list is worth a warning.
    ...(a.ledgerAccounts.active === 0
      ? [
          "  WARNING: Accounting holds no active WellD CH ledger accounts. Every legacy line is numbered but left without an account,",
          "  and every WellD CH approval is refused until accounting enters them in Accounting.",
        ]
      : []),
  );
  if (report.pairing !== null) out.push("", ...formatPairingReport(report.pairing));
  if (report.mode !== "propose") {
    out.push(
      "",
      "Employees' names (read from auth before anything was written; only where a request had none)",
      `  employees named: ${report.ownerNames.employeesNamed} (${report.ownerNames.requestsNamed} ${report.ownerNames.requestsNamed === 1 ? "request" : "requests"})`,
      `  employees left unnamed: ${report.ownerNames.employeesUnnamed}${
        report.ownerNames.employeesUnnamed > 0
          ? " (deleted in auth or with no name there: their receipt initials and journal Description fall back to the email)"
          : ""
      }`,
      "",
      "Default accounts of Refund (by natural key, each only where Refund held no row)",
      `  type defaults set (${s.typeDefaults.length}): ${s.typeDefaults.join(", ") || "none"}`,
      ...s.warnings.map((w) => `  WARNING: ${w}`),
      "",
      `Decisions that differ from the proposal (${report.differsFromProposal.length}), recomputed from the register and the database`,
      ...report.differsFromProposal.map((d) => `  ${d.lineId}: proposed ${d.proposed}, the file decides ${d.decided}`),
      "",
      `Baseline rows (${report.baseline.length}): the counter of each employee continues after the baseline`,
      ...(report.baseline.length === 0 ? ["  none: numbering starts at 001 (AC-4.12)"] : report.baseline.map((b) => `  ${b.employeeRef} ${BASELINE_YEAR}: numbering continues after ${b.baseline} (${b.outcome})`)),
      "",
      `Numbered legacy WellD CH lines (${report.lines.length})`,
      ...report.numbered.map((n) => `  ${n.employeeRef} ${n.year}: ${linesOf(n.count)}, ${n.first} to ${n.last}`),
      "",
      `Rate pending: ${linesOf(report.ratePending.length)} (no rate in effect yet: the first export of their batch copies it)`,
      ...report.ratePending.map((l) => `  ${l.receiptNumber} ${l.employeeRef} ${l.date} ${l.type} ${l.currency} (line ${l.lineId})`),
      "",
      `Left without an account (${report.unclassified.length})`,
      ...report.unclassified.map((l) => `  ${l.receiptNumber} ${l.employeeRef} ${l.date} ${l.type} ${l.currency}: missing ${l.missing.join(" and ")} (line ${l.lineId})`),
    );
  }
  out.push(
    "",
    `WellD Italia lines of approved or paid requests left without a number: ${report.itLinesLeftUnnumbered}`,
    // D-1: `markerWritten` means "would be written" in a dry run, and a dry run writes nothing: say so.
    `Release marker written: ${report.mode === "propose" ? "no (propose writes nothing)" : report.dryRun ? "no (dry run: the real run would write it)" : "yes"}`,
  );
  if (report.dryRun && report.mode === "check") {
    out.push("", "Every line (receipt number, origin, date, type, currency, account, rate)");
    for (const l of report.lines) {
      out.push(`  ${l.receiptNumber}  ${l.origin}  ${l.date}  ${l.type}  ${l.currency}  ${l.account ?? "-"}  ${l.rate ?? "-"}  ${l.employeeRef}  (line ${l.lineId})`);
    }
  }
  return out.join("\n");
}

const USAGE =
  "Usage: bun run accounting:release [--dry-run] --register <xlsx> (--propose <csv> | --pairing <csv>) [--sheet <name>] [--offsets <csv>] [--defaults <json>]";

interface Cli {
  readonly dryRun: boolean;
  readonly register: string | undefined;
  readonly propose: string | undefined;
  readonly pairing: string | undefined;
  readonly sheet: string | undefined;
  readonly offsets: string | undefined;
  readonly defaults: string | undefined;
}

/** Parses the arguments. Usage errors are exit 1 and name the reason, never a value (AC-5.6). */
export function parseArguments(argv: readonly string[]): Cli {
  const values = new Map<string, string>();
  let dryRun = false;
  const withValue = new Set(["--register", "--propose", "--pairing", "--sheet", "--offsets", "--defaults"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--show-emails") {
      throw new ReleaseError("usage", "--show-emails was removed: no output of the release names an employee by email (AC-5.6)");
    } else if (withValue.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new ReleaseError("usage", `${arg} needs a value`);
      if (values.has(arg)) throw new ReleaseError("usage", `${arg} is given twice`);
      values.set(arg, value);
      i++;
    } else {
      // A flag-shaped word is echoed so a typo is found; anything else could be a path or a value and is not.
      throw new ReleaseError("usage", `unknown argument${/^--[A-Za-z][A-Za-z0-9-]{0,30}$/.test(arg) ? ` ${arg}` : ""}. ${USAGE}`);
    }
  }
  return {
    dryRun,
    register: values.get("--register"),
    propose: values.get("--propose"),
    pairing: values.get("--pairing"),
    sheet: values.get("--sheet"),
    offsets: values.get("--offsets"),
    defaults: values.get("--defaults"),
  };
}

async function main(argv: readonly string[]): Promise<void> {
  const cli = parseArguments(argv);
  for (const [path, what] of [
    [cli.register, "the register export"],
    [cli.pairing, "the pairing file"],
    [cli.propose, "the pairing file to write"],
    [cli.offsets, "the offsets file"],
  ] as const) {
    const warning = path === undefined ? null : worktreeWarning(path, what, "It names employees");
    if (warning) console.warn(warning);
  }
  const report = await runAccountingRelease({
    dryRun: cli.dryRun,
    propose: cli.propose !== undefined,
    ...(cli.register !== undefined ? { register: () => readFileSync(cli.register!) } : {}),
    ...(cli.pairing !== undefined ? { pairing: () => readFileSync(cli.pairing!, "utf8") } : {}),
    ...(cli.sheet !== undefined ? { sheet: cli.sheet } : {}),
    ...(cli.offsets !== undefined ? { offsets: () => parseOffsetsCsv(readFileSync(cli.offsets!, "utf8")) } : {}),
    ...(cli.defaults !== undefined ? { defaults: parseDefaults(JSON.parse(readFileSync(cli.defaults, "utf8"))) } : {}),
  });
  if (report.pairingCsv !== null && cli.propose !== undefined) {
    if (existsSync(cli.propose)) throw new ReleaseError("pairing_exists", "the pairing file path exists: a decided file is never overwritten. Choose a new path. Nothing was written");
    writeFileExclusive(cli.propose, report.pairingCsv);
  }
  console.log(formatReport(report));
  if (report.mode === "propose" && report.pairing !== null) {
    console.log("", `Pairing file written (mode 0600): ${report.pairing.openDecisions} decisions are open; the real run would refuse with exit 8 until they are decided.`);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .catch((error) => {
      if (error instanceof AccountingUnavailableError) {
        // AC-7.4: exit 2, nothing written. The kind is for the operator (it names no URL, host or token); the client logged it too.
        console.error(`accounting:release stopped: ${ACCOUNTING_UNREADABLE_MESSAGE}. (${error.kind})`);
        process.exitCode = EXIT_ACCOUNTING_UNREADABLE;
        return;
      }
      if (error instanceof OwnerNamesUnavailableError) {
        // T84: exit 4, nothing written. The kind names no URL, host, token, id, email or name.
        console.error(`accounting:release stopped: ${OWNER_NAMES_UNREADABLE_MESSAGE}. (${error.kind})`);
        process.exitCode = EXIT_OWNER_NAMES_UNREADABLE;
        return;
      }
      if (error instanceof ReleaseError && error.exit !== 1) {
        console.error(`accounting:release stopped (exit ${error.exit}): ${error.message}`);
        process.exitCode = error.exit;
        return;
      }
      console.error(`accounting:release failed, nothing was changed: ${describeReleaseFailure(error)}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.$disconnect();
    });
}
