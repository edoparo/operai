/**
 * The money of a legacy (018) offer, computed once at generation time (specs/20261102-crm-offer-document
 * AC-1.5, AC-3.3, AC-3.4; D-6, D-14): a thin adapter over the shared engine's `computeCosts`
 * (specs/20261115-crm-offer-wizard T4), which owns the arithmetic — integer cents, BigInt intermediates,
 * one rounding rule. A legacy table has no total rows, so the whole table is one span and every
 * engine rule collapses to 018's:
 *
 *   line total          = unit amount × quantity
 *   percentage discount = roundHalfUp(Σ one-off totals × bp / 10 000)
 *   price (stored)      = Σ one-off − Σ discounts
 *   yearly              = Σ yearly totals, shown apart
 *
 * 018 refuses exactly two things, and this adapter throws exactly those, in 018's order (a too-large line
 * first, then discounts above the one-off lines); the wizard's other cost errors cannot arise here.
 */

import { unprocessable } from "../lib/problem";
import type { CostColumns, OfferCostLine, OfferCosts } from "./contract";
import { computeCosts as computeSpanCosts, type CostRowIn } from "./engine/costs";
import type { GenerateOfferInput } from "./offerSchemas";

export function computeCosts(input: {
  currency: "CHF" | "EUR";
  columns: CostColumns;
  showTotal: boolean;
  lines: GenerateOfferInput["costLines"];
}): OfferCosts {
  const rows: CostRowIn[] = input.lines.map((line, index) => ({
    type: "line",
    name: `cost:${index}`,
    kind: line.kind,
    unitCents: line.unitCents ?? null,
    percentBp: line.percentBp ?? null,
    quantity: line.quantity,
  }));
  const result = computeSpanCosts(rows);

  const tooLarge = result.errors.find((error) => error.code === "cost_total_too_large");
  if (tooLarge) {
    throw unprocessable(
      "A cost line is too large",
      { field: `costLines.${tooLarge.name.slice("cost:".length)}.unitCents` },
      "cost_total_too_large",
    );
  }
  if (result.errors.some((error) => error.code === "discounts_exceed_one_off" || error.code === "discounts_exceed_span")) {
    throw unprocessable("The discounts exceed the one-off lines", { field: "costLines" }, "discounts_exceed_one_off");
  }

  // A legacy line always carries its amount (the request schema requires it), so a null here is a bug,
  // never a value to print as 0.
  if (result.oneOffCents === null || result.yearlyCents === null) throw new Error("computeCosts: a legacy cost line has no amount");
  const lines: OfferCostLine[] = input.lines.map((line, index) => {
    const row = result.rows[index]!;
    if (row.type !== "line" || row.totalCents === null) throw new Error("computeCosts: a legacy cost line has no amount");
    return {
      description: line.description,
      kind: line.kind,
      unitCents: line.unitCents ?? null,
      percentBp: line.percentBp ?? null,
      quantity: line.quantity,
      totalCents: row.totalCents,
    };
  });
  return {
    currency: input.currency,
    columns: input.columns,
    showTotal: input.showTotal,
    lines,
    oneOffCents: result.oneOffCents,
    yearlyCents: result.yearlyCents,
  };
}
