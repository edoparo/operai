#!/usr/bin/env bun
/**
 * Latency of letterhead-api's render routes for a 10-page offer: 50 sequential renders as a preview and 50 as a PDF,
 * with a service credential (specs/20261116-letterhead-service, T13 locally, T40 on the deployed service).
 *
 *   AC-1.9   preview of 10 pages, p95 < 1 s     (POST /v1/render/preview, every page: PNG and text)
 *   AC-1.10  PDF of 10 pages,     p95 < 3 s     (POST /v1/render/pdf)
 *
 * The document is the golden corpus's `offer-it` (`engine/tests/golden/fixtures/offer-it.json`, 4 pages) with its blocks
 * repeated, and cut at the first block that makes the layout reach exactly 10 pages. The cut is found by asking the
 * service itself (a preview of page 1 reports the page count), so the document is the one THIS layout needs. The
 * script prints the block count and the SHA-256 of the request body: two runs with the same digest measured the same
 * document.
 *
 * What is timed: the client's wall clock from sending the request to having read the whole answer (the JSON of a
 * preview is not parsed inside the timed section). Runs are sequential, one connection, after `--warmup` renders that
 * are not counted (the first render reads the logos from the bucket; the supervisor keeps them afterwards). The first
 * warm-up's time is printed on its own. Percentiles are nearest-rank over the sorted samples: p50 = the 25th and
 * p95 = the 48th of 50. Every answer is checked (200; preview and PDF both report 10 pages): a run that is not an
 * answer for the 10-page document aborts and prints nothing that looks like a result.
 *
 * The credential (`auth.ts`): `--auth-url <auth base URL>` with LETTERHEAD_PERF_CLIENT_ID and
 * LETTERHEAD_PERF_CLIENT_SECRET in the environment (deployed, T40), or `--local-auth` (a JWKS this script serves).
 *
 *   bun letterhead-api/perf/render-perf.ts --base-url http://localhost:18088 --local-auth \
 *     --issuer http://localhost:3001 --audience operai-service --jwks-port 18089 --json out.json
 *
 * Exit code: 0 when both budgets hold, 3 when one is missed (the numbers are printed either way), 1 on any error.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { arg, fail, tokenSourceFromArgs } from "./auth.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "engine", "tests", "golden", "fixtures", "offer-it.json");

const BUDGET_PREVIEW_MS = 1000; // AC-1.9
const BUDGET_PDF_MS = 3000; // AC-1.10
const TARGET_PAGES = 10;

// --- arguments and the credential ----------------------------------------------------------------------------

const baseUrl = (arg("base-url") ?? fail("--base-url is required")).replace(/\/+$/, "");
const runs = Number(arg("runs", "50"));
const warmup = Number(arg("warmup", "2"));
const jsonOut = arg("json");
if (!Number.isInteger(runs) || runs < 1) fail("--runs must be a positive integer");
if (!Number.isInteger(warmup) || warmup < 1) fail("--warmup must be a positive integer (the first render is the cold one)");

const auth = await tokenSourceFromArgs();

// --- the document --------------------------------------------------------------------------------------------

const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
const base = fixture.request;
const body = (blocks: unknown[]) => JSON.stringify({ ...base, blocks });
const cycle = (n: number): unknown[] => Array.from({ length: n }, (_, i) => base.blocks[i % base.blocks.length]);

async function post(path: string, payload: string): Promise<Response> {
  return fetch(baseUrl + path, {
    method: "POST",
    headers: { authorization: `Bearer ${await auth.token()}`, "content-type": "application/json" },
    body: payload,
  });
}

async function problemCode(res: Response): Promise<string> {
  try {
    return String(((await res.json()) as { code?: unknown }).code ?? "no code");
  } catch {
    return "unreadable body";
  }
}

/** The number of pages `n` blocks lay out to (a preview of page 1 only: the count is in every preview). */
async function pagesOf(n: number): Promise<number> {
  const res = await post("/v1/render/preview?pages=1", body(cycle(n)));
  if (!res.ok) {
    const hint = res.status === 401 ? " (with --local-auth: the service refreshes its key set at most every 30 s, so wait 30 s after a run)" : "";
    fail(`calibration: preview answered HTTP ${res.status} (${await problemCode(res)})${hint}`);
  }
  return ((await res.json()) as { pageCount: number }).pageCount;
}

// The smallest prefix of the repeated offer that reaches TARGET_PAGES (page count never falls as blocks are added).
let lo = 1;
let hi = base.blocks.length * 8;
if ((await pagesOf(hi)) < TARGET_PAGES) fail(`${hi} blocks do not reach ${TARGET_PAGES} pages`);
while (lo < hi) {
  const mid = (lo + hi) >> 1;
  if ((await pagesOf(mid)) >= TARGET_PAGES) hi = mid;
  else lo = mid + 1;
}
const blockCount = lo;
const payload = body(cycle(blockCount));
if ((await pagesOf(blockCount)) !== TARGET_PAGES) fail(`no prefix of the offer lays out to exactly ${TARGET_PAGES} pages`);
const digest = createHash("sha256").update(payload).digest("hex");
console.log(`document: offer-it x ${(blockCount / base.blocks.length).toFixed(2)} (${blockCount} blocks), ${TARGET_PAGES} pages, ${payload.length} bytes, sha256 ${digest.slice(0, 16)}`);

// --- the measurement -------------------------------------------------------------------------------------------

type Series = { name: string; route: string; budgetMs: number; samples: number[]; coldMs: number; answerBytes: number };

async function measure(name: string, route: string, budgetMs: number): Promise<Series> {
  const render = async (): Promise<{ ms: number; bytes: number }> => {
    const started = performance.now();
    const res = await post(route, payload);
    const bytes = await res.arrayBuffer();
    const ms = performance.now() - started;
    if (res.status !== 200) fail(`${name}: HTTP ${res.status} (${new TextDecoder().decode(bytes).match(/"code":"([a-z_]+)"/)?.[1] ?? "no code"})`);
    const pages = route.endsWith("/pdf")
      ? Number(res.headers.get("page-count"))
      : (JSON.parse(new TextDecoder().decode(bytes)) as { pageCount: number }).pageCount;
    if (pages !== TARGET_PAGES) fail(`${name}: the answer has ${pages} pages, not ${TARGET_PAGES}`);
    if (route.endsWith("/pdf") && new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") fail(`${name}: the answer is not a PDF`);
    return { ms, bytes: bytes.byteLength };
  };
  const cold = await render();
  for (let i = 1; i < warmup; i++) await render();
  const samples: number[] = [];
  let answerBytes = cold.bytes;
  for (let i = 0; i < runs; i++) {
    const r = await render();
    samples.push(r.ms);
    answerBytes = r.bytes;
  }
  return { name, route, budgetMs, samples, coldMs: cold.ms, answerBytes };
}

const rank = (sorted: number[], p: number) => sorted[Math.ceil((p / 100) * sorted.length) - 1];
function summary(s: Series) {
  const sorted = [...s.samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    name: s.name,
    runs: sorted.length,
    cold_ms: Math.round(s.coldMs),
    min_ms: Math.round(sorted[0]),
    p50_ms: Math.round(rank(sorted, 50)),
    p95_ms: Math.round(rank(sorted, 95)),
    max_ms: Math.round(sorted[sorted.length - 1]),
    mean_ms: Math.round(sum / sorted.length),
    answer_bytes: s.answerBytes,
    budget_ms: s.budgetMs,
    within_budget: rank(sorted, 95) < s.budgetMs,
  };
}

const startedAt = new Date().toISOString();
const preview = await measure("preview (10 pages: PNG and text of every page)", "/v1/render/preview", BUDGET_PREVIEW_MS);
const pdf = await measure("pdf (10 pages)", "/v1/render/pdf", BUDGET_PDF_MS);
auth.stop();

const results = [summary(preview), summary(pdf)];
console.log("");
console.log("series".padEnd(48), "n".padStart(3), "cold".padStart(6), "min".padStart(6), "p50".padStart(6), "p95".padStart(6), "max".padStart(6), "bytes".padStart(9), " budget");
for (const r of results) {
  console.log(
    r.name.padEnd(48),
    String(r.runs).padStart(3),
    String(r.cold_ms).padStart(6),
    String(r.min_ms).padStart(6),
    String(r.p50_ms).padStart(6),
    String(r.p95_ms).padStart(6),
    String(r.max_ms).padStart(6),
    String(r.answer_bytes).padStart(9),
    ` p95 < ${r.budget_ms} ms: ${r.within_budget ? "yes" : "NO"}`,
  );
}
console.log("(milliseconds, client wall clock; cold = the first render, then warm-up renders are not counted)");

if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify({ startedAt, baseUrl, document: { fixture: "offer-it", blocks: blockCount, pages: TARGET_PAGES, bytes: payload.length, sha256: digest }, results, samples_ms: { preview: preview.samples, pdf: pdf.samples } }, null, 2) + "\n",
  );
  console.log(`written: ${jsonOut}`);
}
process.exit(results.every((r) => r.within_budget) ? 0 : 3);
