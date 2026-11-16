import { describe, expect, it } from "bun:test";
import { computeRefs, evaluateCompute, parseCompute } from "./compute";
import vectors from "./vectors/compute.json";

interface Valid {
  expr: string;
  values: Record<string, string | number | null>;
  sums: Record<string, string | number | null>;
  result: string | null;
}

/** specs/20261115-crm-offer-wizard AC-4.5, AC-8.3: a derived field's expression, a closed grammar, never eval. */
describe("vectors/compute.json", () => {
  for (const vector of vectors.valid as unknown as Valid[]) {
    it(`${vector.expr.trim() || "(blank)"} with ${JSON.stringify(vector.values)} ${JSON.stringify(vector.sums)} → ${vector.result}`, () => {
      const expr = parseCompute(vector.expr);
      expect(expr).not.toBeNull();
      const result = evaluateCompute(expr!, {
        value: (name) => vector.values[name] ?? null,
        sum: (column) => vector.sums[column] ?? null,
      });
      expect(result).toBe(vector.result);
    });
  }

  for (const source of vectors.invalid) {
    it(`rejects ${JSON.stringify(source)}`, () => {
      expect(parseCompute(source)).toBeNull();
    });
  }

  for (const vector of vectors.refs) {
    it(`reads the names of ${vector.expr}`, () => {
      expect(computeRefs(parseCompute(vector.expr)!)).toEqual({ names: vector.names, sums: vector.sums });
    });
  }
});

describe("parseCompute limits", () => {
  it("refuses an expression over 200 characters", () => {
    expect(parseCompute("1 + ".repeat(60) + "1")).toBeNull();
  });

  it("refuses parentheses nested deeper than 16 instead of overflowing the stack", () => {
    expect(parseCompute("(".repeat(17) + "1" + ")".repeat(17))).toBeNull();
    expect(parseCompute("(".repeat(16) + "1" + ")".repeat(16))).not.toBeNull();
    expect(parseCompute("(".repeat(100_000))).toBeNull();
    expect(parseCompute("- ".repeat(100_000))).toBeNull();
  });

  it("the engine holds no eval and no Function constructor", async () => {
    const source = await Bun.file(new URL("./compute.ts", import.meta.url)).text();
    // the pattern is assembled so that this file does not itself match the grep of the task's done-when
    expect(new RegExp("ev" + "al\\(|new " + "Func" + "tion").test(source)).toBe(false);
  });
});
