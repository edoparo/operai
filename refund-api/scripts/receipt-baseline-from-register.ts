/**
 * Operator helper (T64, specs/20261119-accounting; 20261118 AC-4.11; plans "Accounting sign-off delta (2026-11-19)", SO-14, R19).
 *
 * Derives, from a CSV export of the accounting register (`Recap_RS_2026`), the HIGHEST 2026 receipt-number sequence per initials, and
 * lists what accounting must look at before the list goes into `accounting:release --offsets`:
 *
 *   bun run receipt-baseline:from-register --register <csv>
 *
 * The export needs a `receiptNumber` column (`MC26/081`) and may have an `expenseDate` column (`2026-03-14`, `14.03.2026`, `14/03/2026`;
 * a time after the date is ignored). Header names are matched without regard to case, a BOM is dropped, and the delimiter (`,` `;` or a
 * tab) is read from the header line. Other columns (a name, an email) are NEVER read into the output.
 *
 * What it reports:
 * - MAXIMUM per initials: the highest sequence of a 2026 number (`..26/nnn`), plus every WRONG-YEAR number that counts (below).
 * - DUPLICATES: a number that appears more than once (for example `FR26/002` twice). Harmless to the maximum; listed for accounting.
 * - WRONG-YEAR numbers: a number whose year is not 26 (for example `LG25/014` in the 2026 register). It counts toward that initials'
 *   2026 maximum when its expense date is in 2026, when the export has no date column, or when the row's date is empty or unreadable
 *   (a doubtful entry is counted: a gap after the paper numbers is harmless, a repeated number is not). It does not count when the
 *   row's date is readable and outside 2026. Always listed, with the reason, so accounting can confirm.
 * - MALFORMED numbers (not `<2 letters><2 digits>/<1 to 5 digits>`, or a sequence outside 1 to 99999): listed by data row with the
 *   SHAPE of the cell only (letters as A, digits as 9), never its text, since a cell that is not a number may hold a name. Not counted.
 *   Look at these first: a malformed entry may hide a higher number.
 *
 * Personal data. The register names employees; this helper reads one file the operator names, writes STDOUT only (initials and numbers,
 * never a name or an email), touches no database and no network, and has no `--show-emails`: it has nothing to show. The operator maps
 * initials to emails (two employees may share initials, AC-4.6: that needs a person) and writes the offsets file OUTSIDE the repository
 * (SR-3; `.gitignore` covers `*offsets*.csv`). The register export itself must stay outside the repository too: the script warns on
 * stderr when its path is inside a git worktree. Error messages never quote a cell.
 *
 * Exit codes: 0 done, 1 a usage or file failure (nothing is printed on stdout).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OperatorFileError, parseCsvRows, shapeOf, worktreeWarning, yearOfDate } from "./lib/operatorFiles";

// Moved to `lib/operatorFiles.ts` (T6, specs/20261124): re-exported so this script's own tests and callers read as before.
export { parseCsvRows, shapeOf, yearOfDate };

/** The only year whose numbers continue the register (20261118 AC-4.12). */
export const BASELINE_YEAR = 2026;

/** The helper's own failure: the same class as the shared helpers throw, so one catch covers both. */
export const RegisterError = OperatorFileError;
export type RegisterError = OperatorFileError;

// ─── Numbers and dates ───────────────────────────────────────────────────────

const NUMBER_PATTERN = /^([A-Z]{2})(\d{2})\/(\d{1,5})$/;
const MAX_SEQUENCE = 99999;

// ─── Derivation ──────────────────────────────────────────────────────────────

export interface WrongYearEntry {
  /** Canonical text, e.g. `LG25/014`. */
  number: string;
  /** The row's expense year, `null` when the export has no date column or the cell is empty or unreadable. */
  expenseYear: number | null;
  counted: boolean;
  reason: "no date column" | "expense date in 2026" | "expense date missing or unreadable" | "expense date outside 2026";
}

export interface BaselineResult {
  /** Data rows with a non-empty receipt number. */
  numbered: number;
  /** Data rows whose receipt number cell is empty (ignored). */
  withoutNumber: number;
  hasDateColumn: boolean;
  /** Per initials, sorted: the highest 2026 sequence. */
  maxima: { initials: string; lastSeq: number }[];
  duplicates: { number: string; count: number }[];
  wrongYear: WrongYearEntry[];
  /** 1-based data row (header excluded) and the shape of the cell, never its text. */
  malformed: { row: number; shape: string }[];
}

const normalizeHeader = (cell: string) => cell.trim().toLowerCase();

export function deriveBaseline(csvText: string): BaselineResult {
  const rows = parseCsvRows(csvText);
  if (rows.length === 0) throw new RegisterError("the CSV is empty: it needs a header line with a receiptNumber column");
  const header = rows[0]!.map(normalizeHeader);
  const numberColumn = header.indexOf("receiptnumber");
  if (numberColumn === -1) throw new RegisterError("the CSV has no receiptNumber column in its header line");
  const dateColumn = header.indexOf("expensedate");
  const hasDateColumn = dateColumn !== -1;

  const max = new Map<string, number>();
  const seen = new Map<string, number>();
  const wrongYear = new Map<string, WrongYearEntry>();
  const malformed: BaselineResult["malformed"] = [];
  let numbered = 0;
  let withoutNumber = 0;

  rows.slice(1).forEach((cells, index) => {
    const raw = (cells[numberColumn] ?? "").trim();
    if (raw === "") {
      withoutNumber++;
      return;
    }
    numbered++;
    const match = NUMBER_PATTERN.exec(raw.toUpperCase());
    const sequence = match ? Number(match[3]) : 0;
    if (!match || sequence < 1 || sequence > MAX_SEQUENCE) {
      malformed.push({ row: index + 1, shape: shapeOf(raw) });
      return;
    }
    const initials = match[1]!;
    const yearText = match[2]!;
    const number = `${initials}${yearText}/${String(sequence).padStart(3, "0")}`;
    seen.set(number, (seen.get(number) ?? 0) + 1);

    let counted = true;
    if (Number(yearText) !== BASELINE_YEAR % 100) {
      let expenseYear: number | null = null;
      let reason: WrongYearEntry["reason"] = "no date column";
      if (hasDateColumn) {
        expenseYear = yearOfDate(cells[dateColumn] ?? "");
        if (expenseYear === null) reason = "expense date missing or unreadable";
        else if (expenseYear === BASELINE_YEAR) reason = "expense date in 2026";
        else {
          reason = "expense date outside 2026";
          counted = false;
        }
      }
      const previous = wrongYear.get(number);
      if (previous) previous.counted ||= counted;
      else wrongYear.set(number, { number, expenseYear, counted, reason });
    }
    if (counted && sequence > (max.get(initials) ?? 0)) max.set(initials, sequence);
  });

  return {
    numbered,
    withoutNumber,
    hasDateColumn,
    maxima: [...max].map(([initials, lastSeq]) => ({ initials, lastSeq })).sort((a, b) => a.initials.localeCompare(b.initials)),
    duplicates: [...seen].filter(([, count]) => count > 1).map(([number, count]) => ({ number, count })).sort((a, b) => a.number.localeCompare(b.number)),
    wrongYear: [...wrongYear.values()].sort((a, b) => a.number.localeCompare(b.number)),
    malformed,
  };
}

// ─── Report (stdout) ─────────────────────────────────────────────────────────

export function formatBaseline(result: BaselineResult): string {
  const out: string[] = [];
  out.push(
    `Register read: ${result.numbered} numbered rows${result.withoutNumber > 0 ? ` (${result.withoutNumber} rows without a number ignored)` : ""}; ` +
      (result.hasDateColumn ? "expenseDate column present." : "no expenseDate column: wrong-year numbers are counted."),
  );
  out.push("");
  out.push(`Highest ${BASELINE_YEAR} sequence per initials (lastIssuedSeq for the offsets list):`);
  if (result.maxima.length === 0) out.push("  (none)");
  for (const { initials, lastSeq } of result.maxima) out.push(`  ${initials}  ${lastSeq}`);

  out.push("");
  out.push(`Duplicates (${result.duplicates.length}): listed for accounting, harmless to the maximum`);
  if (result.duplicates.length === 0) out.push("  (none)");
  for (const { number, count } of result.duplicates) out.push(`  ${number}  x${count}`);

  out.push("");
  out.push(`Wrong-year numbers (${result.wrongYear.length}): accounting to confirm`);
  if (result.wrongYear.length === 0) out.push("  (none)");
  for (const entry of result.wrongYear) {
    out.push(`  ${entry.number}  ${entry.counted ? "COUNTED" : "not counted"}  (${entry.reason}${entry.expenseYear !== null ? `: ${entry.expenseYear}` : ""})`);
  }

  out.push("");
  out.push(`Malformed numbers (${result.malformed.length}): not counted, check them by hand (shape only: A letter, 9 digit)`);
  if (result.malformed.length === 0) out.push("  (none)");
  for (const { row, shape } of result.malformed) out.push(`  data row ${row}  ${shape}`);
  return out.join("\n");
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const USAGE = "Usage: bun run receipt-baseline:from-register --register <csv>";

/** A warning when `path` lies inside a git worktree: the register names employees and must never be committed (SR-3). */
export function registerPathWarning(path: string): string | null {
  return worktreeWarning(path, "the register export", "It names employees");
}

export function run(argv: readonly string[]): string {
  const index = argv.indexOf("--register");
  const path = index === -1 ? undefined : argv[index + 1];
  if (path === undefined || path.startsWith("--")) throw new RegisterError(`--register needs a CSV path. ${USAGE}`);
  const unknown = argv.filter((a, i) => i !== index && i !== index + 1);
  if (unknown.length > 0) throw new RegisterError(`unknown argument ${shapeOf(unknown[0]!)}. ${USAGE}`);
  const warning = registerPathWarning(path);
  if (warning) console.warn(warning);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown";
    throw new RegisterError(`cannot read the register file (${code})`);
  }
  return formatBaseline(deriveBaseline(text));
}

if (import.meta.main) {
  try {
    console.log(run(process.argv.slice(2)));
  } catch (error) {
    // Never a cell, only our own message: a Prisma-free, DB-free script has no other error that could carry data.
    console.error(`receipt-baseline:from-register failed: ${error instanceof RegisterError ? error.message : "unexpected error"}`);
    process.exitCode = 1;
  }
}
