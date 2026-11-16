import { describe, expect, it } from "bun:test";
import { MAX_CENTS as SCHEMA_MAX_CENTS } from "../offerSchemas";
import { computeCosts as legacyComputeCosts } from "../costs";
import { computeCosts, MAX_CENTS, type CostRowIn } from "./costs";
import vectors from "./vectors/costs.spans.json";

interface Vector {
  name: string;
  group?: string;
  rows: CostRowIn[];
  expected: ReturnType<typeof computeCosts>;
}
const cases = vectors.cases as unknown as Vector[];

/** specs/20261115-crm-offer-wizard AC-4.1, 4.3, 4.6, 4.7 — rules C1–C9 (DD-34, DD-35, DD-39). */
describe("vectors/costs.spans.json", () => {
  for (const vector of cases) {
    it(vector.name, () => {
      expect(computeCosts(vector.rows)).toEqual(vector.expected);
    });
  }

  it("holds every case the plan lists", () => {
    const names = cases.map((vector) => vector.name).join("\n");
    for (const needle of [
      "AC-4.6 example",
      "placement: no total row",
      "placement: three total rows",
      "1350.00",
      "two total rows is refused (template line)",
      "two total rows is refused (extra line)",
      "inside an off block",
      "C4:",
      "C5 alone",
      "C6 alone",
      "empty span",
      "incomplete",
      "option line after the last total",
      "eleven lines",
      "no counted line",
    ]) {
      expect(names).toContain(needle);
    }
  });

  it("placement invariance: cases of one group agree on the stored figures (AC-4.6)", () => {
    const group = cases.filter((vector) => vector.group === "placement");
    expect(group.length).toBeGreaterThanOrEqual(4);
    const [first] = group;
    for (const vector of group) {
      const result = computeCosts(vector.rows);
      expect([result.oneOffCents, result.yearlyCents]).toEqual([first!.expected.oneOffCents, first!.expected.yearlyCents]);
    }
    // the group covers 0, 1, 2 and 3 total rows
    expect(group.map((vector) => vector.rows.filter((row) => row.type === "total").length).sort()).toEqual([0, 1, 2, 3]);
  });
});

describe("computeCosts", () => {
  it("uses the schema's money limit", () => {
    expect(MAX_CENTS).toBe(SCHEMA_MAX_CENTS);
  });

  it("returns errors and never throws, whatever the input", () => {
    const line = (over: Partial<Extract<CostRowIn, { type: "line" }>> = {}): CostRowIn => ({
      type: "line",
      name: "cost:x",
      kind: "one_off",
      unitCents: 1,
      percentBp: null,
      quantity: 1,
      ...over,
    });
    for (const rows of [
      [],
      [line({ unitCents: null, quantity: null })],
      [line({ kind: "discount", unitCents: null, percentBp: 1_000 })],
      [line({ kind: "discount", unitCents: 5, percentBp: 1_000 })],
      [{ type: "total", label: "" } as CostRowIn],
      [line({ unitCents: MAX_CENTS, quantity: 100_000 }), { type: "total", label: "T" } as CostRowIn],
      [line({ kind: "option", unitCents: null })],
    ]) {
      expect(() => computeCosts(rows)).not.toThrow();
    }
  });

  it("does not change its input", () => {
    const rows = JSON.parse(JSON.stringify(cases[0]!.rows)) as CostRowIn[];
    const copy = JSON.parse(JSON.stringify(rows));
    computeCosts(rows);
    expect(rows).toEqual(copy);
  });

  it("is the same for the same rows: no clock, no randomness", () => {
    for (const vector of cases) expect(computeCosts(vector.rows)).toEqual(computeCosts(vector.rows));
  });

  it("property: the stored figures never depend on where the total rows fall (amount discounts)", () => {
    let seed = 20261115;
    const next = (bound: number) => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      return seed % bound;
    };
    for (let round = 0; round < 300; round += 1) {
      const lines: CostRowIn[] = [];
      const count = 1 + next(9);
      for (let i = 0; i < count; i += 1) {
        const kind = (["one_off", "yearly", "discount", "option"] as const)[next(4)]!;
        lines.push({
          type: "line",
          name: `cost:${i}`,
          kind,
          unitCents: next(10) === 0 ? null : next(100_000),
          percentBp: null,
          quantity: 1 + next(5),
        });
      }
      const base = computeCosts(lines);
      for (let placements = 0; placements < 6; placements += 1) {
        const rows: CostRowIn[] = [];
        lines.forEach((row) => {
          if (next(3) === 0) rows.push({ type: "total", label: `T${rows.length}` });
          rows.push(row);
        });
        if (next(2) === 0) rows.push({ type: "total", label: "END" });
        const result = computeCosts(rows);
        expect([result.oneOffCents, result.yearlyCents]).toEqual([base.oneOffCents, base.yearlyCents]);
        // and a total row never prints a negative figure
        for (const row of result.rows) if (row.type === "total" && row.totalCents !== null) expect(row.totalCents).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("property: with at most one total row a percentage equals the legacy 018 arithmetic", () => {
    let seed = 7;
    const next = (bound: number) => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      return seed % bound;
    };
    for (let round = 0; round < 300; round += 1) {
      const amounts = Array.from({ length: 1 + next(4) }, () => 1 + next(10_000_000));
      const bp = 1 + next(10_000);
      const rows: CostRowIn[] = amounts.map((unitCents, i) => ({ type: "line", name: `cost:${i}`, kind: "one_off", unitCents, percentBp: null, quantity: 1 }));
      rows.push({ type: "line", name: "cost:d", kind: "discount", unitCents: null, percentBp: bp, quantity: 1 });
      if (next(2) === 0) rows.push({ type: "total", label: "T" });
      const sum = amounts.reduce((a, b) => a + b, 0);
      const discount = Number((BigInt(sum) * BigInt(bp) + 5_000n) / 10_000n);
      const result = computeCosts(rows);
      expect(result.oneOffCents).toBe(sum - discount);
      expect(result.errors).toEqual([]);
    }
  });
});

/** The 018 arithmetic as it was before the engine took it over (specs/20261102-crm-offer-document D-6, D-14), kept as the oracle. */
function legacyOracle(lines: { kind: "one_off" | "yearly" | "discount"; unitCents?: number; percentBp?: number; quantity: number }[]) {
  const max = BigInt(SCHEMA_MAX_CENTS);
  const fixed = lines.map((line, index) => {
    if (line.unitCents === undefined) return null;
    const total = BigInt(line.unitCents) * BigInt(line.quantity);
    if (total > max) throw new Error(`cost_total_too_large:${index}`);
    return total;
  });
  const oneOff = lines.reduce((sum, line, i) => (line.kind === "one_off" ? sum + fixed[i]! : sum), 0n);
  const totals = lines.map((line, i) => (line.kind === "discount" && line.percentBp !== undefined ? (oneOff * BigInt(line.percentBp) + 5_000n) / 10_000n : fixed[i]!));
  const discounts = lines.reduce((sum, line, i) => (line.kind === "discount" ? sum + totals[i]! : sum), 0n);
  if (discounts > oneOff) throw new Error("discounts_exceed_one_off");
  const yearly = lines.reduce((sum, line, i) => (line.kind === "yearly" ? sum + totals[i]! : sum), 0n);
  return { totals: totals.map(Number), oneOffCents: Number(oneOff - discounts), yearlyCents: Number(yearly) };
}

describe("the legacy adapter (src/offers/costs.ts)", () => {
  it("equals the 018 arithmetic on random legacy inputs, errors included", () => {
    let seed = 99;
    const next = (bound: number) => {
      seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
      return seed % bound;
    };
    for (let round = 0; round < 500; round += 1) {
      const lines: Parameters<typeof legacyOracle>[0] = [];
      lines.push({ kind: "one_off", unitCents: 1 + next(2_000_000), quantity: 1 + next(4) });
      for (let i = next(6); i > 0; i -= 1) {
        const kind = (["one_off", "yearly", "discount"] as const)[next(3)]!;
        if (kind === "discount" && next(2) === 0) lines.push({ kind, percentBp: 1 + next(10_000), quantity: 1 });
        else lines.push({ kind, unitCents: next(20) === 0 ? SCHEMA_MAX_CENTS : next(2_000_000), quantity: 1 + next(next(20) === 0 ? 100_000 : 4) });
      }
      let expected: ReturnType<typeof legacyOracle> | string;
      try {
        expected = legacyOracle(lines);
      } catch (error) {
        expected = (error as Error).message.split(":")[0]!;
      }
      const input = { currency: "CHF" as const, columns: { position: true, unit: true }, showTotal: true, lines: lines.map((line) => ({ description: "d", ...line })) };
      if (typeof expected === "string") {
        let code: unknown;
        try {
          legacyComputeCosts(input);
        } catch (error) {
          code = (error as { code?: string }).code;
        }
        expect(code).toBe(expected);
      } else {
        const result = legacyComputeCosts(input);
        expect(result.lines.map((line) => line.totalCents)).toEqual(expected.totals);
        expect([result.oneOffCents, result.yearlyCents]).toEqual([expected.oneOffCents, expected.yearlyCents]);
      }
    }
  });
});
