/**
 * The money of an offer's cost table (specs/20261115-crm-offer-wizard AC-4.1, 4.3, 4.6, 4.7; DD-34, DD-35,
 * DD-39), computed once from the rows the offer prints: integer cents, BigInt intermediates (a line may
 * reach 10^13 cents × 10^5), one rounding rule. It replaces the arithmetic of the legacy
 * `src/offers/costs.ts`, which keeps its 018 behaviour through a thin adapter.
 *
 * Returns errors, never throws. The rules C1–C9 are normative and pinned by `vectors/costs.spans.json`:
 *
 *   C1 counted line   a one_off or yearly line present in the table. An `option` line is priced and
 *                     numbered but counted nowhere (AC-4.7).
 *   C2 span           the rows after the previous total row (or the top) up to a total row; lines after
 *                     the last total row form a last span with no total row.
 *   C3 percentage     exists only in a table with AT MOST ONE total row (DD-39): the amount is
 *                     roundHalfUp(Σ every one-off line × bp / 10 000), BigInt, rounded once — 018's base.
 *                     With two or more total rows every percentage discount is `percent_discount_multi_total`,
 *                     gets no amount, and its span is "incomplete". Total rows are counted as given,
 *                     whatever the display switch says.
 *   C4 base           a percentage with no one-off line in the table is `discount_without_base`; the
 *                     discount still computes to 0 so the figures stay 018's.
 *   C5 span check     per span: Σ discounts ≤ Σ counted lines, else `discounts_exceed_span` at the span's
 *                     first discount — no printed total is ever negative. A span in error prints no figure.
 *   C6 document check Σ every discount ≤ Σ every one-off line, else `discounts_exceed_one_off` at the last
 *                     discount (018's rule); the stored price is then null.
 *   C7 empty span     a total row whose span has no counted line is "empty": no figure, not an error.
 *   C8 incomplete     a counted line or discount with a missing value has total null; its span is
 *                     "incomplete" (never a partial sum) and its checks wait, as do C6 and the stored
 *                     figures. A missing value on an option line affects nothing but its own price.
 *                     A too-large line (C9) is incomplete too.
 *   C9 limits         no counted line → `no_counted_line` ("cost:*"); more than 10 lines counting options,
 *                     expanded and extra lines → `too_many_cost_lines` ("cost:*"); a figure above
 *                     MAX_CENTS → `cost_total_too_large` at the line.
 *   Invariant         oneOffCents and yearlyCents depend on the lines only, never on where the total
 *                     rows fall.
 *
 * Errors come in rule order: too large (row order), C3, C4, C5 (span order), C6, `no_counted_line`,
 * `too_many_cost_lines`. Pure; no I/O, no clock.
 *
 * Shared with the CRM UI: byte-identical copy (group offerEngine.costs).
 */
// shared-copy:begin offerEngine.costs

export type CostKind = "one_off" | "yearly" | "discount" | "option";

export type CostRowIn =
  | {
      type: "line";
      /** The Issue name: "cost:<key>", "cost:<key>#<n>", "cost:extra:<id>". */
      name: string;
      kind: CostKind;
      unitCents: number | null;
      percentBp: number | null;
      quantity: number | null;
    }
  | { type: "total"; label: string };

export type CostErrorCode =
  | "discounts_exceed_span"
  | "discounts_exceed_one_off"
  | "discount_without_base"
  | "percent_discount_multi_total"
  | "cost_total_too_large"
  | "too_many_cost_lines"
  | "no_counted_line";

export type CostRowOut =
  | {
      type: "line";
      name: string;
      /** Counted and option lines are numbered in order; discounts are not. */
      position: number | null;
      /** A percentage discount's amount, once rounded; null for any other line. */
      discountCents: number | null;
      /** unit × quantity or the rounded percentage; null = incomplete (a value is missing or refused). */
      totalCents: number | null;
    }
  | { type: "total"; label: string; spanIndex: number; state: "ok" | "empty" | "incomplete"; totalCents: number | null };

export interface CostResult {
  rows: CostRowOut[];
  /** The stored price (018): Σ one-off − Σ every discount; null while incomplete or refused. */
  oneOffCents: number | null;
  /** Σ yearly; null while incomplete. */
  yearlyCents: number | null;
  /** `name` is the line ("cost:…") or "cost:*". */
  errors: { code: CostErrorCode; name: string }[];
}

/** Largest figure a line (or an amount entered) may reach. */
export const MAX_CENTS = 10_000_000_000_000;
/** Lines of one table, options, expanded and extra lines included. */
export const MAX_COST_LINES = 10;

type LineRow = Extract<CostRowIn, { type: "line" }>;

interface Entry {
  readonly row: LineRow;
  readonly position: number | null;
  readonly percent: boolean;
  /** null = incomplete. */
  amount: bigint | null;
  refused: boolean;
}

/** Round half up, once: `value × bp / 10 000`, positive values only. */
const percentOf = (sumCents: bigint, bp: bigint): bigint => (sumCents * bp + 5_000n) / 10_000n;

/** A usable amount or count; anything else (null, fraction, negative, NaN) is a missing value the resolver reports. */
const wholeNumber = (value: number | null): value is number => value !== null && Number.isInteger(value) && value >= 0;

export function computeCosts(rows: readonly CostRowIn[]): CostResult {
  const max = BigInt(MAX_CENTS);
  const errors: CostResult["errors"] = [];
  const tooLarge: string[] = [];

  // ─── Lines: figures that need no other line ───
  const entries: Entry[] = [];
  let position = 0;
  for (const row of rows) {
    if (row.type !== "line") continue;
    const percent = row.kind === "discount" && row.percentBp !== null;
    if (row.kind !== "discount") position += 1;
    const entry: Entry = { row, position: row.kind === "discount" ? null : position, percent, amount: null, refused: false };
    if (!percent && wholeNumber(row.unitCents) && wholeNumber(row.quantity)) {
      const total = BigInt(row.unitCents) * BigInt(row.quantity);
      if (total > max) tooLarge.push(row.name);
      else entry.amount = total;
    }
    entries.push(entry);
  }
  for (const name of tooLarge) errors.push({ code: "cost_total_too_large", name });

  // ─── C3 / C4: the percentage discounts ───
  const totalRows = rows.filter((row) => row.type === "total").length;
  const oneOffLines = entries.filter((entry) => entry.row.kind === "one_off");
  const base = oneOffLines.every((entry) => entry.amount !== null) ? oneOffLines.reduce((sum, entry) => sum + entry.amount!, 0n) : null;
  const percents = entries.filter((entry) => entry.percent);
  if (totalRows >= 2) {
    for (const entry of percents) {
      entry.refused = true;
      errors.push({ code: "percent_discount_multi_total", name: entry.row.name });
    }
  } else {
    for (const entry of percents) {
      const bp = entry.row.percentBp!;
      if (!Number.isInteger(bp) || bp < 0) continue; // an answer the resolver reports; no figure
      if (oneOffLines.length === 0) {
        entry.amount = 0n;
        errors.push({ code: "discount_without_base", name: entry.row.name });
      } else if (base !== null) {
        entry.amount = percentOf(base, BigInt(bp));
      }
    }
  }

  // ─── C2 / C5: spans ───
  type Span = { entries: Entry[]; total: Extract<CostRowIn, { type: "total" }> | null };
  const spans: Span[] = [];
  let current: Span = { entries: [], total: null };
  let cursor = 0;
  for (const row of rows) {
    if (row.type === "total") {
      current.total = row;
      spans.push(current);
      current = { entries: [], total: null };
    } else {
      current.entries.push(entries[cursor]!);
      cursor += 1;
    }
  }
  if (current.entries.length > 0) spans.push(current);

  const spanResult = new Map<Span, { state: "ok" | "empty" | "incomplete"; totalCents: number | null }>();
  for (const span of spans) {
    const counted = span.entries.filter((entry) => entry.row.kind === "one_off" || entry.row.kind === "yearly");
    const discounts = span.entries.filter((entry) => entry.row.kind === "discount");
    const incomplete = [...counted, ...discounts].some((entry) => entry.amount === null);
    if (incomplete) {
      spanResult.set(span, { state: "incomplete", totalCents: null });
      continue;
    }
    const countedSum = counted.reduce((sum, entry) => sum + entry.amount!, 0n);
    const discountSum = discounts.reduce((sum, entry) => sum + entry.amount!, 0n);
    if (discountSum > countedSum) {
      errors.push({ code: "discounts_exceed_span", name: discounts[0]!.row.name });
      spanResult.set(span, { state: "incomplete", totalCents: null });
    } else if (counted.length === 0) {
      spanResult.set(span, { state: "empty", totalCents: null });
    } else {
      spanResult.set(span, { state: "ok", totalCents: Number(countedSum - discountSum) });
    }
  }

  // ─── C6: the document ───
  const figured = entries.filter((entry) => entry.row.kind !== "option");
  const complete = figured.every((entry) => entry.amount !== null);
  const oneOffSum = entries.reduce((sum, entry) => (entry.row.kind === "one_off" && entry.amount !== null ? sum + entry.amount : sum), 0n);
  const yearlySum = entries.reduce((sum, entry) => (entry.row.kind === "yearly" && entry.amount !== null ? sum + entry.amount : sum), 0n);
  const allDiscounts = entries.filter((entry) => entry.row.kind === "discount");
  const discountTotal = allDiscounts.reduce((sum, entry) => sum + (entry.amount ?? 0n), 0n);
  let exceeds = false;
  if (complete && discountTotal > oneOffSum) {
    exceeds = true;
    errors.push({ code: "discounts_exceed_one_off", name: allDiscounts[allDiscounts.length - 1]!.row.name });
  }

  // ─── C9 ───
  if (!entries.some((entry) => entry.row.kind === "one_off" || entry.row.kind === "yearly")) {
    errors.push({ code: "no_counted_line", name: "cost:*" });
  }
  if (entries.length > MAX_COST_LINES) errors.push({ code: "too_many_cost_lines", name: "cost:*" });

  // ─── Output ───
  const out: CostRowOut[] = [];
  let spanIndex = 0;
  let cursorOut = 0;
  for (const row of rows) {
    if (row.type === "line") {
      const entry = entries[cursorOut]!;
      cursorOut += 1;
      out.push({
        type: "line",
        name: row.name,
        position: entry.position,
        discountCents: entry.percent && entry.amount !== null ? Number(entry.amount) : null,
        totalCents: entry.amount !== null ? Number(entry.amount) : null,
      });
    } else {
      const span = spans[spanIndex]!;
      const result = spanResult.get(span)!;
      out.push({ type: "total", label: row.label, spanIndex, state: result.state, totalCents: result.totalCents });
      spanIndex += 1;
    }
  }
  return {
    rows: out,
    oneOffCents: complete && !exceeds ? Number(oneOffSum - discountTotal) : null,
    yearlyCents: complete ? Number(yearlySum) : null,
    errors,
  };
}
// shared-copy:end offerEngine.costs
