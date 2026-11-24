/**
 * Test-only: the release as a person runs it, in three steps, in process (T12, specs/20261124-receipt-numbers-from-the-register;
 * plan § Test strategy). The real run now needs the accountant's workbook and a CONFIRMED pairing file (AC-2.8); a test that is not
 * about the pairing (the backfill, the defaults, the owners' names, the audit trail ...) still needs both. `proposeAndConfirm` does
 * what the operator does with a file that has nothing to decide: it runs the propose mode, rewrites every `proposed` record to
 * `confirmed`, and FAILS naming any record that is still `unresolved`, so a test that needs a decision says so instead of passing on
 * a silent default.
 *
 * It takes the run function as a parameter (the test imports `scripts/accounting-release` after it has set its environment) and
 * imports nothing that touches the database.
 */

import { headerOnlyRegisterWorkbook } from "./registerWorkbook";
import { parseCsvRows } from "../../scripts/lib/operatorFiles";

/** What `proposeAndConfirm` needs of `runAccountingRelease`: the options it passes and the one field it reads back. */
export type RunRelease<Options extends object> = (options: Options & { dryRun: true; propose: true; register: Uint8Array }) => Promise<{ readonly pairingCsv: string | null; readonly alreadyCompleted: unknown }>;

const quote = (cell: string) => (/[",\r\n]|^\s|\s$/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);

/**
 * The text of a pairing file with every `proposed` worker, line and row record set to `confirmed` (and a row acknowledged). Throws
 * naming the ids of the records that are `unresolved`: they need a person's decision.
 */
export function confirmProposed(csv: string): string {
  const rows = parseCsvRows(csv);
  const header = rows[0]!.map((c) => c.trim());
  const at = (name: string) => header.indexOf(name);
  const [kind, id, state, decision] = [at("record"), at("id"), at("state"), at("decision")] as const;
  const open: string[] = [];
  const rewritten = rows.map((row, index) => {
    if (index === 0) return row;
    const cells = [...row];
    const type = cells[kind];
    if (type !== "worker" && type !== "line" && type !== "row") return cells;
    if (cells[state] === "unresolved") {
      open.push(`${type} ${cells[id]}`);
      return cells;
    }
    if (cells[state] === "proposed") cells[state] = "confirmed";
    if (type === "row") cells[decision] = "acknowledged";
    return cells;
  });
  if (open.length > 0) throw new Error(`the proposed pairing has records to decide: ${open.join(", ")}`);
  return `﻿${rewritten.map((row) => row.map(quote).join(",")).join("\r\n")}\r\n`;
}

/**
 * Runs the propose mode on `workbook` (default: the header-only fixture, which has no worker and no number, so every line is "no
 * paper counterpart") and returns the workbook and the confirmed file for the check and the real run.
 */
export async function proposeAndConfirm<Options extends object>(args: {
  readonly run: RunRelease<Options>;
  readonly options?: Options;
  readonly workbook?: Uint8Array;
}): Promise<{ readonly register: Uint8Array; readonly pairing: string; readonly alreadyCompleted: boolean }> {
  const register = args.workbook ?? headerOnlyRegisterWorkbook();
  const report = await args.run({ ...(args.options ?? ({} as Options)), dryRun: true, propose: true, register });
  // After completion the propose mode reads nothing and proposes nothing: the real run does not need the file either (AC-5.3).
  if (report.alreadyCompleted !== null) return { register, pairing: "", alreadyCompleted: true };
  if (report.pairingCsv === null) throw new Error("the propose mode wrote no pairing file");
  return { register, pairing: confirmProposed(report.pairingCsv), alreadyCompleted: false };
}

