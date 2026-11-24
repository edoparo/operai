/**
 * The register export (T8, specs/20261124-receipt-numbers-from-the-register; plan § Register export, D1; AC-1.13, AC-2.1): one
 * worksheet of the accountant's `Recap_RS_2026.xlsx` as `RegisterRow[]`.
 *
 * Only four columns are read, found by header text in the first 20 rows (trimmed, case-insensitive): `Worker`, `No.`, `Date`, `Total`.
 * Every other column is never looked at, let alone kept, and a row keeps no field beyond `position`, `worker`, `number`, `date`,
 * `totalCents` (the type says so, and a test pins it).
 *
 * Money and dates are exact. A numeric `<v>` arrives as its decimal text (the reader never turns it into a float) and is rounded to
 * cents HALF AWAY FROM ZERO on that text with integer arithmetic: `1.0049999999999999` is 1.00, `24.5` is 24.50. A date serial is read
 * in the workbook's own system (1900 with its 1900-02-29 quirk, or 1904); a text date is `YYYY-MM-DD`, `DD.MM.YYYY` or `DD/MM/YYYY`.
 * What cannot be read is `null`, never a guess.
 *
 * Personal data. A refusal names the reason, never a cell, a worker or an amount (AC-5.6). The reader's `XlsxRefusal` passes through
 * unchanged for a file it will not read.
 */

import { parseReceiptNumber } from "../../src/accounting/receiptNumber";
import { shapeOf } from "../lib/operatorFiles";
import { readXlsxSheet, type XlsxCellValue, type XlsxSheet } from "./xlsxReader";
import type { RegisterNumber, RegisterRow } from "./types";

/** The default sheet of the register. */
export const DEFAULT_SHEET = "2026";
/** The header row is looked for in this many first rows. */
export const HEADER_SEARCH_ROWS = 20;

/** Every reason this module refuses, with its fixed message (no value of the file is ever part of it). */
export const REGISTER_REFUSALS = {
  "header-missing": `No header row with the columns Worker, No., Date and Total was found in the first ${HEADER_SEARCH_ROWS} rows of the sheet.`,
} as const;

export class RegisterExportRefusal extends Error {
  readonly code: keyof typeof REGISTER_REFUSALS;
  constructor(code: keyof typeof REGISTER_REFUSALS) {
    super(REGISTER_REFUSALS[code]);
    this.name = "RegisterExportRefusal";
    this.code = code;
  }
}

/** Said whenever a formula cell had no stored result: the operator saves the workbook in Excel again. */
export const FORMULA_HINT = "Some formula cells hold no computed value: save the workbook in Excel so it stores computed values, then run again.";

export interface RegisterExport {
  readonly rows: readonly RegisterRow[];
  /** How many cells of the four columns were formulas with no stored result (read as unreadable); a count, never a cell. */
  readonly formulasWithoutValue: number;
}

// ─── Cells ───────────────────────────────────────────────────────────────────

type Cell = XlsxCellValue | undefined;

/** The text a cell holds, trimmed; `null` for an empty or unreadable one. A number or a boolean is its own text. */
function textOf(cell: Cell): string | null {
  if (cell === undefined || cell.kind === "unreadable") return null;
  const value = cell.value.trim();
  return value === "" ? null : value;
}

/** `Worker`, `No.`, `Date`, `Total`, compared trimmed and case-insensitively, on text cells only. */
function headerOf(cell: Cell): string | null {
  return cell !== undefined && cell.kind === "text" ? cell.value.trim().toLowerCase() : null;
}

// ─── The number ──────────────────────────────────────────────────────────────

/** The "No." cell, trimmed and upper-cased: empty, a paper number, or malformed (its shape only, never its text). */
export function classifyNumber(cell: Cell): RegisterNumber {
  const text = textOf(cell);
  if (text === null) return { kind: "empty" };
  const parsed = parseReceiptNumber(text);
  if (parsed !== null) return { kind: "paper", text: parsed.text, prefix: parsed.prefix, yy: parsed.yy, seq: parsed.seq };
  return { kind: "malformed", shape: shapeOf(text) };
}

// ─── The date ────────────────────────────────────────────────────────────────

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function iso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 9999 || month < 1 || month > 12) return null;
  const last = month === 2 && isLeap(year) ? 29 : DAYS[month - 1]!;
  if (!Number.isInteger(day) || day < 1 || day > last) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * A date serial as `YYYY-MM-DD`. The 1900 system counts a 1900-02-29 that never existed: serial 60 is that day (unreadable here),
 * serials 1..59 are 1900-01-01..1900-02-28 and serial 61 is 1900-03-01. The 1904 system has no quirk (serial 0 is 1904-01-01).
 * A fraction (a time of day) is dropped.
 */
export function dateOfSerial(serialText: string, date1904: boolean): string | null {
  const serial = Math.floor(Number(serialText));
  if (!Number.isFinite(serial) || serial < (date1904 ? 0 : 1) || serial > 2_958_465) return null;
  let epoch: number;
  if (date1904) {
    epoch = Date.UTC(1904, 0, 1);
  } else if (serial === 60) {
    return null;
  } else if (serial < 60) {
    epoch = Date.UTC(1899, 11, 31);
  } else {
    epoch = Date.UTC(1899, 11, 30);
  }
  const date = new Date(epoch + serial * 86_400_000);
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** A date cell as `YYYY-MM-DD`, or `null` when it is empty or no date in a form the register uses. */
export function readDate(cell: Cell, date1904: boolean): string | null {
  if (cell === undefined || cell.kind === "unreadable" || cell.kind === "bool") return null;
  if (cell.kind === "number") return dateOfSerial(cell.value, date1904);
  const value = cell.value.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(value);
  if (match) return iso(Number(match[1]), Number(match[2]), Number(match[3]));
  if (cell.kind === "isoDate") return null;
  match = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(value);
  if (match) return iso(Number(match[3]), Number(match[2]), Number(match[1]));
  return null;
}

// ─── The total ───────────────────────────────────────────────────────────────

/**
 * An exact decimal text as cents, rounded half away from zero ON THE TEXT (BigInt, no float): `24.5` is 2450, `1.0049999999999999`
 * is 100, `-3.005` is -301, `4.6083E4` is 4608300. `null` for anything that is not a plain decimal or is out of range.
 */
export function decimalToCents(text: string): number | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d{1,3}))?$/.exec(text.trim());
  if (match === null) return null;
  const [, sign = "", whole = "", fraction = "", exponentText] = match;
  if (whole === "" && fraction === "") return null;
  const digits = BigInt(`${whole}${fraction}` || "0");
  const decimals = fraction.length - Number(exponentText ?? "0"); // the value is digits / 10^decimals
  if (decimals > 400 || decimals < -400) return null;
  let cents: bigint;
  if (decimals <= 2) {
    cents = digits * 10n ** BigInt(2 - decimals);
  } else {
    const divisor = 10n ** BigInt(decimals - 2);
    cents = digits / divisor;
    if ((digits % divisor) * 2n >= divisor) cents += 1n;
  }
  const signed = sign === "-" ? -cents : cents;
  return signed >= BigInt(-Number.MAX_SAFE_INTEGER) && signed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(signed) : null;
}

/**
 * A total cell in cents, or `null`. A numeric cell is rounded as above. A text total is accepted after stripping one currency code,
 * spaces and `'` thousands separators, with `.` or `,` as the one decimal mark: `CHF 1'234.50`, `24,50`. Two decimal marks
 * (`1,234.50`) are ambiguous and refused.
 */
export function readTotal(cell: Cell): number | null {
  if (cell === undefined || cell.kind === "unreadable" || cell.kind === "bool" || cell.kind === "isoDate") return null;
  if (cell.kind === "number") return decimalToCents(cell.value);
  let value = cell.value.trim().replace(/^[A-Za-z]{3}(?=[\s\d+-])|(?<=\d)\s*[A-Za-z]{3}$/, "");
  value = value.replace(/[\s'’ ]/g, "");
  if (!/^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(value)) return null;
  return decimalToCents(value.replace(",", "."));
}

// ─── The sheet ───────────────────────────────────────────────────────────────

interface Columns {
  readonly header: number;
  readonly worker: number;
  readonly number: number;
  readonly date: number;
  readonly total: number;
}

/** The first row among the first 20 that has all four headers, with the column of each (the leftmost one of a repeated header). */
function findHeader(sheet: XlsxSheet): Columns {
  for (let rowNumber = 1; rowNumber <= HEADER_SEARCH_ROWS; rowNumber++) {
    const cells = sheet.rows.get(rowNumber);
    if (cells === undefined) continue;
    const found = new Map<string, number>();
    for (const [column, cell] of [...cells.entries()].sort(([a], [b]) => a - b)) {
      const name = headerOf(cell);
      if (name !== null && !found.has(name)) found.set(name, column);
    }
    const worker = found.get("worker");
    const number = found.get("no.");
    const date = found.get("date");
    const total = found.get("total");
    if (worker !== undefined && number !== undefined && date !== undefined && total !== undefined) {
      return { header: rowNumber, worker, number, date, total };
    }
  }
  throw new RegisterExportRefusal("header-missing");
}

/** The rows of an already-read sheet. Exported for the table-driven tests, which hand it cells the writer cannot produce. */
export function registerRowsFromSheet(sheet: XlsxSheet): RegisterExport {
  const columns = findHeader(sheet);
  const rows: RegisterRow[] = [];
  let formulasWithoutValue = 0;
  const lastRow = Math.max(0, ...sheet.rows.keys());
  for (let position = columns.header + 1; position <= lastRow; position++) {
    const cells = sheet.rows.get(position);
    if (cells === undefined) continue;
    const at = (column: number): Cell => cells.get(column);
    for (const column of [columns.worker, columns.number, columns.date, columns.total]) {
      const cell = at(column);
      if (cell?.kind === "unreadable" && cell.why === "formula-without-value") formulasWithoutValue++;
    }
    const worker = textOf(at(columns.worker));
    const number = classifyNumber(at(columns.number));
    const date = readDate(at(columns.date), sheet.date1904);
    const totalCents = readTotal(at(columns.total));
    // A row that names no worker, no number and no date is a blank or a total line: nothing in it can pair or raise a maximum.
    if (worker === null && number.kind === "empty" && date === null) continue;
    rows.push({ position, worker, number, date, totalCents });
  }
  return { rows, formulasWithoutValue };
}

/**
 * Reads the register export from the workbook's bytes. Throws `XlsxRefusal` (the file or the sheet is not readable) or
 * `RegisterExportRefusal` (no header row); both have fixed messages.
 */
export function readRegisterExport(bytes: Uint8Array, sheetName: string = DEFAULT_SHEET): RegisterExport {
  return registerRowsFromSheet(readXlsxSheet(bytes, sheetName));
}
