/**
 * The pairing file (T10, specs/20261124-receipt-numbers-from-the-register; plan § Pairing file D3; AC-1.1, AC-1.3, AC-1.5, AC-1.6,
 * AC-1.7, AC-1.13 to AC-1.16, AC-2.3, AC-2.4, AC-2.6, AC-2.7): the CSV the propose mode writes and a person decides, and the pure
 * validator the check and the real run apply to it.
 *
 * PURE: text in, text or problems out. No file, no database, no clock. The CSV is RFC 4180 with one header for every kind of record
 * (`meta`, `employee`, `worker`, `line`, `row`), written as UTF-8 with a BOM so Excel shows the names, and read tolerantly: the
 * delimiter is detected (`,` `;` tab), headers and enum values are case-insensitive, the columns may come in any order, and the
 * informational columns (dates, amounts, labels) are never validated, because an Excel round trip may change them. Fingerprints
 * carry a `sha256:` prefix so Excel can never read them as numbers.
 *
 * Personal data. The file names workers, employees and amounts: it is the operator's, kept outside the repository, never printed.
 * The validator's problems name ids (a line id, `W<n>`, `E<n>`, `R<n>`, `S<k>`) and never a cell's text.
 */

import { createHash } from "node:crypto";
import { parseReceiptNumber } from "../../src/accounting/receiptNumber";
import { parseCsvRows } from "../lib/operatorFiles";
import {
  listWorkers,
  normaliseWorker,
  outsideEmployeeKey,
  formatCents,
  resolveWorkerDecision,
  REGISTER_YEAR,
  rowsByEmployee,
  type OffsetEntry,
} from "./pairing";
import type { DecisionKind, PairingFileRecord, PairingProposal, PreReleaseLine, RecordState, RegisterRow, ReleaseEmployee } from "./types";

export const PAIRING_FORMAT = "operai-pairing/1";

const COLUMNS = [
  "record",
  "id",
  "label",
  "employee",
  "expenseDate",
  "amount",
  "currency",
  "category",
  "reason",
  "proposed",
  "proposedNumber",
  "decision",
  "paperNumber",
  "split",
  "state",
  "registerRows",
] as const satisfies readonly (keyof PairingFileRecord)[];

/** A pairing file that cannot be read at all (the real run exits 6): a reason, never a cell. */
export class PairingFileError extends Error {
  constructor(
    readonly code: "csv-malformed" | "header-missing" | "meta-missing" | "format-unknown",
    message: string,
  ) {
    super(message);
    this.name = "PairingFileError";
  }
}

// ─── The digest of the lines ─────────────────────────────────────────────────

/** `sha256:<hex>` of the sorted `lineId|date|approvedTotalCents|currency` list: what the file says about the lines it was built for. */
export function linesDigest(lines: readonly PreReleaseLine[]): string {
  const text = lines
    .map((l) => `${l.id}|${l.date}|${l.approvedTotalCents}|${l.currency}`)
    .sort()
    .join("\n");
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

// ─── Writing ─────────────────────────────────────────────────────────────────

export interface PairingFileData {
  readonly meta: { readonly register: string; readonly sheet: string; readonly lines: string; readonly builtAt: string };
  /** One per employee known to Refund. `label` is `<prefix> · <user id 8>`; `email` is the newest request's. */
  readonly employees: readonly { readonly key: string; readonly label: string; readonly email: string }[];
  /** `text` is the worker as written in the register; `employeeKey` the proposed employee, or `null`. */
  readonly workers: readonly { readonly id: string; readonly text: string; readonly employeeKey: string | null }[];
  readonly lines: readonly {
    readonly proposal: PairingProposal;
    readonly label: string;
    readonly date: string;
    readonly amountCents: number;
    readonly currency: string;
  }[];
  /** Malformed numbers and numbers with no worker, by position, with the cell's SHAPE. */
  readonly rows: readonly { readonly position: number; readonly category: "malformed" | "no_worker"; readonly shape: string }[];
}

/** A spreadsheet reads a cell that starts with one of these as a formula: a single quote in front makes it text. */
const neutralise = (value: string): string => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

function quote(value: string): string {
  return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function record(fields: Partial<PairingFileRecord> & Pick<PairingFileRecord, "record" | "id">): string {
  const full: PairingFileRecord = {
    label: "",
    employee: "",
    expenseDate: "",
    amount: "",
    currency: "",
    category: "",
    reason: "",
    proposed: "",
    proposedNumber: "",
    decision: "",
    paperNumber: "",
    split: "",
    state: "",
    registerRows: "",
    ...fields,
  };
  return COLUMNS.map((column) => quote(full[column])).join(",");
}

/** The proposal as a file: exact matches pre-filled `proposed`, doubtful lines `unresolved`, workers and rows to be decided. */
export function writePairingCsv(data: PairingFileData): string {
  const out: string[] = [COLUMNS.join(",")];
  const meta = (id: string, label: string) => out.push(record({ record: "meta", id, label }));
  meta("format", PAIRING_FORMAT);
  meta("register", data.meta.register);
  meta("sheet", data.meta.sheet);
  meta("lines", data.meta.lines);
  meta("builtAt", data.meta.builtAt);
  for (const e of data.employees) out.push(record({ record: "employee", id: e.key, label: neutralise(e.label), employee: neutralise(e.email) }));
  for (const w of data.workers) {
    out.push(
      record({
        record: "worker",
        id: w.id,
        label: neutralise(w.text),
        employee: w.employeeKey ?? "",
        decision: w.employeeKey ?? "",
        state: w.employeeKey === null ? "unresolved" : "proposed",
      }),
    );
  }
  for (const l of data.lines) {
    const p = l.proposal;
    const prefilled = p.state === "proposed";
    out.push(
      record({
        record: "line",
        id: p.lineId,
        label: neutralise(l.label),
        employee: p.employeeKey,
        expenseDate: l.date,
        amount: formatCents(l.amountCents),
        currency: neutralise(l.currency),
        category: p.category,
        reason: neutralise(p.reason ?? ""),
        proposed: p.proposed ?? "",
        proposedNumber: p.proposedNumber ?? "",
        decision: prefilled ? (p.proposed ?? "") : "",
        paperNumber: prefilled && (p.proposed === "paper" || p.proposed === "split") ? (p.proposedNumber ?? "") : "",
        split: prefilled && p.proposed === "split" ? (p.group ?? "") : "",
        state: p.state,
        registerRows: p.registerRows.map((n) => `R${n}`).join(" "),
      }),
    );
  }
  for (const r of data.rows) {
    out.push(record({ record: "row", id: `R${r.position}`, label: neutralise(r.shape), category: r.category, state: "unresolved" }));
  }
  return `﻿${out.join("\r\n")}\r\n`;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export interface ParsedLineRecord {
  readonly id: string;
  readonly decision: DecisionKind | "" | "invalid";
  readonly paperNumber: string;
  readonly split: string;
  readonly state: RecordState | "invalid";
  readonly proposed: string;
}
export interface ParsedWorkerRecord {
  readonly id: string;
  readonly decision: string;
  readonly state: RecordState | "invalid";
}
export interface ParsedRowRecord {
  readonly id: string;
  readonly decision: string;
  readonly state: RecordState | "invalid";
}
export interface ParsedEmployeeRecord {
  readonly id: string;
  readonly decision: string;
}

export interface PairingFile {
  readonly meta: { readonly format: string; readonly register: string; readonly sheet: string; readonly lines: string; readonly builtAt: string };
  readonly employees: readonly ParsedEmployeeRecord[];
  readonly workers: readonly ParsedWorkerRecord[];
  readonly lines: readonly ParsedLineRecord[];
  readonly rows: readonly ParsedRowRecord[];
}

const STATES = new Set<string>(["proposed", "unresolved", "confirmed"]);
const DECISIONS = new Set<string>(["paper", "new", "split"]);

/**
 * Reads a pairing file. Throws {@link PairingFileError} for a file that is not one (unbalanced quotes, no header, no meta, an unknown
 * format). Everything else is read as written and judged by {@link validatePairing}: a problem with a record is a problem of the
 * decision, not of the file.
 */
export function readPairingCsv(text: string): PairingFile {
  let rows: string[][];
  try {
    rows = parseCsvRows(text);
  } catch {
    throw new PairingFileError("csv-malformed", "the pairing file is not a readable CSV (unbalanced quotes: was it cut off?)");
  }
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const need = ["record", "id", "label", "decision", "state"];
  const at = new Map(COLUMNS.map((c) => [c, header.indexOf(c.toLowerCase())] as const));
  if (need.some((c) => at.get(c as (typeof COLUMNS)[number])! < 0)) {
    throw new PairingFileError("header-missing", "the pairing file has no header line with the columns record, id, label, decision and state");
  }
  const cell = (row: readonly string[], column: (typeof COLUMNS)[number]): string => {
    const index = at.get(column)!;
    return index < 0 ? "" : (row[index] ?? "").trim();
  };
  const state = (row: readonly string[]): RecordState | "invalid" => {
    const value = cell(row, "state").toLowerCase();
    return STATES.has(value) ? (value as RecordState) : "invalid";
  };

  const meta = new Map<string, string>();
  const employees: ParsedEmployeeRecord[] = [];
  const workers: ParsedWorkerRecord[] = [];
  const lines: ParsedLineRecord[] = [];
  const rowRecords: ParsedRowRecord[] = [];
  for (const row of rows.slice(1)) {
    const kind = cell(row, "record").toLowerCase();
    const id = cell(row, "id");
    if (kind === "meta") meta.set(id.toLowerCase(), cell(row, "label"));
    else if (kind === "employee") employees.push({ id, decision: cell(row, "decision").toLowerCase() });
    else if (kind === "worker") workers.push({ id, decision: cell(row, "decision"), state: state(row) });
    else if (kind === "row") rowRecords.push({ id, decision: cell(row, "decision").toLowerCase(), state: state(row) });
    else if (kind === "line") {
      const decision = cell(row, "decision").toLowerCase();
      lines.push({
        id,
        decision: decision === "" ? "" : DECISIONS.has(decision) ? (decision as DecisionKind) : "invalid",
        paperNumber: cell(row, "paperNumber").toUpperCase(),
        split: cell(row, "split").toUpperCase(),
        state: state(row),
        proposed: cell(row, "proposed").toLowerCase(),
      });
    }
  }
  const format = meta.get("format");
  if (format === undefined || meta.get("register") === undefined || meta.get("lines") === undefined) {
    throw new PairingFileError("meta-missing", "the pairing file lacks its meta records (format, register, lines)");
  }
  if (format !== PAIRING_FORMAT) throw new PairingFileError("format-unknown", "the pairing file is of a format this version does not read");
  return {
    meta: { format, register: meta.get("register")!, sheet: meta.get("sheet") ?? "", lines: meta.get("lines")!, builtAt: meta.get("builtat") ?? "" },
    employees,
    workers,
    lines,
    rows: rowRecords,
  };
}

// ─── The worker mapping and the decisions, as the file gives them ────────────

/** The employees the file excludes from the register (AC-1.15), by key. */
export function excludedEmployees(file: PairingFile): Set<string> {
  return new Set(file.employees.filter((e) => e.decision === "excluded").map((e) => e.id));
}

/**
 * Normalised worker key -> employee key or `"not-operai"`, from the file's worker records (by `W<n>`, in the register's own order of
 * first appearance). A worker with no valid decision is absent (unmapped). An email no employee holds becomes an outside employee.
 */
export function workerOwnersFromFile(file: PairingFile, rows: readonly RegisterRow[], employees: readonly ReleaseEmployee[]): Map<string, string> {
  const byId = new Map(listWorkers(rows).map((w) => [w.id, w.key] as const));
  const out = new Map<string, string>();
  for (const record of file.workers) {
    const key = byId.get(record.id);
    if (key === undefined) continue;
    const resolved = resolveWorkerDecision(record.decision, employees);
    if (resolved === null) continue;
    out.set(key, resolved.kind === "employee" ? resolved.key : resolved.kind === "email" ? outsideEmployeeKey(resolved.email) : "not-operai");
  }
  return out;
}

/** The emails the worker decisions name that no Refund employee holds: the employees not yet in Refund. */
export function outsideEmails(file: PairingFile, employees: readonly ReleaseEmployee[]): string[] {
  const emails = new Set<string>();
  for (const record of file.workers) {
    const resolved = resolveWorkerDecision(record.decision, employees);
    if (resolved?.kind === "email") emails.add(resolved.email);
  }
  return [...emails].sort();
}

// ─── Validation ──────────────────────────────────────────────────────────────

export type ProblemCode =
  | "line-missing"
  | "line-extra"
  | "line-duplicate"
  | "not-confirmed"
  | "no-decision"
  | "paper-number-invalid"
  | "paper-number-not-in-register"
  | "paper-outside-2026"
  | "paper-for-excluded"
  | "number-on-two-lines"
  | "split-without-group"
  | "split-two-dates"
  | "split-two-numbers"
  | "split-two-employees"
  | "new-in-group"
  | "worker-unmapped"
  | "worker-unknown"
  | "worker-excluded"
  | "row-unacknowledged"
  | "row-missing"
  | "employee-record-invalid"
  | "offsets-for-excluded";

export interface Problem {
  readonly code: ProblemCode;
  /** A line id, `W<n>`, `E<n>`, `R<n>`, `S<k>` or `offsets`: never a cell's text. */
  readonly id: string;
  readonly message: string;
}

export interface ValidationInput {
  readonly file: PairingFile;
  /** The pre-release lines as the database holds them now. */
  readonly lines: readonly PreReleaseLine[];
  /** The employees known to Refund (`E<n>`), plus nothing else: a worker named by an unknown email is outside by construction. */
  readonly employees: readonly ReleaseEmployee[];
  readonly rows: readonly RegisterRow[];
  readonly offsets: readonly OffsetEntry[];
}

const byId = (a: Problem, b: Problem) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0);

/**
 * Every problem of the file, together, each named by id (AC-2.6): a line missing, extra or listed twice, a record not `confirmed`, a
 * paper number that is not on a row of the line's employee or is on two lines outside a split, a split of two dates, numbers or
 * employees, `new` in a group, a paper number on a line outside 2026 or of an excluded employee, a worker unmapped or mapped to an
 * excluded employee, a malformed row not acknowledged, an offsets row of an excluded employee.
 */
export function validatePairing(input: ValidationInput): Problem[] {
  const problems: Problem[] = [];
  const add = (code: ProblemCode, id: string, message: string) => problems.push({ code, id, message });
  const { file } = input;
  const employeeByKey = new Map(input.employees.map((e) => [e.key, e]));
  const employeeOfUser = new Map(input.employees.filter((e) => e.userId !== null).map((e) => [e.userId!, e]));

  // employees
  const excluded = new Set<string>();
  for (const e of file.employees) {
    if (!employeeByKey.has(e.id)) add("employee-record-invalid", e.id, `employee record ${e.id} is not an employee of this release`);
    else if (e.decision === "excluded") excluded.add(e.id);
    else if (e.decision !== "") add("employee-record-invalid", e.id, `employee ${e.id}: the decision is blank or "excluded"`);
  }

  // workers
  const workerKeys = new Map(listWorkers(input.rows).map((w) => [w.id, w.key] as const));
  const seenWorkers = new Set<string>();
  for (const w of file.workers) {
    if (!workerKeys.has(w.id)) add("worker-unknown", w.id, `worker ${w.id} is not a worker of this register`);
    seenWorkers.add(w.id);
    if (w.state !== "confirmed") add("not-confirmed", w.id, `worker ${w.id} is not confirmed`);
    const resolved = resolveWorkerDecision(w.decision, input.employees);
    if (resolved === null) add("worker-unmapped", w.id, `worker ${w.id} is not mapped to an employee, an email or not-operai`);
    else if (resolved.kind === "employee" && excluded.has(resolved.key)) add("worker-excluded", w.id, `worker ${w.id} is mapped to an employee excluded from the register`);
  }
  for (const id of workerKeys.keys()) if (!seenWorkers.has(id)) add("worker-unmapped", id, `worker ${id} has no record in the file`);
  const owners = workerOwnersFromFile(file, input.rows, input.employees);
  const rowsOf = rowsByEmployee({ rows: input.rows, workerOwners: owners, excluded });

  // rows to acknowledge (AC-1.13, D14)
  const acknowledged = new Map(file.rows.map((r) => [r.id.toUpperCase(), r] as const));
  for (const r of [...input.rows].sort((a, b) => a.position - b.position)) {
    const noWorker = r.number.kind !== "empty" && (r.worker === null || normaliseWorker(r.worker) === "");
    if (r.number.kind !== "malformed" && !noWorker) continue;
    const id = `R${r.position}`;
    const record = acknowledged.get(id);
    if (record === undefined) add("row-missing", id, `row ${id} has a malformed number or no worker and has no record in the file`);
    else if (record.state !== "confirmed" || record.decision !== "acknowledged") add("row-unacknowledged", id, `row ${id} is not acknowledged`);
  }

  // lines present once
  const current = new Map(input.lines.map((l) => [l.id, l] as const));
  const seenLines = new Set<string>();
  const records = new Map<string, ParsedLineRecord>();
  for (const record of file.lines) {
    if (seenLines.has(record.id)) {
      add("line-duplicate", record.id, `line ${record.id} is listed more than once`);
      continue;
    }
    seenLines.add(record.id);
    records.set(record.id, record);
    if (!current.has(record.id)) add("line-extra", record.id, `line ${record.id} is not a pre-release line`);
  }
  for (const id of current.keys()) if (!seenLines.has(id)) add("line-missing", id, `line ${id} is missing from the file`);

  // each line's decision
  const groups = new Map<string, { id: string; employee: string; date: string; number: string }[]>();
  const taken = new Map<string, string[]>(); // (employee, year, seq) -> units that hold it, as `group or line id`
  for (const record of [...records.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const line = current.get(record.id);
    if (line === undefined) continue;
    const employee = employeeOfUser.get(line.ownerUserId);
    if (record.state !== "confirmed") add("not-confirmed", record.id, `line ${record.id} is ${record.state === "invalid" ? "in no known state" : `not confirmed (${record.state})`}`);
    if (record.decision === "" || record.decision === "invalid") {
      add("no-decision", record.id, `line ${record.id} has no decision (paper, new or split)`);
      continue;
    }
    if (record.decision === "new") {
      if (record.split !== "") add("new-in-group", record.id, `line ${record.id} takes a new number and is in split group ${record.split}: a new number is never shared`);
      continue;
    }
    // paper or split
    const parsed = parseReceiptNumber(record.paperNumber);
    if (parsed === null) {
      add("paper-number-invalid", record.id, `line ${record.id}: the paper number is not of the form <letters><yy>/<seq>`);
      continue;
    }
    if (Number(line.date.slice(0, 4)) !== REGISTER_YEAR) add("paper-outside-2026", record.id, `line ${record.id} is not an expense of ${REGISTER_YEAR}: it takes a new number`);
    if (employee === undefined || excluded.has(employee.key)) {
      add("paper-for-excluded", record.id, `line ${record.id} belongs to an employee excluded from the register: it takes a new number`);
    } else if (!(rowsOf.get(employee.key) ?? []).some((r) => r.number.kind === "paper" && r.number.text === parsed.text)) {
      add("paper-number-not-in-register", record.id, `line ${record.id}: ${parsed.text} is not on a register row of the line's employee`);
    }
    const unit = record.decision === "split" ? record.split : record.id;
    if (record.decision === "split") {
      if (record.split === "") {
        add("split-without-group", record.id, `line ${record.id} is a split receipt with no group`);
      } else {
        groups.set(record.split, [...(groups.get(record.split) ?? []), { id: record.id, employee: employee?.key ?? "", date: line.date, number: parsed.text }]);
      }
    }
    const keyOfNumber = `${employee?.key ?? ""}|${line.date.slice(0, 4)}|${parsed.seq}`;
    const holders = taken.get(keyOfNumber) ?? [];
    taken.set(keyOfNumber, [...holders, `${unit}\u0000${record.id}`]);
  }

  // groups: one employee, one date, one number
  for (const [group, members] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (new Set(members.map((m) => m.date)).size > 1) add("split-two-dates", group, `split group ${group} holds lines of more than one expense date`);
    if (new Set(members.map((m) => m.number)).size > 1) add("split-two-numbers", group, `split group ${group} holds more than one number`);
    if (new Set(members.map((m) => m.employee)).size > 1) add("split-two-employees", group, `split group ${group} holds lines of more than one employee`);
  }
  // a number (and a sequence of a year) on two lines outside one group
  for (const holders of taken.values()) {
    const units = new Map<string, string[]>();
    for (const h of holders) {
      const [unit, lineId] = h.split("\u0000") as [string, string];
      units.set(unit, [...(units.get(unit) ?? []), lineId]);
    }
    if (units.size < 2) continue;
    for (const lineId of [...units.values()].flat().sort()) {
      add("number-on-two-lines", lineId, `line ${lineId} shares its number (or its sequence in the year) with another line outside a split receipt`);
    }
  }

  // offsets for an excluded employee (AC-1.15)
  for (const key of [...excluded].sort()) {
    const e = employeeByKey.get(key);
    if (e && input.offsets.some((o) => e.emails.includes(o.email.trim().toLowerCase()))) {
      add("offsets-for-excluded", "offsets", `an --offsets row belongs to the excluded employee ${key}: nothing counts toward its baseline`);
    }
  }
  return problems.sort(byId);
}

/** The problems as lines for the operator, one per problem, naming ids only. */
export function formatProblems(problems: readonly Problem[]): string[] {
  return problems.map((p) => `  ${p.id}: ${p.message}`);
}

/** The decisions of a valid file, by line id. */
export function decisionsOf(file: PairingFile): Map<string, { decision: DecisionKind; paperNumber: string | null; group: string | null }> {
  const out = new Map<string, { decision: DecisionKind; paperNumber: string | null; group: string | null }>();
  for (const l of file.lines) {
    if (l.decision === "" || l.decision === "invalid") continue;
    out.set(l.id, {
      decision: l.decision,
      paperNumber: l.decision === "new" ? null : (parseReceiptNumber(l.paperNumber)?.text ?? null),
      group: l.decision === "split" && l.split !== "" ? l.split : null,
    });
  }
  return out;
}
