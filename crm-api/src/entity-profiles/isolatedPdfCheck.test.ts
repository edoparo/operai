import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG, PAGES, build, contentPdf, latin, page, stream } from "../test-support/pdfBuild";
import { ISOLATED_PDF_CHECK, PdfCheckBusyError, PdfCheckUnavailableError, acquireCheckSlot, boundPdfIsolated, checkLetterheadIsolated, pollIntervalFor, resetIsolatedPdfCheckForTests } from "./isolatedPdfCheck";

/**
 * Security round 10 (specs/20261115-crm-offer-wizard): the checks of an uploaded PDF run in a child process with a timeout and a
 * memory ceiling. The stand-in worker (`test-support/pdfWorkers.ts`) is what a check that a static bound missed does to its
 * process; the real worker answers the real files. Assertions are on verdicts and on the parent's event-loop lag, never on how
 * long a check takes.
 */

const WORKER = fileURLToPath(new URL("../test-support/pdfWorkers.ts", import.meta.url));
const behave = (what: string) => new TextEncoder().encode(what);
const REFUSED = { ok: false, reason: "too_complex" } as const;
const TIMED_OUT = { ok: false, reason: "too_complex", fromTimeout: true } as const; // a letterhead killed for time: its memo is short
const quick = { timeoutMs: 400 };

beforeEach(() => resetIsolatedPdfCheckForTests());
afterEach(() => setSystemTime());

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

  it("runs with an EMPTY environment even when it is started from a directory that holds a dotenv file (security L-12)", async () => {
    // Bun autoloads the dotenv file of a child's working directory whatever `env: {}` says, and on a developer machine the
    // parent's cwd (crm-api/) holds one. The stand-in worker reports how many variables it holds.
    const dir = mkdtempSync(join(tmpdir(), "crm-dotenv-"));
    writeFileSync(join(dir, `${"."}env`), "CRM_DOTENV_SENTINEL=1\nSERVICE_CLIENT_SECRET=not-for-the-child\n");
    process.env.CRM_TEST_SECRET_SENTINEL = "visible-to-parent-only";
    const before = process.cwd();
    process.chdir(dir);
    try {
      const verdict = (await boundPdfIsolated(behave("envsize"), { worker: WORKER })) as { ok: boolean; envSize?: number };
      expect(verdict.ok).toBe(true);
      expect(verdict.envSize).toBe(0);
    } finally {
      process.chdir(before);
      delete process.env.CRM_TEST_SECRET_SENTINEL;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("a check that overruns is killed and refused", () => {
  it("a loop is killed at the timeout: `too_complex`, the same verdict a count gives", async () => {
    expect(await checkLetterheadIsolated(behave("spin"), { worker: WORKER, limits: quick })).toEqual(TIMED_OUT);
    expect(await boundPdfIsolated(behave("spin"), { worker: WORKER, limits: quick })).toEqual(REFUSED);
  });

  it("the parent's event loop keeps running while a child holds its own for the whole timeout (counted ticks, no clock bound)", async () => {
    // A check held in this process would hold the loop for the whole second: the interval would fire at most once. With the child it
    // fires on every turn; the bar (5 of about 100) is far under what a loaded machine delivers and far over what a held loop does.
    let ticks = 0;
    const beat = setInterval(() => ticks++, 10);
    const verdict = await checkLetterheadIsolated(behave("spin"), { worker: WORKER, limits: { timeoutMs: 1_000 } });
    clearInterval(beat);
    expect(verdict).toEqual(TIMED_OUT);
    expect(ticks).toBeGreaterThan(5);
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
    const refused = settled.filter((s) => s.status === "fulfilled" && JSON.stringify(s.value) === JSON.stringify(TIMED_OUT));
    expect(refused.length).toBe(4); // 2 running, then the 2 queued run after them
    expect(busy.length).toBe(2);
    // and the slots are given back: a new check runs
    expect(await checkLetterheadIsolated(await a4())).toEqual({ ok: true });
  }, 20_000);

  it("states its limits", () => {
    expect(ISOLATED_PDF_CHECK).toMatchObject({ timeoutMs: 5_000, maxRssBytes: 512 * 1024 * 1024, maxConcurrent: 2, maxQueued: 6, maxQueuedPerOwner: 2 });
  });

  it("polls the resident set every 20 ms where reading it is a file read (Linux /proc), every 100 ms where it spawns `ps` (security I-22)", () => {
    expect(pollIntervalFor("linux")).toBe(20);
    expect(pollIntervalFor("darwin")).toBe(100);
    expect(ISOLATED_PDF_CHECK.pollMs).toBe(pollIntervalFor(process.platform));
  });
});

describe("one user cannot hold the queue, and a busy check holds no bytes (security L-13)", () => {
  it("a user's waiting checks are capped (`maxQueuedPerOwner`): the next is 503 busy for that user only", async () => {
    const limits = { maxConcurrent: 1, maxQueued: 6, maxQueuedPerOwner: 2 };
    const run = (owner: string) => checkLetterheadIsolated(behave("ok"), { worker: WORKER, limits, owner });
    // the first runs, two wait, the fourth finds the user's share of the queue taken; another user still gets a place
    const settled = await Promise.allSettled([run("a"), run("a"), run("a"), run("a"), run("b")]);
    expect(settled.map((s) => (s.status === "rejected" && s.reason instanceof PdfCheckBusyError ? "busy" : s.status))).toEqual(["fulfilled", "fulfilled", "fulfilled", "busy", "fulfilled"]);
  });

  it("a slot is taken before the bytes are read: acquiring one is 503 busy when the checks and the queue are full", async () => {
    const limits = { maxConcurrent: 1, maxQueued: 1 };
    const first = await acquireCheckSlot(undefined, { limits });
    const queued = acquireCheckSlot(undefined, { limits }); // waits for the first
    await expect(acquireCheckSlot(undefined, { limits })).rejects.toBeInstanceOf(PdfCheckBusyError);
    first.release();
    (await queued).release();
    (await acquireCheckSlot(undefined, { limits })).release();
  });

  it("a check that holds a slot does not take a second one (it would wait for itself), and a slot is given back once", async () => {
    const limits = { maxConcurrent: 1, maxQueued: 0 };
    const slot = await acquireCheckSlot("a", { limits });
    expect(await checkLetterheadIsolated(await a4(), { slot, limits })).toEqual({ ok: true });
    expect((await boundPdfIsolated(await a4(), { slot, limits })).ok).toBe(true);
    slot.release();
    slot.release(); // twice: still one slot given back
    const again = await acquireCheckSlot("a", { limits });
    await expect(acquireCheckSlot("a", { limits })).rejects.toBeInstanceOf(PdfCheckBusyError);
    again.release();
  });

  it("a verdict that is already remembered needs no slot: a full queue does not refuse it", async () => {
    const bytes = await a4();
    const known = await boundPdfIsolated(bytes);
    const held = Array.from({ length: ISOLATED_PDF_CHECK.maxConcurrent + ISOLATED_PDF_CHECK.maxQueued }, () => acquireCheckSlot());
    try {
      await expect(acquireCheckSlot()).rejects.toBeInstanceOf(PdfCheckBusyError);
      expect(await boundPdfIsolated(bytes)).toEqual(known);
      await expect(checkLetterheadIsolated(bytes)).rejects.toBeInstanceOf(PdfCheckBusyError); // a letterhead memo is letterheadUse's, not this module's
    } finally {
      for (const slot of held) void slot.then((s) => s.release());
    }
  });
});

describe("a kill for time is not a lasting verdict about the file (security L-14)", () => {
  it("a timeout kill is remembered for `timeoutVerdictTtlMs` only; the file is checked again after", async () => {
    const bytes = behave("spin");
    expect(await boundPdfIsolated(bytes, { worker: WORKER, limits: quick })).toEqual(REFUSED);
    // within the time a worker that does not exist is never asked: the remembered refusal answers
    expect(await boundPdfIsolated(bytes, { worker: "/nonexistent/worker.ts" })).toEqual(REFUSED);
    setSystemTime(new Date(Date.now() + ISOLATED_PDF_CHECK.timeoutVerdictTtlMs + 1_000));
    // after it the check runs again (here: cannot start, a 503), the refusal is not served
    await expect(boundPdfIsolated(bytes, { worker: "/nonexistent/worker.ts" })).rejects.toBeInstanceOf(PdfCheckUnavailableError);
  });

  it("a memory kill is remembered for good: it does not depend on how busy the host is", async () => {
    const bytes = behave("alloc");
    const limits = { maxRssBytes: 200 * 1024 * 1024, timeoutMs: 20_000, pollMs: 25 };
    expect(await boundPdfIsolated(bytes, { worker: WORKER, limits })).toEqual(REFUSED);
    setSystemTime(new Date(Date.now() + 10 * ISOLATED_PDF_CHECK.timeoutVerdictTtlMs));
    expect(await boundPdfIsolated(bytes, { worker: "/nonexistent/worker.ts" })).toEqual(REFUSED);
  }, 30_000);

  it("a letterhead killed for time carries the mark that tells its memo (`fromTimeout`), one killed for memory does not", async () => {
    expect(await checkLetterheadIsolated(behave("spin"), { worker: WORKER, limits: quick })).toEqual(TIMED_OUT);
    expect(await checkLetterheadIsolated(behave("alloc"), { worker: WORKER, limits: { maxRssBytes: 200 * 1024 * 1024, timeoutMs: 20_000, pollMs: 25 } })).toEqual(REFUSED);
  }, 30_000);
});

describe("the children do not outlive the service (security L-15)", () => {
  const HARNESS = fileURLToPath(new URL("../test-support/pdfParentHarness.ts", import.meta.url));
  const alive = (pid: number): boolean => {
    const ps = Bun.spawnSync(["/bin/ps", "-o", "stat=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" });
    const stat = new TextDecoder().decode(ps.stdout).trim();
    return stat !== "" && !stat.startsWith("Z"); // a zombie is dead, waiting only to be reaped
  };
  async function gone(pids: number[], withinMs: number): Promise<boolean> {
    for (let waited = 0; waited < withinMs; waited += 50) {
      if (!pids.some(alive)) return true;
      await Bun.sleep(50);
    }
    return false;
  }
  /** A parent process with one looping child; resolves with both. `hardDeadlineMs` is what the child is given for its own end. */
  async function parentWithSpinningChild(hardDeadlineMs: number) {
    const parent = Bun.spawn([process.execPath, HARNESS, String(hardDeadlineMs)], { stdout: "pipe", stderr: "ignore", env: {} });
    const reader = (parent.stdout as ReadableStream<Uint8Array>).getReader();
    const line = new TextDecoder().decode((await reader.read()).value);
    const pids = JSON.parse(line) as number[];
    expect(pids).toHaveLength(1);
    expect(alive(pids[0]!)).toBe(true);
    return { parent, pids };
  }

  it("on SIGTERM (what the platform sends) the service kills the live children and ends by the signal", async () => {
    const { parent, pids } = await parentWithSpinningChild(60_000); // the child's own deadline is far: only the handler can end it in time
    try {
      parent.kill("SIGTERM");
      await parent.exited;
      expect(parent.signalCode).toBe("SIGTERM");
      expect(await gone(pids, 5_000)).toBe(true);
    } finally {
      for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
    }
  }, 20_000);

  it("on SIGINT the same", async () => {
    const { parent, pids } = await parentWithSpinningChild(60_000);
    try {
      parent.kill("SIGINT");
      await parent.exited;
      expect(parent.signalCode).toBe("SIGINT");
      expect(await gone(pids, 5_000)).toBe(true);
    } finally {
      for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
    }
  }, 20_000);

  it("when the parent is killed without a chance to act (SIGKILL, the OOM killer) a looping child ends at its own deadline", async () => {
    const { parent, pids } = await parentWithSpinningChild(1_500);
    try {
      parent.kill("SIGKILL");
      await parent.exited;
      expect(await gone(pids, 10_000)).toBe(true);
    } finally {
      for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
    }
  }, 20_000);
});
