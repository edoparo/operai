/**
 * Deal stages and pipeline arithmetic (specs/017-crm, spec § Domain language;
 * decisions D-8, D-9, D-10). Pure: no DB, no clock except where passed in.
 */

export const DEAL_STAGES = ["lead", "qualified", "proposal", "negotiation", "won", "lost"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const OPEN_STAGES = ["lead", "qualified", "proposal", "negotiation"] as const satisfies readonly DealStage[];
export const CLOSED_STAGES = ["won", "lost"] as const satisfies readonly DealStage[];

export const isOpenStage = (stage: DealStage): boolean =>
  (OPEN_STAGES as readonly DealStage[]).includes(stage);

/** Win probability per stage, in percent (D-8). Returned by GET /pipeline so the UI never copies it. */
export const STAGE_PROBABILITY: Readonly<Record<DealStage, number>> = {
  lead: 10,
  qualified: 25,
  proposal: 50,
  negotiation: 75,
  won: 100,
  lost: 0,
};

/**
 * `amount × probability / 100`, rounded half up, exactly once per deal (D-9,
 * ADR-0025's one-rule posture). Integer arithmetic on BigInt so no float ever
 * touches money; amounts are ≥ 0, so "half up" and "half away from zero" agree.
 */
export function weightedCents(amountCents: bigint, stage: DealStage): bigint {
  const numerator = amountCents * BigInt(STAGE_PROBABILITY[stage]);
  return (numerator + 50n) / 100n;
}

/** The fields a stage move writes (AC-3.3). */
export function stageTransition(
  stage: DealStage,
  lostReason: string | null | undefined,
  now: Date,
  previous: { readonly stage: DealStage; readonly closedAt: Date | null },
): { stage: DealStage; closedAt: Date | null; lostReason: string | null } {
  if (isOpenStage(stage)) return { stage, closedAt: null, lostReason: null };
  // Re-saving the same closed stage keeps the original closing moment.
  const closedAt = previous.stage === stage && previous.closedAt ? previous.closedAt : now;
  return { stage, closedAt, lostReason: stage === "lost" ? (lostReason ?? null) : null };
}

export interface PipelineDeal {
  readonly stage: DealStage;
  readonly currency: "CHF" | "EUR";
  readonly amountCents: bigint;
}

export interface StageTotals {
  stage: DealStage;
  count: number;
  totals: { currency: "CHF" | "EUR"; amountCents: number; weightedCents: number }[];
}

/**
 * Groups deals by stage and currency (never summing currencies together,
 * AC-3.4). The caller decides which deals are in (open ones, plus won/lost
 * closed in the year). One entry per stage, in stage order; currencies in a
 * fixed order (CHF, EUR) and only when present.
 */
export function summarisePipeline(deals: readonly PipelineDeal[]): StageTotals[] {
  return DEAL_STAGES.map((stage) => {
    const ofStage = deals.filter((deal) => deal.stage === stage);
    const totals = (["CHF", "EUR"] as const).flatMap((currency) => {
      const ofCurrency = ofStage.filter((deal) => deal.currency === currency);
      if (ofCurrency.length === 0) return [];
      const amount = ofCurrency.reduce((sum, deal) => sum + deal.amountCents, 0n);
      const weighted = ofCurrency.reduce((sum, deal) => sum + weightedCents(deal.amountCents, deal.stage), 0n);
      return [{ currency, amountCents: Number(amount), weightedCents: Number(weighted) }];
    });
    return { stage, count: ofStage.length, totals };
  });
}
