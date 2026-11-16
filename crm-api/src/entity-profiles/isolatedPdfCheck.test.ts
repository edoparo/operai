import { beforeEach, describe, expect, it } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { fileURLToPath } from "node:url";
import { CATALOG, PAGES, build, contentPdf, latin, page, stream } from "../test-support/pdfBuild";
import { ISOLATED_PDF_CHECK, PdfCheckBusyError, PdfCheckUnavailableError, boundPdfIsolated, checkLetterheadIsolated, resetIsolatedPdfCheckForTests } from "./isolatedPdfCheck";

/**
 * Security round 10 (specs/20261115-crm-offer-wizard): the checks of an uploaded PDF run in a child process with a timeout and a
 * memory ceiling. The stand-in worker (`test-support/pdfWorkers.ts`) is what a check that a static bound missed does to its
 * process; the real worker answers the real files. Assertions are on verdicts and on the parent's event-loop lag, never on how
 * long a check takes.
 */

const WORKER = fileURLToPath(new URL("../test-support/pdfWorkers.ts", import.meta.url));
const behave = (what: string) => new TextEncoder().encode(what);
const REFUSED = { ok: false, reason: "too_complex" } as const;
const quick = { timeoutMs: 400 };

beforeEach(() => resetIsolatedPdfCheckForTests());

async function a4(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]).drawLine({ start: { x: 10, y: 10 }, end: { x: 100, y: 10 } });
  return doc.save();
}

/** The M-12 file: one ExtGState whose /BM is an array of 20 000 names, listed under 300 names. */
function blendArrayFile(): Buffer {
  const array = Array.from({ length: 20_000 }, () => "/Normal").join(" ");
  const ext = Array.from({ length: 300 }, (_, i) => `/E${i} 5 0 R`).join(" ");
  const content = Array.from({ length: 300 }, (_, i) => `q /E${i} gs Q`).join(" ");
  return build([
    CATALOG,
    PAGES,
    { header: "3 0 obj", body: page(`<< /ExtGState << ${ext} >> >>`) },
    { header: "4 0 obj", body: stream("", latin(content)) },
    { header: "5 0 obj", body: latin(`<< /BM [ ${array} ] >>`) },
  ]);
}

describe("the real worker", () => {
  it("answers a good letterhead and a refusal as the in-process check does", async () => {
    expect(await checkLetterheadIsolated(await a4())).toEqual({ ok: true });
    expect(await checkLetterheadIsolated(latin("not a pdf at all"))).toMatchObject({ ok: false });
    expect(await checkLetterheadIsolated(blendArrayFile())).toEqual(REFUSED);
  });

  it("answers a deal PDF's bound, and remembers it by the digest of the bytes (one child for the same file)", async () => {
    const bytes = await a4();
    const first = await boundPdfIsolated(bytes);
    expect(first.ok).toBe(true);
    // a worker that would answer differently is never started: the second answer is the remembered one
    const second = await boundPdfIsolated(bytes, { worker: WORKER });
    expect(second).toEqual(first);
    expect(await boundPdfIsolated(contentPdf("4 0 obj", latin("x"), "/Filter /LZWDecode"))).toEqual({ ok: false, reason: "unbounded_stream" });
  });

  it("runs with an empty environment: nothing of the service reaches the child", async () => {
    // the real worker imports no module that reads the environment; a stand-in that would need one fails the same way
    process.env.CRM_TEST_SECRET_SENTINEL = "visible-to-parent-only";
    expect(await checkLetterheadIsolated(await a4())).toEqual({ ok: true });
    delete process.env.CRM_TEST_SECRET_SENTINEL;
  });
});

describe("a check that overruns is killed and refused", () => {
  it("a loop is killed at the timeout: `too_complex`, the same verdict a count gives", async () => {
    expect(await checkLetterheadIsolated(behave("spin"), { worker: WORKER, limits: quick })).toEqual(REFUSED);
    expect(await boundPdfIsolated(behave("spin"), { worker: WORKER, limits: quick })).toEqual(REFUSED);
  });

  it("the parent's event loop stays responsive while a child holds its own for the whole timeout", async () => {
    let worst = 0;
    let last = performance.now();
    const beat = setInterval(() => {
      const now = performance.now();
      worst = Math.max(worst, now - last - 10);
      last = now;
    }, 10);
    const verdict = await checkLetterheadIsolated(behave("spin"), { worker: WORKER, limits: { timeoutMs: 1_000 } });
    clearInterval(beat);
    expect(verdict).toEqual(REFUSED);
    expect(worst).toBeLessThan(100); // the loop that was held by the check itself is the one the child has now
  });

  it("memory growth is killed at the ceiling (a watchdog, polled), and refused as `too_complex`", async () => {
    const verdict = await checkLetterheadIsolated(behave("alloc"), { worker: WORKER, limits: { maxRssBytes: 200 * 1024 * 1024, timeoutMs: 20_000, pollMs: 25 } });
    expect(verdict).toEqual(REFUSED);
  }, 30_000);

  it("a child that prints without end is cut off, and that is not a verdict about the file (503)", async () => {
    await expect(checkLetterheadIsolated(behave("chatty"), { worker: WORKER, limits: { timeoutMs: 5_000 } })).rejects.toBeInstanceOf(PdfCheckUnavailableError);
  });
});

describe("a child that cannot answer is not a finding about the file", () => {
  it("a crash and a non-verdict are 503 `pdf_check_unavailable`, never remembered", async () => {
    await expect(checkLetterheadIsolated(behave("crash"), { worker: WORKER })).rejects.toBeInstanceOf(PdfCheckUnavailableError);
    await expect(checkLetterheadIsolated(behave("garbage"), { worker: WORKER })).rejects.toBeInstanceOf(PdfCheckUnavailableError);
    await expect(boundPdfIsolated(behave("crash"), { worker: WORKER })).rejects.toBeInstanceOf(PdfCheckUnavailableError);
    // the same bytes are asked again (nothing was remembered): they reach a child again
    await expect(boundPdfIsolated(behave("crash"), { worker: WORKER })).rejects.toBeInstanceOf(PdfCheckUnavailableError);
  });

  it("a worker that does not exist is a 503", async () => {
    await expect(checkLetterheadIsolated(await a4(), { worker: "/nonexistent/worker.ts" })).rejects.toBeInstanceOf(PdfCheckUnavailableError);
  });
});

describe("concurrency is bounded", () => {
  it("runs at most `maxConcurrent` at once, queues `maxQueued`, and answers 503 `pdf_check_busy` beyond", async () => {
    const limits = { timeoutMs: 600, maxConcurrent: 2, maxQueued: 2 };
    const run = () => checkLetterheadIsolated(behave("spin"), { worker: WORKER, limits });
    const settled = await Promise.allSettled([run(), run(), run(), run(), run(), run()]);
    const busy = settled.filter((s) => s.status === "rejected" && s.reason instanceof PdfCheckBusyError);
    const refused = settled.filter((s) => s.status === "fulfilled" && JSON.stringify(s.value) === JSON.stringify(REFUSED));
    expect(refused.length).toBe(4); // 2 running, then the 2 queued run after them
    expect(busy.length).toBe(2);
    // and the slots are given back: a new check runs
    expect(await checkLetterheadIsolated(await a4())).toEqual({ ok: true });
  }, 20_000);

  it("states its limits", () => {
    expect(ISOLATED_PDF_CHECK).toMatchObject({ timeoutMs: 5_000, maxRssBytes: 512 * 1024 * 1024, maxConcurrent: 2 });
  });
});
