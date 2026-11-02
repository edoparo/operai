/**
 * Company relationship status automations (specs/017 O2, resolved 2026-11-02).
 *
 * - Won → customer is WRITTEN when a deal moves to `won` (deals.routes): a
 *   prospect or former client that wins a deal becomes a customer.
 * - Inactive → former is DERIVED ON READ, never written by a sweep (ADR-0013): a
 *   stored `customer` with at least one won deal, none won in the last
 *   LAPSE_MONTHS months and no open deal reads as `former`. A customer with no
 *   won deal at all (set by hand) keeps its status: there is nothing to lapse.
 */

import { OPEN_STAGES } from "../deals/stages";
import type { Prisma } from "../lib/generated/prisma/client";

export const LAPSE_MONTHS = 12;

export type CompanyStatus = "prospect" | "customer" | "former";

/** The statuses a deal moving to `won` promotes to `customer`. */
export const PROMOTED_ON_WIN: readonly CompanyStatus[] = ["prospect", "former"];

/** A won deal closed before this moment no longer keeps a customer active. */
export function lapseCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - LAPSE_MONTHS);
  return cutoff;
}

export interface StatusFacts {
  readonly status: CompanyStatus;
  readonly openDealCount: number;
  /** `closedAt` of the most recent won deal, or null when it never won one. */
  readonly lastWonAt: Date | null;
}

export function isLapsed(facts: StatusFacts, now: Date): boolean {
  return (
    facts.status === "customer" &&
    facts.openDealCount === 0 &&
    facts.lastWonAt !== null &&
    facts.lastWonAt < lapseCutoff(now)
  );
}

export function effectiveStatus(facts: StatusFacts, now: Date): CompanyStatus {
  return isLapsed(facts, now) ? "former" : facts.status;
}

/**
 * The `where` for a list filtered by EFFECTIVE status, the same rule as
 * `isLapsed` in SQL terms. A won deal without `closedAt` cannot happen (the
 * stage move always sets it), so `closedAt: { gte }` is the whole "recent" test.
 */
export function statusWhere(status: CompanyStatus, now: Date): Prisma.CompanyWhereInput {
  const keepsActive: Prisma.DealWhereInput = {
    OR: [{ stage: { in: [...OPEN_STAGES] } }, { stage: "won", closedAt: { gte: lapseCutoff(now) } }],
  };
  const lapsed: Prisma.CompanyWhereInput = {
    status: "customer",
    AND: [{ deals: { some: { stage: "won" } } }, { deals: { none: keepsActive } }],
  };
  switch (status) {
    case "prospect":
      return { status: "prospect" };
    case "former":
      return { OR: [{ status: "former" }, lapsed] };
    case "customer":
      return { status: "customer", NOT: lapsed };
  }
}

/** Included with every company read: the latest won deal's closing moment. */
export const lastWon = {
  deals: {
    // `not: null` because Postgres sorts nulls first in a descending order.
    where: { stage: "won", closedAt: { not: null } },
    select: { closedAt: true },
    orderBy: { closedAt: "desc" },
    take: 1,
  },
} satisfies Prisma.CompanyInclude;
