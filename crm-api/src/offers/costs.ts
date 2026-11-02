/**
 * The money of an offer, computed once at generation time (specs/020 AC-1.5,
 * AC-3.3, AC-3.4; D-6, D-14; ADR-0025 posture): integer cents, BigInt
 * intermediates (a line may reach 10^13 cents × 10^5), one rounding rule.
 *
 *   line total          = unit amount × quantity
 *   percentage discount = roundHalfUp(Σ one-off totals × bp / 10 000)
 *   price (stored)      = Σ one-off − Σ discounts
 *   yearly              = Σ yearly totals, shown apart
 */

import { unprocessable } from "../lib/problem";
import type { CostColumns, OfferCostLine, OfferCosts } from "./contract";
import { MAX_CENTS, type GenerateOfferInput } from "./offerSchemas";

const MAX = BigInt(MAX_CENTS);

/** Round half up, once: `value × bp / 10 000`, positive values only. */
export const percentOf = (sumCents: bigint, bp: bigint): bigint => (sumCents * bp + 5_000n) / 10_000n;

export function computeCosts(input: {
  currency: "CHF" | "EUR";
  columns: CostColumns;
  showTotal: boolean;
  lines: GenerateOfferInput["costLines"];
}): OfferCosts {
  const tooLarge = (index: number) =>
    unprocessable(
      "A cost line is too large",
      { field: `costLines.${index}.unitCents` },
      "cost_total_too_large",
    );

  // Fixed amounts first: a percentage discount needs the one-off sum.
  const fixed: (bigint | null)[] = input.lines.map((line, index) => {
    if (line.unitCents === undefined) return null;
    const total = BigInt(line.unitCents) * BigInt(line.quantity);
    if (total > MAX) throw tooLarge(index);
    return total;
  });
  const oneOffSum = input.lines.reduce((sum, line, index) => (line.kind === "one_off" ? sum + fixed[index]! : sum), 0n);

  const totals = input.lines.map((line, index): bigint =>
    line.kind === "discount" && line.percentBp !== undefined ? percentOf(oneOffSum, BigInt(line.percentBp)) : fixed[index]!,
  );
  const discounts = input.lines.reduce((sum, line, index) => (line.kind === "discount" ? sum + totals[index]! : sum), 0n);
  if (discounts > oneOffSum) {
    throw unprocessable(
      "The discounts exceed the one-off lines",
      { field: "costLines" },
      "discounts_exceed_one_off",
    );
  }
  const yearly = input.lines.reduce((sum, line, index) => (line.kind === "yearly" ? sum + totals[index]! : sum), 0n);

  const lines: OfferCostLine[] = input.lines.map((line, index) => ({
    description: line.description,
    kind: line.kind,
    unitCents: line.unitCents ?? null,
    percentBp: line.percentBp ?? null,
    quantity: line.quantity,
    totalCents: Number(totals[index]!),
  }));
  return {
    currency: input.currency,
    columns: input.columns,
    showTotal: input.showTotal,
    lines,
    oneOffCents: Number(oneOffSum - discounts),
    yearlyCents: Number(yearly),
  };
}
