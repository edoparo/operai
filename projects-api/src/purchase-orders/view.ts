/**
 * The `PurchaseOrder` view (specs/022 T23, tasks.md § API contracts): what a project made from a won
 * deal shows of its order — the deal, live; the estimate link; the Bexio order id; the referent (T26
 * fills it, T23 answers `null`); the ops-manager, live.
 *
 * Shared by the project page (`projects.routes.ts`) and the Bexio route (`bexio.routes.ts`), which is
 * why it is not in either.
 */

import { dealsById, type CrmDeal } from "../lib/crm";
import type { Prisma } from "../lib/generated/prisma/client";
import { type HeaderSource } from "../lib/http";
import { loadPeople, type People } from "../lib/people";
import type { DealRef } from "../projects/projects.schemas";

export type PurchaseOrderRow = Prisma.PurchaseOrderGetPayload<object>;

/**
 * A lookup that never misses, for reads, the deal twin of `companyRefs`: a `DealRef` per deal id,
 * from ONE `dealsById` call however many ids are asked, and none at all for none. `title` and `won`
 * are `null` when crm-api cannot answer or no longer knows the deal (fail soft): a project must still
 * load with the CRM down (tasks.md § Decided here). `won: false` is the "no longer won" notice (AC-2.3).
 */
export async function dealRefs(
  ids: readonly (string | null | undefined)[],
): Promise<(id: string) => DealRef> {
  const wanted = ids.filter((id): id is string => typeof id === "string" && id !== "");
  let found = new Map<string, CrmDeal>();
  if (wanted.length > 0) {
    try {
      found = await dealsById(wanted);
    } catch (error) {
      console.error(
        "[crm] could not read deals — degrading them to unknown:",
        error instanceof Error ? error.message : error,
      );
    }
  }
  return (id) => {
    const deal = found.get(id);
    return { id, title: deal?.title ?? null, won: deal ? deal.stage === "won" : null };
  };
}

/** The `PurchaseOrder` of tasks.md § API contracts, from a row and the live lookups. */
export function purchaseOrderView(row: PurchaseOrderRow, deal: (id: string) => DealRef, person: People) {
  return {
    id: row.id,
    deal: deal(row.dealId),
    estimate: row.estimateId === null ? null : { id: row.estimateId },
    bexioOrderId: row.bexioOrderId,
    // T26 reads the referent live from the CRM (D49); until then none is shown, whatever id is stored.
    referent: null,
    opsManager: person(row.opsManagerId),
    version: row.version,
  };
}

/** The `PurchaseOrder` for a route that answers with it alone: the deal and the ops-manager are read live. */
export async function toPurchaseOrderView(c: HeaderSource, row: PurchaseOrderRow) {
  const [deal, people] = await Promise.all([dealRefs([row.dealId]), loadPeople(c, [row.opsManagerId])]);
  return purchaseOrderView(row, deal, people.person);
}
