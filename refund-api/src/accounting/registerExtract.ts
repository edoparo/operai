/**
 * Pure, DB-free register extract workbook: the exportable lines of a batch as rows of the accountant's register (layout in
 * `registerExtractFormat.ts`). Deterministic like the journal: the same lines in any order give the same bytes; no clock,
 * no locale, no random value, and no formula in any cell.
 *
 * The CHF total and the VAT come from `amounts.ts` (`chfCents`, `vatCents`), the functions the review view and the journal
 * use, so the three can never disagree by a cent. A foreign-currency line without a rate is a programming error here (the
 * export is blocked before a file is asked for), exactly as in `export.ts`.
 */

import { chfCents, vatCents } from "./amounts";
import { employeeCell, type AccountingExportLine } from "./export";
import { CURRENCY, dateSerial, formatCents, isCanonicalAccountNumber, ROUND_TRIP, sanitizeText } from "./exportFormat";
import {
  approverCell,
  COLUMN_WIDTHS,
  compareRegisterRows,
  formatMicros,
  HEADERS,
  NUM_FMTS,
  periodCellOf,
  sheetNameOf,
  STYLE,
  STYLES,
} from "./registerExtractFormat";
import { expenseTypeLabelIt } from "../requests/labels";
import { writeXlsx, type XlsxCell } from "./xlsx";

/** An exportable line with what the register shows beyond the journal. */
export interface RegisterExtractLine extends AccountingExportLine {
  /** The expense type (`travel_km`, …): the register's Description, in Italian. */
  readonly type: string;
  /** A mileage trip's start and end (the register's From and To); absent or null when not recorded. */
  readonly fromAddress?: string | null;
  readonly toAddress?: string | null;
  /** Kilometres of a mileage line, else `null`. */
  readonly km: number | null;
  /** The CHF rate per km applied to a mileage line, times 1e6, else `null`. */
  readonly mileageRateMicros: number | null;
  /** The account's name as copied onto the line. */
  readonly accountName: string | null;
  /** The VAT code and its rate as copied onto the line; `null` when the line has none. */
  readonly vatCode: string | null;
  readonly vatRateBasisPoints: number | null;
  /** Who approved the request. */
  readonly approverName: string | null;
  readonly approverEmail: string | null;
}

export interface RegisterFile {
  readonly bytes: Uint8Array;
  /** Data rows, without the header. */
  readonly rowCount: number;
}

const text = (value: string | null): XlsxCell =>
  value === null || value === "" ? { kind: "empty", style: STYLE.text } : { kind: "text", value, style: STYLE.text };
const number = (value: string): XlsxCell => ({ kind: "number", value, style: STYLE.number });
const empty: XlsxCell = { kind: "empty", style: STYLE.default };

function rowOf(line: RegisterExtractLine, period: string): XlsxCell[] {
  const isChf = line.currency === CURRENCY;
  if (!isChf && line.rateMicros === null) {
    throw new RangeError(`line ${line.lineId} in ${line.currency} has no exchange rate: the export must be blocked before this`);
  }
  const chf = chfCents(line.approvedCents, line.currency, isChf ? null : line.rateMicros);
  if (chf === null) throw new RangeError(`line ${line.lineId} has no CHF amount: the export must be blocked before this`);

  // Columns I and J: km and the rate per km; the monthly rate and the foreign amount; or nothing.
  let first: XlsxCell = empty;
  let second: XlsxCell = empty;
  if (!isChf) {
    first = number(formatMicros(line.rateMicros!));
    second = { kind: "number", value: formatCents(line.approvedCents), style: STYLE.amount };
  } else if (line.type === "travel_km" && line.km !== null) {
    first = number(String(line.km));
    // A mileage line approved before the rate was kept on it has its km and no rate: J stays empty rather than guessed.
    if (line.mileageRateMicros !== null) second = number(formatMicros(line.mileageRateMicros));
  }

  const vat =
    line.vatCode !== null && line.vatRateBasisPoints !== null && line.vatRateBasisPoints > 0
      ? vatCents(chf, line.vatRateBasisPoints)
      : null;
  const account: XlsxCell = isCanonicalAccountNumber(line.accountNumber)
    ? number(line.accountNumber)
    : text(sanitizeText(line.accountNumber));

  return [
    text(sanitizeText(employeeCell(line))),
    number(periodCellOf(period)),
    text(sanitizeText(line.receiptNumber)),
    text(line.roundTrip === true ? `${expenseTypeLabelIt(line.type)} ${ROUND_TRIP}` : expenseTypeLabelIt(line.type)),
    text(line.fromAddress ? sanitizeText(line.fromAddress) : null), // From
    text(line.toAddress ? sanitizeText(line.toAddress) : null), // To
    text(sanitizeText(line.motivo)),
    { kind: "number", value: dateSerial(line.date), style: STYLE.date },
    first,
    second,
    { kind: "number", value: formatCents(chf), style: STYLE.chf },
    account,
    text(line.accountName === null ? null : sanitizeText(line.accountName)),
    text(line.vatCode === null ? null : sanitizeText(line.vatCode)),
    vat === null ? empty : { kind: "number", value: formatCents(vat), style: STYLE.amount },
    text(approverCell(line.approverName, line.approverEmail)),
  ];
}

/**
 * The register extract of the given lines for the competence month `period` (`YYYY-MM`): a header, then one row per line in
 * the register's order; the header alone for none.
 */
export function buildRegisterExtract(lines: readonly RegisterExtractLine[], period: string): RegisterFile {
  const sheetName = sheetNameOf(period); // refuses a period that is not YYYY-MM
  const header: XlsxCell[] = HEADERS.map((value) => ({ kind: "text", value, style: STYLE.header }));
  const rows = [...lines]
    .sort((a, b) => compareRegisterRows({ ...a, employee: employeeCell(a) }, { ...b, employee: employeeCell(b) }))
    .map((line) => rowOf(line, period));
  const bytes = writeXlsx({
    sheetName,
    numFmts: NUM_FMTS,
    styles: STYLES,
    columnWidths: COLUMN_WIDTHS,
    freezeFirstRow: true,
    rows: [header, ...rows],
  });
  return { bytes, rowCount: rows.length };
}
