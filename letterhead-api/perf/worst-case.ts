#!/usr/bin/env bun
/**
 * Does the container's memory limit hold the render pool's worst case? (specs/20261116-letterhead-service, T13; plan F4,
 * ADR 20261116-renders-run-in-killable-worker-processes-and-concurrency-is-bounded-by-memory.)
 *
 * `.railway/railway.ts` sizes the service (5 GB) for `LH_WORKERS` (2) x 2 GiB of worker memory (the default
 * `LH_WORKER_RSS_MB`, 2048; T46) plus the supervisor. The worst request the service accepts (AC-3.3) is a table of about
 * 5 000 blocks (spike: 1 660 rows x 3 cells, 220 pages, ~855 MiB; a table of the most blocks that comes to just over 300
 * pages peaks a worker at about 1.53 GiB on Linux, see the README of the service, "Memory of a render"). This sends
 * `--concurrency` (default: 2, the pool) of them at once, as previews (every page rasterised: the heaviest answer) or as PDFs (`--pdf`), and reports each answer's status, the page count and the time. With the
 * service in a container started with `--memory`, run it and then read the container's peak
 * (`cat /sys/fs/cgroup/memory.peak` inside it) and check that it was not OOM-killed (`docker inspect -f '{{.State.OOMKilled}}'`).
 *
 * It is a load test of the limit, not of latency: use `render-perf.ts` for the figures of AC-1.9 and AC-1.10.
 *
 *   bun letterhead-api/perf/worst-case.ts --base-url http://localhost:18088 --local-auth \
 *     --issuer http://localhost:3001 --audience operai-service --jwks-port 18089
 */
import { arg, flag, tokenSourceFromArgs, fail } from "./auth.ts";

const baseUrl = (arg("base-url") ?? fail("--base-url is required")).replace(/\/+$/, "");
const concurrency = Number(arg("concurrency", "2"));
const rows = Number(arg("rows", "1660"));
// The spike's table drew 220 pages from 1 660 rows, so its rows were several lines tall: a middle cell this long
// does that in a column that is 3/10 of the body width. `--detail-chars` takes a list (`100,130,150`) to sweep it. The
// page count is printed; the service refuses 300 (AC-3.3).
const detailChars = (arg("detail-chars", "130") as string).split(",").map(Number);
const route = flag("pdf") ? "/v1/render/pdf" : "/v1/render/preview";
if (!Number.isInteger(concurrency) || concurrency < 1) fail("--concurrency must be a positive integer");

const cell = (text: string) => [{ type: "paragraph", runs: [{ text }] }];

/** 3 cells a row: 1 + 3 x (rows + 1 header) blocks, 4 984 for the default 1 660 (the limit is 5 000). */
function payloadFor(detail: number): string {
  const table = {
    type: "table",
    columns: [5, 3, 2],
    header: [cell("Voce"), cell("Dettaglio"), cell("Importo")],
    rows: Array.from({ length: rows }, (_, i) => [
      cell(`Voce ${i + 1}`),
      cell(`Dettaglio della voce ${i + 1}: ${"descrizione dell'attivita svolta ".repeat(8)}`.slice(0, detail)),
      cell(`${i + 1}.00`),
    ]),
  };
  return JSON.stringify({
    contentVersion: 1,
    entity: "welld_it",
    language: "it",
    entityData: { legalName: "WellD Italia S.r.l. (SAMPLE)", addressLines: ["Via Esempio 1", "I-16100 Genova (Italia)"], vat: "IT00000000000", iban: "", contacts: "www.example.com" },
    blocks: [table],
  });
}

const auth = await tokenSourceFromArgs();
const token = await auth.token();

const one = async (payload: string, n: number) => {
  const started = performance.now();
  const res = await fetch(baseUrl + route, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: payload,
  });
  const bytes = await res.arrayBuffer();
  const ms = Math.round(performance.now() - started);
  const text = new TextDecoder().decode(bytes);
  const pages = route.endsWith("/pdf") ? res.headers.get("page-count") : String((JSON.parse(res.ok ? text : "{}") as { pageCount?: number }).pageCount ?? "-");
  const code = res.ok ? "ok" : (text.match(/"code":"([a-z_]+)"/)?.[1] ?? "no code");
  console.log(`  #${n}: HTTP ${res.status} ${code}, pages ${pages}, ${(bytes.byteLength / 1048576).toFixed(1)} MiB answer, ${ms} ms`);
  return res.status;
};

let allOk = true;
for (const detail of detailChars) {
  const payload = payloadFor(detail);
  console.log(`document: ${rows} rows x 3 cells (${1 + 3 * (rows + 1)} blocks), middle cell ${detail} chars, ${(payload.length / 1024).toFixed(0)} KiB, ${route}, ${concurrency} at once`);
  const statuses = await Promise.all(Array.from({ length: concurrency }, (_, i) => one(payload, i + 1)));
  allOk &&= statuses.every((s) => s === 200);
}
auth.stop();
process.exit(allOk ? 0 : 3);
