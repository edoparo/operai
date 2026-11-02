/**
 * The `{timeline}` table of an offer (specs/020 AC-1.6, D-13): per release, the
 * elapsed working months of the best case (optimistic values) and of the worst
 * case (pessimistic values). Pure and DB-free.
 *
 * It mirrors `computeRelease` in estimai-ui's `useEstimator.ts` (AGENTS.md §
 * Estimation model), the part that yields `best` and `worst`:
 *
 *   sum        = Σ (O | P) + risk                         over the release's activities
 *   Individual = sum + QA deploy + QA test + PM
 *   Planning   = FTE × (Individual / Sprint) / 8          (0 when the sprint is 0)
 *   Baseline   = Individual + Planning
 *   Elapsed    = ROUND(Baseline × (1 − Parallelism × (FTE − 1) / FTE))
 *   Months     = Elapsed / working days per month
 *
 * Parameters fall back to the model's documented defaults when absent or not a
 * number: parallelism 0.7, sprint 10, working days 20, FTE 1, overheads 0 —
 * with `||`, exactly as the UI does, so a typed 0 also falls back.
 *
 * Differences from the UI, deliberate: an activity with only a most-likely
 * value is derived (O = ML × 0.75, P = ML × 1.60) unrounded, like `scope.ts`
 * (the UI stores the derived values rounded to one decimal in the grid); and
 * months are rounded half up once, to a whole number, from the unrounded
 * elapsed/working-days ratio. `timeline.test.ts` pins shared vectors with
 * `useEstimator.ts` (estimai-ui/src/hooks/useEstimator.test.ts).
 */

import type { EstimateDocument } from "../lib/estimai";
import type { OfferLanguage } from "./contract";
import { releaseKeyOf, roundHalfUp, type EstimateActivity } from "./scope";

export const DEFAULT_PARALLELISM = 0.7;
export const DEFAULT_SPRINT_DAYS = 10;
export const DEFAULT_WORKING_DAYS_MONTH = 20;

const num = (value: number | string | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export interface ReleaseTimeline {
  readonly name: string;
  /** Elapsed days of the best / worst case (the UI's `best` and `worst`). */
  readonly bestDays: number;
  readonly worstDays: number;
  /** Elapsed working months, rounded half up. */
  readonly bestMonths: number;
  readonly worstMonths: number;
}

interface ModelParams {
  readonly parallelism: number;
  readonly sprint: number;
  readonly workingDaysMonth: number;
  readonly overhead: number;
}

function paramsOf(estimate: EstimateDocument): ModelParams {
  const p = estimate.content.params;
  return {
    parallelism: num(p.parallelism) || DEFAULT_PARALLELISM,
    sprint: num(p.sprintDays) || DEFAULT_SPRINT_DAYS,
    workingDaysMonth: num(p.workingDaysMonth) || DEFAULT_WORKING_DAYS_MONTH,
    overhead: num(p.qaDeployDays) + num(p.qaTestDays) + num(p.pmDays),
  };
}

/** `crunch(sum).el` of the UI: elapsed days for a sum of effort, FTE and parameters. */
export function elapsedDays(effortSum: number, fte: number, params: ModelParams): number {
  const individual = effortSum + params.overhead;
  const planning = params.sprint > 0 ? (fte * (individual / params.sprint)) / 8 : 0;
  const baseline = individual + planning;
  return Math.round(baseline * (1 - params.parallelism * ((fte - 1) / fte)));
}

function optimisticPessimistic(act: EstimateActivity): { o: number; p: number } {
  const ml = num(act.ml);
  const o = num(act.o);
  const p = num(act.p);
  return o === 0 && p === 0 && ml > 0 ? { o: ml * 0.75, p: ml * 1.6 } : { o, p };
}

/** One entry per estimate release that has activities, in the estimate's order. */
export function buildTimeline(estimate: EstimateDocument): ReleaseTimeline[] {
  const params = paramsOf(estimate);
  const rows: ReleaseTimeline[] = [];
  for (const release of estimate.content.releases) {
    const acts = estimate.content.acts.filter((act) => releaseKeyOf(estimate, act) === release.id);
    if (acts.length === 0) continue;
    const fte = num(release.fte) || 1;
    const sumBest = acts.reduce((total, act) => total + optimisticPessimistic(act).o + num(act.risk), 0);
    const sumWorst = acts.reduce((total, act) => total + optimisticPessimistic(act).p + num(act.risk), 0);
    const bestDays = elapsedDays(sumBest, fte, params);
    const worstDays = elapsedDays(sumWorst, fte, params);
    rows.push({
      name: release.name || release.id,
      bestDays,
      worstDays,
      bestMonths: roundHalfUp(bestDays / params.workingDaysMonth),
      worstMonths: roundHalfUp(worstDays / params.workingDaysMonth),
    });
  }
  return rows;
}

const HEADERS = {
  it: ["Fase", "Stima mesi lavorativi"],
  en: ["Phase", "Estimated working months"],
} as const;

/** A cell of the markup table: no pipe, no line break of its own. */
const cell = (text: string): string => text.replace(/\|/g, "/").replace(/\s+/g, " ").trim();

/** The `{timeline}` markup: "5 - 6", or one number when best and worst agree. */
export function timelineTable(rows: readonly ReleaseTimeline[], language: OfferLanguage): string {
  const [phase, months] = HEADERS[language];
  const lines = [`| ${phase} | ${months} |`];
  for (const row of rows) {
    const range = row.bestMonths === row.worstMonths ? `${row.bestMonths}` : `${row.bestMonths} - ${row.worstMonths}`;
    lines.push(`| ${cell(row.name)} | ${range} |`);
  }
  return lines.join("\n");
}
