/**
 * Rule resolution (T10, specs/20261006-hardware-inventory; AC-6.2, ADR 20261006-depreciation-derived-on-read-closed-years-snapshotted).
 *
 * An asset stores no rule. Its rule is the latest one for its entity whose
 * `effectiveFrom` is on or before its purchase date, resolved on every read
 * (the `resolveEffectiveRate` idiom of ADR 20260720-mileage-rate-model-snapshot-admin-ui-composition). A rule appended later with
 * `effectiveFrom = D` therefore changes the answer only for purchase dates
 * `>= D`, with no recomputation job. Ties on `effectiveFrom` go to the later
 * `createdAt`, then to the larger id so the answer is deterministic.
 *
 * Pure: dates are the UTC-midnight `Date`s Prisma returns for `@db.Date`.
 */

export interface RuleLike {
  readonly id: string;
  readonly entity: string;
  readonly effectiveFrom: Date;
  readonly createdAt: Date;
}

/** `a` ranks above `b` when it should win resolution. */
function outranks(a: RuleLike, b: RuleLike): boolean {
  const byFrom = a.effectiveFrom.getTime() - b.effectiveFrom.getTime();
  if (byFrom !== 0) return byFrom > 0;
  const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
  if (byCreated !== 0) return byCreated > 0;
  return a.id > b.id;
}

/** The rule in force for `entity` at `purchaseDate`, or `null` when none applies yet. */
export function resolveRule<R extends RuleLike>(
  rules: readonly R[],
  entity: string,
  purchaseDate: Date,
): R | null {
  let best: R | null = null;
  for (const rule of rules) {
    if (rule.entity !== entity) continue;
    if (rule.effectiveFrom.getTime() > purchaseDate.getTime()) continue;
    if (best === null || outranks(rule, best)) best = rule;
  }
  return best;
}
