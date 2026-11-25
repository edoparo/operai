/**
 * EVERY FORMAT CHOICE of the register extract, in one module: the batch's WellD CH lines laid out like the accountant's own
 * register (the yearly sheet, e.g. `2026`, of the "Recap RS" workbook), so the rows can be pasted under the ones already there.
 *
 * It is the second file of the accounting export card, beside the journal (`exportFormat.ts`). It is built from the same
 * evaluated lines, under the same blockers, rate copies and export log; only the layout differs. `registerExtract.ts` maps a
 * line to the sixteen cells and knows no label, format or order of its own.
 *
 * The register's columns, A to P, in its order and with its header text (two columns are both called "Description": the
 * expense and the account):
 *
 *   Worker | Period | No. | Description | From | To | Reason | Date | Km / Monthly avg rate | Multiplier / Foreign Amount |
 *   Total | Account | Description | IVA | IVA2 | Approved by
 *
 * - Period is the month (1 to 12) the batch is booked in, the same on every row: the competence month the accountant is
 *   handling, not the month of the expense (the expense date is in column H). By default the month before the batch's
 *   cutoff (Europe/Zurich): a batch cut on 14 November is October's. The caller may name another (`YYYY-MM`).
 * - Km / Monthly avg rate and Multiplier / Foreign Amount hold the km and the CHF rate per km for a mileage line; the monthly
 *   rate (CHF per unit) and the amount in its currency for a foreign-currency line; nothing for a CHF line.
 * - Total is CHF. IVA is the VAT code, IVA2 the VAT contained in the CHF total (the register's `K - K / (1 + rate)`).
 * - From and To exist in the register but Operai keeps no route: they are present and empty.
 * - No cell is a formula: where the register computes (Period, the account's description, IVA2, Approved by), the extract
 *   writes the value.
 *
 * A change of anything here is a bump of `REGISTER_FORMAT_VERSION`, which the export log records with the kind `register`.
 */

import { compareCodePoints, sanitizeText } from "./exportFormat";
import type { XlsxStyle } from "./xlsx";

/** Written to the export log (kind `register`) with every download of the extract; bump it with every change in this file. */
export const REGISTER_FORMAT_VERSION = 3; // 2: Period is the competence month; 3: `A/R` after a round trip's description

export const HEADERS = [
  "Worker",
  "Period",
  "No.",
  "Description",
  "From",
  "To",
  "Reason",
  "Date",
  "Km / Monthly avg rate",
  "Multiplier / Foreign Amount",
  "Total",
  "Account",
  "Description",
  "IVA",
  "IVA2",
  "Approved by",
] as const;

/** Column widths in characters, close to the register's (the date and the totals a little wider, to fit their format). */
export const COLUMN_WIDTHS: readonly number[] = [18.5, 6.2, 9.7, 26, 12, 12, 39, 11, 10, 11, 12, 9, 40, 8, 9, 12];

/** Day first, as the register shows its dates. */
const DATE_FORMAT = 164;
/** `CHF 1,234.50`, the register's Total. */
const CHF_FORMAT = 165;

export const NUM_FMTS: Readonly<Record<number, string>> = {
  [DATE_FORMAT]: "dd/mm/yyyy",
  [CHF_FORMAT]: '"CHF"\\ #,##0.00',
};

/** The register's header band: bold, grey (`C0C0C0`), a thin line above and below, wrapped. */
const HEADER_FILL = "C0C0C0";

/** `cellXfs`. Every text style carries `quotePrefix`, as the journal's (a spreadsheet keeps `=...` typed in a reason as text). */
export const STYLES: readonly XlsxStyle[] = [
  { numFmtId: 0 },
  { numFmtId: 49, bold: true, quotePrefix: true, fill: HEADER_FILL, borderTopBottom: true, wrap: true, horizontal: "left" },
  { numFmtId: 49, quotePrefix: true },
  { numFmtId: 0 },
  { numFmtId: DATE_FORMAT, horizontal: "left" },
  { numFmtId: CHF_FORMAT },
  { numFmtId: 2 },
];

/** Indexes into {@link STYLES}. */
export const STYLE = { default: 0, header: 1, text: 2, number: 3, date: 4, chf: 5, amount: 6 } as const;

/** A competence month: `YYYY-MM`. */
export const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The sheet is named after the competence month's year, as the register's yearly sheets are. */
export const sheetNameOf = (period: string): string => parsePeriod(period).year;

function parsePeriod(period: string): { year: string; month: string } {
  const match = PERIOD_RE.exec(period);
  if (!match) throw new RangeError(`a period is YYYY-MM, got ${period}`);
  return { year: match[1]!, month: String(Number(match[2])) };
}

/** The Period cell: `2026-10` -> `10`. */
export const periodCellOf = (period: string): string => parsePeriod(period).month;

/** The default competence month of a batch: the month before its cutoff, in Europe/Zurich (cut 2026-11-14 -> `2026-10`). */
export function defaultPeriodOf(cutoff: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit" }).formatToParts(cutoff);
  const year = Number(parts.find((part) => part.type === "year")!.value);
  const month = Number(parts.find((part) => part.type === "month")!.value);
  const [y, m] = month === 1 ? [year - 1, 12] : [year, month - 1];
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** `refund-register-<cutoff YYYY-MM-DD>-<batchId>.xlsx`: no personal data in it. */
export function registerFilename(cutoff: Date, batchId: string): string {
  const safeId = batchId.replace(/[^A-Za-z0-9_-]/g, "_");
  return `refund-register-${cutoff.toISOString().slice(0, 10)}-${safeId}.xlsx`;
}

/** `924600` -> `0.9246`, `700000` -> `0.7`, `1000000` -> `1`: an exact decimal from integer micros, no float. */
export function formatMicros(micros: number): string {
  if (!Number.isSafeInteger(micros) || micros < 0) throw new RangeError(`micros must be a non-negative safe integer, got ${String(micros)}`);
  const whole = Math.floor(micros / 1_000_000);
  const fraction = String(micros % 1_000_000).padStart(6, "0").replace(/0+$/, "");
  return fraction === "" ? String(whole) : `${whole}.${fraction}`;
}

/**
 * Who approved, as the register writes it: the first name and the initial of the last (`Matteo Codogno` -> `Matteo C.`).
 * A one-word name stays as it is; with no name, the email; with neither (cannot happen for an approved request), empty.
 */
export function approverCell(name: string | null, email: string | null): string {
  const words = sanitizeText(name ?? "").split(" ").filter((word) => word !== "");
  if (words.length === 0) return sanitizeText(email ?? "");
  if (words.length === 1) return words[0]!;
  const last = [...words[words.length - 1]!][0]!;
  return `${words[0]} ${last.toUpperCase()}.`;
}

export interface RegisterOrderKey {
  readonly date: string;
  readonly employee: string;
  readonly ownerUserId: string;
  readonly receiptYear: number;
  readonly receiptSeq: number;
  readonly lineId: string;
}

/**
 * The register's order: the worker (code point order), then the receipt number (year, sequence), then the date and the
 * line id, so the parts of a split receipt sit together and the same lines always give the same rows.
 */
export function compareRegisterRows(a: RegisterOrderKey, b: RegisterOrderKey): number {
  return (
    compareCodePoints(a.employee, b.employee) ||
    compareCodePoints(a.ownerUserId, b.ownerUserId) ||
    a.receiptYear - b.receiptYear ||
    a.receiptSeq - b.receiptSeq ||
    compareCodePoints(a.date, b.date) ||
    compareCodePoints(a.lineId, b.lineId)
  );
}
