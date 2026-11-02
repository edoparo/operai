import { describe, expect, it } from "bun:test";
import type { EstimateDocument } from "../lib/estimai";
import { buildTimeline, elapsedDays, timelineTable } from "./timeline";

/**
 * Shared vectors with estimai-ui's `computeRelease` (AGENTS.md § Estimation
 * model): estimai-ui/src/hooks/useEstimator.test.ts asserts the SAME best/worst
 * elapsed days from the same inputs. If the elapsed chain changes, change both.
 */
type Act = EstimateDocument["content"]["acts"][number];
const act = (o: number, ml: number, p: number, risk = 0, release = "R"): Act => ({ id: "a", epic: "E", o, ml, p, risk, release });
const estimate = (
  acts: Act[],
  fte: number | string,
  params: EstimateDocument["content"]["params"] = {},
): EstimateDocument => ({
  id: "e",
  name: "E",
  content: { params, releases: [{ id: "r", name: "R", fte }], acts },
});
const days = (doc: EstimateDocument) => {
  const [row] = buildTimeline(doc);
  return { best: row!.bestDays, worst: row!.worstDays };
};
const FULL = { parallelism: 0.7, sprintDays: 10, workingDaysMonth: 20, qaDeployDays: 0, qaTestDays: 0, pmDays: 0 };

describe("timeline: the estimate model's elapsed chain (specs/020 D-13)", () => {
  it("vector 1: 2 FTE with QA and PM overhead", () => {
    const doc = estimate([act(2, 4, 9, 0.5), act(3, 5, 8), act(10, 20, 40, 2)], 2, { ...FULL, qaDeployDays: 1, qaTestDays: 1, pmDays: 2 });
    expect(days(doc)).toEqual({ best: 14, worst: 42 });
  });

  it("vector 2: one FTE, no parallelism effect", () => {
    expect(days(estimate([act(5, 10, 20, 1), act(1, 2, 3)], 1, FULL))).toEqual({ best: 7, worst: 24 });
  });

  it("vector 3: 3 FTE, parallelism 0.5, sprint 5, 21 working days", () => {
    const doc = estimate([act(20, 30, 50, 3), act(15, 25, 45), act(8, 12, 20, 1)], 3, {
      ...FULL,
      parallelism: 0.5,
      sprintDays: 5,
      workingDaysMonth: 21,
    });
    expect(days(doc)).toEqual({ best: 34, worst: 85 });
    const [row] = buildTimeline(doc);
    // 34 / 21 = 1.62 → 2 ; 85 / 21 = 4.05 → 4
    expect([row!.bestMonths, row!.worstMonths]).toEqual([2, 4]);
  });

  it("vector 4: parameters left out fall back to 0.7 / 10 / 20 and one FTE; months round half up", () => {
    const doc = estimate([act(10, 20, 30)], 0, {});
    expect(days(doc)).toEqual({ best: 10, worst: 30 });
    const [row] = buildTimeline(doc);
    // 10 / 20 = 0.5 → 1 ; 30 / 20 = 1.5 → 2
    expect([row!.bestMonths, row!.worstMonths]).toEqual([1, 2]);
  });

  it("reads parameters the grid stored as strings, and a release by name or id", () => {
    const doc = estimate([act(5, 10, 20, 1, "R"), act(1, 2, 3, 0, "r")], "1", {
      parallelism: "0.7",
      sprintDays: "10",
      workingDaysMonth: "20",
    });
    expect(days(doc)).toEqual({ best: 7, worst: 24 });
  });

  it("an activity with only a most-likely value is derived as O = ML × 0.75, P = ML × 1.60", () => {
    // 10 → O 7.5, P 16: sums 7.5 / 16 (+ planning) → 8 / 16 days, one FTE.
    expect(days(estimate([{ id: "a", ml: 10, release: "R" }], 1, FULL))).toEqual({ best: 8, worst: 16 });
  });

  it("elapsedDays is the chain on its own", () => {
    expect(elapsedDays(47, 3, { parallelism: 0.5, sprint: 5, workingDaysMonth: 21, overhead: 0 })).toBe(34);
  });

  it("skips releases with no activities", () => {
    const doc = estimate([act(1, 2, 3)], 1, FULL);
    doc.content.releases.push({ id: "r2", name: "Empty", fte: 1 });
    expect(buildTimeline(doc).map((row) => row.name)).toEqual(["R"]);
  });
});

describe("timelineTable", () => {
  const rows = [
    { name: "Phase 1", bestDays: 80, worstDays: 120, bestMonths: 4, worstMonths: 6 },
    { name: "Phase | 2", bestDays: 80, worstDays: 85, bestMonths: 4, worstMonths: 4 },
  ];

  it("prints a range, or one number when best and worst agree", () => {
    expect(timelineTable(rows, "it")).toBe(
      ["| Fase | Stima mesi lavorativi |", "| Phase 1 | 4 - 6 |", "| Phase / 2 | 4 |"].join("\n"),
    );
    expect(timelineTable(rows, "en").split("\n")[0]).toBe("| Phase | Estimated working months |");
  });
});
