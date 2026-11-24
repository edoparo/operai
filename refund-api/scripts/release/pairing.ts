/**
 * The pairing of pre-release lines with register rows, and what hangs on it (T9, specs/20261124-receipt-numbers-from-the-register;
 * plan § Pairing (D2), § Counter continuation (D5), § Prefixes and receipt codes (D8, AC-4.11 at the release), D14).
 *
 * PURE: no database, no file, no clock, no network. It takes the lines, the register rows, the employees and the worker mapping, and
 * returns decisions about ids, numbers, positions and counts. It is deterministic: lines are sorted by (employee, date, createdAt,
 * id), rows by position, split groups are numbered `S1`, `S2`, ... in that order, so the same inputs in any order give the same output.
 *
 * Personal data. A worker's text and an employee's name or email are used to MATCH and are never returned in a proposal, a reason or
 * a count: the strings this module produces name line ids, row positions, paper numbers and, for a doubtful line, its own amounts.
 */

import { formatReceiptNumber, parseReceiptNumber } from "../../src/accounting/receiptNumber";
import type { PairingCategory, PairingProposal, PreReleaseLine, RegisterRow, ReleaseEmployee } from "./types";

/** The one year whose numbers continue the register (20261118 AC-4.12). */
export const REGISTER_YEAR = 2026;

type PaperRow = RegisterRow & { readonly number: Extract<RegisterRow["number"], { kind: "paper" }> };
const isPaper = (row: RegisterRow): row is PaperRow => row.number.kind === "paper";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `E2` before `E10`, both before an employee the operator named by email. */
export function compareEmployeeKeys(a: string, b: string): number {
  const rank = (key: string) => (/^E\d+$/.test(key) ? 0 : 1);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (rank(a) === 0) return Number(a.slice(1)) - Number(b.slice(1));
  return compare(a, b);
}

/** `24.5` -> `24.50` for a reason that names a doubtful line's own amounts. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// ─── Workers ─────────────────────────────────────────────────────────────────

/** A worker's text as a key: trimmed, case-folded, diacritics stripped, the SET of its words (their order does not matter). */
export function normaliseWorker(text: string): string {
  const words = text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/[\s,.;]+/u)
    .filter((word) => word !== "");
  return [...new Set(words)].sort().join(" ");
}

export interface WorkerEntry {
  /** `W1`, `W2`, ... in order of first appearance in the sheet. */
  readonly id: string;
  /** The normalised key: what rows are matched by. */
  readonly key: string;
  /** The text as first written in the register. Never printed. */
  readonly text: string;
  /** How many rows name this worker. */
  readonly rows: number;
}

export function listWorkers(rows: readonly RegisterRow[]): WorkerEntry[] {
  const byKey = new Map<string, { text: string; rows: number }>();
  for (const row of [...rows].sort((a, b) => a.position - b.position)) {
    if (row.worker === null) continue;
    const key = normaliseWorker(row.worker);
    if (key === "") continue;
    const entry = byKey.get(key);
    if (entry) entry.rows++;
    else byKey.set(key, { text: row.worker, rows: 1 });
  }
  return [...byKey.entries()].map(([key, v], i) => ({ id: `W${i + 1}`, key, text: v.text, rows: v.rows }));
}

export interface WorkerProposal {
  readonly workerId: string;
  /** The employee whose current name has the same word set, when exactly one has. */
  readonly employeeKey: string | null;
  /** How many employees have that word set: 0 (none), 1 (mapped) or more (several: left unresolved, AC-1.14). */
  readonly matches: number;
}

/** AC-1.14: a worker is mapped to an employee only when exactly one employee's name has the same normalised word set. */
export function proposeWorkerMapping(workers: readonly WorkerEntry[], employees: readonly ReleaseEmployee[]): WorkerProposal[] {
  const byName = new Map<string, string[]>();
  for (const employee of employees) {
    if (employee.name === null) continue;
    const key = normaliseWorker(employee.name);
    if (key !== "") byName.set(key, [...(byName.get(key) ?? []), employee.key]);
  }
  return workers.map((worker) => {
    const matches = byName.get(worker.key) ?? [];
    return { workerId: worker.id, employeeKey: matches.length === 1 ? matches[0]! : null, matches: matches.length };
  });
}

/** The employee a worker decision names: `E<n>`, or an email (any of an employee's request emails, else a new outside employee). */
export function resolveWorkerDecision(
  decision: string,
  employees: readonly ReleaseEmployee[],
): { readonly kind: "employee"; readonly key: string } | { readonly kind: "not-operai" } | { readonly kind: "email"; readonly email: string } | null {
  const text = decision.trim();
  if (text.toLowerCase() === "not-operai") return { kind: "not-operai" };
  const byKey = employees.find((e) => e.key.toLowerCase() === text.toLowerCase());
  if (byKey) return { kind: "employee", key: byKey.key };
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) {
    const email = text.toLowerCase();
    const known = employees.find((e) => e.emails.includes(email));
    return known ? { kind: "employee", key: known.key } : { kind: "email", email };
  }
  return null;
}

/** The key of an employee the operator named by an email that no Refund request carries. */
export const outsideEmployeeKey = (email: string): string => `mailto:${email.trim().toLowerCase()}`;

/** The employees plus one outside employee for each email that no employee holds (an employee not yet in Refund). */
export function withOutsideEmployees(employees: readonly ReleaseEmployee[], emails: readonly string[]): ReleaseEmployee[] {
  const out = [...employees];
  for (const raw of [...new Set(emails.map((e) => e.trim().toLowerCase()))].sort()) {
    if (out.some((e) => e.emails.includes(raw))) continue;
    out.push({ key: outsideEmployeeKey(raw), userId: null, name: null, email: raw, emails: [raw], code: null, initials: null, numberedPrefixes: [] });
  }
  return out;
}

// ─── The inputs ──────────────────────────────────────────────────────────────

export interface PairingInput {
  readonly lines: readonly PreReleaseLine[];
  readonly rows: readonly RegisterRow[];
  readonly employees: readonly ReleaseEmployee[];
  /** Normalised worker key -> employee key, or `"not-operai"`. A worker absent from it is unmapped (no row of it is anyone's). */
  readonly workerOwners: ReadonlyMap<string, string>;
  /** Employees excluded from the register (AC-1.15): none of their rows is paired or counted. */
  readonly excluded: ReadonlySet<string>;
}

/** The register rows of each (non-excluded) employee, by position. */
export function rowsByEmployee(input: Pick<PairingInput, "rows" | "workerOwners" | "excluded">): Map<string, RegisterRow[]> {
  const out = new Map<string, RegisterRow[]>();
  for (const row of [...input.rows].sort((a, b) => a.position - b.position)) {
    if (row.worker === null) continue;
    const owner = input.workerOwners.get(normaliseWorker(row.worker));
    if (owner === undefined || owner === "not-operai" || input.excluded.has(owner)) continue;
    out.set(owner, [...(out.get(owner) ?? []), row]);
  }
  return out;
}

// ─── The proposal ────────────────────────────────────────────────────────────

export interface PairingResult {
  /** One proposal per pre-release line, by (employee, date, createdAt, id). */
  readonly proposals: readonly PairingProposal[];
  /** `S<k>` -> the line ids of that split receipt. */
  readonly groups: ReadonlyMap<string, readonly string[]>;
}

interface Work {
  readonly line: PreReleaseLine;
  readonly employeeKey: string;
  readonly year: number;
  candidates: RegisterRow[];
  numbered: PaperRow[];
  exact: PaperRow[];
  category: PairingCategory | "pending";
  reason: string | null;
  proposed: PairingProposal["proposed"];
  number: PaperRow["number"] | null;
  group: string | null;
  rows: number[];
}

const listRows = (rows: readonly { position: number }[]) => rows.map((r) => `R${r.position}`).join(", ");

export function proposePairing(input: PairingInput): PairingResult {
  const employees = [...input.employees].sort((a, b) => compareEmployeeKeys(a.key, b.key));
  const employeeOfUser = new Map(employees.filter((e) => e.userId !== null).map((e) => [e.userId!, e]));
  const rowsOf = rowsByEmployee(input);

  const sortedLines = [...input.lines].sort(
    (a, b) =>
      compareEmployeeKeys(employeeOfUser.get(a.ownerUserId)?.key ?? "~", employeeOfUser.get(b.ownerUserId)?.key ?? "~") ||
      compare(a.date, b.date) ||
      compare(a.createdAt, b.createdAt) ||
      compare(a.id, b.id),
  );

  const works: Work[] = [];
  for (const line of sortedLines) {
    const employee = employeeOfUser.get(line.ownerUserId);
    if (employee === undefined) throw new RangeError(`line ${line.id} belongs to an employee that is not listed`);
    works.push({
      line,
      employeeKey: employee.key,
      year: Number(line.date.slice(0, 4)),
      candidates: [],
      numbered: [],
      exact: [],
      category: "pending",
      reason: null,
      proposed: null,
      number: null,
      group: null,
      rows: [],
    });
  }

  let nextGroup = 1;
  const groups = new Map<string, string[]>();

  for (const employee of employees) {
    const mine = works.filter((w) => w.employeeKey === employee.key);
    if (mine.length === 0) continue;
    const ownRows = rowsOf.get(employee.key) ?? [];

    // ── Candidates and exact candidates ──
    for (const w of mine) {
      w.candidates = ownRows.filter((r) => r.date === w.line.date);
      w.numbered = w.candidates.filter(isPaper);
      w.exact = w.numbered.filter((r) => r.totalCents !== null && r.totalCents === w.line.approvedTotalCents);
    }
    const exactOf = new Map<number, Work[]>();
    for (const w of mine) for (const r of w.exact) exactOf.set(r.position, [...(exactOf.get(r.position) ?? []), w]);

    // ── The category table, first that applies ──
    const pending: Work[] = [];
    for (const w of mine) {
      const set = (category: PairingCategory, proposed: Work["proposed"], reason: string | null = null) => {
        w.category = category;
        w.proposed = proposed;
        w.reason = reason;
      };
      w.rows = w.candidates.map((r) => r.position);
      if (w.year !== REGISTER_YEAR) {
        w.rows = [];
        set("outside_2026", "new");
      } else if (w.candidates.length === 0) {
        set("no_counterpart", "new");
      } else if (w.numbered.length === 0) {
        set("row_without_number", "new", `matches a row without a number: ${listRows(w.candidates)}`);
      } else {
        const distinct = [...new Set(w.numbered.map((r) => r.number.text))].sort();
        const rowsSum = w.numbered.every((r) => r.totalCents !== null) ? w.numbered.reduce((sum, r) => sum + r.totalCents!, 0) : null;
        if (w.exact.length === 0 && distinct.length === 1 && w.numbered.length >= 2 && rowsSum === w.line.approvedTotalCents) {
          // AC-1.7: one line, several rows of one number whose totals add up to the line's.
          w.category = "split_receipt";
          w.proposed = "split";
          w.number = w.numbered[0]!.number;
          w.rows = w.numbered.map((r) => r.position);
          pending.push(w);
        } else if (w.exact.length >= 2 || (w.exact.length === 1 && exactOf.get(w.exact[0]!.position)!.length >= 2)) {
          set(
            "several_candidates",
            null,
            `several candidates: ${w.exact.map((r) => `R${r.position} ${r.number.text}`).join(", ")}`,
          );
        } else if (w.exact.length === 1) {
          w.category = "exact";
          w.proposed = "paper";
          w.number = w.exact[0]!.number;
          w.rows = [w.exact[0]!.position];
          pending.push(w);
        } else if (distinct.length >= 2) {
          set("several_candidates", null, `several candidates: ${w.numbered.map((r) => `R${r.position} ${r.number.text}`).join(", ")}`);
        } else if (w.numbered.every((r) => r.totalCents === null)) {
          set("total_unreadable", null, `total unreadable on ${listRows(w.numbered)} (${distinct[0]}), line ${formatCents(w.line.approvedTotalCents)} ${w.line.currency}`);
          w.number = w.numbered[0]!.number;
        } else {
          set(
            "amount_differs",
            "paper",
            `amount differs: line ${formatCents(w.line.approvedTotalCents)} ${w.line.currency}, ${w.numbered
              .map((r) => `R${r.position} ${r.totalCents === null ? "unreadable" : formatCents(r.totalCents)}`)
              .join(", ")}, ${distinct[0]}`,
          );
          w.number = w.numbered[0]!.number;
        }
      }
    }

    // ── Split receipts of AC-1.6: lines of one date whose single, unshared exact rows carry one number; groups numbered in line order ──
    const byDateNumber = new Map<string, Work[]>();
    for (const w of pending) {
      if (w.category !== "exact") continue;
      const groupKey = `${w.line.date}|${w.number!.text}`;
      byDateNumber.set(groupKey, [...(byDateNumber.get(groupKey) ?? []), w]);
    }
    for (const w of mine) {
      if (w.group !== null || (w.category !== "exact" && w.category !== "split_receipt")) continue;
      const peers = w.category === "exact" ? byDateNumber.get(`${w.line.date}|${w.number!.text}`)! : [w];
      if (peers.length < 2 && w.category === "exact") continue;
      const id = `S${nextGroup++}`;
      groups.set(id, peers.map((p) => p.line.id));
      for (const peer of peers) {
        peer.category = "split_receipt";
        peer.proposed = "split";
        peer.group = id;
      }
    }

    // ── Demotions of an exact or split line to doubtful ──
    const taken = new Map<string, Set<string>>(); // (expense year, seq) -> the units (group or line) that hold it
    const proposedWork = mine.filter((w) => (w.category === "exact" || w.category === "split_receipt") && w.number !== null);
    for (const w of proposedWork) {
      const key = `${w.year}|${w.number!.seq}`;
      taken.set(key, (taken.get(key) ?? new Set()).add(w.group ?? w.line.id));
    }
    const derived = new Set([employee.code, employee.initials].filter((p): p is string => p !== null));
    for (const w of proposedWork) {
      const number = w.number!;
      const demote = (category: PairingCategory, reason: string, proposed: Work["proposed"] = w.proposed) => {
        w.category = category;
        w.reason = reason;
        w.proposed = proposed;
      };
      if (taken.get(`${w.year}|${number.seq}`)!.size >= 2) {
        demote("number_taken", `number already taken: sequence ${number.seq} of ${w.year} is proposed for more than one line (${number.text})`);
      } else if (number.yy !== w.year % 100) {
        demote("wrong_year", `wrong year: ${number.text} on an expense of ${w.year}`);
      } else if (number.seq === 0) {
        demote("sequence_000", `sequence 000: ${number.text}`, "new");
      } else if (
        !derived.has(number.prefix) &&
        !proposedWork.some((other) => other !== w && other.number!.text !== number.text && other.number!.prefix === number.prefix)
      ) {
        demote("prefix_differs", `prefix differs: ${number.text} is neither the receipt code, the initials nor the prefix of the other paper numbers`);
      }
    }
  }

  const proposals: PairingProposal[] = works.map((w) => {
    if (w.category === "pending") throw new Error(`line ${w.line.id} was not classified`);
    const state: PairingProposal["state"] =
      w.category === "outside_2026" || w.category === "no_counterpart" || w.category === "exact" || w.category === "split_receipt" ? "proposed" : "unresolved";
    const keepsNumber = w.proposed === "paper" || w.proposed === "split" || w.category === "several_candidates" || w.category === "total_unreadable";
    return {
      lineId: w.line.id,
      employeeKey: w.employeeKey,
      category: w.category,
      reason: w.reason,
      proposed: w.proposed,
      proposedNumber: keepsNumber && w.proposed !== null && w.number !== null ? w.number.text : null,
      group: w.group,
      registerRows: [...w.rows].sort((a, b) => a - b),
      state,
    };
  });
  return { proposals, groups };
}

// ─── Register rows nobody pairs with, and the lists AC-1.13 asks for ─────────

export interface RowInventory {
  /** Rows of a mapped employee that no line takes as a candidate (AC-1.9). Counted, never written. */
  readonly rowsWithNoLine: number;
  /** Rows of a mapped employee with no paper number: empty or malformed. */
  readonly rowsWithoutNumber: number;
  /** Rows with a paper number but no readable date or total: listed, their number counts toward the maximum. */
  readonly rowsWithoutDateOrTotal: readonly number[];
  /** Positions of malformed numbers (to be acknowledged), over every row with a worker mapped or not. */
  readonly malformed: readonly { readonly position: number; readonly shape: string }[];
  /** Positions of rows with a number and no worker (to be acknowledged, D14). */
  readonly noWorker: readonly number[];
  /** The ids (`W<n>`) of the workers with no employee and no `not-operai` (AC-1.14). */
  readonly unmappedWorkers: readonly string[];
}

export function inventory(input: PairingInput, result: PairingResult): RowInventory {
  const paired = new Set(result.proposals.flatMap((p) => p.registerRows));
  const mapped = rowsByEmployee(input);
  let rowsWithNoLine = 0;
  let rowsWithoutNumber = 0;
  const noDateOrTotal: number[] = [];
  for (const rows of mapped.values()) {
    for (const row of rows) {
      if (!paired.has(row.position)) rowsWithNoLine++;
      if (row.number.kind !== "paper") rowsWithoutNumber++;
      if (row.number.kind === "paper" && (row.date === null || row.totalCents === null)) noDateOrTotal.push(row.position);
    }
  }
  const sorted = [...input.rows].sort((a, b) => a.position - b.position);
  const unmapped = listWorkers(input.rows).filter((worker) => !input.workerOwners.has(worker.key)).map((worker) => worker.id);
  return {
    rowsWithNoLine,
    rowsWithoutNumber,
    rowsWithoutDateOrTotal: noDateOrTotal.sort((a, b) => a - b),
    malformed: sorted.filter((r) => r.number.kind === "malformed").map((r) => ({ position: r.position, shape: (r.number as { shape: string }).shape })),
    noWorker: sorted.filter((r) => r.number.kind !== "empty" && (r.worker === null || normaliseWorker(r.worker) === "")).map((r) => r.position),
    unmappedWorkers: unmapped,
  };
}

// ─── Counter continuation (AC-3.1, D5) ───────────────────────────────────────

export interface OffsetEntry {
  readonly email: string;
  readonly lastIssuedSeq: number;
}

export interface EmployeeBaseline {
  readonly employeeKey: string;
  /** The highest `--offsets` row of any of the employee's emails, or 0. */
  readonly offsets: number;
  /** The highest 2026 sequence among the employee's register rows, by the rule below, or 0. */
  readonly registerMax: number;
  /** The highest sequence among the paper numbers the decisions import on 2026 lines, or 0. */
  readonly importedMax: number;
  /** max of the three: the counter continues after it. */
  readonly baseline: number;
}

/**
 * Does a register row's paper number count toward its employee's 2026 maximum? A `..26` number counts; another year's number
 * counts when its row's date is in 2026, or missing or unreadable (a doubtful entry is counted: a gap is harmless, a repeat is not),
 * and does not when that date is readable and outside 2026 (what `receipt-baseline:from-register` does). A sequence 0, an empty
 * number and a malformed one count for nothing.
 */
export function countsTowardMaximum(row: RegisterRow): boolean {
  if (!isPaper(row) || row.number.seq < 1) return false;
  if (row.number.yy === REGISTER_YEAR % 100) return true;
  return row.date === null || Number(row.date.slice(0, 4)) === REGISTER_YEAR;
}

export interface BaselineInput {
  readonly employees: readonly ReleaseEmployee[];
  readonly rows: readonly RegisterRow[];
  readonly workerOwners: ReadonlyMap<string, string>;
  readonly excluded: ReadonlySet<string>;
  readonly offsets: readonly OffsetEntry[];
  /** The paper numbers the decisions put on lines, per employee (texts). */
  readonly imported: ReadonlyMap<string, readonly string[]>;
}

export function computeBaselines(input: BaselineInput): Map<string, EmployeeBaseline> {
  const out = new Map<string, EmployeeBaseline>();
  const rowsOf = rowsByEmployee(input);
  for (const employee of [...input.employees].sort((a, b) => compareEmployeeKeys(a.key, b.key))) {
    const excluded = input.excluded.has(employee.key);
    const offsets = excluded ? 0 : Math.max(0, ...input.offsets.filter((o) => employee.emails.includes(o.email.trim().toLowerCase())).map((o) => o.lastIssuedSeq));
    const registerMax = Math.max(0, ...(rowsOf.get(employee.key) ?? []).filter(countsTowardMaximum).map((r) => (r.number as { seq: number }).seq));
    const importedMax = excluded
      ? 0
      : Math.max(0, ...(input.imported.get(employee.key) ?? []).map((text) => parseReceiptNumber(text)?.seq ?? 0));
    out.set(employee.key, { employeeKey: employee.key, offsets, registerMax, importedMax, baseline: Math.max(offsets, registerMax, importedMax) });
  }
  return out;
}

/** The first new number the employee's lines would take: after the baseline, with the prefix in force, in 2026. */
export function firstNewNumber(employee: ReleaseEmployee, baseline: number): string | null {
  const prefix = employee.code ?? employee.initials;
  if (prefix === null) return null;
  return formatReceiptNumber(prefix, REGISTER_YEAR, baseline + 1);
}

// ─── Shared prefixes (AC-4.11, DS-8) ─────────────────────────────────────────

export interface PrefixInput {
  readonly employees: readonly ReleaseEmployee[];
  readonly rows: readonly RegisterRow[];
  readonly workerOwners: ReadonlyMap<string, string>;
  readonly excluded: ReadonlySet<string>;
  /** The paper numbers the decisions put on lines, per employee. */
  readonly imported: ReadonlyMap<string, readonly string[]>;
  /** The employees that have at least one line taking a NEW number. */
  readonly withNewNumbers: ReadonlySet<string>;
}

export interface PrefixAnalysis {
  readonly prefixes: ReadonlyMap<string, ReadonlySet<string>>;
  /** Employees whose prefixes meet another employee's (a shared pair), with or without a code. */
  readonly shared: readonly string[];
  /** Shared employees that hold no receipt code and are in Refund (the dry run lists them: they need a code). */
  readonly needCode: readonly string[];
  /** Employees the real run refuses (exit 9): a new number would go to a codeless member of a shared pair, or to a prefix another holds. */
  readonly blocked: readonly string[];
}

/**
 * prefixes(E) = {code, else initials} + the prefixes of E's well-formed 2026 register rows + the prefixes of E's paper decisions
 * + the prefixes of the numbers already issued or imported to E. E is in a shared pair when another employee shares one of them.
 * The excluded test account takes part with its code or initials (its register rows are dropped). An employee whose lines all
 * take paper numbers is never blocked.
 */
export function analysePrefixes(input: PrefixInput): PrefixAnalysis {
  const employees = [...input.employees].sort((a, b) => compareEmployeeKeys(a.key, b.key));
  const rowsOf = rowsByEmployee(input);
  const prefixes = new Map<string, Set<string>>();
  for (const employee of employees) {
    const set = new Set<string>();
    const own = employee.code ?? employee.initials;
    if (own !== null) set.add(own);
    for (const row of rowsOf.get(employee.key) ?? []) {
      if (isPaper(row) && (row.date === null || Number(row.date.slice(0, 4)) === REGISTER_YEAR)) set.add(row.number.prefix);
    }
    for (const text of input.imported.get(employee.key) ?? []) {
      const parsed = parseReceiptNumber(text);
      if (parsed !== null) set.add(parsed.prefix);
    }
    for (const prefix of employee.numberedPrefixes) set.add(prefix);
    prefixes.set(employee.key, set);
  }
  const meets = (a: ReadonlySet<string>, b: ReadonlySet<string>) => [...a].some((p) => b.has(p));
  const shared = employees.filter((e) => employees.some((f) => f.key !== e.key && meets(prefixes.get(e.key)!, prefixes.get(f.key)!))).map((e) => e.key);
  const sharedSet = new Set(shared);
  const needCode = employees.filter((e) => sharedSet.has(e.key) && e.code === null && e.userId !== null).map((e) => e.key);
  const blocked = employees
    .filter((e) => {
      if (!input.withNewNumbers.has(e.key)) return false;
      const newPrefix = e.code ?? e.initials;
      if (e.code === null && sharedSet.has(e.key)) return true;
      return newPrefix !== null && employees.some((f) => f.key !== e.key && prefixes.get(f.key)!.has(newPrefix));
    })
    .map((e) => e.key);
  return { prefixes, shared, needCode, blocked };
}
