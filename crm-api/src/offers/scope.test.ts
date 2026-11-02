import { describe, expect, it } from "bun:test";
import { buildScope, expectedOf, pert } from "./scope";
import { formatManDays, formatPrice, winAnsi } from "./pdf";
import type { EstimateDocument } from "../lib/estimai";

/**
 * Shared vectors with estimai-ui's `pertCalc` / `deriveOP` (AGENTS.md §
 * Estimation model): if EstimAI's arithmetic changes, these must change too.
 */
describe("offer scope arithmetic (specs/018 AC-4.1)", () => {
  const options = { aiAssisted: false, globalAiGain: 0.3 };

  it("PERT and Expected = PERT + risk", () => {
    expect(pert(2, 4, 9)).toBe(4.5);
    expect(expectedOf({ id: "a", o: 2, ml: 4, p: 9, risk: 0.5 }, options)).toBe(5);
    // Values typed as strings in the grid.
    expect(expectedOf({ id: "a", o: "2", ml: "4", p: "9", risk: "0.5" }, options)).toBe(5);
  });

  it("only ML given → O = ML × 0.75, P = ML × 1.60", () => {
    expect(expectedOf({ id: "a", ml: 10 }, options)).toBeCloseTo((7.5 + 40 + 16) / 6, 10);
  });

  it("AI-assisted uses the activity's gain, else the global one", () => {
    const act = { id: "a", o: 2, ml: 4, p: 9, risk: 0.5 };
    expect(expectedOf(act, { aiAssisted: true, globalAiGain: 0.3 })).toBeCloseTo(3.5, 10);
    expect(expectedOf({ ...act, aiGain: 0.5 }, { aiAssisted: true, globalAiGain: 0.3 })).toBeCloseTo(2.5, 10);
  });

  it("groups by release (estimate order) and epic (first seen), rounding once per line", () => {
    const estimate: EstimateDocument = {
      id: "e",
      name: "E",
      content: {
        params: { aiGain: "0.3" },
        releases: [
          { id: "r2", name: "Release 2" },
          { id: "r1", name: "MVP" },
        ],
        acts: [
          { id: "1", epic: "Auth", ml: 1, o: 1, p: 1, release: "r1" }, // 1.0
          { id: "2", epic: "Auth", ml: 10, release: "r1" }, // 10.583…
          { id: "3", epic: "Reports", o: 2, ml: 4, p: 9, risk: 0.5, release: "r2" }, // 5.0
          { id: "4", epic: "", ml: 1, o: 1, p: 1, release: "missing" }, // 1.0, unassigned
        ],
      },
    };
    const scope = buildScope(estimate, { aiAssisted: false, unassignedLabel: "Other", noEpicLabel: "General" });
    expect(scope.releases.map((r) => r.name)).toEqual(["Release 2", "MVP", "Other"]);
    expect(scope.releases[1]).toEqual({ name: "MVP", epics: [{ epic: "Auth", manDaysTenths: 116 }], manDaysTenths: 116 });
    expect(scope.releases[2]!.epics[0]).toEqual({ epic: "General", manDaysTenths: 10 });
    // 1 + 10.5833 + 5 + 1 = 17.5833 → 176 tenths (summed unrounded).
    expect(scope.manDaysTenths).toBe(176);
  });
});

describe("offer PDF formatting", () => {
  it("formats prices from integer cents, per currency", () => {
    expect(formatPrice(8_500_050, "CHF")).toBe("CHF 85'000.50");
    expect(formatPrice(8_500_050, "EUR")).toBe("EUR 85.000,50");
    expect(formatPrice(5, "CHF")).toBe("CHF 0.05");
  });

  it("formats man-days per language", () => {
    expect(formatManDays(116, "en")).toBe("11.6");
    expect(formatManDays(116, "it")).toBe("11,6");
  });

  it("keeps what Helvetica can draw and replaces the rest", () => {
    expect(winAnsi("Società — €5 “ok”")).toBe("Società — €5 “ok”");
    expect(winAnsi("Zürich 北京 ✓")).toBe("Zürich ?? ?");
  });
});
