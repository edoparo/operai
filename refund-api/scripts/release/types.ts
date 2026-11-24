/**
 * The shared types of the accounting release's pure modules (T6, specs/20261124-receipt-numbers-from-the-register; plan D2, D3, DS-10):
 * the register export reader (`registerExport.ts`), the pairing (`pairing.ts`), the pairing file (`pairingFile.ts`) and the report
 * (`report.ts`) are built against these, so they can be written side by side. TYPES ONLY: no value, no import with an effect.
 *
 * Personal data. A `RegisterRow` holds a worker's name: it exists in memory only, is never printed, logged, stored or put in an
 * error message. The report and every message use ids, prefixes, paper numbers, row positions and counts (AC-5.6).
 */

// ─── The register export ─────────────────────────────────────────────────────

/** The "No." cell of a register row, classified (plan § Register export, "No."). */
export type RegisterNumber =
  /** An empty cell: the row has no paper number (AC-1.13). */
  | { readonly kind: "empty" }
  /** `<letters><yy>/<seq>` after trim and upper-casing. `text` is that normalised text; `seq` may be 0 (AC-1.11). */
  | { readonly kind: "paper"; readonly text: string; readonly prefix: string; readonly yy: number; readonly seq: number }
  /** Any other text: kept as its SHAPE only (letters A, digits 9), never the cell (AC-1.13). */
  | { readonly kind: "malformed"; readonly shape: string };

/**
 * One row of the register export. Nothing but these five fields is ever kept from the workbook (T8).
 * `null` is "missing or unreadable": an empty cell, an error cell, a formula with no cached value or a text that is no date or amount.
 */
export interface RegisterRow {
  /** The sheet row number as Excel shows it (`37` is `R37`): the only register reference ever stored or printed. */
  readonly position: number;
  /** The worker's text as in the register (merged cells propagated), or `null` when there is none. NEVER printed. */
  readonly worker: string | null;
  readonly number: RegisterNumber;
  /** `YYYY-MM-DD`, or `null`. */
  readonly date: string | null;
  /** The total in cents, rounded half away from zero on the decimal string, or `null`. */
  readonly totalCents: number | null;
}

// ─── Refund's side ───────────────────────────────────────────────────────────

/** A WellD CH line to be numbered by the release (AC-1 of 20261118 AC-7.1; the `legacyLineWhere` set). */
export interface PreReleaseLine {
  readonly id: string;
  readonly ownerUserId: string;
  /** The expense date, `YYYY-MM-DD`. */
  readonly date: string;
  /** ISO time of creation (the numbering order's second key). */
  readonly createdAt: string;
  readonly approvedTotalCents: number;
  readonly currency: string;
}

/**
 * An employee of the pairing: known to Refund (`userId` set, key `E<n>` ordered by user id) or an employee the operator named by
 * email who has no request yet (`userId` null, key `mailto:<email>`), who holds register rows and a baseline only.
 */
export interface ReleaseEmployee {
  readonly key: string;
  readonly userId: string | null;
  /** The newest request's name, or `null`. Used to propose a worker mapping; never printed. */
  readonly name: string | null;
  /** The newest request's email (lower-cased), or the email the operator named. Never printed. */
  readonly email: string;
  /** Every email the user id has used on a request, lower-cased (the `--offsets` and the worker mapping match any of them). */
  readonly emails: readonly string[];
  /** The receipt code in force, or `null`. */
  readonly code: string | null;
  /** The two letters Refund derives from the name or email, or `null` for an employee not in Refund. */
  readonly initials: string | null;
  /** The prefixes of the numbers already issued or imported to the employee, any year (AC-4.11, DS-8). */
  readonly numberedPrefixes: readonly string[];
}

// ─── The pairing ─────────────────────────────────────────────────────────────

/**
 * What the dry run says about a line. The first rows are the categories of the plan's table (D2); the last four are the demotions
 * of an `exact` or `split_receipt` line to doubtful.
 */
export type PairingCategory =
  | "outside_2026"
  | "no_counterpart"
  | "row_without_number"
  | "split_receipt"
  | "exact"
  | "several_candidates"
  | "amount_differs"
  | "total_unreadable"
  | "wrong_year"
  | "sequence_000"
  | "prefix_differs"
  | "number_taken";

/** How a line gets its number: a paper number, a new one, or a paper number shared by a split receipt. */
export type DecisionKind = "paper" | "new" | "split";

/** `proposed`: pre-filled by the machine; `unresolved`: a person must decide; `confirmed`: a person did. The real run takes only `confirmed`. */
export type RecordState = "proposed" | "unresolved" | "confirmed";

/** The proposal for one line (the dry run's output, D2). */
export interface PairingProposal {
  readonly lineId: string;
  readonly employeeKey: string;
  readonly category: PairingCategory;
  /** A sentence for the operator naming amounts and paper numbers of THIS doubtful line and its rows (positions), or `null`. */
  readonly reason: string | null;
  /** What the machine proposes; `null` when it proposes nothing (a doubtful line to be decided). */
  readonly proposed: DecisionKind | null;
  /** The paper number shown or proposed, or `null`. For a doubtful line it is shown, not taken. */
  readonly proposedNumber: string | null;
  /** `S<k>` for a split receipt, else `null`. */
  readonly group: string | null;
  /** The positions of the register rows concerned, ascending. */
  readonly registerRows: readonly number[];
  /** `proposed` for an exact match, a split, a line with no counterpart or outside 2026; `unresolved` for a doubtful line. */
  readonly state: "proposed" | "unresolved";
}

/** A person's decision about one line, as read from the pairing file. */
export interface PairingDecision {
  readonly lineId: string;
  readonly decision: DecisionKind | null;
  /** The paper number (`paper`, `split`), upper-cased, as written in the file. */
  readonly paperNumber: string | null;
  /** `S<k>`, for `split`. */
  readonly group: string | null;
  readonly state: RecordState | null;
}

// ─── The pairing file ────────────────────────────────────────────────────────

/** One record of the pairing CSV (plan D3): one header for all the kinds. */
export interface PairingFileRecord {
  readonly record: "meta" | "employee" | "worker" | "line" | "row";
  readonly id: string;
  readonly label: string;
  readonly employee: string;
  readonly expenseDate: string;
  readonly amount: string;
  readonly currency: string;
  readonly category: string;
  readonly reason: string;
  readonly proposed: string;
  readonly proposedNumber: string;
  readonly decision: string;
  readonly paperNumber: string;
  readonly split: string;
  readonly state: string;
  readonly registerRows: string;
}
