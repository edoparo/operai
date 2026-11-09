/**
 * One-off backfill of deal links into EstimAI (specs/024 AC-3.7, ADR-0076).
 *
 *   bun scripts/backfill-estimate-links.ts [--apply]
 *
 * Before specs/024, estimai-api knew nothing of which deal an estimate belongs
 * to. Run this once after both services are deployed: it sends one `linked`
 * deal-link notice per `deal_estimate` row that still holds an estimate
 * (`estimateId <> ''`), with `at` = the row's `requestedAt`.
 *
 * DRY RUN IS THE DEFAULT: it prints how many notices it would send and sends
 * nothing. `--apply` needs the client configured (`ESTIMAI_INTERNAL_URL`,
 * `SERVICE_CLIENT_ID`, `SERVICE_CLIENT_SECRET`, `AUTH_BASE_URL`) and exits 1
 * without sending if it is not. Safe to repeat: estimai-api applies a notice
 * only when it is newer than the one it holds, and a repeat is a no-op. Exit
 * code 1 also when any notice could not be delivered (re-run to retry).
 */

import { parseArgs } from "node:util";
import { db } from "../src/lib/db";
import { envDealLinkNoticeClient, type SendDealLinkNotice } from "../src/lib/estimaiNotices";

export interface Io {
  log(line: string): void;
  error(line: string): void;
}

export interface BackfillOptions {
  readonly apply: boolean;
  /** `null` when the client is not configured. */
  readonly send: SendDealLinkNotice | null;
  readonly io: Io;
}

/** Returns the process exit code: 0 ok, 1 unconfigured on --apply or a failed delivery. */
export async function runBackfill({ apply, send, io }: BackfillOptions): Promise<number> {
  const rows = await db.dealEstimate.findMany({
    where: { estimateId: { not: "" } },
    select: { dealId: true, estimateId: true, requestedAt: true },
    orderBy: { requestedAt: "asc" },
  });
  if (!apply) {
    io.log(`Dry run: ${rows.length} linked estimate(s) would be sent. Nothing was sent. Re-run with --apply.`);
    return 0;
  }
  if (send === null) {
    io.error("ESTIMAI_INTERNAL_URL / SERVICE_CLIENT_ID / SERVICE_CLIENT_SECRET are not set: nothing was sent.");
    return 1;
  }
  let sent = 0;
  const failed: string[] = [];
  for (const row of rows) {
    const ok = await send({ estimateId: row.estimateId, dealId: row.dealId, event: "linked", at: row.requestedAt.toISOString() });
    if (ok) sent++;
    else failed.push(row.dealId);
  }
  io.log(`Sent ${sent} of ${rows.length} notice(s).`);
  if (failed.length > 0) {
    io.error(`${failed.length} not delivered (deal ids: ${failed.join(", ")}). Re-run to retry; repeats are harmless.`);
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  let apply = false;
  try {
    ({
      values: { apply },
    } = parseArgs({ args: process.argv.slice(2), strict: true, options: { apply: { type: "boolean", default: false } } }) as { values: { apply: boolean } });
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : "bad arguments"}\nUsage: bun scripts/backfill-estimate-links.ts [--apply]`);
    process.exit(2);
  }
  const { dealLinkNoticesConfigured } = await import("../src/lib/estimaiNotices");
  const code = await runBackfill({
    apply,
    send: dealLinkNoticesConfigured ? envDealLinkNoticeClient : null,
    io: { log: (l) => console.log(l), error: (l) => console.error(l) },
  });
  await db.$disconnect();
  process.exit(code);
}
