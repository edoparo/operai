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


// ─── Deciding a pairing file in code ─────────────────────────────────────────

/** One record of a pairing file as the test sees it: the header names as keys, every value text. */
export type PairingRecord = Record<string, string>;

/**
 * Rewrites a pairing file record by record, the way a person edits it in a spreadsheet: `edit` receives each record (by reference, change
 * it in place) and the file comes back as text with the same header. Used to decide the doubtful lines, map workers, exclude an
 * employee, break the file on purpose.
 */
export function editPairing(csv: string, edit: (record: PairingRecord) => void): string {
  const rows = parseCsvRows(csv);
  const header = rows[0]!.map((c) => c.trim());
  const out = rows.map((row, index) => {
    if (index === 0) return row;
    const record: PairingRecord = {};
    header.forEach((name, i) => (record[name] = row[i] ?? ""));
    edit(record);
    return header.map((name) => record[name] ?? "");
  });
  return `\uFEFF${out.map((row) => row.map(quote).join(",")).join("\r\n")}\r\n`;
}

/** The records of a pairing file, for a test to read (a decision, a reason, a state). */
export function pairingRecords(csv: string): PairingRecord[] {
  const rows = parseCsvRows(csv);
  const header = rows[0]!.map((c) => c.trim());
  return rows.slice(1).map((row) => Object.fromEntries(header.map((name, i) => [name, row[i] ?? ""])));
}

/** Confirms every worker, line and row record WHATEVER its state (a test that decided them in code), acknowledging rows. */
export function confirmAll(csv: string): string {
  return editPairing(csv, (r) => {
    if (r["record"] === "worker" || r["record"] === "line" || r["record"] === "row") r["state"] = "confirmed";
    if (r["record"] === "row") r["decision"] = "acknowledged";
  });
}

export interface LineDecision {
  readonly decision: "paper" | "new" | "split";
  readonly paperNumber?: string;
  readonly split?: string;
}

/** Decides lines by id (the others are left as the proposal had them) and confirms everything. */
export function decideLines(csv: string, decisions: Readonly<Record<string, LineDecision>>): string {
  const decided = editPairing(csv, (r) => {
    if (r["record"] !== "line") return;
    const d = decisions[r["id"]!];
    if (d === undefined) return;
    r["decision"] = d.decision;
    r["paperNumber"] = d.decision === "new" ? "" : (d.paperNumber ?? "");
    r["split"] = d.decision === "split" ? (d.split ?? "") : "";
  });
  return confirmAll(decided);
}
