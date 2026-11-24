/**
 * The report of the propose and check modes (T11, specs/20261124-receipt-numbers-from-the-register; AC-1.9, AC-2.2, AC-3.1, AC-3.4,
 * AC-4.11, AC-5.6; plan R5).
 *
 * PRIVACY BY CONSTRUCTION. The formatter takes {@link ReportInput}, which holds only what AC-5.6 allows in an output: counts, line
 * ids, row positions, paper numbers, a malformed cell's SHAPE, employee references (`<prefix> · <first 8 of the user id>`) and the own
 * date, amount and currency of a DOUBTFUL line. It has no field for a worker, a name, an email, a description or the amount of a row
 * that is not part of a doubtful pairing, so none of them can reach the text. {@link buildReportInput} is the one place that sees
 * more (the lines' facts) and it copies out only the doubtful lines' own.
 */

import type { RowInventory } from "./pairing";
import { formatCents } from "./pairing";
import type { PairingCategory, PairingProposal, PreReleaseLine } from "./types";

/** `LCX · 1a2b3c4d`: a prefix and the first eight characters of the user id; no name, no email. */
export function employeeRef(prefix: string, userId: string): string {
  return `${prefix} · ${userId.slice(0, 8)}`;
}

export const CATEGORY_LABELS: Readonly<Record<PairingCategory, string>> = {
  exact: "exact matches",
  split_receipt: "split receipts",
  no_counterpart: "no paper counterpart",
  outside_2026: "outside 2026 (a new number)",
  row_without_number: "matches a row without a number",
  several_candidates: "several candidates",
  amount_differs: "amount differs",
  total_unreadable: "total unreadable",
  wrong_year: "wrong year",
  sequence_000: "sequence 000",
  prefix_differs: "prefix differs",
  number_taken: "number already taken",
};

const ORDER: readonly PairingCategory[] = [
  "exact",
  "split_receipt",
  "no_counterpart",
  "outside_2026",
  "row_without_number",
  "several_candidates",
  "amount_differs",
  "total_unreadable",
  "wrong_year",
  "sequence_000",
  "prefix_differs",
  "number_taken",
];
const DOUBTFUL: ReadonlySet<PairingCategory> = new Set(["row_without_number", "several_candidates", "amount_differs", "total_unreadable", "wrong_year", "sequence_000", "prefix_differs", "number_taken"]);

export interface DoubtfulLineFacts {
  readonly lineId: string;
  /** `YYYY-MM-DD`, the doubtful line's own expense date. */
  readonly date: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly category: PairingCategory;
  /** The reason sentence of the proposal: ids, positions, paper numbers and this pairing's own amounts. */
  readonly reason: string;
}

export interface EmployeeReportRow {
  /** `<prefix> · <id8>` or, for an employee not yet in Refund, `not yet in Refund`. */
  readonly ref: string;
  readonly offsets: number;
  readonly registerMax: number;
  readonly importedMax: number;
  readonly baseline: number;
  /** The first new number the run would issue, or `null` when no line of the employee takes a new number. */
  readonly firstNew: string | null;
  readonly lines: number;
  /** The employee has pre-release lines and no mapped worker (AC-3.4): a wrong mapping is easy to miss. */
  readonly noMappedWorker: boolean;
  /** In a shared pair with no receipt code (AC-4.11). */
  readonly needsCode: boolean;
  readonly excluded: boolean;
}

export interface ReportInput {
  readonly mode: "propose" | "check";
  /** The latest readable date of the register export (plan R5), or `null`. */
  readonly registerLastDate: string | null;
  readonly registerRows: number;
  readonly sheet: string;
  readonly lineCount: number;
  readonly linesByCategory: Readonly<Record<PairingCategory, number>>;
  /** Distinct register rows concerned, per category. */
  readonly rowsByCategory: Readonly<Record<PairingCategory, number>>;
  readonly splitGroups: number;
  /** Lines whose state is not yet decided by the machine (the real run would refuse with 8 until a person has). */
  readonly openDecisions: number;
  readonly rows: {
    readonly noLine: number;
    readonly withoutNumber: number;
    readonly withoutDateOrTotal: readonly number[];
    readonly malformed: readonly { readonly position: number; readonly shape: string }[];
    readonly noWorker: readonly number[];
    readonly unmappedWorkers: number;
    /** Formula cells with no stored result: the hint to save the workbook in Excel. */
    readonly formulasWithoutValue: number;
  };
  readonly employees: readonly EmployeeReportRow[];
  readonly doubtful: readonly DoubtfulLineFacts[];
}

const zeroed = (): Record<PairingCategory, number> => Object.fromEntries(ORDER.map((c) => [c, 0])) as Record<PairingCategory, number>;

/** The one place that reads the lines' facts: it copies out the own facts of the doubtful lines only. */
export function buildReportInput(args: {
  readonly mode: ReportInput["mode"];
  readonly sheet: string;
  readonly registerRows: number;
  readonly registerLastDate: string | null;
  readonly lines: readonly PreReleaseLine[];
  readonly proposals: readonly PairingProposal[];
  readonly inventory: RowInventory;
  readonly formulasWithoutValue: number;
  readonly employees: readonly EmployeeReportRow[];
}): ReportInput {
  const lineById = new Map(args.lines.map((l) => [l.id, l] as const));
  const linesByCategory = zeroed();
  const rowsSeen = new Map<PairingCategory, Set<number>>();
  const groups = new Set<string>();
  const doubtful: DoubtfulLineFacts[] = [];
  let openDecisions = 0;
  for (const p of args.proposals) {
    linesByCategory[p.category]++;
    const rows = rowsSeen.get(p.category) ?? new Set<number>();
    for (const r of p.registerRows) rows.add(r);
    rowsSeen.set(p.category, rows);
    if (p.group !== null) groups.add(p.group);
    if (p.state === "unresolved") openDecisions++;
    if (DOUBTFUL.has(p.category)) {
      const line = lineById.get(p.lineId);
      if (line === undefined) continue;
      doubtful.push({ lineId: p.lineId, date: line.date, amountCents: line.approvedTotalCents, currency: line.currency, category: p.category, reason: p.reason ?? "" });
    }
  }
  const rowsByCategory = zeroed();
  for (const [category, set] of rowsSeen) rowsByCategory[category] = set.size;
  return {
    mode: args.mode,
    registerLastDate: args.registerLastDate,
    registerRows: args.registerRows,
    sheet: args.sheet,
    lineCount: args.proposals.length,
    linesByCategory,
    rowsByCategory,
    splitGroups: groups.size,
    openDecisions,
    rows: {
      noLine: args.inventory.rowsWithNoLine,
      withoutNumber: args.inventory.rowsWithoutNumber,
      withoutDateOrTotal: args.inventory.rowsWithoutDateOrTotal,
      malformed: args.inventory.malformed,
      noWorker: args.inventory.noWorker,
      unmappedWorkers: args.inventory.unmappedWorkers.length,
      formulasWithoutValue: args.formulasWithoutValue,
    },
    employees: args.employees,
    doubtful: doubtful.sort((a, b) => (a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0)),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const positions = (list: readonly number[]) => list.map((n) => `R${n}`).join(" ");

/** The report as lines of text. Everything in it comes from {@link ReportInput}. */
export function formatPairingReport(report: ReportInput): string[] {
  const out: string[] = [];
  out.push(
    `Register export: ${plural(report.registerRows, "row")} read from sheet ${report.sheet}, last expense date ${report.registerLastDate ?? "unknown"}`,
    "  (from the release on, accounting stops numbering by hand the expenses Refund numbers: a number written after this date could repeat one)",
  );
  if (report.rows.formulasWithoutValue > 0) {
    out.push(`  WARNING: ${plural(report.rows.formulasWithoutValue, "formula cell")} hold no computed value (read as unreadable): save the workbook in Excel so it stores computed values, then run again.`);
  }
  out.push("", `Pre-release lines: ${report.lineCount}`);
  for (const category of ORDER) {
    const lines = report.linesByCategory[category];
    if (lines === 0) continue;
    const extra = category === "split_receipt" ? `, ${plural(report.splitGroups, "group")}` : "";
    const rows = report.rowsByCategory[category];
    out.push(`  ${CATEGORY_LABELS[category]}: ${plural(lines, "line")}${rows > 0 ? `, ${plural(rows, "row")}` : ""}${extra}`);
  }
  const open = report.openDecisions;
  out.push(
    report.mode === "propose"
      ? `  ${plural(open, "decision")} still open: the real run would refuse (exit 8) until a person has decided them in the pairing file`
      : `  ${plural(open, "decision")} still open in the file`,
  );

  out.push(
    "",
    "Register rows",
    `  with no pre-release line (feed an employee's maximum only): ${report.rows.noLine}`,
    `  without a number (never taken, count toward no maximum): ${report.rows.withoutNumber}`,
    `  with a number but no readable date or total (listed, their number counts): ${report.rows.withoutDateOrTotal.length}${report.rows.withoutDateOrTotal.length > 0 ? ` (${positions(report.rows.withoutDateOrTotal)})` : ""}`,
    `  with a malformed number (to be acknowledged, count toward nothing): ${report.rows.malformed.length}${report.rows.malformed.length > 0 ? ` (${report.rows.malformed.map((m) => `R${m.position} ${m.shape}`).join(", ")})` : ""}`,
    `  with a number and no worker (to be acknowledged): ${report.rows.noWorker.length}${report.rows.noWorker.length > 0 ? ` (${positions(report.rows.noWorker)})` : ""}`,
    `  workers not mapped to an employee: ${report.rows.unmappedWorkers}`,
  );

  const needCode = report.employees.filter((e) => e.needsCode);
  out.push("", `Employees that need a receipt code (a prefix shared with another employee, AC-4.11): ${needCode.length}`);
  for (const e of needCode) out.push(`  ${e.ref}`);

  out.push("", `Per employee (${report.employees.length})`);
  for (const e of report.employees) {
    const flags = [
      e.excluded ? "excluded from the register" : null,
      e.offsets > 0 && e.offsets !== e.registerMax ? `offsets ${e.offsets} differ from the register maximum ${e.registerMax}` : null,
      e.noMappedWorker && e.lines > 0 ? "has pre-release lines and no mapped worker: check the mapping" : null,
    ].filter((f): f is string => f !== null);
    out.push(
      `  ${e.ref}: ${plural(e.lines, "line")}; offsets ${e.offsets}, register maximum ${e.registerMax}, imported maximum ${e.importedMax}, baseline ${e.baseline}; ` +
        `first new number ${e.firstNew ?? "none"}${flags.length > 0 ? `; ${flags.join("; ")}` : ""}`,
    );
  }

  out.push("", `Doubtful lines (${report.doubtful.length})`);
  for (const d of report.doubtful) {
    out.push(`  ${d.lineId}  ${d.date}  ${formatCents(d.amountCents)} ${d.currency}  ${d.reason !== "" ? d.reason : CATEGORY_LABELS[d.category]}`);
  }
  return out;
}
