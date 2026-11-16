/**
 * A stand-in for crm-api, run as a process by `isolatedPdfCheck.test.ts` (security L-15): it starts one check whose child loops for
 * ever, prints the child's pid as a JSON array on one line, and stays alive until it is signalled. argv[2] is the child's own
 * deadline in ms. The tests end this process with SIGTERM, SIGINT and SIGKILL and watch what becomes of the child.
 */

import { checkLetterheadIsolated, liveChildPids } from "../entity-profiles/isolatedPdfCheck";

const worker = new URL("./pdfWorkers.ts", import.meta.url).pathname;
void checkLetterheadIsolated(new TextEncoder().encode("spin"), { worker, limits: { timeoutMs: 120_000 }, hardDeadlineMs: Number(process.argv[2]) }).catch(() => {});
while (liveChildPids().length === 0) await Bun.sleep(10);
console.log(JSON.stringify(liveChildPids()));
setInterval(() => {}, 1_000);
